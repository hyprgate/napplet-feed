// napplets/feed/src/lib/feed-origin.ts
// The single origin-routing seam for the feed (Phase 88, FEED-02).
//
// subscribeForPayload turns a FeedIntentPayload into ONE subscription, routing
// by `origin` and returning a uniform { close } handle (same shape as
// relay.subscribe / profile-metadata's adapter):
//
//   origin:'outbox'  → NAP-OUTBOX discovery: outbox.subscribe(filters) when
//                      supports('outbox'),
//                      else NAP-RELAYS fallback via relay.subscribe.
//
//   origin:'relay'   → NAP-RELAYS exact relay fan-out: one relay.subscribe call
//                      per payload relay, scoped with { relay: url }. This keeps
//                      saved nfeed relays on the relay domain instead of tunneling
//                      them through NAP-OUTBOX exact-pin options.
//
// The supports('outbox') gate MUST be read AFTER await shell.ready() — it is
// false until shell.init lands (Phase 87 canonical pattern, profile-metadata.ts).

import {
  outbox,
  relay,
  type OutboxSubscribeOptions,
  type RelayEventResult,
  type Subscription,
} from '@napplet/sdk';
import type { FeedIntentPayload, NostrEvent, NostrFilter } from '@hyprgate/types';

/** Minimal shape of the shim-installed shell handshake we depend on. */
interface NappletShellHandle {
  ready(): Promise<unknown>;
  supports(domain: string, protocol?: string): boolean;
}

function getShell(): NappletShellHandle | null {
  return (globalThis as unknown as { napplet?: { shell?: NappletShellHandle } }).napplet?.shell ?? null;
}

/** Callbacks for a payload subscription. */
export interface PayloadSubscriptionCallbacks {
  onEvent(event: NostrEvent, relayHints?: string[]): void;
  onEose(reason?: string): void;
  onRoute?(route: 'outbox' | 'relay'): void;
}

/**
 * Apply caller-supplied per-leg props (e.g. `{ limit, until }` for the page leg,
 * `{ since }` for the live leg) onto every filter, returning PLAIN, structured-
 * cloneable filter objects.
 *
 * The deep clone is load-bearing, not cosmetic: an intent/persisted payload's
 * `filters` originate from the App's Svelte `$state`, so they are reactive
 * Proxies. The outbox/relay SDK `subscribe()` posts these filters to the shell
 * via `postMessage`, and a Proxy is NOT structured-cloneable — `postMessage`
 * throws `DataCloneError` and the subscription silently never crosses the iframe
 * boundary (the FEED-02 root cause: outbox.subscribe never reached the runtime).
 * A JSON round-trip strips the Proxy; a NostrFilter is always JSON-serializable.
 */
function withExtraProps(
  filters: NostrFilter[],
  extra: Record<string, unknown> | undefined,
): NostrFilter[] {
  const merged =
    extra && Object.keys(extra).length > 0
      ? filters.map((filter) => ({ ...filter, ...extra }))
      : filters;
  return JSON.parse(JSON.stringify(merged)) as NostrFilter[];
}

/**
 * Build a uniform { close } subscription from a FeedIntentPayload.
 *
 * @param payload - The validated feed wireformat (filters + origin + relays).
 * @param callbacks - onEvent / onEose.
 * @param extraFilterProps - Per-leg filter props merged into every filter (the
 *   feed-engine passes `{ limit, until }` for the paged leg and `{ since }` for
 *   the live leg, preserving its pagination/live split).
 * @param outboxOptions - Shell-owned outbox lifecycle options. These stay out
 *   of Nostr filters, which keeps pagination filters protocol-shaped.
 * @returns A synchronous { close } handle; the subscription opens after the
 *   shell.ready() gate resolves, and an early close() is honored.
 */
export function subscribeForPayload(
  payload: FeedIntentPayload,
  callbacks: PayloadSubscriptionCallbacks,
  extraFilterProps?: Record<string, unknown>,
  outboxOptions?: OutboxSubscribeOptions,
): Subscription {
  const filters = withExtraProps(payload.filters, extraFilterProps);

  let subscription: Subscription | null = null;
  let closed = false;
  let closeWhenReady = false;

  // Close guard set up synchronously: an early close() (before the ready() gate
  // resolves) defers, then closes the subscription as soon as it opens.
  function close(): void {
    if (closed) return;
    closed = true;
    if (subscription) {
      subscription.close();
    } else {
      closeWhenReady = true;
    }
  }

  function openOutbox(): Subscription {
    const sub = outboxOptions === undefined
      ? outbox.subscribe(filters)
      : outbox.subscribe(filters, outboxOptions);
    let eoseSent = false;
    let remoteClosed = false;
    const sendEose = (reason?: string): void => {
      if (closed || eoseSent) return;
      eoseSent = true;
      remoteClosed = true;
      callbacks.onEose(reason);
    };

    sub.on('event', (result: RelayEventResult) => {
      if (closed || remoteClosed) return;
      callbacks.onEvent(result.event as NostrEvent, result.sidecar?.relayHints);
    });
    sub.on('closed', sendEose);
    return { close: () => sub.close() };
  }

  function openRelayFallback(relayUrl?: string): Subscription {
    return relay.subscribe(
      filters,
      (result) => callbacks.onEvent(
        result.event as NostrEvent,
        result.sidecar?.relayHints,
      ),
      () => callbacks.onEose(),
      relayUrl ? { relay: relayUrl } : undefined,
    );
  }

  function openPinnedRelays(relays: string[]): Subscription {
    const relayUrls = [...relays];
    const subs: Subscription[] = [];
    const seenIds = new Set<string>();
    let remainingEose = relayUrls.length;
    let eoseSent = false;

    function maybeEose(): void {
      if (eoseSent || remainingEose > 0) return;
      eoseSent = true;
      callbacks.onEose();
    }

    for (const relayUrl of relayUrls) {
      subs.push(relay.subscribe(
        filters,
        (result) => {
          const event = result.event as NostrEvent;
          if (seenIds.has(event.id)) return;
          seenIds.add(event.id);
          callbacks.onEvent(event, result.sidecar?.relayHints);
        },
        () => {
          remainingEose -= 1;
          maybeEose();
        },
        { relay: relayUrl },
      ));
    }

    return {
      close: () => {
        for (const sub of subs) sub.close();
      },
    };
  }

  void (async () => {
    const shell = getShell();
    await shell?.ready();
    if (closed) return;
    const useOutbox = shell?.supports('outbox') ?? false;

    if (payload.origin === 'relay') {
      callbacks.onRoute?.('relay');
      subscription = openPinnedRelays(payload.relays ?? []);
    } else if (useOutbox) {
      // Outbox discovery (NIP-65 author-write relays).
      callbacks.onRoute?.('outbox');
      subscription = openOutbox();
    } else {
      // NAP-RELAYS fallback: the runtime selects relays from the filter set.
      callbacks.onRoute?.('relay');
      subscription = openRelayFallback();
    }

    if (closeWhenReady) subscription.close();
  })();

  return { close };
}
