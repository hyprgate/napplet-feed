// napplets/feed/src/lib/feed-engine.ts
// Stateful feed logic, split out of feed-store's factory so neither the file
// nor createFeedStore grows unbounded. All functions operate on an explicit
// FeedContext (the store's mutable state + tracking), keeping them
// vitest-importable and the factory thin.

import type { FeedIntentPayload, NostrEvent, NostrFilter } from '@hyprgate/types';
import {
  KIND_NIP22_COMMENT,
  KIND_TEXT_NOTE,
  parseNoteViewerReply,
} from '@hyprgate/utils';
import type { FeedSource } from './feed-store.js';
import {
  TIMELINE_PAGE_LIMIT,
  compareTimelineEvents,
  oldestCreatedAt,
  type FeedContext,
} from './feed-context.js';
import {
  TIMELINE_PAGE_LIMIT_BY_INTENT,
  moreAggressiveLoadIntent,
  type FeedLoadIntent,
} from './feed-load-strategy.js';
import { subscribeForPayload } from './feed-origin.js';
import { resetEngagement, syncEngagementSubscription } from './feed-engagement.js';

export { TIMELINE_PAGE_LIMIT, createFeedContext, type FeedContext } from './feed-context.js';
export { normalizeReactionContent } from './feed-context.js';

const EMPTY_FOLLOWING_AUTHOR = '0'.repeat(64);
const TIMELINE_PAGE_EOSE_TIMEOUT_MS = 5000;
const URGENT_TIMELINE_PAGE_TIMEOUT_MS = 2000;
export const TIMELINE_CACHE_LIMIT = TIMELINE_PAGE_LIMIT * 20;
type TimelinePageCompletion = 'eose' | 'timeout';

// ── Timeline helpers ──────────────────────────────────────────────────────

function findTimelineInsertIndex(events: NostrEvent[], event: NostrEvent): number {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    const candidate = events[mid];
    if (candidate && compareTimelineEvents(candidate, event) < 0) low = mid + 1;
    else high = mid;
  }
  return low;
}

function insertPageCandidate(events: NostrEvent[], event: NostrEvent): void {
  events.splice(findTimelineInsertIndex(events, event), 0, event);
}

function isReplyEvent(event: NostrEvent): boolean {
  return parseNoteViewerReply(event) !== null;
}

function recomputeOldestTimestamp(ctx: FeedContext): void {
  ctx.oldestTimestamp = oldestCreatedAt(ctx.timelineEvents);
}

function isTimelineEventVisible(ctx: FeedContext, event: NostrEvent): boolean {
  return ctx.state.showReplies || !isReplyEvent(event);
}

function rebuildVisibleTimeline(ctx: FeedContext): void {
  ctx.state.timeline = ctx.timelineEvents.filter((event) => isTimelineEventVisible(ctx, event));
}

function findTimelineEvictionIndex(ctx: FeedContext): number {
  for (let index = ctx.timelineEvents.length - 1; index >= 0; index--) {
    const event = ctx.timelineEvents[index];
    if (event && !isTimelineEventVisible(ctx, event)) return index;
  }
  return ctx.timelineEvents.length - 1;
}

function trimTimelineCache(ctx: FeedContext): void {
  while (ctx.timelineEvents.length > TIMELINE_CACHE_LIMIT) {
    const [evicted] = ctx.timelineEvents.splice(findTimelineEvictionIndex(ctx), 1);
    if (!evicted) continue;
    ctx.seenIds.delete(evicted.id);
  }
}

function cacheHiddenPendingEvents(ctx: FeedContext): void {
  const visiblePending: NostrEvent[] = [];
  for (const event of ctx.state.pendingNew) {
    if (isTimelineEventVisible(ctx, event)) {
      visiblePending.push(event);
      continue;
    }
    addTimelineEvent(ctx, event);
  }
  ctx.state.pendingNew = visiblePending;
}

function addTimelineEvent(ctx: FeedContext, event: NostrEvent): boolean {
  if (ctx.seenIds.has(event.id)) return false;
  ctx.seenIds.add(event.id);
  ctx.pendingIds.delete(event.id);
  insertPageCandidate(ctx.timelineEvents, event);
  trimTimelineCache(ctx);
  const retained = ctx.seenIds.has(event.id);
  if (retained && isTimelineEventVisible(ctx, event)) {
    rebuildVisibleTimeline(ctx);
  }
  return retained;
}

function removeTimelineEvent(ctx: FeedContext, eventId: string): boolean {
  const allIndex = ctx.timelineEvents.findIndex((event) => event.id === eventId);
  if (allIndex === -1) return false;
  ctx.timelineEvents.splice(allIndex, 1);
  const index = ctx.state.timeline.findIndex((event) => event.id === eventId);
  if (index !== -1) ctx.state.timeline.splice(index, 1);
  ctx.seenIds.delete(eventId);
  return true;
}

function commitTimelineChange(ctx: FeedContext): void {
  recomputeOldestTimestamp(ctx);
  ctx.notify();
  syncEngagementSubscription(ctx);
}

function addToTimeline(ctx: FeedContext, event: NostrEvent): boolean {
  if (!addTimelineEvent(ctx, event)) return false;
  commitTimelineChange(ctx);
  return true;
}

function selectTimelinePageEvents(pageCandidates: NostrEvent[], pageLimit: number): NostrEvent[] {
  return pageCandidates.slice(0, pageLimit);
}

function applyTimelinePageSelection(
  ctx: FeedContext,
  pageCandidates: NostrEvent[],
  acceptedPageIds: Set<string>,
  pageLimit: number,
): void {
  const selectedEvents = selectTimelinePageEvents(pageCandidates, pageLimit);
  const selectedIds = new Set(selectedEvents.map((event) => event.id));
  let changed = false;

  for (const eventId of acceptedPageIds) {
    if (selectedIds.has(eventId)) continue;
    acceptedPageIds.delete(eventId);
    changed = removeTimelineEvent(ctx, eventId) || changed;
  }

  for (const event of selectedEvents) {
    if (acceptedPageIds.has(event.id)) continue;
    if (addTimelineEvent(ctx, event)) {
      acceptedPageIds.add(event.id);
      changed = true;
    }
  }

  if (changed) commitTimelineChange(ctx);
}

function commitPageCursor(
  ctx: FeedContext,
  pageCandidates: NostrEvent[],
  pageLimit: number,
  completion: TimelinePageCompletion,
): void {
  const selectedEvents = selectTimelinePageEvents(pageCandidates, pageLimit);
  ctx.pageCursorTimestamp = oldestCreatedAt(selectedEvents);
  ctx.state.canLoadMore = ctx.pageCursorTimestamp !== null
    && (selectedEvents.length === pageLimit || completion === 'timeout');
}

function clearTimelinePageTimeout(ctx: FeedContext): void {
  if (ctx.timelinePageTimeout === null) return;
  clearTimeout(ctx.timelinePageTimeout);
  ctx.timelinePageTimeout = null;
}

function finalizeTimelinePage(
  ctx: FeedContext,
  requestId: number,
  pageCandidates: NostrEvent[],
  pageLimit: number,
  completion: TimelinePageCompletion,
): void {
  if (requestId !== ctx.timelineRequestId) return;
  clearTimelinePageTimeout(ctx);
  ctx.timelineSub?.close();
  ctx.timelineSub = null;
  commitPageCursor(ctx, pageCandidates, pageLimit, completion);
  ctx.timelinePageInFlight = false;
  ctx.state.loading = false;
  ctx.notify();
  const pendingIntent = ctx.pendingLoadMoreIntent;
  ctx.pendingLoadMoreIntent = null;
  if (pendingIntent && ctx.state.canLoadMore) startLoadMorePage(ctx, pendingIntent);
}

export function teardownSubscriptions(ctx: FeedContext): void {
  clearTimelinePageTimeout(ctx);
  for (const key of ['contactsSub', 'timelineSub', 'liveSub', 'engagementSub'] as const) {
    ctx[key]?.close();
    ctx[key] = null;
  }
  ctx.timelinePageInFlight = false;
  ctx.pendingLoadMoreIntent = null;
  ctx.timelineRequestId++;
  ctx.engagementTargetsKey = '';
}

// ── Payload-driven subscriptions ───────────────────────────────────────────
// The timeline + live subscriptions are built ENTIRELY from ctx.currentPayload
// (FEED-01: no hard-coded kinds/authors on the payload path). Origin routing
// (outbox discovery vs. exact relay-pin) is owned by subscribeForPayload.

/**
 * Open the paged (historical) timeline subscription from the active payload.
 * `extra` carries the page-leg props (`{ limit, until }`).
 */
function startTimelineSubscription(
  ctx: FeedContext,
  extra: Record<string, unknown>,
  pageLimit = TIMELINE_PAGE_LIMIT,
  timeoutMs = TIMELINE_PAGE_EOSE_TIMEOUT_MS,
): void {
  const payload = ctx.currentPayload;
  if (!payload) return;

  const requestId = ++ctx.timelineRequestId;
  const pageCandidates: NostrEvent[] = [];
  const pageCandidateIds = new Set<string>();
  const acceptedPageIds = new Set<string>();
  ctx.state.loading = true;
  ctx.timelinePageInFlight = true;
  ctx.notify();

  ctx.timelineSub = subscribeForPayload(
    payload,
    {
      onEvent: (event: NostrEvent) => {
        if (requestId !== ctx.timelineRequestId) return;
        if (pageCandidateIds.has(event.id) || ctx.seenIds.has(event.id) || ctx.pendingIds.has(event.id)) return;
        pageCandidateIds.add(event.id);
        insertPageCandidate(pageCandidates, event);
        applyTimelinePageSelection(ctx, pageCandidates, acceptedPageIds, pageLimit);
      },
      onEose: () => {
        finalizeTimelinePage(ctx, requestId, pageCandidates, pageLimit, 'eose');
      },
    },
    { ...extra, limit: pageLimit },
  );
  clearTimelinePageTimeout(ctx);
  ctx.timelinePageTimeout = setTimeout(() => {
    finalizeTimelinePage(ctx, requestId, pageCandidates, pageLimit, 'timeout');
  }, timeoutMs);
}

/** Open the live (future events) subscription from the active payload. */
function startLiveSubscription(ctx: FeedContext): void {
  const payload = ctx.currentPayload;
  if (!payload) return;
  const since = Math.floor(Date.now() / 1000);

  ctx.liveSub = subscribeForPayload(
    payload,
    {
      onEvent: (event: NostrEvent) => {
        if (!ctx.seenIds.has(event.id) && !ctx.pendingIds.has(event.id)) {
          if (!isTimelineEventVisible(ctx, event)) {
            addToTimeline(ctx, event);
            return;
          }
          ctx.pendingIds.add(event.id);
          ctx.state.pendingNew.unshift(event);
          ctx.notify();
        }
      },
      onEose: () => {
        // EOSE on live sub — normal, we keep listening for future events.
      },
    },
    { since },
  );
}

/**
 * Apply a FeedIntentPayload: tear down the timeline/live subs, reset the
 * timeline + tracking, store the payload, then (re)build the paged + live
 * subscriptions from payload.filters via subscribeForPayload. The ONLY entry
 * point that opens timeline subscriptions — there is no hard-coded filter path.
 *
 * An empty filter set produces the explicit empty state (no subscription).
 */
export function applyPayload(ctx: FeedContext, payload: FeedIntentPayload): void {
  // Reset the timeline/live legs + tracking (keep any kind-3 contacts sub open).
  ctx.timelineSub?.close();
  ctx.timelineSub = null;
  ctx.liveSub?.close();
  ctx.liveSub = null;
  clearTimelinePageTimeout(ctx);
  ctx.timelinePageInFlight = false;
  ctx.pendingLoadMoreIntent = null;
  ctx.timelineRequestId++;

  ctx.state.timeline = [];
  ctx.timelineEvents = [];
  ctx.state.pendingNew = [];
  ctx.seenIds.clear();
  ctx.pendingIds.clear();
  resetEngagement(ctx);
  ctx.engagementSub?.close();
  ctx.engagementSub = null;
  ctx.engagementTargetsKey = '';
  ctx.oldestTimestamp = null;
  ctx.pageCursorTimestamp = null;
  ctx.pendingLoadMoreIntent = null;
  ctx.state.canLoadMore = false;
  ctx.state.error = null;

  ctx.currentPayload = payload;

  if (payload.filters.length === 0) {
    ctx.state.loading = false;
    ctx.notify();
    return;
  }

  startTimelineSubscription(ctx, {});
  startLiveSubscription(ctx);
}

// ── Following-default synthesis ────────────────────────────────────────────
// The backward-compat default: when no intent payload is applied and a pubkey
// exists, synthesize a following-timeline payload from the user's kind-3 follows
// and run it through the SAME applyPayload path. Origin is 'outbox' so follows
// resolve via NIP-65 author-write relays.

function timelineKinds(): number[] {
  return [KIND_TEXT_NOTE, KIND_NIP22_COMMENT];
}

/** Build the following-default timeline filter (NOT used on the intent path). */
function buildTimelineFilter(extra: Record<string, unknown> = {}): NostrFilter {
  return { kinds: timelineKinds(), ...extra } as NostrFilter;
}

/** Synthesize the global-timeline payload (no authors). */
function synthesizeGlobalPayload(): FeedIntentPayload {
  return { filters: [buildTimelineFilter()], origin: 'outbox' };
}

/** Synthesize the following-timeline payload from resolved kind-3 follows. */
function synthesizeFollowingPayload(ctx: FeedContext, pubkeys: string[]): FeedIntentPayload {
  return {
    filters: [buildTimelineFilter({ authors: pubkeys.length > 0 ? pubkeys : [EMPTY_FOLLOWING_AUTHOR] })],
    origin: 'outbox',
  };
}

function startGlobalFeed(ctx: FeedContext): void {
  applyPayload(ctx, synthesizeGlobalPayload());
}

function startFollowingFeed(ctx: FeedContext, pubkeys: string[]): void {
  if (pubkeys.length === 0) {
    ctx.currentPayload = synthesizeFollowingPayload(ctx, pubkeys);
    ctx.state.loading = false;
    ctx.state.canLoadMore = false;
    ctx.notify();
    return;
  }
  applyPayload(ctx, synthesizeFollowingPayload(ctx, pubkeys));
}

function restartFollowingFeedPreservingTimeline(ctx: FeedContext, pubkeys: string[]): void {
  if (pubkeys.length === 0) {
    startFollowingFeed(ctx, pubkeys);
    return;
  }

  clearTimelinePageTimeout(ctx);
  ctx.timelinePageInFlight = false;
  ctx.pendingLoadMoreIntent = null;
  ctx.timelineRequestId++;
  ctx.timelineSub?.close();
  ctx.timelineSub = null;
  ctx.liveSub?.close();
  ctx.liveSub = null;
  ctx.currentPayload = synthesizeFollowingPayload(ctx, pubkeys);
  ctx.state.error = null;

  startTimelineSubscription(ctx, {});
  startLiveSubscription(ctx);
}

function contactsFromKind3(event: NostrEvent): string[] {
  return event.tags
    .filter((t) => t[0] === 'p' && typeof t[1] === 'string')
    .map((t) => t[1]!);
}

function initFollowingFeed(ctx: FeedContext, pubkey: string): void {
  // Resolve the kind-3 contact list WITHOUT blocking the timeline on the
  // contact-list EOSE (which can hang for 5-15s). We start the feed as soon
  // as the first kind-3 arrives, but kind 3 is replaceable and a fast relay
  // can serve a stale/partial follow list — so we track the NEWEST
  // (highest created_at) kind-3 and re-subscribe the timeline if a fuller,
  // fresher list arrives later. With a warm runtime cache the newest kind-3
  // is delivered first, so this is both instant and correct.
  let bestCreatedAt = 0;
  let startedKey: string | null = null;

  const startOrRestart = (): void => {
    const key = ctx.contactPubkeys.join(',');
    if (key === startedKey) return; // contact set unchanged → nothing to do
    startedKey = key;
    // Close the prior timeline/live subs (keep the kind-3 sub open) before
    // re-subscribing with the corrected author set. Existing timeline events
    // are kept, so growing the follow set streams more in without a reset.
    restartFollowingFeedPreservingTimeline(ctx, ctx.contactPubkeys);
  };

  const startKnownContacts = (): void => {
    if (startedKey !== null) return;
    startedKey = ctx.contactPubkeys.join(',');
    startFollowingFeed(ctx, ctx.contactPubkeys);
  };

  queueMicrotask(startKnownContacts);

  ctx.contactsSub = subscribeForPayload(
    { filters: [{ kinds: [3], authors: [pubkey], limit: 5 }], origin: 'outbox' },
    {
      onEvent: (event) => {
        if (event.kind !== 3 || event.created_at <= bestCreatedAt) return;
        bestCreatedAt = event.created_at;
        ctx.contactPubkeys = contactsFromKind3(event);
        startOrRestart();
      },
      onEose: () => {
        // EOSE before any kind-3 → user follows no one yet; render empty state.
        startKnownContacts();
      },
    },
  );
}

export function init(ctx: FeedContext, pubkey: string): void {
  ctx.currentPubkey = pubkey;
  ctx.state.loading = true;
  ctx.state.error = null;
  ctx.notify();

  if (ctx.state.source === 'following') {
    initFollowingFeed(ctx, pubkey);
  } else {
    startGlobalFeed(ctx);
  }
}

/** Clear the timeline + tracking and restart the active feed source. */
function resetAndRestartFeed(ctx: FeedContext): void {
  ctx.state.timeline = [];
  ctx.timelineEvents = [];
  ctx.state.pendingNew = [];
  ctx.seenIds.clear();
  ctx.pendingIds.clear();
  resetEngagement(ctx);
  ctx.oldestTimestamp = null;
  ctx.pageCursorTimestamp = null;
  ctx.pendingLoadMoreIntent = null;
  ctx.state.canLoadMore = false;
  teardownSubscriptions(ctx);
  ctx.state.error = null;
  ctx.notify();

  if (ctx.state.source === 'global') {
    startGlobalFeed(ctx);
  } else if (ctx.currentPubkey != null) {
    init(ctx, ctx.currentPubkey);
  }
}

export function switchSource(ctx: FeedContext, source: FeedSource): void {
  if (ctx.state.source === source) return;
  ctx.state.source = source;
  resetAndRestartFeed(ctx);
}

export function setShowReplies(ctx: FeedContext, showReplies: boolean): void {
  if (ctx.state.showReplies === showReplies) return;
  ctx.state.showReplies = showReplies;
  cacheHiddenPendingEvents(ctx);
  rebuildVisibleTimeline(ctx);
  recomputeOldestTimestamp(ctx);
  ctx.notify();
  syncEngagementSubscription(ctx);
}

export function loadNewNotes(ctx: FeedContext): void {
  for (const event of ctx.state.pendingNew) addToTimeline(ctx, event);
  ctx.state.pendingNew = [];
  ctx.pendingIds.clear();
  ctx.notify();
}

function startLoadMorePage(ctx: FeedContext, intent: FeedLoadIntent): void {
  const cursorTimestamp = ctx.pageCursorTimestamp ?? ctx.oldestTimestamp;
  if (!ctx.state.canLoadMore || cursorTimestamp === null) return;
  if (!ctx.currentPayload || ctx.currentPayload.filters.length === 0) return;

  // The next page reuses the active payload's filters (FEED-01); only the page
  // cursor changes. subscribeForPayload applies `until` to every filter.
  const pageLimit = TIMELINE_PAGE_LIMIT_BY_INTENT[intent];
  const timeoutMs = intent === 'urgent' ? URGENT_TIMELINE_PAGE_TIMEOUT_MS : TIMELINE_PAGE_EOSE_TIMEOUT_MS;
  startTimelineSubscription(ctx, { until: cursorTimestamp - 1 }, pageLimit, timeoutMs);
}

export function loadMore(ctx: FeedContext, intent: FeedLoadIntent = 'prefetch'): void {
  if (ctx.timelinePageInFlight) {
    ctx.pendingLoadMoreIntent = moreAggressiveLoadIntent(ctx.pendingLoadMoreIntent, intent);
    return;
  }

  // Close any stale timeline sub and reopen with `until` pointing to the page cursor.
  ctx.timelineSub?.close();
  ctx.timelineSub = null;
  startLoadMorePage(ctx, intent);
}

/**
 * Public store entry: apply an external (intent / persisted) FeedIntentPayload.
 * Bypasses the following/global source machinery — the payload IS the source.
 */
export function applyExternalPayload(ctx: FeedContext, payload: FeedIntentPayload): void {
  ctx.state.error = null;
  applyPayload(ctx, payload);
}
