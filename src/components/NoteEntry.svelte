<script lang="ts">
  import { format } from 'timeago.js';
  import * as nip19 from 'nostr-tools/nip19';
  import type { NostrEvent } from 'applesauce-core/helpers/event';
  import { clientTagValue, isCanonicalHexPubkey, pubkeyColorStyle, resourceImageBatch as resourceImage } from '@hyprgate/utils';
  import { createFeedProfileIntentRequest, invokeFeedIntent } from '../lib/feed-actions';
  import type { EngagementCounts } from '../lib/feed-store';
  import type { EmojiOption } from '../lib/emoji-sets';
  import type { ProfileContent } from '../lib/profile-metadata';
  import { replyContextForEvent } from '../lib/note-presentation';
  import EngagementPills from './EngagementPills.svelte';
  import FeedEventContent from './FeedEventContent.svelte';
  import ReplyContextLink from './ReplyContextLink.svelte';

  interface Props {
    event: NostrEvent;
    profiles: Map<string, ProfileContent>;
    profile?: ProfileContent;
    engagement?: EngagementCounts;
    reactionOptions: EmojiOption[];
    loadResources?: boolean;
  }

  let { event, profiles, profile, engagement, reactionOptions, loadResources = true }: Props = $props();

  function shortenPubkey(pubkey: string): string {
    try {
      const npub = nip19.npubEncode(pubkey);
      return npub.slice(0, 16) + '...';
    } catch {
      return pubkey.slice(0, 12) + '...';
    }
  }

  async function openProfile(): Promise<void> {
    if (!isCanonicalHexPubkey(event.pubkey)) return;
    const request = createFeedProfileIntentRequest(event.pubkey);
    if (request) await invokeFeedIntent(request);
  }

  let authorName = $derived.by(() => {
    if (profile?.display_name) return profile.display_name;
    if (profile?.name) return profile.name;
    return shortenPubkey(event.pubkey);
  });

  let avatarUrl = $derived.by(() => profile?.picture ?? null);

  let avatarFallback = $derived.by(() => {
    const name = profile?.name ?? profile?.display_name ?? '';
    return name.slice(0, 2).toUpperCase() || event.pubkey.slice(0, 2).toUpperCase();
  });

  let relativeTime = $derived.by(() => format(event.created_at * 1000));
  let clientName = $derived(clientTagValue(event));
  let replyContext = $derived(replyContextForEvent(event));
  let hovered = $state(false);

  function profileLabel(pubkey: string): string {
    const referencedProfile = profiles.get(pubkey);
    return referencedProfile?.display_name ?? referencedProfile?.name ?? shortenPubkey(pubkey);
  }
</script>

<div
  class="flex gap-2 p-2 hover:bg-bg-surface transition-colors"
  onpointerenter={() => (hovered = true)}
  onpointerleave={() => (hovered = false)}
>
  <!-- Avatar -->
  <button
    type="button"
    class="relative flex-shrink-0 w-8 h-8 rounded-full overflow-hidden cursor-pointer bg-bg-surface border border-border-dim flex items-center justify-center"
    onclick={openProfile}
    aria-label="Open profile for {authorName}"
  >
    <span class="text-text-muted text-xs font-mono">{avatarFallback}</span>
    {#if avatarUrl != null}
      <img use:resourceImage={loadResources ? avatarUrl : null} alt="" class="absolute inset-0 w-full h-full object-cover" loading="lazy" />
    {/if}
  </button>

  <!-- Content -->
  <div class="flex-1 min-w-0">
    <!-- Author row -->
    <div class="flex items-baseline gap-2 mb-1">
      <button
        type="button"
        class="text-sm font-semibold font-mono truncate hover:underline cursor-pointer bg-transparent border-none p-0"
        style={pubkeyColorStyle(event.pubkey)}
        onclick={openProfile}
        data-feed-author-pubkey={event.pubkey}
        data-feed-author-label={authorName}
      >
        {authorName}
      </button>
      <span class="text-text-muted text-xs flex-shrink-0">{relativeTime}</span>
      {#if clientName}
        <span class="text-text-muted text-xs flex-shrink-0 opacity-70" title="Published with {clientName}">via {clientName}</span>
      {/if}
      {#if replyContext}
        <span class="reply-badge">{replyContext.label}</span>
      {/if}
      <div class="ml-auto">
        <EngagementPills {event} {engagement} compact active={hovered} {loadResources} />
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

    <!-- Note content -->
    <div class="text-text-primary text-sm leading-relaxed">
      <FeedEventContent {event} {profiles} {reactionOptions} {profileLabel} {loadResources} />
    </div>
  </div>
</div>

<style>
  .reply-badge {
    flex-shrink: 0;
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
    margin: 0 0 6px;
    padding: 5px 7px;
    border-left: 2px solid var(--hg-accent-green, #9be564);
    background: color-mix(in srgb, var(--hg-accent-green, #9be564) 8%, transparent);
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 11px;
    line-height: 1.35;
    word-break: break-word;
  }
</style>
