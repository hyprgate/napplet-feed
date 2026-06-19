<script lang="ts">
  import type { NostrEvent } from 'applesauce-core/helpers/event';
  import { format } from 'timeago.js';
  import { nip19 } from 'nostr-tools';
  import { inc as ipc } from '@napplet/sdk';
  import { clientTagValue, isCanonicalHexPubkey, pubkeyColorStyle, resourceImage } from '@hyprgate/utils';
  import type { EngagementCounts } from '../lib/feed-store';
  import {
    FEED_LOAD_THRESHOLDS,
    getProactiveLoadIntent,
    type FeedLoadIntent,
  } from '../lib/feed-load-strategy';
  import type { EmojiOption } from '../lib/emoji-sets';
  import { replyContextForEvent } from '../lib/note-presentation';
  import EngagementPills from './EngagementPills.svelte';
  import ExpandableNoteContent from './ExpandableNoteContent.svelte';
  import FeedEmbeds from './FeedEmbeds.svelte';
  import NoteActions from './NoteActions.svelte';
  import ReplyContextLink from './ReplyContextLink.svelte';

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
  }

  let { events, profiles, engagement, reactionOptions, canLoadMore, onLoadMore }: Props = $props();

  function shortenPubkey(pubkey: string): string {
    try {
      const npub = nip19.npubEncode(pubkey);
      return npub.slice(0, 16) + '...';
    } catch {
      return pubkey.slice(0, 12) + '...';
    }
  }

  function openProfile(pubkey: string) {
    if (!isCanonicalHexPubkey(pubkey)) return;
    ipc.emit('profile:open', [], JSON.stringify({ pubkey }));
  }

  function getAuthorName(pubkey: string, profile?: ProfileContent): string {
    return profile?.display_name ?? profile?.name ?? shortenPubkey(pubkey);
  }

  function profileLabel(pubkey: string): string {
    return getAuthorName(pubkey, profiles.get(pubkey));
  }

  // Sentinel element for IntersectionObserver
  let scroller: HTMLDivElement | undefined = $state(undefined);
  let sentinel: HTMLDivElement | undefined = $state(undefined);
  let hoveredCardId = $state<string | null>(null);

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

<div bind:this={scroller} class="feed-cards overflow-y-auto flex-1 p-2" onscroll={loadMoreForScrollPosition}>
  {#each events as event (event.id)}
    {@const profile = profiles.get(event.pubkey)}
    {@const counts = engagement.get(event.id)}
    {@const replyContext = replyContextForEvent(event)}
    <div
      class="border border-border-dim rounded p-3 mb-2 bg-bg-surface hover:bg-bg-overlay transition-colors"
      onpointerenter={() => (hoveredCardId = event.id)}
      onpointerleave={() => { if (hoveredCardId === event.id) hoveredCardId = null; }}
    >
      <!-- Author row -->
      <div class="flex items-center gap-3 mb-2">
        <button
          type="button"
          class="w-12 h-12 rounded-full overflow-hidden flex-shrink-0 bg-bg-base border border-border-dim flex items-center justify-center cursor-pointer"
          onclick={() => openProfile(event.pubkey)}
          aria-label="Open profile"
        >
          {#if profile?.picture != null}
            <img use:resourceImage={profile.picture} alt={getAuthorName(event.pubkey, profile)} class="w-full h-full object-cover" loading="lazy" />
          {:else}
            <span class="text-text-muted text-sm font-mono">
              {(profile?.name ?? event.pubkey).slice(0, 2).toUpperCase()}
            </span>
          {/if}
        </button>
        <div>
          <button
            type="button"
            class="font-semibold font-mono hover:underline cursor-pointer bg-transparent border-none p-0 block"
            style={pubkeyColorStyle(event.pubkey)}
            onclick={() => openProfile(event.pubkey)}
            data-feed-author-pubkey={event.pubkey}
            data-feed-author-label={getAuthorName(event.pubkey, profile)}
          >
            {getAuthorName(event.pubkey, profile)}
          </button>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-text-muted text-xs">{format(event.created_at * 1000)}</span>
            {#if clientTagValue(event)}
              <span class="text-text-muted text-xs opacity-70" title="Published with {clientTagValue(event)}">via {clientTagValue(event)}</span>
            {/if}
            {#if replyContext}
              <span class="reply-badge">{replyContext.label}</span>
            {/if}
          </div>
        </div>
        <div class="ml-auto">
          <EngagementPills {event} engagement={counts} active={hoveredCardId === event.id} />
        </div>
      </div>
      {#if replyContext}
        <div class="reply-context" aria-label="Reply context">
          <div>replying to <ReplyContextLink reference={replyContext.parent} /></div>
          {#if replyContext.root}
            <div>root <ReplyContextLink reference={replyContext.root} /></div>
          {/if}
        </div>
      {/if}
      <!-- Content -->
      <div class="text-text-primary text-sm leading-relaxed">
        <ExpandableNoteContent content={event.content} {profileLabel} />
        <FeedEmbeds content={event.content} />
        <NoteActions {event} {reactionOptions} />
      </div>
    </div>
  {/each}
  <div bind:this={sentinel} class="h-4"></div>
</div>

<style>
  .reply-badge {
    border: 1px solid var(--hg-accent-green, #9be564);
    border-radius: 999px;
    padding: 1px 6px;
    color: var(--hg-accent-green, #9be564);
    font-size: 10px;
    line-height: 1.3;
  }

  .reply-context {
    display: grid;
    gap: 2px;
    margin: 0 0 8px 60px;
    padding: 6px 8px;
    border-left: 2px solid var(--hg-accent-green, #9be564);
    background: color-mix(in srgb, var(--hg-accent-green, #9be564) 8%, transparent);
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 11px;
    line-height: 1.35;
    word-break: break-word;
  }
</style>
