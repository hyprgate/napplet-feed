<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { NostrEvent } from 'applesauce-core/helpers/event';
  import { KIND_REACTION } from '@hyprgate/types';
  import * as nip19 from 'nostr-tools/nip19';
  import { clientTagValue, isCanonicalHexPubkey, pubkeyColorStyle } from '@hyprgate/utils';
  import type { EngagementCounts } from '../lib/feed-store';
  import {
    FEED_LOAD_THRESHOLDS,
    getProactiveLoadIntent,
    type FeedLoadIntent,
  } from '../lib/feed-load-strategy';
  import { createEngagementVisibilityTracker } from '../lib/feed-visible-targets';
  import { createFeedResourceVisibilityTracker } from '../lib/feed-resource-visibility';
  import { attachScrollKeyListener } from '../lib/keyboard-scroll';
  import type { ProfileContent } from '../lib/profile-metadata';
  import { previewContent, replyContextForEvent, shouldTruncateContent, terminalEngagementLabel } from '../lib/note-presentation';
  import { terminalEventContent } from '../lib/rendering-fallbacks';
  import ReplyContextLink from './ReplyContextLink.svelte';
  import ReactionContent from './ReactionContent.svelte';
  import { createFeedProfileIntentRequest, invokeFeedIntent } from '../lib/feed-actions';

  interface Props {
    events: NostrEvent[];
    profiles: Map<string, ProfileContent>;
    engagement: Map<string, EngagementCounts>;
    loading: boolean;
    canLoadMore: boolean;
    onLoadMore?: (intent?: FeedLoadIntent) => void;
    onVisibleEventsChange?: (ids: string[]) => void;
  }

  let { events, profiles, engagement, canLoadMore, onLoadMore, onVisibleEventsChange }: Props = $props();

  function shortenPubkey(pubkey: string): string {
    try {
      const npub = nip19.npubEncode(pubkey);
      return npub.slice(0, 10) + '...';
    } catch {
      return pubkey.slice(0, 8) + '...';
    }
  }

  function getAuthorName(pubkey: string, profile?: ProfileContent): string {
    return profile?.display_name ?? profile?.displayName ?? profile?.name ?? profile?.nip05 ?? shortenPubkey(pubkey);
  }

  async function openProfile(pubkey: string): Promise<void> {
    const request = createFeedProfileIntentRequest(pubkey);
    if (request) await invokeFeedIntent(request);
  }

  function formatTimestamp(unixSecs: number): string {
    const d = new Date(unixSecs * 1000);
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function terminalContent(content: string): string {
    return shouldTruncateContent(content, 240, 4) ? previewContent(content, 240, 4) : content;
  }

  function eventContent(event: NostrEvent): string {
    const content = terminalEventContent(event);
    return terminalContent(content);
  }

  // Sentinel element for IntersectionObserver
  let scroller: HTMLDivElement | undefined = $state(undefined);
  let sentinel: HTMLDivElement | undefined = $state(undefined);
  const trackEngagementVisibility = createEngagementVisibilityTracker(
    () => scroller,
    () => events,
    () => onVisibleEventsChange,
  );
  let resourceEventIds = $state(new Set<string>());
  const resourceVisibility = createFeedResourceVisibilityTracker(
    () => scroller,
    () => events,
    (ids) => { resourceEventIds = new Set(ids); },
  );
  const trackResourceVisibility = resourceVisibility.track;
  onDestroy(resourceVisibility.destroy);

  $effect(() => {
    events.length;
    resourceVisibility.refresh();
  });

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

  function handleScroll(): void {
    loadMoreForScrollPosition();
    resourceVisibility.refresh();
  }

  // Issue #183: PageUp/PageDown/Home/End scroll the container explicitly, so they
  // work even though the scroller isn't the document scrolling element and the
  // iframe's activeElement is <body>. Listens at document level (keys bubble there)
  // and bows out for text inputs so typing/caret nav is untouched.
  $effect(() => attachScrollKeyListener(() => scroller));

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

<div
  bind:this={scroller}
  class="feed-terminal overflow-y-auto flex-1 bg-bg-base font-mono text-accent-green focus:outline-none"
  tabindex="-1"
  role="group"
  aria-label="Feed"
  onscroll={handleScroll}
>
  {#each events as event (event.id)}
    {@const profile = profiles.get(event.pubkey)}
    {@const counts = engagement.get(event.id)}
    {@const replyContext = replyContextForEvent(event)}
    {@const client = clientTagValue(event)}
    <div
      class="px-2 py-0.5 hover:bg-bg-surface leading-tight text-sm whitespace-pre-wrap break-words"
      style={pubkeyColorStyle(event.pubkey)}
      use:trackEngagementVisibility={event.id}
      use:trackResourceVisibility={event.id}
      data-feed-event-id={event.id}
      data-feed-resources-enabled={resourceEventIds.has(event.id)}
    >
      <span>[{formatTimestamp(event.created_at)}]</span>
      <button
        type="button"
        class="terminal-author"
        title={isCanonicalHexPubkey(event.pubkey) ? nip19.npubEncode(event.pubkey) : event.pubkey}
        data-feed-author-pubkey={event.pubkey}
        data-feed-author-label={getAuthorName(event.pubkey, profile)}
        onclick={() => openProfile(event.pubkey)}
      >&lt;{getAuthorName(event.pubkey, profile)}&gt;</button>
      {#if client}<span class="opacity-70"> (via {client})</span>{/if}
      {#if replyContext}
        <span> [{replyContext.label}: <ReplyContextLink reference={replyContext.parent} />{#if replyContext.root} / root <ReplyContextLink reference={replyContext.root} />{/if}]</span>
      {/if}
      {#if event.kind === KIND_REACTION}
        <ReactionContent {event} {profiles} compact loadResources={resourceEventIds.has(event.id)} />
      {:else}
        <span> [{terminalEngagementLabel(counts)}]</span>
        <span> {eventContent(event)}</span>
      {/if}
    </div>
  {/each}
  <div bind:this={sentinel} class="h-4"></div>
</div>

<style>
  .terminal-author { padding: 0; border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; }
  .terminal-author:hover { text-decoration: underline; }
</style>
