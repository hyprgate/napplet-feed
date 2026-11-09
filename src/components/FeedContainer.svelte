<script lang="ts">
  import { onMount, setContext } from 'svelte';
  import type { FeedIntentPayload, NostrEvent } from '@hyprgate/types';
  import type { Subscription } from '@napplet/sdk';
  import { hasNsfwTag } from '@hyprgate/utils';
  import { createFeedStore } from '../lib/feed-store';
  import type { EngagementCounts, FeedLoadIntent, ViewMode } from '../lib/feed-store';
  import { createEmojiSetStore, type EmojiOption } from '../lib/emoji-sets';
  import { subscribeProfileMetadata, type ProfileContent } from '../lib/profile-metadata';
  import { FEED_PROFILE_HYDRATION_CONTEXT } from '../lib/profile-hydration-context';
  import { collectFeedProfilePubkeys } from '../lib/rendering-fallbacks';
  import { snapshotFeedTimeline } from '../lib/feed-state-synchronizer';
  import { feedEmptyState } from '../lib/feed-empty-state';
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
  let lastStoreTimeline: NostrEvent[] | null = null;
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

  let emptyState = $derived(feedEmptyState({
    timelineCount: timeline.length,
    visibleCount: visibleTimeline.length,
    hasPayload: payload != null,
  }));

  function syncState(): void {
    const s = store.state;
    const timelineSnapshot = snapshotFeedTimeline(s.timeline, lastStoreTimeline);
    lastStoreTimeline = timelineSnapshot.sourceTimeline;
    if (timelineSnapshot.visibleTimeline !== null) {
      timeline = timelineSnapshot.visibleTimeline;
      loadMissingProfiles(timelineSnapshot.visibleTimeline);
    }
    pendingCount = s.pendingNew.length;
    engagementVersion = s.engagementVersion;
    loading = s.loading;
    canLoadMore = s.canLoadMore;
    error = s.error;
    viewMode = s.viewMode;
    showReplies = s.showReplies;
    detailedReactions = s.detailedReactions;
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
    const missingPubkeys = [...collectFeedProfilePubkeys(events)]
      .filter((pk) => !loadingPubkeys.has(pk) && !profileMap.has(pk));

    if (missingPubkeys.length === 0) return;

    for (const pk of missingPubkeys) queuedProfilePubkeys.add(pk);
    if (profileBatchTimer !== null) return;

    profileBatchTimer = setTimeout(() => {
      profileBatchTimer = null;
      flushProfileMetadataBatch();
    }, PROFILE_METADATA_BATCH_MS);
  }

  setContext(FEED_PROFILE_HYDRATION_CONTEXT, loadMissingProfiles);

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

  // React to an intent payload that arrives after the initial restore.
  // Guarded by `initialized` and an applied-payload content check so
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
  <div class="feed-toolbar flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border-b border-border-dim flex-shrink-0">
    <div class="toolbar-group" role="group" aria-label="Show in this feed">
      <span class="toolbar-label" aria-hidden="true">Show</span>
      {#snippet toggle(label: string, on: boolean, title: string, change: () => void)}
        <button type="button" class="toolbar-toggle" class:on aria-pressed={on} {title} onclick={change}>
          <span class="toggle-box" aria-hidden="true"></span>
          {label}
        </button>
      {/snippet}
      {@render toggle('Replies', showReplies, 'Include replies in this feed', () => setShowReplies(!showReplies))}
      {@render toggle('NSFW', showNsfw, 'Show notes tagged #nsfw', () => { showNsfw = !showNsfw; })}
      {@render toggle('Reaction details', detailedReactions, 'Split reaction counts by emoji', () => setDetailedReactions(!detailedReactions))}
    </div>

    <div class="flex-1"></div>

    <ReactionSettings state={emojiStore.state} store={emojiStore} version={emojiVersion} />

    <!-- View mode switcher -->
    <div class="view-switch" role="group" aria-label="Layout">
      <button type="button" class:on={viewMode === 'compact'} aria-pressed={viewMode === 'compact'} onclick={() => setViewMode('compact')} aria-label="Compact list view" title="Compact list">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <line x1="3" y1="6" x2="3.01" y2="6" />
          <line x1="3" y1="12" x2="3.01" y2="12" />
          <line x1="3" y1="18" x2="3.01" y2="18" />
        </svg>
      </button>
      <button type="button" class:on={viewMode === 'cards'} aria-pressed={viewMode === 'cards'} onclick={() => setViewMode('cards')} aria-label="Cards view" title="Cards">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
        </svg>
      </button>
      <button type="button" class:on={viewMode === 'terminal'} aria-pressed={viewMode === 'terminal'} onclick={() => setViewMode('terminal')} aria-label="Terminal view" title="Terminal">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
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
      <div class="feed-message" role="alert">
        <p class="feed-message-title">Couldn't load this feed</p>
        <p class="feed-message-detail">{error}</p>
        <button type="button" class="feed-message-action" onclick={applyActiveSource}>Try again</button>
      </div>
    {:else if loading && timeline.length === 0}
      <div class="feed-skeleton" role="status" aria-label="Loading feed" aria-busy="true">
        {#each [0, 1, 2, 3] as row (row)}
          <div class="skeleton-row">
            <span class="skeleton-avatar"></span>
            <span class="skeleton-lines">
              <span class="skeleton-line short"></span>
              <span class="skeleton-line"></span>
            </span>
          </div>
        {/each}
      </div>
    {:else if emptyState}
      <div class="feed-message" data-feed-empty={emptyState.kind}>
        <p class="feed-message-title">{emptyState.title}</p>
        <p class="feed-message-detail">{emptyState.detail}</p>
        {#if emptyState.kind === 'hidden-nsfw'}
          <button type="button" class="feed-message-action" onclick={() => { showNsfw = true; }}>Show NSFW notes</button>
        {/if}
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

<style>
  /* Every feed control shares one keyboard focus ring. */
  .feed-container :global(button:focus-visible),
  .feed-container :global(a:focus-visible),
  .feed-container :global(input:focus-visible) {
    outline: 2px solid var(--hg-accent-focus, var(--hg-accent-primary, #82d8f7));
    outline-offset: 1px;
  }

  .toolbar-group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }

  .toolbar-label {
    margin-right: 2px;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 11px;
  }

  @media (max-width: 520px) {
    .toolbar-label {
      display: none;
    }
  }

  .toolbar-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 26px;
    padding: 0 8px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    background: transparent;
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    white-space: nowrap;
  }

  .toolbar-toggle:hover {
    color: var(--hg-text-primary, #f2efe7);
  }

  .toolbar-toggle.on {
    border-color: var(--hg-accent-primary, #82d8f7);
    background: color-mix(in srgb, var(--hg-accent-primary, #82d8f7) 14%, transparent);
    color: var(--hg-text-primary, #f2efe7);
  }

  .toggle-box {
    width: 8px;
    height: 8px;
    border: 1px solid currentColor;
    border-radius: 2px;
  }

  .toolbar-toggle.on .toggle-box {
    border-color: var(--hg-accent-primary, #82d8f7);
    background: var(--hg-accent-primary, #82d8f7);
  }

  .view-switch {
    display: inline-flex;
    overflow: hidden;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
  }

  .view-switch button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 24px;
    border: 0;
    background: transparent;
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
  }

  .view-switch button:hover {
    color: var(--hg-text-primary, #f2efe7);
  }

  .view-switch button.on {
    background: color-mix(in srgb, var(--hg-accent-primary, #82d8f7) 22%, transparent);
    color: var(--hg-text-primary, #f2efe7);
  }

  .view-switch button:focus-visible {
    outline-offset: -2px;
  }

  .feed-message {
    display: grid;
    justify-items: center;
    gap: 8px;
    max-width: 44ch;
    margin: 12vh auto 0;
    padding: 16px;
    text-align: center;
  }

  .feed-message-title {
    margin: 0;
    color: var(--hg-text-primary, #f2efe7);
    font-size: 14px;
    font-weight: 600;
  }

  .feed-message-detail {
    margin: 0;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 12px;
    line-height: 1.5;
  }

  .feed-message-action {
    margin-top: 4px;
    padding: 5px 10px;
    border: 1px solid var(--hg-accent-primary, #82d8f7);
    border-radius: 4px;
    background: transparent;
    color: var(--hg-text-primary, #f2efe7);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }

  .feed-message-action:hover {
    background: color-mix(in srgb, var(--hg-accent-primary, #82d8f7) 14%, transparent);
  }

  .skeleton-row {
    display: flex;
    gap: 8px;
    padding: 10px 8px;
    border-bottom: 1px solid var(--hg-border-muted, #222);
  }

  .skeleton-avatar {
    flex: none;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--hg-surface, #101010);
  }

  .skeleton-lines {
    display: grid;
    flex: 1;
    align-content: center;
    gap: 7px;
  }

  .skeleton-line {
    height: 9px;
    max-width: 62ch;
    border-radius: 3px;
    background: var(--hg-surface, #101010);
  }

  .skeleton-line.short {
    max-width: 20ch;
  }

  @media (prefers-reduced-motion: no-preference) {
    .feed-skeleton {
      animation: feed-skeleton-pulse 1.4s ease-in-out infinite;
    }
  }

  @keyframes feed-skeleton-pulse {
    50% { opacity: 0.55; }
  }
</style>
