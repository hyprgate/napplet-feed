<script lang="ts">
  import { onMount } from 'svelte';
  import type { NostrEvent } from '@hyprgate/types';
  import type { Subscription } from '@napplet/sdk';
  import { inc as ipc, relay } from '@napplet/sdk';
  import { NOTE_VIEWER_OPEN_TOPIC, createNoteViewerOpenPayload, pubkeyColorStyle } from '@hyprgate/utils';
  import { previewContent } from '../lib/note-presentation';

  interface Props {
    id: string;
    event?: NostrEvent | null;
    label?: string;
  }

  let { id, event: providedEvent = null, label = 'quoted note' }: Props = $props();
  let fetchedEvent = $state<NostrEvent | null>(null);
  let fetchStatus = $state<'loading' | 'ready' | 'empty' | 'error'>('loading');
  let event = $derived(providedEvent ?? fetchedEvent);
  let status = $derived(providedEvent ? 'ready' : fetchStatus);

  function openNote(): void {
    const payload = createNoteViewerOpenPayload({
      target: { type: 'event', id, ...(event ? { kind: event.kind, pubkey: event.pubkey } : {}) },
      behavior: { focus: true },
      source: { napplet: 'feed' },
    });
    if (!payload) return;
    ipc.emit(NOTE_VIEWER_OPEN_TOPIC, [], JSON.stringify(payload));
  }

  let body = $derived(event ? previewContent(event.content || '[empty note]', 180, 3) : '');

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

<button type="button" class="event-embed" onclick={openNote}>
  <span class="label">{label}</span>
  {#if status === 'loading'}
    <span class="body muted">Loading note...</span>
  {:else if status === 'error'}
    <span class="body muted">Could not load note.</span>
  {:else if event}
    <span class="body">{body}</span>
    <span class="meta" style={pubkeyColorStyle(event.pubkey)}>{event.pubkey.slice(0, 12)}...</span>
  {:else}
    <span class="body muted">Note not found in current relay set.</span>
  {/if}
</button>

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
    cursor: pointer;
    text-align: left;
  }

  .event-embed:hover {
    border-color: var(--hg-accent-cyan, #82d8f7);
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
</style>
