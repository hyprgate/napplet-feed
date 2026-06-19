<script lang="ts">
  import {
    EMOJI_GROUPS,
    filterEmojiCatalog,
    getEmojiCatalogByGroup,
    type EmojiCatalogEntry,
  } from '@hyprgate/utils';

  interface Props {
    buttonLabel?: string;
    title?: string;
    disabled?: boolean;
    onselect: (emoji: string, entry: EmojiCatalogEntry) => void;
  }

  let {
    buttonLabel = 'Emoji',
    title = 'Emoji library',
    disabled = false,
    onselect,
  }: Props = $props();

  let open = $state(false);
  let query = $state('');
  let rootEl: HTMLDivElement | undefined = $state();
  let triggerEl: HTMLButtonElement | undefined = $state();
  let searchEl: HTMLInputElement | undefined = $state();
  let selectedGroup = $state(EMOJI_GROUPS[0] ?? '');
  let popoverStyle = $state('');

  const trimmedQuery = $derived(query.trim());
  const visibleEntries = $derived.by((): EmojiCatalogEntry[] => {
    if (trimmedQuery) return filterEmojiCatalog(trimmedQuery, { limit: 120 });
    return getEmojiCatalogByGroup(selectedGroup);
  });

  $effect(() => {
    if (!open) return;
    queueMicrotask(() => searchEl?.focus());
  });

  // Keep the popover inside the napplet viewport: anchor it to the trigger, flip
  // above when there is more room there, clamp the horizontal edge, and bound the
  // height to the available space (the emoji grid scrolls within whatever fits).
  // Without this the popover always opened downward at a fixed height and spilled
  // off-screen — most visibly when browsing a full emoji group.
  function positionPopover(): void {
    if (!open || typeof window === 'undefined' || !triggerEl) return;
    const rect = triggerEl.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(342, viewportWidth - margin * 2);
    const left = Math.min(
      Math.max(rect.right - width, margin),
      Math.max(margin, viewportWidth - width - margin),
    );
    const spaceBelow = viewportHeight - rect.bottom - margin - gap;
    const spaceAbove = rect.top - margin - gap;
    const openDown = spaceBelow >= spaceAbove;
    const maxHeight = Math.max(160, Math.floor(openDown ? spaceBelow : spaceAbove));
    const vertical = openDown
      ? `top: ${Math.round(rect.bottom + gap)}px;`
      : `bottom: ${Math.round(viewportHeight - rect.top + gap)}px;`;
    popoverStyle = `left: ${Math.round(left)}px; width: ${width}px; max-height: ${maxHeight}px; ${vertical}`;
  }

  $effect(() => {
    if (!open) return;
    // Recompute when content that changes the popover footprint changes.
    void trimmedQuery;
    void selectedGroup;
    const reposition = (): void => positionPopover();
    reposition();
    // Run again after layout settles (scrollbars, fonts, async grid fill).
    const raf = requestAnimationFrame(reposition);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  });

  function toggle(): void {
    if (disabled) return;
    open = !open;
  }

  function choose(entry: EmojiCatalogEntry): void {
    onselect(entry.emoji, entry);
    open = false;
    query = '';
  }

  function handleWindowClick(event: MouseEvent): void {
    if (!open) return;
    const target = event.target;
    if (target instanceof Node && rootEl?.contains(target)) return;
    open = false;
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') {
      open = false;
    }
  }
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleWindowKeydown} />

<div class="emoji-selector" bind:this={rootEl}>
  <button
    type="button"
    class="emoji-trigger"
    bind:this={triggerEl}
    aria-expanded={open}
    {title}
    {disabled}
    onclick={toggle}
  >{buttonLabel}</button>

  {#if open}
    <div class="emoji-popover" role="dialog" aria-label="Emoji selector" style={popoverStyle}>
      <input
        bind:this={searchEl}
        bind:value={query}
        type="search"
        placeholder="Find emoji"
        aria-label="Find emoji"
      />

      {#if !trimmedQuery}
        <div class="emoji-groups" aria-label="Emoji groups">
          {#each EMOJI_GROUPS as group}
            <button
              type="button"
              class:active={selectedGroup === group}
              title={group}
              onclick={() => (selectedGroup = group)}
            >{group}</button>
          {/each}
        </div>
      {/if}

      <div class="emoji-grid" aria-live="polite">
        {#each visibleEntries as entry (entry.emoji + entry.name)}
          <button
            type="button"
            class="emoji-cell"
            title={`${entry.emoji} ${entry.name}`}
            aria-label={entry.name}
            onclick={() => choose(entry)}
          >{entry.emoji}</button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .emoji-selector {
    position: relative;
    display: inline-block;
  }

  .emoji-trigger,
  .emoji-groups button,
  .emoji-cell {
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-muted, #b8b1a4);
    cursor: pointer;
    font: inherit;
  }

  .emoji-trigger {
    min-height: 24px;
    padding: 0 8px;
    font-size: 11px;
  }

  .emoji-trigger:hover:not(:disabled),
  .emoji-groups button:hover,
  .emoji-groups button.active,
  .emoji-cell:hover {
    border-color: var(--hg-accent-cyan, #82d8f7);
    color: var(--hg-text-primary, #f2efe7);
  }

  .emoji-trigger:disabled {
    cursor: wait;
    opacity: 0.65;
  }

  .emoji-popover {
    position: fixed;
    z-index: 60;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    background: var(--hg-bg-base, #050505);
    box-shadow: 0 12px 32px color-mix(in srgb, var(--hg-shadow-color, #000) 55%, transparent);
  }

  input {
    width: 100%;
    min-width: 0;
    height: 26px;
    padding: 0 7px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-primary, #f2efe7);
    font: inherit;
    font-size: 11px;
    flex: 0 0 auto;
  }

  .emoji-groups {
    display: flex;
    gap: 4px;
    overflow-x: auto;
    padding-bottom: 2px;
    flex: 0 0 auto;
  }

  .emoji-groups button {
    flex: 0 0 auto;
    min-height: 22px;
    padding: 0 7px;
    font-size: 10px;
    white-space: nowrap;
  }

  .emoji-grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 4px;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }

  .emoji-cell {
    width: 100%;
    aspect-ratio: 1;
    padding: 0;
    color: var(--hg-text-primary, #f2efe7);
    font-size: 20px;
    line-height: 1;
  }
</style>
