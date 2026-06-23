<script lang="ts">
  import { onMount } from 'svelte';
  import type { NostrEvent } from '@hyprgate/types';
  import { KIND_REPOST } from '@hyprgate/types';
  import type { Subscription } from '@napplet/sdk';
  import { inc as ipc, relay } from '@napplet/sdk';
  import { NOTE_VIEWER_OPEN_TOPIC, createNoteViewerOpenPayload, pubkeyColorStyle } from '@hyprgate/utils';
  import { isFeedRenderableEvent, isInlineDepthExhausted, MAX_INLINE_EVENT_DEPTH } from '../lib/rendering-fallbacks';
  import ExpandableNoteContent from './ExpandableNoteContent.svelte';
  import FeedEmbeds from './FeedEmbeds.svelte';
  import RepostContent from './RepostContent.svelte';
  import UnsupportedEventFallback from './UnsupportedEventFallback.svelte';
  import type { ProfileContent } from '../lib/profile-metadata';

  interface Props {
    id: string;
    event?: NostrEvent | null;
    label?: string;
    profiles?: Map<string, ProfileContent>;
    profileLabel?: (pubkey: string) => string;
    depth?: number;
    maxDepth?: number;
  }

  let {
    id,
    event: providedEvent = null,
    label = 'quoted note',
    profiles = new Map<string, ProfileContent>(),
    profileLabel = (pubkey: string) => `${pubkey.slice(0, 12)}...`,
    depth = 0,
    maxDepth = MAX_INLINE_EVENT_DEPTH,
  }: Props = $props();
  let fetchedEvent = $state<NostrEvent | null>(null);
  let fetchStatus = $state<'loading' | 'ready' | 'empty' | 'error'>('loading');
  let event = $derived(providedEvent ?? fetchedEvent);
  let status = $derived(providedEvent ? 'ready' : fetchStatus);
  let canRenderNestedEvents = $derived(!isInlineDepthExhausted(depth, maxDepth));

  function openNote(): void {
    const payload = createNoteViewerOpenPayload({
      target: { type: 'event', id, ...(event ? { kind: event.kind, pubkey: event.pubkey } : {}) },
      behavior: { focus: true },
      source: { napplet: 'feed' },
    });
    if (!payload) return;
    ipc.emit(NOTE_VIEWER_OPEN_TOPIC, [], JSON.stringify(payload));
  }

  onMount(() => {
    let sawEvent = false;
    let subscription: Subscription | null = null;
    try {
      subscription = relay.subscribe(
        [{ ids: [id], limit: 1 }],
        (next: NostrEvent) => {
          fetchedEvent = next;
          sawEvent = true;
          fetchStatus = 'ready';
        },
        () => {
          if (!sawEvent) fetchStatus = 'empty';
        },
      );
    } catch {
      fetchStatus = 'error';
    }
    return () => subscription?.close();
  });
</script>

<article class="event-embed" data-feed-event-embed-depth={depth}>
  <button type="button" class="embed-header" onclick={openNote}>
    <span class="label">{label}</span>
  </button>
  {#if status === 'loading'}
    <span class="body muted">Loading note...</span>
  {:else if status === 'error'}
    <span class="body muted">cannot render note</span>
  {:else if event}
    <div class="embed-body">
      {#if event.kind === KIND_REPOST}
        <RepostContent {event} {profiles} {profileLabel} {depth} {maxDepth} />
      {:else if isFeedRenderableEvent(event)}
        <ExpandableNoteContent content={event.content} emojiTags={event.tags} {profileLabel} />
        {#if canRenderNestedEvents}
          <FeedEmbeds content={event.content} {profiles} {profileLabel} {depth} {maxDepth} />
        {:else}
          <div class="depth-limit" data-feed-inline-depth-limit>Nested note limit reached.</div>
        {/if}
      {:else}
        <UnsupportedEventFallback {event} />
      {/if}
    </div>
    <span class="meta" style={pubkeyColorStyle(event.pubkey)}>{event.pubkey.slice(0, 12)}...</span>
  {:else}
    <span class="body muted">cannot render note</span>
  {/if}
</article>

<style>
  .event-embed {
    display: grid;
    gap: 4px;
    width: 100%;
    max-width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--hg-border, #303030);
    border-left: 3px solid var(--hg-accent-cyan, #82d8f7);
    border-radius: 6px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-primary, #f2efe7);
    text-align: left;
  }

  .event-embed:hover,
  .embed-header:hover {
    border-color: var(--hg-accent-cyan, #82d8f7);
  }

  .embed-header {
    display: flex;
    width: max-content;
    max-width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .embed-body {
    display: grid;
    gap: 6px;
  }

  .label,
  .meta,
  .muted {
    color: var(--hg-text-muted, #b8b1a4);
  }

  .label {
    font-size: 10px;
    text-transform: uppercase;
  }

  .body {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    font-size: 12px;
    line-height: 1.4;
  }

  .meta {
    font-size: 10px;
  }

  .depth-limit {
    padding: 8px;
    border: 1px dashed var(--hg-border, #303030);
    border-radius: 6px;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 11px;
  }
</style>
