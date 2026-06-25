<script lang="ts">
  import type { NostrEvent } from '@hyprgate/types';
  import { KIND_REPOST } from '@hyprgate/types';
  import type { EmojiOption } from '../lib/emoji-sets';
  import { isFeedRenderableEvent, MAX_INLINE_EVENT_DEPTH } from '../lib/rendering-fallbacks';
  import type { ProfileContent } from '../lib/profile-metadata';
  import ExpandableNoteContent from './ExpandableNoteContent.svelte';
  import FeedEmbeds from './FeedEmbeds.svelte';
  import NoteActions from './NoteActions.svelte';
  import RepostContent from './RepostContent.svelte';
  import UnsupportedEventFallback from './UnsupportedEventFallback.svelte';

  interface Props {
    event: NostrEvent;
    reactionOptions: EmojiOption[];
    profiles?: Map<string, ProfileContent>;
    profileLabel: (pubkey: string) => string;
    depth?: number;
    maxDepth?: number;
  }

  let {
    event,
    reactionOptions,
    profiles = new Map<string, ProfileContent>(),
    profileLabel,
    depth = 0,
    maxDepth = MAX_INLINE_EVENT_DEPTH,
  }: Props = $props();
</script>

{#if event.kind === KIND_REPOST}
  <RepostContent {event} {profiles} {profileLabel} {depth} {maxDepth} />
{:else if isFeedRenderableEvent(event)}
  <ExpandableNoteContent content={event.content} emojiTags={event.tags} {profileLabel} />
  <FeedEmbeds content={event.content} {profiles} {profileLabel} {depth} {maxDepth} />
{:else}
  <UnsupportedEventFallback {event} />
{/if}
{#if depth === 0}
  <NoteActions {event} {reactionOptions} />
{/if}
