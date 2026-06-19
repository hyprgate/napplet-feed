<script lang="ts">
  import type { EmojiSetState, EmojiSetStore } from '../lib/emoji-sets';

  interface Props {
    state: EmojiSetState;
    store: EmojiSetStore;
    version: number;
  }

  let { state: emojiState, store, version }: Props = $props();
  let open = $state(false);

  // The button shows whichever palette is active: the built-in default, the
  // user's emoji list (kind 10030), or a named emoji set (kind 30030).
  const activeLabel = $derived.by(() => {
    version;
    const source = emojiState.activeSource;
    if (source === 'default') return 'Default';
    if (source === 'preferred') return 'My list';
    return emojiState.sets.find((set) => set.address === source)?.title ?? 'Emoji';
  });

  function select(source: 'default' | 'preferred' | string): void {
    store.setActiveSource(source);
    open = false;
  }
</script>

<div class="reaction-settings" data-version={version}>
  <button
    type="button"
    class="toolbar-button"
    aria-expanded={open}
    title="Choose reaction palette"
    onclick={() => (open = !open)}
  >
    <span class="star">★</span>
    <span class="label">{activeLabel}</span>
    <span class="count">{emojiState.options.length}</span>
  </button>

  {#if open}
    <div class="settings-popover">
      <div class="section-title">Reaction palette</div>
      <div class="source-list">
        <button
          type="button"
          class="source"
          class:active={emojiState.activeSource === 'default'}
          onclick={() => select('default')}
        >
          <span class="name">Default</span>
          <span class="count">{emojiState.defaults.length}</span>
        </button>

        {#if emojiState.preferred.length > 0}
          <button
            type="button"
            class="source"
            class:active={emojiState.activeSource === 'preferred'}
            onclick={() => select('preferred')}
          >
            <span class="name">My list</span>
            <span class="count">{emojiState.preferred.length}</span>
          </button>
        {/if}

        {#each emojiState.sets as set (set.address)}
          <button
            type="button"
            class="source"
            class:active={emojiState.activeSource === set.address}
            title={set.address}
            onclick={() => select(set.address)}
          >
            <span class="name">{set.title}</span>
            <span class="count">{set.emojis.length}</span>
          </button>
        {/each}
      </div>

      <p class="hint">Create and edit emoji lists in the Emoji Sets app.</p>
      {#if emojiState.error}<p class="error">{emojiState.error}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .reaction-settings {
    position: relative;
  }

  .toolbar-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
    max-width: 180px;
    padding: 0 8px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font: inherit;
    font-size: 11px;
  }

  .toolbar-button:hover {
    border-color: var(--hg-accent-cyan, #82d8f7);
    color: var(--hg-text-primary, #f2efe7);
  }

  .toolbar-button .star {
    color: var(--hg-accent-cyan, #82d8f7);
  }

  .toolbar-button .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .settings-popover {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 30;
    width: min(260px, calc(100vw - 24px));
    display: grid;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 6px;
    background: var(--hg-bg-base, #050505);
    box-shadow: 0 16px 44px rgba(0, 0, 0, 0.42);
  }

  .section-title {
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 10px;
    text-transform: uppercase;
  }

  .source-list {
    display: grid;
    gap: 4px;
  }

  .source {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 28px;
    padding: 0 10px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font: inherit;
    font-size: 12px;
  }

  .source:hover,
  .source.active {
    border-color: var(--hg-accent-cyan, #82d8f7);
    color: var(--hg-text-primary, #f2efe7);
  }

  .source .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    flex: 0 0 auto;
    padding: 0 6px;
    border-radius: 8px;
    background: var(--hg-bg-base, #050505);
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 10px;
  }

  .hint {
    margin: 0;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 10px;
  }

  .error {
    margin: 0;
    color: var(--hg-accent-red, #ff6b6b);
    font-size: 11px;
  }
</style>
