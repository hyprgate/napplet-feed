<script lang="ts">
  import { onMount } from 'svelte';
  import { inc, identity } from '@napplet/sdk';
  // Local alias kept for the existing identity:changed subscriptions below.
  const ipc = inc;
  import type { FeedIntentPayload } from '@hyprgate/types';
  import {
    IDENTITY_CHANGED_TOPIC,
    LEGACY_AUTH_IDENTITY_CHANGED_TOPIC,
    parseIdentityChangedPayload,
    validateFeedIntentPayload,
    waitForPublicKey,
  } from '@hyprgate/utils';
  import { getInstancePayload, setInstancePayload } from './lib/feed-storage';
  import FeedContainer from './components/FeedContainer.svelte';

  // ── App state ──────────────────────────────────────────────────────────────
  let pubkey: string | null = $state(null);
  // The active intent/persisted payload driving this window, or null. Once a
  // VALID payload is applied the feed renders REGARDLESS of pubkey (W-2): the
  // payload path is independent of login. `null` keeps the no-payload
  // following-default behavior (which needs a pubkey to resolve kind-3).
  let payload: FeedIntentPayload | null = $state(null);
  let hasPayload = $derived(payload != null);
  let payloadStartupResolved = $state(false);

  /** The inc topic the feed emits once subscribed to feed:open (Pitfall 2). */
  const FEED_READY_TOPIC = 'feed:ready';

  // ── Listen for identity + intent payload from shell ─────────────────────────
  // Use onMount (not $effect) to avoid Svelte 5 reactivity loops —
  // on() callbacks write to $state which must not re-trigger the subscription setup.
  onMount(() => {
    const controller = new AbortController();

    const handleIdentityChanged = (raw: unknown) => {
      const identityChange = parseIdentityChangedPayload(raw);
      if (identityChange) pubkey = identityChange.pubkey;
    };
    const canonicalSub = ipc.on(IDENTITY_CHANGED_TOPIC, handleIdentityChanged);
    const legacySub = ipc.on(LEGACY_AUTH_IDENTITY_CHANGED_TOPIC, handleIdentityChanged);

    // feed:open — the intent payload targeted at THIS window (NAP-INTENT). The
    // payload crosses the napplet trust boundary, so it is UNTRUSTED: validate
    // before applying (T-88-09); invalid payloads are dropped. A valid payload
    // is applied to the render path and persisted per-window so reload restores it.
    const applyPayload = (raw: unknown): void => {
      const valid = validateFeedIntentPayload(raw);
      if (!valid) return;
      payload = valid;
      payloadStartupResolved = true;
      void setInstancePayload(valid);
    };
    // inc.on('feed:open', …) — the canonical NAP-INTENT delivery seam (key_link).
    const feedOpenSub = inc.on('feed:open', applyPayload);

    // Boot precedence (RESEARCH §Backward-compat): persisted instance payload >
    // intent feed:open payload (live above) > following-default (if pubkey) >
    // empty state. Restore the persisted payload first; a live feed:open
    // overrides it (the controller flushes after feed:ready, below).
    void getInstancePayload().then((restored) => {
      if (controller.signal.aborted) return;
      if (restored && payload == null) payload = restored;
      payloadStartupResolved = true;
    }).catch(() => {
      if (!controller.signal.aborted) payloadStartupResolved = true;
    });

    // Emit feed:ready AFTER the feed:open subscription is registered so the
    // Plan 01 controller flushes the buffered payload only once we can receive
    // it (delivery race — Pitfall 2).
    ipc.emit(FEED_READY_TOPIC);

    void waitForPublicKey(identity, {
      signal: controller.signal,
      onError: (err) => console.error('[feed/App] getPublicKey failed:', err),
    }).then((pk) => {
      if (!controller.signal.aborted && !pubkey && pk) pubkey = pk;
    });

    return () => {
      controller.abort();
      canonicalSub.close();
      legacySub.close();
      feedOpenSub.close();
    };
  });
</script>

<div
  class="app h-screen w-screen overflow-hidden bg-bg-base text-text-primary font-mono"
  data-feed-payload={payload ? JSON.stringify(payload) : ''}
  data-feed-has-payload={hasPayload}
>
  {#if payloadStartupResolved && (hasPayload || pubkey != null)}
    <!-- Render the feed when a valid payload exists OR a user is logged in.
         The payload path (W-2) does NOT require a pubkey; FeedContainer guards
         every pubkey-derived behavior behind a null check. -->
    <FeedContainer {pubkey} {payload} />
  {:else}
    <div class="flex items-center justify-center h-full">
      <p class="text-text-muted text-sm">not logged in</p>
    </div>
  {/if}
</div>
