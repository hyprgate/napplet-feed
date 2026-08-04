<script lang="ts">
  import type { NostrEvent } from '@hyprgate/types';
  import EventEmbed from './EventEmbed.svelte';
  import {
    feedEventReference,
    MAX_INLINE_EVENT_DEPTH,
    parsedRepostEvent,
    repostTargetId,
  } from '../lib/rendering-fallbacks';
  import type { ProfileContent } from '../lib/profile-metadata';

  interface Props {
    event: NostrEvent;
    profiles?: Map<string, ProfileContent>;
    profileLabel?: (pubkey: string) => string;
    depth?: number;
    maxDepth?: number;
    loadResources?: boolean;
  }

  let {
    event,
    profiles = new Map<string, ProfileContent>(),
    profileLabel = (pubkey: string) => `${pubkey.slice(0, 12)}...`,
    depth = 0,
    maxDepth = MAX_INLINE_EVENT_DEPTH,
    loadResources = true,
  }: Props = $props();
  let embedded = $derived(parsedRepostEvent(event));
  let targetId = $derived(embedded?.id ?? repostTargetId(event));
  let targetReference = $derived(targetId
    ? feedEventReference(event, {
      type: 'event',
      value: targetId,
      source: '',
      ...(embedded ? { author: embedded.pubkey, kind: embedded.kind } : { kind: 1 }),
    })
    : null);
</script>

{#if embedded}
  <EventEmbed
    id={embedded.id}
    event={embedded}
    label="repost"
    referenceAuthor={targetReference?.author}
    referenceKind={targetReference?.kind}
    referenceRelays={targetReference?.relays}
    {profiles}
    {profileLabel}
    depth={depth + 1}
    {maxDepth}
    {loadResources}
  />
{:else if targetId}
  <EventEmbed
    id={targetId}
    label="repost"
    referenceAuthor={targetReference?.author}
    referenceKind={targetReference?.kind}
    referenceRelays={targetReference?.relays}
    {profiles}
    {profileLabel}
    depth={depth + 1}
    {maxDepth}
    {loadResources}
  />
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
