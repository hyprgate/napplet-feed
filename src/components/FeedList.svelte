  <script lang="ts">
    import type { NostrEvent } from 'applesauce-core/helpers/event';
    import type { EngagementCounts } from '../lib/feed-store';
	    import {
	      FEED_LOAD_THRESHOLDS,
	      getProactiveLoadIntent,
	      type FeedLoadIntent,
	    } from '../lib/feed-load-strategy';
	    import type { EmojiOption } from '../lib/emoji-sets';
	    import { createEngagementVisibilityTracker } from '../lib/feed-visible-targets';
	    import NoteEntry from './NoteEntry.svelte';

  interface ProfileContent {
    name?: string;
    display_name?: string;
    picture?: string;
  }

  interface Props {
    events: NostrEvent[];
    profiles: Map<string, ProfileContent>;
    engagement: Map<string, EngagementCounts>;
    reactionOptions: EmojiOption[];
    loading: boolean;
    canLoadMore: boolean;
    onLoadMore?: (intent?: FeedLoadIntent) => void;
    onVisibleEventsChange?: (ids: string[]) => void;
  }

  let {
    events,
    profiles,
    engagement,
    reactionOptions,
    canLoadMore,
    onLoadMore,
    onVisibleEventsChange,
  }: Props = $props();

  // Sentinel element for IntersectionObserver (load more trigger)
  let scroller: HTMLDivElement | undefined = $state(undefined);
  let sentinel: HTMLDivElement | undefined = $state(undefined);
  const trackEngagementVisibility = createEngagementVisibilityTracker(
    () => scroller,
    () => events,
    () => onVisibleEventsChange,
  );

  function maybeLoadMore(intent: FeedLoadIntent = 'prefetch'): void {
    if (!canLoadMore) return;
    onLoadMore?.(intent);
  }

  function loadMoreForScrollPosition(): void {
    if (!scroller || !onLoadMore || !canLoadMore) return;
    const remainingPx = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    const intent = getProactiveLoadIntent(remainingPx, scroller.clientHeight);
    if (intent) maybeLoadMore(intent);
  }

  $effect(() => {
    if (!sentinel || !onLoadMore) return;

    const observers = FEED_LOAD_THRESHOLDS.map(({ intent, rootMargin }) => {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) maybeLoadMore(intent);
        },
        { rootMargin },
      );
      observer.observe(sentinel);
      return observer;
    });
    return () => observers.forEach((observer) => observer.disconnect());
  });

  $effect(() => {
    const eventCount = events.length;
    if (!scroller || !onLoadMore || !canLoadMore) return;
    queueMicrotask(() => {
      if (!scroller || !canLoadMore || events.length !== eventCount) return;
      loadMoreForScrollPosition();
    });
  });
</script>

<div bind:this={scroller} class="feed-list overflow-y-auto flex-1" onscroll={loadMoreForScrollPosition}>
  <div class="divide-y divide-border-dim">
    {#each events as event (event.id)}
      <div use:trackEngagementVisibility={event.id}>
        <NoteEntry {event} {profiles} profile={profiles.get(event.pubkey)} engagement={engagement.get(event.id)} {reactionOptions} />
      </div>
    {/each}
  </div>
  <!-- Sentinel for infinite scroll -->
  <div bind:this={sentinel} class="h-4"></div>
</div>
