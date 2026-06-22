<script lang="ts">
  import type { NostrEvent } from '@hyprgate/types';
  import EventEmbed from './EventEmbed.svelte';
  import { parsedRepostEvent, repostTargetId } from '../lib/rendering-fallbacks';

  interface Props {
    event: NostrEvent;
  }

  let { event }: Props = $props();
  let embedded = $derived(parsedRepostEvent(event));
  let targetId = $derived(embedded?.id ?? repostTargetId(event));
</script>

{#if embedded}
  <EventEmbed id={embedded.id} event={embedded} label="repost" />
{:else if targetId}
  <EventEmbed id={targetId} label="repost" />
{:else}
  <div class="repost-empty">Repost target unavailable</div>
{/if}

<style>
  .repost-empty {
    margin: 4px 0 8px;
    padding: 8px 10px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 6px;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 12px;
  }
</style>
