<script lang="ts">
  import type { NostrEvent } from '@hyprgate/types';
  import { resourceImageBatch as resourceImage } from '@hyprgate/utils';
  import { reactionPresentation, reactionTarget } from '../lib/reaction-presentation';
  import { previewContent } from '../lib/note-presentation';
  import { isInlineDepthExhausted, MAX_INLINE_EVENT_DEPTH } from '../lib/rendering-fallbacks';
  import type { ProfileContent } from '../lib/profile-metadata';
  import EventEmbed from './EventEmbed.svelte';

  interface Props {
    event: NostrEvent;
    profiles?: Map<string, ProfileContent>;
    profileLabel?: (pubkey: string) => string;
    depth?: number;
    maxDepth?: number;
    loadResources?: boolean;
    compact?: boolean;
  }

  let {
    event, profiles, profileLabel, depth = 0, maxDepth = MAX_INLINE_EVENT_DEPTH,
    loadResources = true, compact = false,
  }: Props = $props();
  let reaction = $derived(reactionPresentation(event));
  let target = $derived(reactionTarget(event));
  let failedImage = $state<string | undefined>();

</script>

<span class="reaction-content" class:compact data-feed-reaction-id={event.id}>
  <span class="reaction-value" data-feed-reaction-value>
    <span>{reaction.label}</span>
    {#if reaction.emoji?.imageUrl && failedImage !== reaction.emoji.imageUrl}
      <img
        use:resourceImage={loadResources ? reaction.emoji.imageUrl : null}
        alt=":{reaction.emoji.shortcode}:"
        title=":{reaction.emoji.shortcode}:"
        loading="lazy"
        onerror={() => { failedImage = reaction.emoji?.imageUrl; }}
      />
    {:else if reaction.value}
      <span>{compact ? previewContent(reaction.value, 180, 2) : reaction.value}</span>
    {/if}
  </span>
  {#if !target}
    <span class="unavailable">Reaction target unavailable</span>
  {:else if isInlineDepthExhausted(depth, maxDepth)}
    <span class="unavailable" data-feed-inline-depth-limit>Nested note limit reached.</span>
  {:else}
    {#key target.id}
      <EventEmbed
        id={target.id}
        referenceSource={target.source}
        label="reacted note"
        referenceAuthor={target.author}
        referenceKind={target.kind}
        referenceRelays={target.relays}
        {profiles}
        {profileLabel}
        depth={depth + 1}
        {maxDepth}
        {loadResources}
      />
    {/key}
  {/if}
</span>

<style>
  .reaction-content { display: grid; gap: 8px; min-width: 0; }
  .reaction-content.compact { margin-top: 4px; font-size: 12px; }
  .reaction-value { display: inline-flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
  .reaction-value img { width: 1.5em; height: 1.5em; object-fit: contain; }
  .unavailable { color: var(--hg-text-muted, #b8b1a4); font-size: 12px; }
</style>
