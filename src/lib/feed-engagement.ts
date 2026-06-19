// napps/feed/src/lib/feed-engagement.ts
// Engagement aggregation (reactions / comments / zaps) for the feed timeline.
// Operates on the shared FeedContext.

import type { NostrEvent } from '@hyprgate/types';
import {
  KIND_NIP22_COMMENT,
  KIND_REACTION,
  KIND_TEXT_NOTE,
  KIND_ZAP_RECEIPT,
  parseZapReceipt,
} from '@hyprgate/utils';
import type { EngagementCounts } from '@hyprgate/utils';
import { relay } from '@napplet/sdk';
import {
  getCustomEmoji,
  normalizeReactionContent,
  type FeedContext,
  type SeenEngagementIds,
} from './feed-context.js';

type EngagementCategory = keyof SeenEngagementIds;

export function resetEngagement(ctx: FeedContext): void {
  ctx.state.engagement.clear();
  ctx.state.engagementVersion++;
  ctx.seenEngagementIds.reactions.clear();
  ctx.seenEngagementIds.comments.clear();
  ctx.seenEngagementIds.zaps.clear();
}

function getCounts(ctx: FeedContext, noteId: string): EngagementCounts {
  let counts = ctx.state.engagement.get(noteId);
  if (!counts) {
    counts = { reactions: 0, reactionGroups: [], comments: 0, zaps: 0, zapMillisats: 0 };
    ctx.state.engagement.set(noteId, counts);
  }
  return counts;
}

function cloneEngagementCounts(counts: EngagementCounts): EngagementCounts {
  return {
    reactions: counts.reactions,
    reactionGroups: counts.reactionGroups.map((group) => ({ ...group })),
    comments: counts.comments,
    zaps: counts.zaps,
    zapMillisats: counts.zapMillisats,
  };
}

function getSeenSet(ctx: FeedContext, category: EngagementCategory, noteId: string): Set<string> {
  let seen = ctx.seenEngagementIds[category].get(noteId);
  if (!seen) {
    seen = new Set<string>();
    ctx.seenEngagementIds[category].set(noteId, seen);
  }
  return seen;
}

function matchingTargetIds(ctx: FeedContext, event: NostrEvent): string[] {
  const loadedIds = new Set(ctx.state.timeline.map((note) => note.id));
  const targetIds = event.kind === KIND_ZAP_RECEIPT
    ? (parseZapReceipt(event)?.targetEventIds ?? [])
    : event.tags
        .filter((tag) => (tag[0] === 'e' || (event.kind === KIND_NIP22_COMMENT && tag[0] === 'E')) && typeof tag[1] === 'string')
        .map((tag) => tag[1]!);
  const targets = targetIds.filter((targetId) => loadedIds.has(targetId));
  return [...new Set(targets)];
}

function engagementCategory(kind: number): EngagementCategory | null {
  if (kind === KIND_REACTION) return 'reactions';
  if (kind === KIND_TEXT_NOTE || kind === KIND_NIP22_COMMENT) return 'comments';
  if (kind === KIND_ZAP_RECEIPT) return 'zaps';
  return null;
}

function applyReaction(counts: EngagementCounts, event: NostrEvent): void {
  const content = normalizeReactionContent(event.content);
  let group = counts.reactionGroups.find((item) => item.content === content);
  if (!group) {
    group = { content, count: 0, ...getCustomEmoji(content, event.tags) };
    counts.reactionGroups.push(group);
  } else if (!group.imageUrl) {
    Object.assign(group, getCustomEmoji(content, event.tags));
  }
  group.count++;
}

function applyEngagementEvent(ctx: FeedContext, event: NostrEvent): void {
  const targets = matchingTargetIds(ctx, event);
  if (targets.length === 0) return;
  const category = engagementCategory(event.kind);
  if (category === null) return;

  let changed = false;
  for (const target of targets) {
    const seen = getSeenSet(ctx, category, target);
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    const counts = getCounts(ctx, target);
    counts[category]++;
    if (category === 'zaps') {
      counts.zapMillisats += parseZapReceipt(event)?.amountMillisats ?? 0;
    } else if (category === 'reactions') {
      applyReaction(counts, event);
    }
    ctx.state.engagement.set(target, cloneEngagementCounts(counts));
    changed = true;
  }

  if (changed) {
    ctx.state.engagementVersion++;
    ctx.notify();
  }
}

export function syncEngagementSubscription(ctx: FeedContext): void {
  const targetIds = ctx.state.timeline.map((event) => event.id);
  const nextKey = targetIds.join(',');
  if (nextKey === ctx.engagementTargetsKey) return;

  ctx.engagementSub?.close();
  ctx.engagementSub = null;

  ctx.engagementTargetsKey = nextKey;
  if (targetIds.length === 0) return;

  ctx.engagementSub = relay.subscribe(
    [
      { kinds: [KIND_REACTION], '#e': targetIds },
      { kinds: [KIND_TEXT_NOTE], '#e': targetIds },
      { kinds: [KIND_NIP22_COMMENT], '#e': targetIds },
      { kinds: [KIND_NIP22_COMMENT], '#E': targetIds },
      { kinds: [KIND_ZAP_RECEIPT], '#e': targetIds },
    ],
    (event: NostrEvent) => applyEngagementEvent(ctx, event),
    () => {
      // Stored engagement events exhausted; keep listening for live updates.
    },
  );
}
