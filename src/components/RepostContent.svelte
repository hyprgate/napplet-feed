<script lang="ts">
  import type { NostrEvent } from '@hyprgate/types';
  import EventEmbed from './EventEmbed.svelte';
  import { MAX_INLINE_EVENT_DEPTH, parsedRepostEvent, repostTargetId } from '../lib/rendering-fallbacks';
  import type { ProfileContent } from '../lib/profile-metadata';

  interface Props {
    event: NostrEvent;
    profiles?: Map<string, ProfileContent>;
    profileLabel?: (pubkey: string) => string;
    depth?: number;
    maxDepth?: number;
  }

  let {
    event,
    profiles = new Map<string, ProfileContent>(),
    profileLabel = (pubkey: string) => `${pubkey.slice(0, 12)}...`,
    depth = 0,
    maxDepth = MAX_INLINE_EVENT_DEPTH,
  }: Props = $props();
  let embedded = $derived(parsedRepostEvent(event));
  let targetId = $derived(embedded?.id ?? repostTargetId(event));
</script>

{#if embedded}
  <EventEmbed id={embedded.id} event={embedded} label="repost" {profiles} {profileLabel} depth={depth + 1} {maxDepth} />
{:else if targetId}
  <EventEmbed id={targetId} label="repost" {profiles} {profileLabel} depth={depth + 1} {maxDepth} />
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
