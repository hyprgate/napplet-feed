<script lang="ts">
  import NoteContent from './NoteContent.svelte';
  import {
    DEFAULT_NOTE_TRUNCATE_CHARS,
    DEFAULT_NOTE_TRUNCATE_LINES,
    previewContent,
    shouldTruncateContent,
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
  let isTruncated = $derived(shouldTruncateContent(content, maxChars, maxLines));
  let visibleContent = $derived(expanded || !isTruncated ? content : previewContent(content, maxChars, maxLines));
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
