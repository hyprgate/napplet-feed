<script lang="ts">
  import { onMount } from 'svelte';
  import type { FeedIntentPayload, NostrEvent } from '@hyprgate/types';
  import type { Subscription } from '@napplet/sdk';
  import { hasNsfwTag, parseNoteContent } from '@hyprgate/utils';
  import { createFeedStore } from '../lib/feed-store';
  import type { EngagementCounts, FeedLoadIntent, ViewMode } from '../lib/feed-store';
  import { createEmojiSetStore, type EmojiOption } from '../lib/emoji-sets';
  import { subscribeProfileMetadata, type ProfileContent } from '../lib/profile-metadata';
  import {
    getViewMode as loadSharedViewMode,
    setViewMode as persistSharedViewMode,
    getShowReplies as loadSharedShowReplies,
    setShowReplies as persistSharedShowReplies,
    getDetailedReactions as loadSharedDetailedReactions,
    setDetailedReactions as persistSharedDetailedReactions,
  } from '../lib/feed-storage';
  import FeedList from './FeedList.svelte';
  import FeedCards from './FeedCards.svelte';
  import FeedTerminal from './FeedTerminal.svelte';
  import NewNotesBanner from './NewNotesBanner.svelte';
  import ComposeInline from './ComposeInline.svelte';
  import ReactionSettings from './ReactionSettings.svelte';

  interface Props {
    /**
     * The logged-in user's pubkey, or null when driven purely by a payload
     * (W-2: the payload render path is pubkey-independent). All pubkey-derived
     * behavior (following resolution, compose, emoji init) is guarded below.
     */
    pubkey: string | null;
    /**
     * The active intent/persisted FeedIntentPayload, or null. When present, the
     * timeline is built ENTIRELY from the payload (FEED-01/FEED-02) — the
     * following/global source machinery is bypassed.
     */
    payload?: FeedIntentPayload | null;
  }

  const SHARED_PREF_STARTUP_BUDGET_MS = 200;
  const PROFILE_METADATA_BATCH_MS = 250;

  let { pubkey, payload = null }: Props = $props();

  // ── Reactive local copies of store state ──────────────────────────────────
  // Feed store uses plain mutable state (not Svelte runes).
  // syncState() is wired as the onUpdate callback so every store mutation
  // immediately copies fields into these $state variables, triggering Svelte
  // reactivity — the same pattern used by profile-store / profile App.svelte.
  let timeline = $state<NostrEvent[]>([]);
  let pendingCount = $state(0);
  let engagementVersion = $state(0);
  let loading = $state(false);
  let canLoadMore = $state(false);
  let error = $state<string | null>(null);
  let viewMode = $state<ViewMode>('compact');
  let showReplies = $state(false);
  let detailedReactions = $state(false);
  // NSFW is hidden by default; #nsfw-tagged notes only appear when enabled.
  let showNsfw = $state(false);
  let visibleTimeline = $derived(
    showNsfw ? timeline : timeline.filter((event) => !hasNsfwTag(event)),
  );

  function syncState(): void {
    const s = store.state;
    const nextTimeline = [...s.timeline];
    // The store mutates state.timeline in place (splice) and notifies after
    // every streamed event. Snapshot into a fresh array so Svelte's referential
    // equality check sees a change and re-renders incrementally as notes arrive,
    // instead of only repainting when some other field (e.g. loading at EOSE)
    // changes — which made the feed feel like it waited for completion.
    timeline = nextTimeline;
    pendingCount = s.pendingNew.length;
    engagementVersion = s.engagementVersion;
    loading = s.loading;
    canLoadMore = s.canLoadMore;
    error = s.error;
    viewMode = s.viewMode;
    showReplies = s.showReplies;
    detailedReactions = s.detailedReactions;
    loadMissingProfiles(nextTimeline);
  }

  // Create feed store with syncState wired as the onUpdate callback
  const store = createFeedStore(syncState);
  const emojiStore = createEmojiSetStore(syncEmojiState);
  let emojiVersion = $state(0);

  function syncEmojiState(): void {
    emojiVersion++;
  }

  // ── Store method wrappers ─────────────────────────────────────────────────
  // Store methods already call notify() → syncState() internally, so no
  // manual syncState() call needed here.
  function setViewMode(mode: ViewMode) {
    store.setViewMode(mode);
    // viewMode is a SHARED (cross-window) pref — persist via shared storage so
    // every feed window picks it up, not just this instance (FEED-05).
    void persistSharedViewMode(mode);
  }

  function setShowReplies(next: boolean) {
    store.setShowReplies(next);
    // showReplies is SHARED across windows (FEED-05).
    void persistSharedShowReplies(next);
  }

  function setDetailedReactions(next: boolean) {
    store.setDetailedReactions(next);
    void persistSharedDetailedReactions(next);
  }

  function loadNewNotes() {
    store.loadNewNotes();
  }

  function loadMore(intent?: FeedLoadIntent) {
    store.loadMore(intent);
  }

  function setEngagementTargetIds(targetIds: string[]): void {
    store.setEngagementTargetIds(targetIds);
  }

  $effect(() => {
    if (!loading && canLoadMore && timeline.length === 0) {
      loadMore();
    }
  });

  // ── Profile loading ────────────────────────────────────────────────────────
  // For each unique pubkey in timeline, load their profile via a real relay subscription.
  // Keep the map itself immutable at the Svelte boundary: mutating a stable Map
  // can leave child feed rows stuck on npub/avatar fallbacks even after metadata
  // arrives.
  let profileMap = $state(new Map<string, ProfileContent>());
  const loadingPubkeys = new Set<string>();
  const profileSubscriptions = new Set<Subscription>();
  const queuedProfilePubkeys = new Set<string>();
  let profileBatchTimer: ReturnType<typeof setTimeout> | null = null;

  function loadMissingProfiles(events: NostrEvent[]): void {
    const missingPubkeys = [...collectTimelineProfilePubkeys(events)]
      .filter((pk) => !loadingPubkeys.has(pk) && !profileMap.has(pk));

    if (missingPubkeys.length === 0) return;

    for (const pk of missingPubkeys) queuedProfilePubkeys.add(pk);
    if (profileBatchTimer !== null) return;

    profileBatchTimer = setTimeout(() => {
      profileBatchTimer = null;
      flushProfileMetadataBatch();
    }, PROFILE_METADATA_BATCH_MS);
  }

  function flushProfileMetadataBatch(): void {
    const missingPubkeys = [...queuedProfilePubkeys]
      .filter((pk) => !loadingPubkeys.has(pk) && !profileMap.has(pk));
    queuedProfilePubkeys.clear();

    if (missingPubkeys.length === 0) return;

    for (const pk of missingPubkeys) loadingPubkeys.add(pk);

    let subscription: Subscription | null = null;
    try {
      subscription = subscribeProfileMetadata(
        missingPubkeys,
        (pk, metadata) => {
          profileMap = new Map(profileMap).set(pk, metadata);
          loadingPubkeys.delete(pk);
        },
        () => {
          // This only marks the initial profile pass; the subscription remains
          // live so late relay/cache metadata can replace npub fallbacks.
        },
      );
      profileSubscriptions.add(subscription);
    } catch {
      for (const pk of missingPubkeys) loadingPubkeys.delete(pk);
    }
  }

  $effect(() => {
    loadMissingProfiles(timeline);
  });

  function collectTimelineProfilePubkeys(events: NostrEvent[]): Set<string> {
    const pubkeys = new Set<string>();
    for (const event of events) {
      pubkeys.add(event.pubkey);
      for (const block of parseNoteContent(event.content)) {
        if (block.type === 'profile') pubkeys.add(block.value);
      }
    }
    return pubkeys;
  }

  let profiles = $derived(profileMap);

  let engagement = $derived.by((): Map<string, EngagementCounts> => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    engagementVersion;
    return store.state.engagement;
  });

  let reactionOptions = $derived.by((): EmojiOption[] => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    emojiVersion;
    return emojiStore.state.options;
  });

  // The payload that has already been applied to the store, so a re-delivered or
  // identical payload does not rebuild the subscription (idempotent apply).
  let appliedPayloadKey: string | null = null;
  // Gate so the post-mount payload effect does not fire until the initial
  // restore (shared prefs + first source) has completed — otherwise it could
  // race the onMount sequence and double-open / clobber the subscription.
  let initialized = $state(false);

  /**
   * Drive the timeline from the active payload when present (FEED-01/02), else
   * fall back to the following/global default source — which needs a pubkey.
   */
  function applyActiveSource(): void {
    if (payload != null) {
      appliedPayloadKey = JSON.stringify(payload);
      store.applyPayload(payload);
      return;
    }
    // No payload: the backward-compat following/global default. This path needs
    // a pubkey to resolve kind-3 follows; with no pubkey we render the empty
    // state (App.svelte only mounts us here when hasPayload || pubkey != null,
    // so a null pubkey on this branch means the user logged out mid-session).
    if (pubkey != null) store.init(pubkey);
  }

  // React to a payload that arrives AFTER the initial restore (the Plan 01
  // controller flushes feed:open once this window signals feed:ready —
  // Pitfall 2). Guarded by `initialized` + an applied-payload content check so
  // streamed store updates and the initial mount do not re-trigger an apply.
  $effect(() => {
    const next = payload;
    if (!initialized) return;
    if (next != null) {
      const nextKey = JSON.stringify(next);
      if (nextKey === appliedPayloadKey) return;
      appliedPayloadKey = nextKey;
      store.applyPayload(next);
    }
  });

  // ── Initialize feed on mount ───────────────────────────────────────────────
  // Use onMount (not $effect) to avoid Svelte 5 reactivity loops —
  // store callbacks write to $state which must not re-trigger init.
  onMount(() => {
    // Restore SHARED (cross-window) prefs before opening any subscription so the
    // first page is built with the user's persisted viewMode/showReplies (FEED-05).
    // setViewMode/setShowReplies must be seeded BEFORE applyActiveSource so the
    // reply policy is correct on the first page and the source is opened once.
    // The shared prefs (viewMode/showReplies) are NON-ESSENTIAL. Give them a
    // tiny startup budget so a healthy storage bridge still seeds the first
    // page, but never let a lost storage response block the streaming feed.
    let mounted = true;
    const prefs = Promise.allSettled([loadSharedViewMode(), loadSharedShowReplies(), loadSharedDetailedReactions()]);
    const startupBudget = new Promise<null>((resolve) => {
      window.setTimeout(() => resolve(null), SHARED_PREF_STARTUP_BUDGET_MS);
    });

    function applyResolvedPrefs(results: Awaited<typeof prefs>): void {
      const [viewModeResult, showRepliesResult, detailedReactionsResult] = results;
      if (viewModeResult.status === 'fulfilled') store.setViewMode(viewModeResult.value);
      if (showRepliesResult.status === 'fulfilled' && showRepliesResult.value) store.setShowReplies(true);
      if (detailedReactionsResult.status === 'fulfilled' && detailedReactionsResult.value) store.setDetailedReactions(true);
    }

    void Promise.race([prefs, startupBudget]).then((results) => {
      if (!mounted) return;
      if (results) {
        applyResolvedPrefs(results);
      } else {
        void prefs.then((lateResults) => {
          if (!mounted) return;
          const [viewModeResult, , detailedReactionsResult] = lateResults;
          if (viewModeResult.status === 'fulfilled') store.setViewMode(viewModeResult.value);
          if (detailedReactionsResult.status === 'fulfilled') store.setDetailedReactions(detailedReactionsResult.value);
        });
      }

      applyActiveSource();
      // emoji reactions need a pubkey; skip when payload-only / logged out.
      if (pubkey != null) emojiStore.init(pubkey);
      // Open the post-mount payload-change effect only after the first source
      // has been applied.
      initialized = true;
    });

    return () => {
      mounted = false;
      if (profileBatchTimer !== null) {
        clearTimeout(profileBatchTimer);
        profileBatchTimer = null;
      }
      for (const subscription of profileSubscriptions) subscription.close();
      profileSubscriptions.clear();
      emojiStore.destroy();
      store.destroy();
    };
  });
</script>

<div
  class="feed-container flex flex-col h-full bg-bg-base"
  data-feed-loading={loading}
  data-feed-can-load-more={canLoadMore}
  data-feed-timeline-count={visibleTimeline.length}
>
  <!-- Top bar: view/display controls. The feed SOURCE (Following / Global /
       #tag / saved feeds) is now chosen from the shell-native FeedChromeBar
       (Phase 89, FEED-03) which drives this window over NAP-INTENT, so the old
       in-napplet Following/Global switcher was removed (D-01/D-02). -->
  <div class="flex items-center gap-2 px-3 py-2 border-b border-border-dim flex-shrink-0">
    <!-- Spacer -->
    <div class="flex-1"></div>

    <button
      type="button"
      class="px-2 py-1 text-xs font-mono rounded transition-colors {showReplies ? 'bg-accent-green/20 text-accent-green border border-accent-green/40' : 'text-text-muted border border-border-dim hover:text-text-primary'}"
      aria-pressed={showReplies}
      onclick={() => setShowReplies(!showReplies)}
    >
      Show replies
    </button>

    <button
      type="button"
      class="px-2 py-1 text-xs font-mono rounded transition-colors {showNsfw ? 'bg-accent-green/20 text-accent-green border border-accent-green/40' : 'text-text-muted border border-border-dim hover:text-text-primary'}"
      aria-pressed={showNsfw}
      title="Show #nsfw notes"
      onclick={() => { showNsfw = !showNsfw; }}
    >
      NSFW
    </button>

    <ReactionSettings state={emojiStore.state} store={emojiStore} version={emojiVersion} />

    <button
      type="button"
      class="px-2 py-1 text-xs font-mono rounded transition-colors {detailedReactions ? 'bg-accent-green/20 text-accent-green border border-accent-green/40' : 'text-text-muted border border-border-dim hover:text-text-primary'}"
      aria-pressed={detailedReactions}
      title="Show reaction kinds"
      onclick={() => setDetailedReactions(!detailedReactions)}
    >
      Detailed reactions
    </button>

    <!-- View mode switcher -->
    <div class="flex gap-1">
      <!-- Compact list icon -->
      <button
        type="button"
        class="p-1 rounded transition-colors {viewMode === 'compact' ? 'text-accent-green' : 'text-text-muted hover:text-text-primary'}"
        onclick={() => setViewMode('compact')}
        aria-label="Compact list view"
        title="Compact list"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      </button>
      <!-- Cards icon -->
      <button
        type="button"
        class="p-1 rounded transition-colors {viewMode === 'cards' ? 'text-accent-green' : 'text-text-muted hover:text-text-primary'}"
        onclick={() => setViewMode('cards')}
        aria-label="Cards view"
        title="Cards"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
      </button>
      <!-- Terminal icon -->
      <button
        type="button"
        class="p-1 rounded transition-colors {viewMode === 'terminal' ? 'text-accent-green' : 'text-text-muted hover:text-text-primary'}"
        onclick={() => setViewMode('terminal')}
        aria-label="Terminal view"
        title="Terminal"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      </button>
    </div>
  </div>

  <!-- Inline compose box -->
  <ComposeInline />

  <!-- New notes banner -->
  <NewNotesBanner count={pendingCount} onclick={loadNewNotes} />

  <!-- Feed content -->
  <div class="flex-1 overflow-hidden flex flex-col">
    {#if error != null}
      <div class="p-4 text-accent-red font-mono text-sm">
        <span class="text-text-muted">error:</span> {error}
      </div>
    {:else if loading && timeline.length === 0}
      <div class="p-4 text-text-muted font-mono text-sm animate-pulse">
        loading feed...
      </div>
    {:else if timeline.length === 0}
      <div class="p-4 text-text-muted font-mono text-sm">
        no notes yet
      </div>
    {:else if viewMode === 'compact'}
      <FeedList events={visibleTimeline} {profiles} {engagement} {reactionOptions} {loading} {canLoadMore} onLoadMore={loadMore} onVisibleEventsChange={setEngagementTargetIds} />
    {:else if viewMode === 'cards'}
      <FeedCards events={visibleTimeline} {profiles} {engagement} {reactionOptions} {loading} {canLoadMore} onLoadMore={loadMore} onVisibleEventsChange={setEngagementTargetIds} />
    {:else}
      <FeedTerminal events={visibleTimeline} {profiles} {engagement} {loading} {canLoadMore} onLoadMore={loadMore} onVisibleEventsChange={setEngagementTargetIds} />
    {/if}
  </div>
</div>
