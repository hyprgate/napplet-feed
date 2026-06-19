<script lang="ts">
  import { inc as ipc } from '@napplet/sdk';
  import { NOTE_VIEWER_OPEN_TOPIC } from '@hyprgate/utils';
  import {
    createReplyReferenceOpenPayload,
    type ReplyContextReferenceDisplay,
  } from '../lib/note-presentation';

  interface Props {
    reference: ReplyContextReferenceDisplay;
  }

  let { reference }: Props = $props();

  function openReference(): void {
    const payload = createReplyReferenceOpenPayload(reference);
    if (!payload) return;
    ipc.emit(NOTE_VIEWER_OPEN_TOPIC, [], JSON.stringify(payload));
  }
</script>

{#if reference.target}
  <button type="button" class="reply-context-link" title={reference.title} onclick={openReference}>
    {reference.label}
  </button>
{:else}
  <span class="reply-context-link muted" title={reference.title}>{reference.label}</span>
{/if}

<style>
  .reply-context-link {
    display: inline;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--hg-accent-cyan, #82d8f7);
    font: inherit;
    line-height: inherit;
    cursor: pointer;
    text-align: left;
    overflow-wrap: anywhere;
  }

  .reply-context-link:hover {
    color: var(--hg-text-primary, #f2efe7);
    text-decoration: underline;
  }

  .reply-context-link.muted {
    color: var(--hg-text-muted, #b8b1a4);
    cursor: default;
  }
</style>
