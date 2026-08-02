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

  async function openReplyComposer(): Promise<void> {
    error = null;
    const request = createFeedComposerIntentRequest(createFeedReplyComposePayload(event));
    if (!request) return;
    const result = await invokeFeedIntent(request);
    if (!result.handled) error = result.error;
  }

  async function openNoteViewer(): Promise<void> {
    error = null;
    const request = createFeedNoteIntentRequest(event);
    if (!request) return;
    const result = await invokeFeedIntent(request);
    if (!result.handled) error = result.error;
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
  <button type="button" onclick={openNoteViewer}>Open</button>
  <button type="button" onclick={openReplyComposer}>Reply</button>
  <div class="reaction-picker">
    <button type="button" onclick={() => (reactionMenuOpen = !reactionMenuOpen)} disabled={reacting}>
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
        <form class="custom-reaction" onsubmit={(submitEvent) => { submitEvent.preventDefault(); void reactCustom(); }}>
          <input
            bind:value={customReaction}
            placeholder="emoji or :code:"
            aria-label="Custom reaction"
            maxlength="32"
            disabled={reacting}
          />
          <button type="submit" disabled={reacting || !customReaction.trim()}>Send</button>
        </form>
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
    gap: 8px;
    margin-top: 8px;
    min-height: 24px;
    flex-wrap: wrap;
  }

  button {
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
  }

  button:hover:not(:disabled) {
    border-color: var(--hg-accent-cyan, #82d8f7);
    color: var(--hg-text-primary, #f2efe7);
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
