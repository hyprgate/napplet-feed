import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedIntentPayload, NostrEvent } from '@hyprgate/types';
import { outbox, relay } from '@napplet/sdk';
import { subscribeForPayload } from './feed-origin.js';

vi.mock('@napplet/sdk', () => ({
  relay: { subscribe: vi.fn() },
  outbox: { subscribe: vi.fn(), query: vi.fn() },
}));

interface FakeOutboxSub {
  close: ReturnType<typeof vi.fn>;
  handlers: Record<string, ((...args: unknown[]) => void) | undefined>;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  emit: (event: string, ...args: unknown[]) => void;
}

function makeOutboxSub(): FakeOutboxSub {
  const sub: FakeOutboxSub = {
    close: vi.fn(),
    handlers: {},
    on(event, cb) {
      this.handlers[event] = cb;
    },
    emit(event, ...args) {
      this.handlers[event]?.(...args);
    },
  };
  return sub;
}

function installShell(supportsOutbox: boolean): void {
  (globalThis as unknown as { napplet: unknown }).napplet = {
    shell: {
      ready: vi.fn().mockResolvedValue({}),
      supports: vi.fn((domain: string) => (domain === 'outbox' ? supportsOutbox : false)),
    },
  };
}

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function ev(id: string): NostrEvent {
  return { id, kind: 1, pubkey: 'pk', created_at: 1, tags: [], content: id, sig: 'sig' };
}

describe('subscribeForPayload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(relay.subscribe).mockReturnValue({ close: vi.fn() });
    vi.mocked(outbox.subscribe).mockReturnValue(
      makeOutboxSub() as unknown as ReturnType<typeof outbox.subscribe>,
    );
    vi.mocked(outbox.query).mockResolvedValue({ events: [] });
    installShell(true);
  });

  afterEach(() => {
    delete (globalThis as unknown as { napplet?: unknown }).napplet;
  });

  it('origin:outbox streams historical page events through outbox.subscribe', async () => {
    installShell(true);
    const sub = makeOutboxSub();
    vi.mocked(outbox.subscribe).mockReturnValue(sub as unknown as ReturnType<typeof outbox.subscribe>);

    const payload: FeedIntentPayload = { filters: [{ kinds: [1] }], origin: 'outbox' };
    const onEvent = vi.fn();
    const onEose = vi.fn();
    const handle = subscribeForPayload(payload, { onEvent, onEose });
    await flush();

    expect(relay.subscribe).not.toHaveBeenCalled();
    expect(outbox.subscribe).toHaveBeenCalledWith([{ kinds: [1] }]);
    expect(outbox.query).not.toHaveBeenCalled();
    expect(onEose).not.toHaveBeenCalled();

    const event = ev('late-author-history');
    sub.emit('event', { event, sidecar: { relayHints: ['wss://relay.example'] } });
    expect(onEvent).toHaveBeenCalledWith(event, ['wss://relay.example']);

    sub.emit('closed');
    expect(onEose).toHaveBeenCalledOnce();

    handle.close();
    expect(sub.close).toHaveBeenCalledOnce();
  });

  it('origin:relay with AUTHOR-BEARING filters uses scoped NAP-RELAYS subscriptions', async () => {
    installShell(true);
    const relaySubs = [{ close: vi.fn() }, { close: vi.fn() }];
    const onEvents: Array<(result: {
      event: NostrEvent;
      sidecar?: { relayHints?: string[] };
    }) => void> = [];
    const onEoses: Array<() => void> = [];
    vi.mocked(relay.subscribe).mockImplementation((filters, onEvent, onEose, options) => {
      onEvents.push(onEvent as (result: {
        event: NostrEvent;
        sidecar?: { relayHints?: string[] };
      }) => void);
      onEoses.push(onEose);
      expect(filters).toEqual([{ kinds: [1], authors: ['a'.repeat(64), 'b'.repeat(64)] }]);
      return relaySubs[onEvents.length - 1]!;
    });

    const payload: FeedIntentPayload = {
      filters: [{ kinds: [1], authors: ['a'.repeat(64), 'b'.repeat(64)] }],
      origin: 'relay',
      relays: ['wss://a', 'wss://b'],
    };
    const cbEvent = vi.fn();
    const cbEose = vi.fn();
    const handle = subscribeForPayload(payload, { onEvent: cbEvent, onEose: cbEose });
    await flush();

    expect(outbox.subscribe).not.toHaveBeenCalled();
    expect(relay.subscribe).toHaveBeenCalledTimes(2);
    expect(vi.mocked(relay.subscribe).mock.calls.map((call) => call[3])).toEqual([
      { relay: 'wss://a' },
      { relay: 'wss://b' },
    ]);

    const event = ev('a');
    onEvents[0]!({ event, sidecar: { relayHints: ['wss://observed'] } });
    onEvents[1]!({ event });
    expect(cbEvent).toHaveBeenCalledOnce();
    expect(cbEvent).toHaveBeenCalledWith(event, [
      'wss://a',
      'wss://b',
      'wss://observed',
    ]);

    onEoses[0]!();
    expect(cbEose).not.toHaveBeenCalled();
    onEoses[1]!();
    expect(cbEose).toHaveBeenCalledOnce();

    handle.close();
    expect(relaySubs[0]!.close).toHaveBeenCalledOnce();
    expect(relaySubs[1]!.close).toHaveBeenCalledOnce();
  });

  it('hands DETACHED, structured-cloneable filters + relay options to the SDK (FEED-02 DataClone fix)', async () => {
    // The wire payload reaches the shell via postMessage, which structured-clones
    // it. An intent payload's filters/relays come from the App's Svelte `$state`,
    // i.e. reactive Proxies that postMessage CANNOT clone (DataCloneError → the
    // subscription silently never crosses the iframe boundary, the FEED-02 root
    // cause). subscribeForPayload must therefore hand the SDK plain, detached,
    // cloneable copies — never the live payload references.
    installShell(true);
    let seenFilters: unknown;
    let seenOptions: Record<string, unknown> | undefined;
    vi.mocked(relay.subscribe).mockImplementation((filters, _onEvent, _onEose, options) => {
      seenFilters = filters;
      seenOptions = options as Record<string, unknown>;
      return { close: vi.fn() };
    });

    const payload: FeedIntentPayload = {
      filters: [{ kinds: [1], '#t': ['nostr'] }],
      origin: 'relay',
      relays: ['wss://a'],
    };
    subscribeForPayload(payload, { onEvent: vi.fn(), onEose: vi.fn() });
    await flush();

    // Detached: a NEW object graph, not the live (potentially-proxied) payload refs.
    expect(seenFilters).not.toBe(payload.filters);
    expect((seenFilters as unknown[])[0]).not.toBe(payload.filters[0]);
    // Value-preserving …
    expect(seenFilters).toEqual([{ kinds: [1], '#t': ['nostr'] }]);
    expect(seenOptions).toEqual({ relay: 'wss://a' });
    // … and structured-cloneable (postMessage can never throw DataCloneError).
    expect(() => structuredClone(seenFilters)).not.toThrow();
    expect(() => structuredClone(seenOptions)).not.toThrow();
  });

  it('falls back to relay.subscribe when outbox is unsupported (degraded)', async () => {
    installShell(false);
    let onEvent: ((result: { event: NostrEvent }) => void) | undefined;
    let onEose: (() => void) | undefined;
    const close = vi.fn();
    vi.mocked(relay.subscribe).mockImplementation((filters, eCb, eoCb) => {
      onEvent = eCb as (result: { event: NostrEvent }) => void;
      onEose = eoCb;
      expect(filters).toEqual([{ kinds: [1] }]);
      return { close };
    });

    const payload: FeedIntentPayload = { filters: [{ kinds: [1] }], origin: 'outbox' };
    const cbEvent = vi.fn();
    const cbEose = vi.fn();
    subscribeForPayload(payload, { onEvent: cbEvent, onEose: cbEose });
    await flush();

    expect(outbox.subscribe).not.toHaveBeenCalled();
    onEvent?.({ event: ev('x') });
    onEose?.();
    expect(cbEvent).toHaveBeenCalledWith(ev('x'), undefined);
    expect(cbEose).toHaveBeenCalledOnce();
  });

  it('merges extraFilterProps into every filter (page leg: limit+until; live leg: since)', async () => {
    installShell(true);
    let seenFilters: Array<Record<string, unknown>> | undefined;
    vi.mocked(outbox.subscribe).mockImplementation((filters) => {
      seenFilters = filters as Array<Record<string, unknown>>;
      return makeOutboxSub() as unknown as ReturnType<typeof outbox.subscribe>;
    });

    const payload: FeedIntentPayload = { filters: [{ kinds: [1] }, { kinds: [6] }], origin: 'outbox' };
    subscribeForPayload(payload, { onEvent: vi.fn(), onEose: vi.fn() }, { limit: 50, until: 1000 });
    await flush();

    expect(seenFilters).toEqual([
      { kinds: [1], limit: 50, until: 1000 },
      { kinds: [6], limit: 50, until: 1000 },
    ]);
  });

  it('passes a requested finite outbox budget without adding it to Nostr filters', async () => {
    installShell(true);
    const sub = makeOutboxSub();
    vi.mocked(outbox.subscribe).mockReturnValue(sub as unknown as ReturnType<typeof outbox.subscribe>);

    subscribeForPayload(
      { filters: [{ kinds: [1] }], origin: 'outbox' },
      { onEvent: vi.fn(), onEose: vi.fn() },
      { limit: 50 },
      { timeoutMs: 20_000 },
    );
    await flush();

    expect(outbox.subscribe).toHaveBeenCalledWith([{ kinds: [1], limit: 50 }], { timeoutMs: 20_000 });
  });

  it('honors close() called before the ready() gate resolves (no subscription opened)', async () => {
    installShell(true);
    const close = vi.fn();
    vi.mocked(outbox.subscribe).mockImplementation(() => {
      const s = makeOutboxSub();
      s.close = close;
      return s as unknown as ReturnType<typeof outbox.subscribe>;
    });

    const payload: FeedIntentPayload = { filters: [{ kinds: [1] }], origin: 'outbox' };
    const handle = subscribeForPayload(payload, { onEvent: vi.fn(), onEose: vi.fn() });
    handle.close(); // before await ready() resolves
    await flush();

    expect(outbox.subscribe).not.toHaveBeenCalled();
    expect(outbox.query).not.toHaveBeenCalled();
    expect(relay.subscribe).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('returns a { close } handle that closes the underlying outbox subscription', async () => {
    installShell(true);
    const sub = makeOutboxSub();
    vi.mocked(outbox.subscribe).mockReturnValue(sub as unknown as ReturnType<typeof outbox.subscribe>);

    const payload: FeedIntentPayload = { filters: [{ kinds: [1] }], origin: 'outbox' };
    const handle = subscribeForPayload(payload, { onEvent: vi.fn(), onEose: vi.fn() });
    await flush();
    handle.close();
    expect(sub.close).toHaveBeenCalledOnce();
  });
});
