import type { NostrEvent } from '@hyprgate/types';

export interface FeedTimelineSnapshot {
  sourceTimeline: NostrEvent[];
  visibleTimeline: NostrEvent[] | null;
}

/**
 * Produces the reactive timeline value consumed by FeedContainer.
 *
 * `sourceTimeline` records the store reference used for the last bridge pass;
 * a later call can avoid publishing a new visible-list value when only
 * non-timeline state changed.
 */
export function snapshotFeedTimeline(
  sourceTimeline: NostrEvent[],
  previousSourceTimeline: NostrEvent[] | null,
): FeedTimelineSnapshot {
  return {
    sourceTimeline,
    visibleTimeline: sourceTimeline === previousSourceTimeline ? null : sourceTimeline,
  };
}
