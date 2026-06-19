export type FeedLoadIntent = 'prefetch' | 'near' | 'urgent';

export const FEED_LOAD_INTENT_RANK: Record<FeedLoadIntent, number> = {
  prefetch: 0,
  near: 1,
  urgent: 2,
};

export const TIMELINE_PAGE_LIMIT_BY_INTENT: Record<FeedLoadIntent, number> = {
  prefetch: 75,
  near: 125,
  urgent: 200,
};

export const FEED_LOAD_THRESHOLDS: Array<{
  intent: FeedLoadIntent;
  rootMargin: string;
  remainingViewportRatio: number;
}> = [
  { intent: 'prefetch', rootMargin: '0px 0px 30% 0px', remainingViewportRatio: 0.3 },
  { intent: 'near', rootMargin: '0px 0px 20% 0px', remainingViewportRatio: 0.2 },
  { intent: 'urgent', rootMargin: '0px 0px 10% 0px', remainingViewportRatio: 0.1 },
];

export function moreAggressiveLoadIntent(
  current: FeedLoadIntent | null,
  next: FeedLoadIntent,
): FeedLoadIntent {
  if (current === null) return next;
  return FEED_LOAD_INTENT_RANK[next] > FEED_LOAD_INTENT_RANK[current] ? next : current;
}

export function getProactiveLoadIntent(
  remainingPx: number,
  viewportPx: number,
): FeedLoadIntent | null {
  if (viewportPx <= 0) return null;
  const ratio = Math.max(0, remainingPx) / viewportPx;
  for (let index = FEED_LOAD_THRESHOLDS.length - 1; index >= 0; index--) {
    const threshold = FEED_LOAD_THRESHOLDS[index]!;
    if (ratio <= threshold.remainingViewportRatio) return threshold.intent;
  }
  return null;
}
