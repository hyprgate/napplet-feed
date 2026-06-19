// napplets/feed/src/lib/feed-store.ts
// Feed state management — pure TypeScript, no Svelte runes.
// Keep this as .ts (not .svelte.ts) so vitest can import without Svelte compiler.
//
// Relay operations route through the shell pseudo-relay via relay.subscribe.
// No per-napp RelayPool.
//
// The stateful logic lives in ./feed-engine and operates on an explicit
// FeedContext; this module owns the public types and a thin factory.

import type { FeedIntentPayload, NostrEvent } from '@hyprgate/types';
import type { EngagementCounts, ReactionGroup } from '@hyprgate/utils';
import type { FeedLoadIntent } from './feed-load-strategy.js';
import {
  applyExternalPayload,
  createFeedContext,
  init,
  loadMore,
  loadNewNotes,
  setShowReplies,
  switchSource,
  teardownSubscriptions,
} from './feed-engine.js';

export type { EngagementCounts, ReactionGroup };
export type { FeedLoadIntent };
export { normalizeReactionContent } from './feed-engine.js';

export type FeedSource = 'following' | 'global';
export type ViewMode = 'compact' | 'cards' | 'terminal';

export interface FeedState {
  timeline: NostrEvent[];
  pendingNew: NostrEvent[];
  engagement: Map<string, EngagementCounts>;
  engagementVersion: number;
  loading: boolean;
  canLoadMore: boolean;
  source: FeedSource;
  viewMode: ViewMode;
  showReplies: boolean;
  error: string | null;
}

export interface FeedStore {
  state: FeedState;
  init(pubkey: string): void;
  switchSource(source: FeedSource): void;
  setViewMode(mode: ViewMode): void;
  setShowReplies(showReplies: boolean): void;
  /**
   * Drive the feed from an external FeedIntentPayload (intent / persisted).
   * The payload's filters + origin replace the following/global source — the
   * timeline is rebuilt entirely from the payload (FEED-01/FEED-02).
   */
  applyPayload(payload: FeedIntentPayload): void;
  /** The active payload driving the subscription, or null. */
  readonly currentPayload: FeedIntentPayload | null;
  loadNewNotes(): void;
  loadMore(intent?: FeedLoadIntent): void;
  destroy(): void;
}

/**
 * Create a feed store that routes all relay operations through the shell's
 * shared relay pool via subscribe and query.
 * No per-napp RelayPool or EventStore is created.
 *
 * @param onUpdate - Called after every state mutation so the caller (e.g. a
 *   Svelte component) can sync its own reactive `$state` variables. Svelte 5
 *   plain-object mutations are not auto-tracked, so the component must
 *   manually copy `store.state.*` into its `$state` vars inside this callback.
 */
export function createFeedStore(onUpdate?: () => void): FeedStore {
  const ctx = createFeedContext(() => onUpdate?.());

  return {
    state: ctx.state,
    init: (pubkey) => init(ctx, pubkey),
    switchSource: (source) => switchSource(ctx, source),
    setViewMode(mode: ViewMode): void {
      ctx.state.viewMode = mode;
      ctx.notify();
    },
    setShowReplies: (showReplies) => setShowReplies(ctx, showReplies),
    applyPayload: (payload) => applyExternalPayload(ctx, payload),
    get currentPayload(): FeedIntentPayload | null {
      return ctx.currentPayload;
    },
    loadNewNotes: () => loadNewNotes(ctx),
    loadMore: (intent) => loadMore(ctx, intent),
    destroy: () => teardownSubscriptions(ctx),
  };
}
