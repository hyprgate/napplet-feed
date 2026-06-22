<script lang="ts">
  import type { NostrEvent } from '@hyprgate/types';
  import { KIND_REPOST } from '@hyprgate/types';
  import type { EmojiOption } from '../lib/emoji-sets';
  import { isFeedRenderableEvent } from '../lib/rendering-fallbacks';
  import ExpandableNoteContent from './ExpandableNoteContent.svelte';
  import FeedEmbeds from './FeedEmbeds.svelte';
  import NoteActions from './NoteActions.svelte';
  import RepostContent from './RepostContent.svelte';
  import UnsupportedEventFallback from './UnsupportedEventFallback.svelte';

  interface Props {
    event: NostrEvent;
    reactionOptions: EmojiOption[];
    profileLabel: (pubkey: string) => string;
  }

  let { event, reactionOptions, profileLabel }: Props = $props();
</script>

{#if event.kind === KIND_REPOST}
  <RepostContent {event} />
{:else if isFeedRenderableEvent(event)}
  <ExpandableNoteContent content={event.content} emojiTags={event.tags} {profileLabel} />
  <FeedEmbeds content={event.content} />
{:else}
  <UnsupportedEventFallback {event} />
{/if}
<NoteActions {event} {reactionOptions} />
