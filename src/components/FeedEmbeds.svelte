<script lang="ts">
  import { extractNoteContentEmbeds } from '@hyprgate/utils';
  import EventEmbed from './EventEmbed.svelte';
  import ProfileEmbed from './ProfileEmbed.svelte';
  import ResourceEmbed from './ResourceEmbed.svelte';
  import { MAX_INLINE_EVENT_DEPTH, isInlineDepthExhausted } from '../lib/rendering-fallbacks';

  interface Props {
    content: string;
    profileLabel?: (pubkey: string) => string;
    depth?: number;
    maxDepth?: number;
  }

  let {
    content,
    profileLabel = (pubkey: string) => `${pubkey.slice(0, 12)}...`,
    depth = 0,
    maxDepth = MAX_INLINE_EVENT_DEPTH,
  }: Props = $props();
  let embeds = $derived(extractNoteContentEmbeds(content, 6, { includeImageUrls: false, includeResources: false }));
  let canRenderNestedEvents = $derived(!isInlineDepthExhausted(depth, maxDepth));
</script>

{#if embeds.length > 0}
  <div class="feed-embeds" aria-label="Resolved note references">
    {#each embeds as embed (`${embed.type}:${embed.value}`)}
      {#if embed.type === 'profile'}
        <ProfileEmbed pubkey={embed.value} />
      {:else if embed.type === 'event'}
        {#if canRenderNestedEvents}
          <EventEmbed id={embed.value} {profileLabel} depth={depth + 1} {maxDepth} />
        {:else}
          <div class="depth-limit" data-feed-inline-depth-limit>Nested note limit reached.</div>
        {/if}
      {:else if embed.type === 'media'}
        <ResourceEmbed source={embed.value} mediaType={embed.mediaType} />
      {:else if embed.type === 'resource'}
        <ResourceEmbed source={embed.value} mediaType="image" />
      {:else}
        <div class="address-embed">
          <span>address</span>
          <code>{embed.value}</code>
        </div>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .feed-embeds {
    display: grid;
    gap: 8px;
    margin-top: 8px;
  }

  .address-embed {
    display: grid;
    gap: 4px;
    padding: 8px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 6px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 11px;
  }

  .depth-limit {
    padding: 8px;
    border: 1px dashed var(--hg-border, #303030);
    border-radius: 6px;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 11px;
  }

  code {
    overflow-wrap: anywhere;
    color: var(--hg-accent-cyan, #82d8f7);
  }
</style>
