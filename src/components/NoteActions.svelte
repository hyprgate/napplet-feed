<script lang="ts">
  import type { NostrEvent } from '@hyprgate/types';
  import { resourceImageBatch as resourceImage } from '@hyprgate/utils';
  import {
    createFeedComposerIntentRequest,
    createFeedNoteIntentRequest,
    createFeedReplyComposePayload,
    invokeFeedIntent,
    publishReaction,
  } from '../lib/feed-actions';
  import {
    customReactionInput,
    reactionInputFromEmojiOption,
    type EmojiOption,
  } from '../lib/emoji-sets';
  import EmojiSelector from './EmojiSelector.svelte';

  interface Props {
    event: NostrEvent;
    reactionOptions?: EmojiOption[];
    loadResources?: boolean;
  }

  let { event, reactionOptions = [], loadResources = true }: Props = $props();
  let reacting = $state(false);
  let reactionMenuOpen = $state(false);
  let customReaction = $state('');
  let error = $state<string | null>(null);
  let picker: HTMLDivElement | undefined = $state(undefined);
  let reactTrigger: HTMLButtonElement | undefined = $state(undefined);

  $effect(() => {
    if (!reactionMenuOpen) return;
    const onPointerDown = (pointer: PointerEvent): void => {
      if (!picker?.contains(pointer.target as Node)) reactionMenuOpen = false;
    };
    const onKeyDown = (key: KeyboardEvent): void => {
      if (key.key !== 'Escape' || key.defaultPrevented) return;
      reactionMenuOpen = false;
      reactTrigger?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  });

  async function openReplyComposer(): Promise<void> {
    error = null;
    const request = createFeedComposerIntentRequest(createFeedReplyComposePayload(event));
    if (!request) return;
    const result = await invokeFeedIntent(request);
    if (!result.accepted) error = result.error;
  }

  async function openNoteViewer(): Promise<void> {
    error = null;
    const request = createFeedNoteIntentRequest(event);
    if (!request) return;
    const result = await invokeFeedIntent(request);
    if (!result.accepted) error = result.error;
  }

  async function react(input: string | ReturnType<typeof reactionInputFromEmojiOption>): Promise<void> {
    if (reacting) return;
    reacting = true;
    reactionMenuOpen = false;
    error = null;
    try {
      await publishReaction(event, input);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Reaction failed';
    } finally {
      reacting = false;
    }
  }

  async function reactCustom(): Promise<void> {
    const input = customReactionInput(customReaction, reactionOptions);
    if (!input.content) return;
    customReaction = '';
    await react(input);
  }
</script>

<div class="note-actions">
  <button type="button" onclick={openNoteViewer}>
    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
    Open
  </button>
  <button type="button" onclick={openReplyComposer}>
    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H4l2.5-3.5A8 8 0 1 1 21 12z" /></svg>
    Reply
  </button>
  <div class="reaction-picker" bind:this={picker}>
    <button
      type="button"
      bind:this={reactTrigger}
      aria-haspopup="menu"
      aria-expanded={reactionMenuOpen}
      onclick={() => (reactionMenuOpen = !reactionMenuOpen)}
      disabled={reacting}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2M9 9.5h.01M15 9.5h.01" /></svg>
      {reacting ? 'Reacting...' : 'React'}
    </button>
    {#if reactionMenuOpen}
      <div class="reaction-menu" role="menu" aria-label="Select reaction">
        <div class="reaction-grid">
          {#each reactionOptions as option}
            <button type="button" role="menuitem" title={option.label} onclick={() => react(reactionInputFromEmojiOption(option))}>
              {#if option.imageUrl}
                <img use:resourceImage={loadResources ? option.imageUrl : null} alt={option.label} loading="lazy" />
              {:else}
                {option.content}
              {/if}
            </button>
          {/each}
        </div>
        <div class="emoji-library-row">
          <EmojiSelector
            buttonLabel="All emoji"
            title="Search all Unicode emoji"
            disabled={reacting}
            onselect={(emoji) => void react(emoji)}
          />
        </div>
        <!-- Not a <form>: submit never fires under sandbox="allow-scripts". -->
        <div class="custom-reaction">
          <input
            bind:value={customReaction}
            placeholder="emoji or :code:"
            aria-label="Custom reaction"
            maxlength="32"
            disabled={reacting}
            onkeydown={(key) => {
              if (key.key !== 'Enter' || key.isComposing) return;
              key.preventDefault();
              void reactCustom();
            }}
          />
          <button type="button" disabled={reacting || !customReaction.trim()} onclick={() => void reactCustom()}>Send</button>
        </div>
      </div>
    {/if}
  </div>
  {#if error}
    <span class="error" role="status">{error}</span>
  {/if}
</div>

<style>
  .note-actions {
    display: flex;
    align-items: center;
    gap: 2px;
    margin: 4px 0 0 -6px;
    min-height: 24px;
    flex-wrap: wrap;
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
  }

  button svg {
    width: 13px;
    height: 13px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  button:hover:not(:disabled),
  button[aria-expanded='true'] {
    border-color: var(--hg-border, #303030);
    background: var(--hg-surface, #101010);
    color: var(--hg-text-primary, #f2efe7);
  }

  .reaction-menu button {
    border-color: var(--hg-border, #303030);
    background: var(--hg-surface, #101010);
  }

  button:disabled {
    cursor: wait;
    opacity: 0.7;
  }

  .reaction-picker {
    position: relative;
  }

  .reaction-menu {
    position: absolute;
    left: 0;
    top: calc(100% + 4px);
    z-index: 10;
    width: min(280px, calc(100vw - 32px));
    display: grid;
    gap: 6px;
    padding: 6px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    background: var(--hg-surface, #101010);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
  }

  .reaction-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .reaction-grid button {
    min-width: 28px;
    padding: 0 6px;
    color: var(--hg-text-primary, #f2efe7);
  }

  .reaction-grid img {
    width: 16px;
    height: 16px;
    object-fit: contain;
  }

  .emoji-library-row {
    display: flex;
    justify-content: flex-start;
  }

  .custom-reaction {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 4px;
  }

  input {
    min-width: 0;
    height: 24px;
    padding: 0 6px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    background: var(--hg-bg-base, #050505);
    color: var(--hg-text-primary, #f2efe7);
    font: inherit;
    font-size: 11px;
  }

  .error {
    color: var(--hg-accent-red, #ff6b6b);
    font-size: 11px;
  }
</style>
