<script lang="ts">
  import NoteContent from './NoteContent.svelte';
  import {
    DEFAULT_NOTE_TRUNCATE_CHARS,
    DEFAULT_NOTE_TRUNCATE_LINES,
    previewContent,
    shouldTruncateContent,
    tightenImageSpacing,
  } from '../lib/note-presentation';

  interface Props {
    content: string;
    emojiTags?: string[][];
    maxChars?: number;
    maxLines?: number;
    profileLabel?: (pubkey: string) => string;
    loadResources?: boolean;
  }

  let {
    content,
    emojiTags = [],
    maxChars = DEFAULT_NOTE_TRUNCATE_CHARS,
    maxLines = DEFAULT_NOTE_TRUNCATE_LINES,
    profileLabel,
    loadResources = true,
  }: Props = $props();

  let expanded = $state(false);
  let readable = $derived(tightenImageSpacing(content));
  let isTruncated = $derived(shouldTruncateContent(readable, maxChars, maxLines));
  let visibleContent = $derived(expanded || !isTruncated ? readable : previewContent(readable, maxChars, maxLines));
</script>

<div class="expandable-note-content">
  <NoteContent content={visibleContent} {emojiTags} {profileLabel} {loadResources} />
  {#if isTruncated}
    <button
      type="button"
      class="toggle"
      onclick={() => (expanded = !expanded)}
      aria-expanded={expanded}
    >
      {expanded ? 'Show less' : 'Show more'}
    </button>
  {/if}
</div>

<style>
  .expandable-note-content {
    min-width: 0;
  }

  /* Keep the next note on screen: an image shouldn't fill the whole window. */
  .expandable-note-content :global(.note-content img.media) {
    max-width: min(100%, 512px);
    max-height: 18rem;
  }

  .expandable-note-content :global(.note-content img.media.resource-pending) {
    width: min(100%, 512px);
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    margin-top: 6px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--hg-accent-cyan, #82d8f7);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }

  .toggle:hover {
    text-decoration: underline;
  }
</style>
