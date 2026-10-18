import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import { snapshotFeedTimeline } from './feed-state-synchronizer';

function event(id: string): NostrEvent {
  return {
    id,
    pubkey: 'a'.repeat(64),
    created_at: 1,
    kind: 1,
    tags: [],
    content: '',
    sig: 'b'.repeat(128),
  };
}

describe('snapshotFeedTimeline', () => {
  it('publishes the initial empty timeline once, then suppresses unchanged empty updates', () => {
    const timeline: NostrEvent[] = [];
    const initial = snapshotFeedTimeline(timeline, null);
    const pendingOnly = snapshotFeedTimeline(timeline, initial.sourceTimeline);

    expect(initial.visibleTimeline).toBe(timeline);
    expect(pendingOnly.visibleTimeline).toBeNull();
  });

  it('does not republish the visible timeline for a pending-only store update', () => {
    const timeline = [event('visible')];
    const initial = snapshotFeedTimeline(timeline, null);
    const pendingOnly = snapshotFeedTimeline(timeline, initial.sourceTimeline);

    expect(initial.visibleTimeline).toBe(timeline);
    expect(pendingOnly.visibleTimeline).toBeNull();
  });

  it('publishes a changed store timeline so visible notes render immediately', () => {
    const initial = snapshotFeedTimeline([event('first')], null);
    const changedTimeline = [event('second'), event('first')];

    const changed = snapshotFeedTimeline(changedTimeline, initial.sourceTimeline);

    expect(changed.visibleTimeline).toBe(changedTimeline);
  });
});
