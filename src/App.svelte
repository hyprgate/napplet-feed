<script lang="ts">
  import { onMount } from 'svelte';
  import { identity, intent } from '@napplet/sdk';
  import type { FeedIntentPayload } from '@hyprgate/types';
  import {
    waitForPublicKey,
  } from '@hyprgate/utils';
  import { getInstancePayload, setInstancePayload } from './lib/feed-storage';
  import { feedPayloadFromIntentDelivery } from './feed-intent-delivery.js';
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

  // ── Listen for identity + intent payload from shell ─────────────────────────
  // Use onMount (not $effect) to avoid Svelte 5 reactivity loops —
  // on() callbacks write to $state which must not re-trigger the subscription setup.
  onMount(() => {
    const controller = new AbortController();

    const identitySub = identity.onChanged((nextPubkey) => {
      pubkey = nextPubkey || null;
    });

    // Validate the target contract and payload before applying and persisting it.
    const applyPayload = (event): void => {
      const valid = feedPayloadFromIntentDelivery(event);
      if (!valid) return;
      payload = valid;
      payloadStartupResolved = true;
      void setInstancePayload(valid);
    };
    const feedOpenSub = intent.onDelivery(applyPayload);

    // Buffered/live delivery takes precedence over asynchronous persisted state.
    void getInstancePayload().then((restored) => {
      if (controller.signal.aborted) return;
      if (restored && payload == null) payload = restored;
      payloadStartupResolved = true;
    }).catch(() => {
      if (!controller.signal.aborted) payloadStartupResolved = true;
    });

    void waitForPublicKey(identity, {
      signal: controller.signal,
      onError: (err) => console.error('[feed/App] getPublicKey failed:', err),
    }).then((pk) => {
      if (!controller.signal.aborted && !pubkey && pk) pubkey = pk;
    });

    return () => {
      controller.abort();
      identitySub.close();
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
