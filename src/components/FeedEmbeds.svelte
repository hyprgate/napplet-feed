<script lang="ts">
  import { extractNoteContentEmbeds } from '@hyprgate/utils';
  import EventEmbed from './EventEmbed.svelte';
  import ProfileEmbed from './ProfileEmbed.svelte';
  import ResourceEmbed from './ResourceEmbed.svelte';

  interface Props {
    content: string;
  }

  let { content }: Props = $props();
  let embeds = $derived(extractNoteContentEmbeds(content, 6, { includeImageUrls: false, includeResources: false }));
</script>

{#if embeds.length > 0}
  <div class="feed-embeds" aria-label="Resolved note references">
    {#each embeds as embed (`${embed.type}:${embed.value}`)}
      {#if embed.type === 'profile'}
        <ProfileEmbed pubkey={embed.value} />
      {:else if embed.type === 'event'}
        <EventEmbed id={embed.value} />
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

  code {
    overflow-wrap: anywhere;
    color: var(--hg-accent-cyan, #82d8f7);
  }
</style>
