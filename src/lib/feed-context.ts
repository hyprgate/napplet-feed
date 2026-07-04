// napplets/feed/src/lib/feed-context.ts
// The shared FeedContext (mutable store state + tracking) plus small pure
// helpers used across the feed engine modules.

import type { FeedIntentPayload, NostrEvent } from '@hyprgate/types';
import { customEmojiForShortcodeContent, type ReactionGroup } from '@hyprgate/utils';
import type { Subscription } from '@napplet/sdk';
import type { FeedLoadIntent } from './feed-load-strategy.js';
import type { FeedState } from './feed-store.js';

export const TIMELINE_PAGE_LIMIT = 50;

export interface SeenEngagementIds {
  reactions: Map<string, Set<string>>;
  comments: Map<string, Set<string>>;
  zaps: Map<string, Set<string>>;
}

export interface FeedContext {
  state: FeedState;
  notify(): void;

  /**
   * All timeline events accepted from historical pages or loaded live notes.
   * `state.timeline` is the visible projection derived from this cache.
   */
  timelineEvents: NostrEvent[];
  seenIds: Set<string>;
  pendingIds: Set<string>;
  currentPubkey: string | null;
  contactPubkeys: string[];
  /**
   * The active feed wireformat driving the subscription. Null until a payload
   * (intent or synthesized following-default) is applied. Source of truth for
   * the paged/live subscription filters (FEED-01 — no hard-coded filter path).
   */
  currentPayload: FeedIntentPayload | null;
  timelinePageInFlight: boolean;
  pendingLoadMoreIntent: FeedLoadIntent | null;
  timelineRequestId: number;
  contactsRequestId: number;
  timelinePageTimeout: ReturnType<typeof setTimeout> | null;
  reactionCountRequestId: number;
  reactionCountTargetIds: Set<string>;

  contactsSub: Subscription | null;
  timelineSub: Subscription | null;
  liveSub: Subscription | null;
  engagementSub: Subscription | null;

  oldestTimestamp: number | null;
  pageCursorTimestamp: number | null;
  engagementTargetIds: string[];
  engagementTargetsKey: string;
  seenEngagementIds: SeenEngagementIds;
}

export function createFeedContext(notify: () => void): FeedContext {
  return {
    state: {
      timeline: [],
      pendingNew: [],
      engagement: new Map(),
      engagementVersion: 0,
      loading: false,
      canLoadMore: false,
      source: 'following',
      viewMode: 'compact',
      showReplies: false,
      detailedReactions: false,
      error: null,
    },
    notify,
    timelineEvents: [],
    seenIds: new Set<string>(),
    pendingIds: new Set<string>(),
    currentPubkey: null,
    contactPubkeys: [],
    currentPayload: null,
    timelinePageInFlight: false,
    pendingLoadMoreIntent: null,
    timelineRequestId: 0,
    contactsRequestId: 0,
    timelinePageTimeout: null,
    reactionCountRequestId: 0,
    reactionCountTargetIds: new Set<string>(),
    contactsSub: null,
    timelineSub: null,
    liveSub: null,
    engagementSub: null,
    oldestTimestamp: null,
    pageCursorTimestamp: null,
    engagementTargetIds: [],
    engagementTargetsKey: '',
    seenEngagementIds: {
      reactions: new Map<string, Set<string>>(),
      comments: new Map<string, Set<string>>(),
      zaps: new Map<string, Set<string>>(),
    },
  };
}

export function compareTimelineEvents(a: NostrEvent, b: NostrEvent): number {
  return b.created_at - a.created_at || a.id.localeCompare(b.id);
}

export function normalizeReactionContent(content: string): string {
  const normalized = content.trim();
  return normalized.length > 0 ? normalized : '+';
}

export function getCustomEmoji(content: string, tags: string[][]): Pick<ReactionGroup, 'imageUrl' | 'shortcode'> {
  const emoji = customEmojiForShortcodeContent(content, tags);
  if (!emoji) return {};
  return {
    shortcode: emoji.shortcode,
    ...(emoji.imageUrl ? { imageUrl: emoji.imageUrl } : {}),
  };
}

export function oldestCreatedAt(events: NostrEvent[]): number | null {
  return events.reduce<number | null>(
    (oldest, event) => oldest === null || event.created_at < oldest ? event.created_at : oldest,
    null,
  );
}
