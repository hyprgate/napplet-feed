import { describe, expect, it } from 'vitest';
import { feedEmptyState } from './feed-empty-state';

describe('feedEmptyState', () => {
  it('stays out of the way when there are notes to show', () => {
    expect(feedEmptyState({ timelineCount: 3, visibleCount: 3, hasPayload: false })).toBeNull();
  });

  it('points at the NSFW filter instead of a blank list when it hides everything', () => {
    expect(feedEmptyState({ timelineCount: 2, visibleCount: 0, hasPayload: false })).toMatchObject({
      kind: 'hidden-nsfw',
      detail: 'All 2 notes loaded so far are tagged #nsfw.',
    });
    expect(feedEmptyState({ timelineCount: 1, visibleCount: 0, hasPayload: true })?.detail)
      .toBe('The 1 note loaded so far is tagged #nsfw.');
  });

  it('separates an empty follow timeline from a saved feed with no matches', () => {
    expect(feedEmptyState({ timelineCount: 0, visibleCount: 0, hasPayload: false })?.kind).toBe('no-follows');
    expect(feedEmptyState({ timelineCount: 0, visibleCount: 0, hasPayload: true })?.kind).toBe('no-matches');
  });
});
