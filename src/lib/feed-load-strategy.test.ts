import { describe, expect, it } from 'vitest';
import {
  TIMELINE_PAGE_LIMIT_BY_INTENT,
  getProactiveLoadIntent,
  moreAggressiveLoadIntent,
} from './feed-load-strategy';

describe('feed load strategy', () => {
  it('maps bottom distance to progressively stronger load intents', () => {
    expect(getProactiveLoadIntent(400, 1000)).toBe(null);
    expect(getProactiveLoadIntent(300, 1000)).toBe('prefetch');
    expect(getProactiveLoadIntent(200, 1000)).toBe('near');
    expect(getProactiveLoadIntent(100, 1000)).toBe('urgent');
    expect(getProactiveLoadIntent(0, 1000)).toBe('urgent');
  });

  it('keeps only the most aggressive pending intent', () => {
    expect(moreAggressiveLoadIntent(null, 'prefetch')).toBe('prefetch');
    expect(moreAggressiveLoadIntent('prefetch', 'near')).toBe('near');
    expect(moreAggressiveLoadIntent('urgent', 'near')).toBe('urgent');
  });

  it('uses larger page limits for later viewport thresholds', () => {
    expect(TIMELINE_PAGE_LIMIT_BY_INTENT.prefetch).toBeLessThan(TIMELINE_PAGE_LIMIT_BY_INTENT.near);
    expect(TIMELINE_PAGE_LIMIT_BY_INTENT.near).toBeLessThan(TIMELINE_PAGE_LIMIT_BY_INTENT.urgent);
  });
});
