<script lang="ts">
  import { onDestroy } from 'svelte';
  import { formatMillisatsAsSats, resourceImageBatch as resourceImage } from '@hyprgate/utils';
  import type { NostrEvent } from '@hyprgate/types';
  import { publishReaction } from '../lib/feed-actions';
  import { countLabel } from '../lib/note-presentation';
  import type { EngagementCounts, ReactionGroup } from '../lib/feed-store';

  interface Props {
    event?: Pick<NostrEvent, 'id' | 'kind' | 'pubkey'>;
    engagement?: EngagementCounts;
    compact?: boolean;
    /** When false (and not hovered) the counts are visually muted. */
    active?: boolean;
    loadResources?: boolean;
  }

  let { event, engagement, compact = false, active = false, loadResources = true }: Props = $props();

  let counts = $derived(engagement ?? { reactions: 0, reactionGroups: [], comments: 0, zaps: 0, zapMillisats: 0 });
  let reactionGroups = $derived(sortReactionGroups(counts.reactionGroups));
  let zapSatsLabel = $derived(formatMillisatsAsSats(counts.zapMillisats));
  let zapTitle = $derived(counts.zaps > 0
    ? `${countLabel(counts.zaps, 'zap')} / ${zapSatsLabel}`
    : countLabel(counts.zaps, 'zap'));

  function sortReactionGroups(groups: ReactionGroup[]): ReactionGroup[] {
    return [...groups].sort((a, b) => {
      if (a.content === '+' && b.content !== '+') return -1;
      if (b.content === '+' && a.content !== '+') return 1;
      if (a.content === '-' && b.content !== '-') return -1;
      if (b.content === '-' && a.content !== '-') return 1;
      return b.count - a.count || a.content.localeCompare(b.content);
    });
  }

  const HOLD_MS = 650;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let holdingContent = $state<string | null>(null);
  let completedContent = $state<string | null>(null);
  let sending = $state(false);

  function startReactionHold(group: ReactionGroup): void {
    if (!event || sending) return;
    cancelReactionHold();
    holdingContent = group.content;
    holdTimer = setTimeout(() => {
      void sendExistingReaction(group);
    }, HOLD_MS);
  }

  function cancelReactionHold(): void {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    holdingContent = null;
  }

  async function sendExistingReaction(group: ReactionGroup): Promise<void> {
    if (!event || sending) return;
    holdTimer = null;
    sending = true;
    holdingContent = null;
    const tags = group.shortcode && group.imageUrl ? [['emoji', group.shortcode, group.imageUrl]] : [];
    try {
      await publishReaction(event, { content: group.content, tags });
      completedContent = group.content;
      setTimeout(() => {
        if (completedContent === group.content) completedContent = null;
      }, 520);
    } finally {
      sending = false;
    }
  }

  onDestroy(cancelReactionHold);
</script>

<div class="engagement-pills" class:compact class:active aria-label="Engagement counts">
  {#if reactionGroups.length > 0}
    {#each reactionGroups as group (group.content)}
      <button
        type="button"
        class="pill reaction"
        class:hold-active={holdingContent === group.content}
        class:send-complete={completedContent === group.content}
        title={event ? `Hold to send ${group.content}` : countLabel(group.count, `${group.content} reaction`)}
        disabled={!event || sending}
        onpointerdown={() => startReactionHold(group)}
        onpointerup={cancelReactionHold}
        onpointerleave={cancelReactionHold}
        onpointercancel={cancelReactionHold}
      >
        {#if group.imageUrl}
          <img use:resourceImage={loadResources ? group.imageUrl : null} alt={group.shortcode ?? group.content} loading="lazy" />
        {:else}
          <span class="mark reaction-mark">{group.content}</span>
        {/if}
        <span>{group.count}</span>
      </button>
    {/each}
  {:else}
    <span class="pill reaction" title={countLabel(counts.reactions, 'reaction')}>
      <span class="mark reaction-mark">+</span>
      <span>{counts.reactions}</span>
    </span>
  {/if}
  <span class="pill reply" title={countLabel(counts.comments, 'reply', 'replies')}>
    <span class="mark">r</span>
    <span>{counts.comments}</span>
  </span>
  <span class="pill zap" title={zapTitle}>
    <span class="mark">z</span>
    <span>{counts.zaps > 0 ? zapSatsLabel : counts.zaps}</span>
  </span>
</div>

<style>
  .engagement-pills {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 11px;
    line-height: 1;
    opacity: 0.5;
    transition: opacity 0.15s ease;
  }

  /* Muted by default; full weight once the surrounding note is hovered/active. */
  .engagement-pills.active,
  .engagement-pills:hover {
    opacity: 1;
  }

  .engagement-pills.compact {
    gap: 4px;
    font-size: 10px;
  }

  .pill {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
    height: 20px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: 999px;
    background: transparent;
    color: inherit;
    font: inherit;
    white-space: nowrap;
    overflow: hidden;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .engagement-pills.active .pill,
  .engagement-pills:hover .pill {
    border-color: var(--hg-border, #303030);
    background: color-mix(in srgb, var(--hg-surface, #101010) 88%, transparent);
  }

  button.pill {
    cursor: pointer;
  }

  button.pill:disabled {
    cursor: default;
    opacity: 0.78;
  }

  button.pill::before {
    content: '';
    position: absolute;
    inset: 0;
    transform: scaleX(0);
    transform-origin: left center;
    background: color-mix(in srgb, var(--hg-accent-green, #9be564) 32%, transparent);
    pointer-events: none;
  }

  button.pill.hold-active::before {
    animation: hold-fill 650ms linear forwards;
  }

  button.pill.send-complete {
    animation: sent-pop 520ms ease-out;
  }

  .engagement-pills.compact .pill {
    height: 18px;
    padding: 0 5px;
  }

  .mark {
    color: var(--hg-accent-cyan, #82d8f7);
    font-weight: 700;
  }

  .reaction-mark {
    max-width: 7ch;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  img {
    width: 14px;
    height: 14px;
    object-fit: contain;
  }

  .engagement-pills.compact img {
    width: 12px;
    height: 12px;
  }

  .reply .mark {
    color: var(--hg-accent-green, #9be564);
  }

  .zap .mark {
    color: var(--hg-accent-yellow, #f7d774);
  }

  @keyframes hold-fill {
    from { transform: scaleX(0); }
    to { transform: scaleX(1); }
  }

  @keyframes sent-pop {
    0% {
      border-color: var(--hg-accent-green, #9be564);
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--hg-accent-green, #9be564) 50%, transparent);
      transform: scale(1);
    }
    45% {
      box-shadow: 0 0 0 6px transparent;
      transform: scale(1.08);
    }
    100% {
      box-shadow: none;
      transform: scale(1);
    }
  }
</style>
