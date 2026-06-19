// napplets/feed/src/lib/feed-store.test.ts
// Unit tests for createFeedStore factory.
// Mocks @napplet/sdk relay helpers instead of pool/eventStore.
//
// Phase 88: the timeline/live subscriptions now route through
// subscribeForPayload, which opens AFTER an `await shell.ready()` gate (Phase 87
// canonical pattern). With no `supports('outbox')` the engine takes the
// relay.subscribe fallback — but the open is deferred a microtask, so tests
// install a shell stub and `await flush()` before driving captured callbacks.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import { KIND_ZAP_RECEIPT, KIND_ZAP_REQUEST } from '@hyprgate/utils';
import { createFeedStore } from './feed-store';
import { TIMELINE_CACHE_LIMIT } from './feed-engine';
import { TIMELINE_PAGE_LIMIT_BY_INTENT } from './feed-load-strategy';

// ─── Mock @napplet/sdk ────────────────────────────────────────────────────────
// NOTE: vi.mock is hoisted — factory must not reference variables declared below.

vi.mock('@napplet/sdk', () => ({
  relay: {
    subscribe: vi.fn().mockReturnValue({ close: vi.fn() }),
    query: vi.fn().mockResolvedValue([]),
    publish: vi.fn().mockResolvedValue({}),
  },
  outbox: {
    subscribe: vi.fn(),
  },
}));

import { relay } from '@napplet/sdk';
const _subscribe = relay.subscribe;
const mockSubscribe = vi.mocked(_subscribe);
const mockCloseFn = vi.fn();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/** Install a shell stub. supportsOutbox=false → relay.subscribe fallback path. */
function installShell(supportsOutbox = false): void {
  (globalThis as unknown as { napplet: unknown }).napplet = {
    shell: {
      ready: vi.fn().mockResolvedValue({}),
      supports: vi.fn((domain: string) => (domain === 'outbox' ? supportsOutbox : false)),
    },
  };
}

function makeEvent(id: string, createdAt: number, pubkey = 'pk1', kind = 1, tags: string[][] = [], content = `note ${id}`): NostrEvent {
  return { id, kind, pubkey, created_at: createdAt, tags, content, sig: 'sig' };
}

function makeKind3Event(authorPubkey: string, followPubkeys: string[]): NostrEvent {
  return {
    id: 'kind3-evt',
    kind: 3,
    pubkey: authorPubkey,
    created_at: 1700000000,
    tags: followPubkeys.map(pk => ['p', pk]),
    content: '',
    sig: 'sig',
  };
}

function makeZapReceipt(id: string, targetId: string, amountMillisats: number, tagReceiptTarget = true): NostrEvent {
  const request = makeEvent(`${id}-request`, 1000, 'zapper', KIND_ZAP_REQUEST, [
    ['amount', String(amountMillisats)],
    ['e', targetId],
    ['p', 'recipient'],
  ], 'zap note');

  return makeEvent(id, 1102, 'provider', KIND_ZAP_RECEIPT, [
    ['description', JSON.stringify(request)],
    ['bolt11', 'invoice'],
    ...(tagReceiptTarget ? [['e', targetId]] : []),
  ], '');
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createFeedStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCloseFn.mockReset();
    mockSubscribe.mockReturnValue({ close: mockCloseFn });
    installShell(false);
  });

  afterEach(() => {
    delete (globalThis as unknown as { napplet?: unknown }).napplet;
  });

  it('initializes with correct default state', () => {
    const store = createFeedStore();

    expect(store.state.timeline).toEqual([]);
    expect(store.state.pendingNew).toEqual([]);
    expect(store.state.source).toBe('following');
    expect(store.state.viewMode).toBe('compact');
    expect(store.state.loading).toBe(false);
    expect(store.state.canLoadMore).toBe(false);
    expect(store.state.error).toBe(null);
    expect(store.currentPayload).toBe(null);
  });

  it('calls onUpdate when state changes', () => {
    const onUpdate = vi.fn();
    const store = createFeedStore(onUpdate);

    store.setViewMode('cards');
    expect(onUpdate).toHaveBeenCalled();
  });

  it('setViewMode updates the view mode', () => {
    const store = createFeedStore();

    store.setViewMode('cards');
    expect(store.state.viewMode).toBe('cards');

    store.setViewMode('terminal');
    expect(store.state.viewMode).toBe('terminal');

    store.setViewMode('compact');
    expect(store.state.viewMode).toBe('compact');
  });

  it('switchSource changes source field', () => {
    const store = createFeedStore();

    store.switchSource('global');
    expect(store.state.source).toBe('global');
  });

  it('switchSource to global calls subscribe without authors restriction', async () => {
    const store = createFeedStore();

    store.switchSource('global');
    await flush();

    expect(mockSubscribe).toHaveBeenCalled();
    // First call is the timeline subscription
    const firstCallFilters = mockSubscribe.mock.calls[0]![0] as Array<{ kinds?: number[]; authors?: string[] }>;
    const filter = firstCallFilters[0]!;
    expect(filter.authors).toBeUndefined();
    expect(filter.kinds).toContain(1);
  });

  it('switchSource to global synthesizes an outbox-origin global payload', async () => {
    const store = createFeedStore();
    store.switchSource('global');
    await flush();
    expect(store.currentPayload).toEqual({ filters: [{ kinds: [1, 1111] }], origin: 'outbox' });
  });

  it('empty Following synthesizes a sentinel author instead of authors:[] so it cannot normalize to Global', async () => {
    const store = createFeedStore();
    store.init('user-pubkey');
    await flush();

    expect(store.currentPayload).toEqual({
      filters: [{ kinds: [1, 1111], authors: ['0'.repeat(64)] }],
      origin: 'outbox',
    });
    expect(store.currentPayload?.filters).not.toEqual([{ kinds: [1] }]);
  });

  it('preserves streamed Following events when a newer kind-3 follow list resubscribes', async () => {
    let contactOnEvent: ((e: NostrEvent) => void) | null = null;
    let timelineOnEvent: ((e: NostrEvent) => void) | null = null;
    let timelineSubCount = 0;

    mockSubscribe.mockImplementation(
      (filters: unknown, onEvent: (e: NostrEvent) => void) => {
        const filter = (filters as Array<{ kinds?: number[]; since?: number }>)[0];
        if (filter?.kinds?.includes(3)) {
          contactOnEvent = onEvent;
        } else if (filter?.since === undefined && filter?.kinds?.includes(1) && 'authors' in filter) {
          timelineSubCount++;
          timelineOnEvent = onEvent;
        }
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.init('user-pubkey');
    await flush();

    contactOnEvent!({
      ...makeKind3Event('user-pubkey', ['a'.repeat(64)]),
      created_at: 1700000000,
    });
    await flush();
    timelineOnEvent!(makeEvent('note-from-first-follow-set', 2000));

    expect(store.state.timeline.map((event) => event.id)).toEqual(['note-from-first-follow-set']);
    expect(timelineSubCount).toBe(1);

    contactOnEvent!({
      ...makeKind3Event('user-pubkey', ['a'.repeat(64), 'b'.repeat(64)]),
      id: 'kind3-newer',
      created_at: 1700000001,
    });

    expect(store.state.timeline.map((event) => event.id)).toEqual(['note-from-first-follow-set']);
    await flush();
    expect(timelineSubCount).toBe(2);
    expect(store.state.timeline.map((event) => event.id)).toEqual(['note-from-first-follow-set']);
    expect(store.currentPayload).toEqual({
      filters: [{ kinds: [1, 1111], authors: ['a'.repeat(64), 'b'.repeat(64)] }],
      origin: 'outbox',
    });
  });

  it('loadNewNotes flushes pendingNew into timeline', () => {
    const store = createFeedStore();

    const event1 = makeEvent('evt1', 1000);
    const event2 = makeEvent('evt2', 2000);
    store.state.pendingNew = [event1, event2];

    store.loadNewNotes();

    expect(store.state.pendingNew).toEqual([]);
    expect(store.state.timeline).toHaveLength(2);
    expect(store.state.timeline[0]!.id).toBe('evt2');
    expect(store.state.timeline[1]!.id).toBe('evt1');
  });

  it('pendingNew count increments when live subscription receives new event', async () => {
    let capturedLiveOnEvent: ((e: NostrEvent) => void) | null = null;
    let callCount = 0;

    mockSubscribe.mockImplementation(
      (_filters: unknown, onEvent: (e: NostrEvent) => void, _onEose: () => void) => {
        callCount++;
        if (callCount === 2) capturedLiveOnEvent = onEvent;
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.switchSource('global');
    await flush();

    const event = makeEvent('live1', Date.now());
    capturedLiveOnEvent!(event);

    expect(store.state.pendingNew).toHaveLength(1);
    expect(store.state.pendingNew[0]!.id).toBe('live1');
  });

  it('live subscription dedupes pending events before they are loaded', async () => {
    let capturedLiveOnEvent: ((e: NostrEvent) => void) | null = null;
    let callCount = 0;

    mockSubscribe.mockImplementation(
      (_filters: unknown, onEvent: (e: NostrEvent) => void, _onEose: () => void) => {
        callCount++;
        if (callCount === 2) capturedLiveOnEvent = onEvent;
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.switchSource('global');
    await flush();

    const event = makeEvent('live-dup', Date.now());
    capturedLiveOnEvent!(event);
    capturedLiveOnEvent!(event);

    expect(store.state.pendingNew).toHaveLength(1);
  });

  it('streamed timeline insertion does not sort the full timeline per event', async () => {
    let capturedTimelineOnEvent: ((e: NostrEvent) => void) | null = null;
    let capturedTimelineOnEose: (() => void) | null = null;

    mockSubscribe.mockImplementation(
      (_filters: unknown, onEvent: (e: NostrEvent) => void, onEose: () => void) => {
        if (!capturedTimelineOnEvent) {
          capturedTimelineOnEvent = onEvent;
          capturedTimelineOnEose = onEose;
        }
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.switchSource('global');
    await flush();

    const sortSpy = vi.spyOn(Array.prototype, 'sort');
    expect(sortSpy).not.toHaveBeenCalled();
    try {
      capturedTimelineOnEvent!(makeEvent('evt1', 1000));
      capturedTimelineOnEvent!(makeEvent('evt3', 3000));
      capturedTimelineOnEvent!(makeEvent('evt2', 2000));
      expect(sortSpy).not.toHaveBeenCalled();
      capturedTimelineOnEose!();
    } finally {
      sortSpy.mockRestore();
    }
    expect(store.state.timeline.map((event) => event.id)).toEqual(['evt3', 'evt2', 'evt1']);
  });

  it('applying a new external payload clears stale timeline and enters loading before new events arrive', async () => {
    let capturedTimelineOnEvent: ((e: NostrEvent) => void) | null = null;
    let capturedTimelineOnEose: (() => void) | null = null;

    mockSubscribe.mockImplementation(
      (_filters: unknown, onEvent: (e: NostrEvent) => void, onEose: () => void) => {
        if (!capturedTimelineOnEvent) {
          capturedTimelineOnEvent = onEvent;
          capturedTimelineOnEose = onEose;
        }
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.switchSource('global');
    await flush();
    capturedTimelineOnEvent!(makeEvent('global-note', 2000));
    capturedTimelineOnEose!();
    expect(store.state.timeline.map((event) => event.id)).toEqual(['global-note']);
    expect(store.state.loading).toBe(false);

    store.applyPayload({
      filters: [{ kinds: [1], authors: ['a'.repeat(64)] }],
      origin: 'outbox',
      title: 'Following',
    });

    expect(store.state.timeline).toEqual([]);
    expect(store.state.pendingNew).toEqual([]);
    expect(store.state.loading).toBe(true);
    expect(store.currentPayload).toEqual({
      filters: [{ kinds: [1], authors: ['a'.repeat(64)] }],
      origin: 'outbox',
      title: 'Following',
    });
  });

  it('caps a historical page to the requested timeline page size', async () => {
    let capturedTimelineOnEvent: ((e: NostrEvent) => void) | null = null;
    let capturedTimelineOnEose: (() => void) | null = null;

    mockSubscribe.mockImplementation(
      (_filters: unknown, onEvent: (e: NostrEvent) => void, onEose: () => void) => {
        if (!capturedTimelineOnEvent) {
          capturedTimelineOnEvent = onEvent;
          capturedTimelineOnEose = onEose;
        }
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.switchSource('global');
    await flush();

    const sortSpy = vi.spyOn(Array.prototype, 'sort');
    try {
      for (let index = 0; index < 500; index++) {
        capturedTimelineOnEvent!(makeEvent(`evt${index}`, 1000 + ((index * 37) % 500)));
      }
      expect(sortSpy).not.toHaveBeenCalled();
      capturedTimelineOnEose!();
    } finally {
      sortSpy.mockRestore();
    }

    expect(store.state.timeline).toHaveLength(50);
    expect(store.state.timeline[0]!.created_at).toBeGreaterThanOrEqual(
      store.state.timeline.at(-1)!.created_at,
    );
  });

  it('does not advance the load-more cursor from events beyond the page limit', async () => {
    let capturedTimelineOnEvent: ((e: NostrEvent) => void) | null = null;
    let capturedTimelineOnEose: (() => void) | null = null;

    mockSubscribe.mockImplementation(
      (_filters: unknown, onEvent: (e: NostrEvent) => void, onEose: () => void) => {
        if (!capturedTimelineOnEvent) {
          capturedTimelineOnEvent = onEvent;
          capturedTimelineOnEose = onEose;
        }
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.switchSource('global');
    await flush();

    for (let index = 0; index < 50; index++) {
      capturedTimelineOnEvent!(makeEvent(`recent-${index}`, 1000 - index));
    }
    capturedTimelineOnEvent!(makeEvent('stale-straggler', 10));
    capturedTimelineOnEose!();

    expect(store.state.timeline).toHaveLength(50);
    expect(store.state.timeline.some((event) => event.id === 'stale-straggler')).toBe(false);

    store.loadMore();
    await flush();

    const loadMoreCall = mockSubscribe.mock.calls.find((call) => {
      const filters = call[0] as Array<{ until?: number }>;
      return filters[0]?.until !== undefined;
    });
    expect(loadMoreCall).toBeDefined();
    expect((loadMoreCall![0] as Array<{ until?: number }>)[0]?.until).toBe(950);
  });

  it('advances the load-more cursor when the first page is filtered out', async () => {
    const timelineCallbacks: Array<{
      onEvent: (e: NostrEvent) => void;
      onEose: () => void;
    }> = [];

    mockSubscribe.mockImplementation(
      (_filters: unknown, onEvent: (e: NostrEvent) => void, onEose: () => void) => {
        timelineCallbacks.push({ onEvent, onEose });
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.switchSource('global');
    await flush();

    for (let index = 0; index < 50; index++) {
      timelineCallbacks[0]!.onEvent(
        makeEvent(`reply-${index}`, 2000 - index, 'pk2', 1, [
          ['e', 'root'],
          ['p', 'pk1'],
        ]),
      );
    }
    timelineCallbacks[0]!.onEose();

    expect(store.state.timeline).toHaveLength(0);
    expect(store.state.canLoadMore).toBe(true);

    store.loadMore();
    await flush();

    const loadMoreCall = mockSubscribe.mock.calls.find((call) => {
      const filters = call[0] as Array<{ until?: number }>;
      return filters[0]?.until !== undefined;
    });
    expect(loadMoreCall).toBeDefined();
    expect((loadMoreCall![0] as Array<{ until?: number }>)[0]?.until).toBe(1950);
  });

  it('uses larger page limits for urgent reply-dense load-more requests', async () => {
    const timelineCallbacks: Array<{
      onEvent: (e: NostrEvent) => void;
      onEose: () => void;
    }> = [];

    mockSubscribe.mockImplementation(
      (filters: unknown, onEvent: (e: NostrEvent) => void, onEose: () => void) => {
        const filter = (filters as Array<{ kinds?: number[]; since?: number; '#e'?: string[] }>)[0];
        if (filter?.kinds?.includes(1) && filter.since === undefined && filter['#e'] === undefined) {
          timelineCallbacks.push({ onEvent, onEose });
        }
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.switchSource('global');
    await flush();

    for (let index = 0; index < 50; index++) {
      timelineCallbacks[0]!.onEvent(makeEvent(`root-${index}`, 3000 - index));
    }
    timelineCallbacks[0]!.onEose();

    store.loadMore('urgent');
    await flush();

    const urgentCall = mockSubscribe.mock.calls.find((call) => {
      const filters = call[0] as Array<{ until?: number; limit?: number }>;
      return filters[0]?.until !== undefined;
    });
    expect(urgentCall).toBeDefined();
    expect((urgentCall![0] as Array<{ limit?: number }>)[0]?.limit).toBe(
      TIMELINE_PAGE_LIMIT_BY_INTENT.urgent,
    );

    for (let index = 0; index < TIMELINE_PAGE_LIMIT_BY_INTENT.urgent; index++) {
      timelineCallbacks[1]!.onEvent(
        makeEvent(`reply-${index}`, 2950 - index, 'pk2', 1, [
          ['e', 'root-0'],
          ['p', 'pk1'],
        ]),
      );
    }
    timelineCallbacks[1]!.onEose();

    expect(store.state.timeline).toHaveLength(50);
    expect(store.state.timeline.every((event) => event.id.startsWith('root-'))).toBe(true);
    expect(store.state.canLoadMore).toBe(true);

    store.loadMore('urgent');
    await flush();

    const loadMoreCalls = mockSubscribe.mock.calls.filter((call) => {
      const filters = call[0] as Array<{ until?: number }>;
      return filters[0]?.until !== undefined;
    });
    expect((loadMoreCalls[1]![0] as Array<{ until?: number }>)[0]?.until).toBe(2750);
  });

  it('selects newest page events by timestamp when cache and relay arrivals interleave', async () => {
    let capturedTimelineOnEvent: ((e: NostrEvent) => void) | null = null;
    let capturedTimelineOnEose: (() => void) | null = null;

    mockSubscribe.mockImplementation(
      (_filters: unknown, onEvent: (e: NostrEvent) => void, onEose: () => void) => {
        if (!capturedTimelineOnEvent) {
          capturedTimelineOnEvent = onEvent;
          capturedTimelineOnEose = onEose;
        }
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.switchSource('global');
    await flush();

    capturedTimelineOnEvent!(makeEvent('recent', 2000));
    for (let index = 0; index < 49; index++) {
      capturedTimelineOnEvent!(makeEvent(`old-cache-${index}`, 1000 - index));
    }
    for (let index = 0; index < 49; index++) {
      capturedTimelineOnEvent!(makeEvent(`intermediate-relay-${index}`, 1900 - index));
    }
    capturedTimelineOnEose!();

    expect(store.state.timeline).toHaveLength(50);
    expect(store.state.timeline[0]!.id).toBe('recent');
    expect(store.state.timeline.some((event) => event.id.startsWith('old-cache-'))).toBe(false);
    expect(store.state.timeline.filter((event) => event.id.startsWith('intermediate-relay-'))).toHaveLength(49);
  });

  it('queues the strongest loadMore intent while an older page is in flight', async () => {
    const timelineCallbacks: Array<{
      onEvent: (e: NostrEvent) => void;
      onEose: () => void;
    }> = [];

    mockSubscribe.mockImplementation(
      (filters: unknown, onEvent: (e: NostrEvent) => void, onEose: () => void) => {
        const filter = (filters as Array<{ kinds?: number[]; since?: number; '#e'?: string[] }>)[0];
        if (filter?.kinds?.includes(1) && filter.since === undefined && filter['#e'] === undefined) {
          timelineCallbacks.push({ onEvent, onEose });
        }
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.switchSource('global');
    await flush();
    for (let index = 0; index < 50; index++) {
      timelineCallbacks[0]!.onEvent(makeEvent(`seed-${index}`, 1000 - index));
    }
    timelineCallbacks[0]!.onEose();

    store.loadMore('prefetch');
    store.loadMore('near');
    store.loadMore('urgent');
    await flush();

    let loadMoreCalls = mockSubscribe.mock.calls.filter((call) => {
      const filters = call[0] as Array<{ until?: number }>;
      return filters[0]?.until !== undefined;
    });
    expect(loadMoreCalls).toHaveLength(1);
    expect((loadMoreCalls[0]![0] as Array<{ until?: number }>)[0]?.until).toBe(950);
    expect((loadMoreCalls[0]![0] as Array<{ limit?: number }>)[0]?.limit).toBe(
      TIMELINE_PAGE_LIMIT_BY_INTENT.prefetch,
    );

    for (let index = 0; index < TIMELINE_PAGE_LIMIT_BY_INTENT.prefetch; index++) {
      timelineCallbacks[1]!.onEvent(makeEvent(`reply-${index}`, 949 - index, 'pk2', 1, [
        ['e', 'seed-0'],
        ['p', 'pk1'],
      ]));
    }
    timelineCallbacks[1]!.onEose();
    await flush();

    loadMoreCalls = mockSubscribe.mock.calls.filter((call) => {
      const filters = call[0] as Array<{ until?: number }>;
      return filters[0]?.until !== undefined;
    });
    expect(loadMoreCalls).toHaveLength(2);
    expect((loadMoreCalls[1]![0] as Array<{ until?: number; limit?: number }>)[0]).toMatchObject({
      until: 874,
      limit: TIMELINE_PAGE_LIMIT_BY_INTENT.urgent,
    });
  });

  it('keeps pagination open when an urgent page times out with partial hidden replies', async () => {
    vi.useFakeTimers();
    try {
      const timelineCallbacks: Array<{
        onEvent: (e: NostrEvent) => void;
        onEose: () => void;
      }> = [];

      mockSubscribe.mockImplementation(
        (filters: unknown, onEvent: (e: NostrEvent) => void, onEose: () => void) => {
          const filter = (filters as Array<{ kinds?: number[]; since?: number; '#e'?: string[] }>)[0];
          if (filter?.kinds?.includes(1) && filter.since === undefined && filter['#e'] === undefined) {
            timelineCallbacks.push({ onEvent, onEose });
          }
          return { close: mockCloseFn };
        },
      );

      const store = createFeedStore();
      store.switchSource('global');
      await Promise.resolve();
      await Promise.resolve();

      for (let index = 0; index < 50; index++) {
        timelineCallbacks[0]!.onEvent(makeEvent(`root-${index}`, 2000 - index));
      }
      timelineCallbacks[0]!.onEose();

      store.loadMore('urgent');
      await Promise.resolve();
      await Promise.resolve();

      for (let index = 0; index < 10; index++) {
        timelineCallbacks[1]!.onEvent(makeEvent(`slow-reply-${index}`, 1950 - index, 'pk2', 1, [
          ['e', 'root-0'],
          ['p', 'pk1'],
        ]));
      }

      vi.advanceTimersByTime(2000);

      expect(store.state.loading).toBe(false);
      expect(store.state.canLoadMore).toBe(true);
      expect(store.state.timeline).toHaveLength(50);

      store.loadMore('urgent');
      await Promise.resolve();
      await Promise.resolve();

      const loadMoreCalls = mockSubscribe.mock.calls.filter((call) => {
        const filters = call[0] as Array<{ until?: number }>;
        return filters[0]?.until !== undefined;
      });
      expect(loadMoreCalls).toHaveLength(2);
      expect((loadMoreCalls[1]![0] as Array<{ until?: number }>)[0]?.until).toBe(1940);
      store.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('subscribes to engagement streams for loaded timeline notes', async () => {
    let capturedTimelineOnEvent: ((e: NostrEvent) => void) | null = null;
    let capturedTimelineOnEose: (() => void) | null = null;

    mockSubscribe.mockImplementation(
      (_filters: unknown, onEvent: (e: NostrEvent) => void, onEose: () => void) => {
        if (!capturedTimelineOnEvent) {
          capturedTimelineOnEvent = onEvent;
          capturedTimelineOnEose = onEose;
        }
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.switchSource('global');
    await flush();
    capturedTimelineOnEvent!(makeEvent('note1', 1000));
    capturedTimelineOnEose!();

    // Engagement subscription uses relay.subscribe directly (not payload-driven),
    // so it is the first call whose filters target #e.
    const engagementCall = mockSubscribe.mock.calls.find((call) => {
      const filters = call[0] as Array<{ '#e'?: string[] }>;
      return filters[0]?.['#e'] !== undefined;
    });
    expect(engagementCall).toBeDefined();
    const filters = engagementCall![0] as Array<{ kinds?: number[]; '#e'?: string[] }>;
    expect(filters).toEqual([
      { kinds: [7], '#e': ['note1'] },
      { kinds: [1], '#e': ['note1'] },
      { kinds: [1111], '#e': ['note1'] },
      { kinds: [1111], '#E': ['note1'] },
      { kinds: [9735], '#e': ['note1'] },
    ]);
  });

  it('subscribes to reply-capable timeline kinds while hiding replies by default', async () => {
    const store = createFeedStore();

    store.switchSource('global');
    await flush();

    const firstCallFilters = mockSubscribe.mock.calls[0]![0] as Array<{ kinds?: number[] }>;
    expect(store.state.showReplies).toBe(false);
    expect(firstCallFilters[0]?.kinds).toEqual([1, 1111]);
  });

  it('excludes kind 1 replies from timeline while showReplies is off', async () => {
    let capturedTimelineOnEvent: ((e: NostrEvent) => void) | null = null;
    let capturedTimelineOnEose: (() => void) | null = null;

    mockSubscribe.mockImplementation(
      (_filters: unknown, onEvent: (e: NostrEvent) => void, onEose: () => void) => {
        if (!capturedTimelineOnEvent) {
          capturedTimelineOnEvent = onEvent;
          capturedTimelineOnEose = onEose;
        }
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.switchSource('global');
    await flush();

    capturedTimelineOnEvent!(makeEvent('root', 2000));
    capturedTimelineOnEvent!(makeEvent('reply', 2100, 'pk2', 1, [['e', 'root'], ['p', 'pk1']]));
    capturedTimelineOnEose!();

    expect(store.state.timeline.map((event) => event.id)).toEqual(['root']);
  });

  it('showReplies reveals cached replies without reopening timeline subscriptions', async () => {
    let capturedTimelineOnEvent: ((e: NostrEvent) => void) | null = null;
    let capturedTimelineOnEose: (() => void) | null = null;

    mockSubscribe.mockImplementation(
      (filters: unknown, onEvent: (e: NostrEvent) => void, onEose: () => void) => {
        const filter = (filters as Array<{ kinds?: number[]; since?: number }>)[0];
        if (filter?.kinds?.includes(1) && filter.since === undefined && !capturedTimelineOnEvent) {
          capturedTimelineOnEvent = onEvent;
          capturedTimelineOnEose = onEose;
        }
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.switchSource('global');
    await flush();

    capturedTimelineOnEvent!(makeEvent('root', 2000));
    capturedTimelineOnEvent!(makeEvent('kind1-reply', 2100, 'pk2', 1, [['e', 'root'], ['p', 'pk1']]));
    capturedTimelineOnEvent!(makeEvent('kind1111-reply', 2200, 'pk3', 1111, [['E', 'root'], ['K', '1'], ['P', 'pk1']]));
    capturedTimelineOnEose!();

    expect(store.state.timeline.map((event) => event.id)).toEqual(['root']);

    const feedSubscriptionCallCount = mockSubscribe.mock.calls.filter((call) => {
      const filters = call[0] as Array<{ kinds?: number[]; '#e'?: string[]; since?: number }>;
      return filters[0]?.['#e'] === undefined && filters[0]?.kinds?.includes(1);
    }).length;
    store.setShowReplies(true);

    expect(mockSubscribe.mock.calls.filter((call) => {
      const filters = call[0] as Array<{ kinds?: number[]; '#e'?: string[]; since?: number }>;
      return filters[0]?.['#e'] === undefined && filters[0]?.kinds?.includes(1);
    })).toHaveLength(feedSubscriptionCallCount);
    expect(store.state.timeline.map((event) => event.id)).toEqual(['kind1111-reply', 'kind1-reply', 'root']);

    store.setShowReplies(false);

    expect(mockSubscribe.mock.calls.filter((call) => {
      const filters = call[0] as Array<{ kinds?: number[]; '#e'?: string[]; since?: number }>;
      return filters[0]?.['#e'] === undefined && filters[0]?.kinds?.includes(1);
    })).toHaveLength(feedSubscriptionCallCount);
    expect(store.state.timeline.map((event) => event.id)).toEqual(['root']);
  });

  it('caches hidden live replies instead of putting them in the new-notes banner', async () => {
    let capturedLiveOnEvent: ((e: NostrEvent) => void) | null = null;

    mockSubscribe.mockImplementation(
      (filters: unknown, onEvent: (e: NostrEvent) => void) => {
        const filter = (filters as Array<{ kinds?: number[]; since?: number }>)[0];
        if (filter?.kinds?.includes(1) && filter.since !== undefined) capturedLiveOnEvent = onEvent;
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.switchSource('global');
    await flush();

    capturedLiveOnEvent!(makeEvent('live-reply', 2300, 'pk2', 1, [['e', 'root'], ['p', 'pk1']]));

    expect(store.state.pendingNew).toEqual([]);
    expect(store.state.timeline).toEqual([]);

    store.setShowReplies(true);

    expect(store.state.timeline.map((event) => event.id)).toEqual(['live-reply']);
  });

  it('evicts hidden replies before visible root notes when the timeline cache is full', () => {
    const store = createFeedStore();
    const rootEvents = Array.from({ length: TIMELINE_CACHE_LIMIT }, (_, index) => (
      makeEvent(`root-${index}`, 1000 + index)
    ));
    const hiddenReplies = Array.from({ length: 10 }, (_, index) => (
      makeEvent(`reply-${index}`, 3000 + index, 'pk2', 1, [['e', 'root-0'], ['p', 'pk1']])
    ));

    store.state.pendingNew = [...rootEvents, ...hiddenReplies];
    store.loadNewNotes();

    expect(store.state.timeline).toHaveLength(TIMELINE_CACHE_LIMIT);
    expect(store.state.timeline.every((event) => event.id.startsWith('root-'))).toBe(true);

    store.setShowReplies(true);

    expect(store.state.timeline).toHaveLength(TIMELINE_CACHE_LIMIT);
    expect(store.state.timeline.every((event) => event.id.startsWith('root-'))).toBe(true);
  });

  it('counts streamed engagement events by target note id with dedupe', async () => {
    let capturedTimelineOnEvent: ((e: NostrEvent) => void) | null = null;
    let capturedTimelineOnEose: (() => void) | null = null;
    let capturedEngagementOnEvent: ((e: NostrEvent) => void) | null = null;

    mockSubscribe.mockImplementation(
      (filters: unknown, onEvent: (e: NostrEvent) => void, onEose: () => void) => {
        const f = filters as Array<{ '#e'?: string[]; since?: number }>;
        if (f[0]?.['#e'] !== undefined) {
          capturedEngagementOnEvent = onEvent;
        } else if (!capturedTimelineOnEvent && f[0]?.since === undefined) {
          capturedTimelineOnEvent = onEvent;
          capturedTimelineOnEose = onEose;
        }
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.switchSource('global');
    await flush();
    capturedTimelineOnEvent!(makeEvent('note1', 1000));
    capturedTimelineOnEose!();
    const versionBeforeEngagement = store.state.engagementVersion;

    capturedEngagementOnEvent!(makeEvent('reaction1', 1100, 'pk2', 7, [['e', 'note1']], '+'));
    capturedEngagementOnEvent!(makeEvent('reaction1', 1100, 'pk2', 7, [['e', 'note1']], '+'));
    capturedEngagementOnEvent!(makeEvent('comment1', 1101, 'pk3', 1, [['e', 'note1']]));
    capturedEngagementOnEvent!(makeZapReceipt('zap1', 'note1', 21000));

    expect(store.state.engagement.get('note1')).toEqual({
      reactions: 1,
      reactionGroups: [{ content: '+', count: 1 }],
      comments: 1,
      zaps: 1,
      zapMillisats: 21000,
    });
    expect(store.state.engagementVersion).toBe(versionBeforeEngagement + 3);
  });

  it('matches zap targets and amount from the embedded zap request description', async () => {
    let capturedTimelineOnEvent: ((e: NostrEvent) => void) | null = null;
    let capturedTimelineOnEose: (() => void) | null = null;
    let capturedEngagementOnEvent: ((e: NostrEvent) => void) | null = null;

    mockSubscribe.mockImplementation(
      (filters: unknown, onEvent: (e: NostrEvent) => void, onEose: () => void) => {
        const f = filters as Array<{ '#e'?: string[]; since?: number }>;
        if (f[0]?.['#e'] !== undefined) {
          capturedEngagementOnEvent = onEvent;
        } else if (!capturedTimelineOnEvent && f[0]?.since === undefined) {
          capturedTimelineOnEvent = onEvent;
          capturedTimelineOnEose = onEose;
        }
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.switchSource('global');
    await flush();
    capturedTimelineOnEvent!(makeEvent('note1', 1000));
    capturedTimelineOnEose!();

    capturedEngagementOnEvent!(makeZapReceipt('zap1', 'note1', 1000, false));
    capturedEngagementOnEvent!(makeZapReceipt('zap2', 'note1', 2500, true));

    expect(store.state.engagement.get('note1')).toMatchObject({
      zaps: 2,
      zapMillisats: 3500,
    });
  });

  it('groups reaction events by content including dislikes and custom emoji shortcodes', async () => {
    let capturedTimelineOnEvent: ((e: NostrEvent) => void) | null = null;
    let capturedTimelineOnEose: (() => void) | null = null;
    let capturedEngagementOnEvent: ((e: NostrEvent) => void) | null = null;

    mockSubscribe.mockImplementation(
      (filters: unknown, onEvent: (e: NostrEvent) => void, onEose: () => void) => {
        const f = filters as Array<{ '#e'?: string[]; since?: number }>;
        if (f[0]?.['#e'] !== undefined) {
          capturedEngagementOnEvent = onEvent;
        } else if (!capturedTimelineOnEvent && f[0]?.since === undefined) {
          capturedTimelineOnEvent = onEvent;
          capturedTimelineOnEose = onEose;
        }
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.switchSource('global');
    await flush();
    capturedTimelineOnEvent!(makeEvent('note1', 1000));
    capturedTimelineOnEose!();

    capturedEngagementOnEvent!(makeEvent('like1', 1100, 'pk2', 7, [['e', 'note1']], ''));
    capturedEngagementOnEvent!(makeEvent('like2', 1101, 'pk3', 7, [['e', 'note1']], '+'));
    capturedEngagementOnEvent!(makeEvent('down1', 1102, 'pk4', 7, [['e', 'note1']], '-'));
    capturedEngagementOnEvent!(makeEvent('cat1', 1103, 'pk5', 7, [
      ['e', 'note1'],
      ['emoji', 'blobcat', 'https://emoji.example/blobcat.png', '30030:pk5:cats'],
    ], ':blobcat:'));

    expect(store.state.engagement.get('note1')?.reactionGroups).toEqual([
      { content: '+', count: 2 },
      { content: '-', count: 1 },
      { content: ':blobcat:', count: 1, shortcode: 'blobcat', imageUrl: 'https://emoji.example/blobcat.png' },
    ]);
  });

  it('timeline is sorted by created_at descending', () => {
    const store = createFeedStore();

    store.state.pendingNew = [
      makeEvent('evt3', 3000),
      makeEvent('evt1', 1000),
      makeEvent('evt2', 2000),
    ];
    store.loadNewNotes();

    expect(store.state.timeline[0]!.created_at).toBe(3000);
    expect(store.state.timeline[1]!.created_at).toBe(2000);
    expect(store.state.timeline[2]!.created_at).toBe(1000);
  });

  it('duplicate event IDs are not added to timeline', () => {
    const store = createFeedStore();

    const event = makeEvent('dup1', 1000);
    store.state.pendingNew = [event, event];
    store.loadNewNotes();

    const dupCount = store.state.timeline.filter((e) => e.id === 'dup1').length;
    expect(dupCount).toBe(1);
  });

  it('destroy closes active subscriptions without throwing', async () => {
    const store = createFeedStore();
    store.switchSource('global');
    await flush();

    expect(() => store.destroy()).not.toThrow();
    expect(mockCloseFn).toHaveBeenCalled();
  });

  it('init following feed subscribes to kind 3 contacts', async () => {
    let capturedKind3OnEose: (() => void) | null = null;
    let capturedKind3OnEvent: ((e: NostrEvent) => void) | null = null;

    mockSubscribe.mockImplementation(
      (filters: unknown, onEvent: (e: NostrEvent) => void, onEose: () => void) => {
        const filtersArr = filters as Array<{ kinds?: number[] }>;
        if (filtersArr[0]?.kinds?.includes(3)) {
          capturedKind3OnEvent = onEvent;
          capturedKind3OnEose = onEose;
        }
        return { close: mockCloseFn };
      },
    );

    const contactPubkeys = ['follower1', 'follower2'];
    const kind3 = makeKind3Event('mypubkey', contactPubkeys);

    const store = createFeedStore();
    store.init('mypubkey');
    await flush();

    capturedKind3OnEvent!(kind3);
    capturedKind3OnEose!();
    await flush();

    const kind1Call = mockSubscribe.mock.calls.find((call) => {
      const filters = call[0] as Array<{ kinds?: number[]; authors?: string[] }>;
      return filters[0]?.kinds?.includes(1) && filters[0]?.authors !== undefined;
    });
    expect(kind1Call).toBeDefined();
    const kind1Filter = (kind1Call![0] as Array<{ authors?: string[] }>)[0]!;
    expect(kind1Filter.authors).toEqual(contactPubkeys);
  });

  it('following init renders known empty state without waiting for contact-list EOSE', async () => {
    mockSubscribe.mockImplementation(
      (_filters: unknown, _onEvent: (e: NostrEvent) => void, _onEose: () => void) => ({ close: mockCloseFn }),
    );

    const store = createFeedStore();
    store.init('mypubkey');
    expect(store.state.loading).toBe(true);

    await flush();

    expect(store.state.loading).toBe(false);
    expect(store.currentPayload).toEqual({
      filters: [{ kinds: [1, 1111], authors: ['0'.repeat(64)] }],
      origin: 'outbox',
    });
  });

  it('following init restarts from empty state when a delayed kind-3 contact list streams in', async () => {
    let capturedKind3OnEvent: ((e: NostrEvent) => void) | null = null;

    mockSubscribe.mockImplementation(
      (filters: unknown, onEvent: (e: NostrEvent) => void, _onEose: () => void) => {
        const filtersArr = filters as Array<{ kinds?: number[] }>;
        if (filtersArr[0]?.kinds?.includes(3)) {
          capturedKind3OnEvent = onEvent;
        }
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.init('mypubkey');
    await flush();

    expect(store.currentPayload).toEqual({
      filters: [{ kinds: [1, 1111], authors: ['0'.repeat(64)] }],
      origin: 'outbox',
    });

    capturedKind3OnEvent!(makeKind3Event('mypubkey', ['f1', 'f2']));
    await flush();

    expect(store.currentPayload).toEqual({
      filters: [{ kinds: [1, 1111], authors: ['f1', 'f2'] }],
      origin: 'outbox',
    });
  });

  it('clears loading when a following timeline page never sends EOSE', async () => {
    vi.useFakeTimers();
    try {
      mockSubscribe.mockImplementation(
        (_filters: unknown, _onEvent: (e: NostrEvent) => void, _onEose: () => void) => ({ close: mockCloseFn }),
      );

      const store = createFeedStore();
      store.applyPayload({
        filters: [{ kinds: [1], authors: ['f1'] }],
        origin: 'outbox',
        title: 'Following',
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(store.state.loading).toBe(true);

      vi.advanceTimersByTime(5000);

      expect(store.state.loading).toBe(false);
      expect(store.state.canLoadMore).toBe(false);
      store.destroy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('synthesizes a following payload (outbox origin) from the resolved follow set', async () => {
    let capturedKind3OnEose: (() => void) | null = null;
    let capturedKind3OnEvent: ((e: NostrEvent) => void) | null = null;

    mockSubscribe.mockImplementation(
      (filters: unknown, onEvent: (e: NostrEvent) => void, onEose: () => void) => {
        const filtersArr = filters as Array<{ kinds?: number[] }>;
        if (filtersArr[0]?.kinds?.includes(3)) {
          capturedKind3OnEvent = onEvent;
          capturedKind3OnEose = onEose;
        }
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.init('mypubkey');
    await flush();

    capturedKind3OnEvent!(makeKind3Event('mypubkey', ['f1', 'f2']));
    capturedKind3OnEose!();
    await flush();

    expect(store.currentPayload).toEqual({
      filters: [{ kinds: [1, 1111], authors: ['f1', 'f2'] }],
      origin: 'outbox',
    });
  });

  it('uses the NEWEST kind-3 follow list, not a stale/partial one from a fast relay', async () => {
    let capturedKind3OnEvent: ((e: NostrEvent) => void) | null = null;
    let capturedKind3OnEose: (() => void) | null = null;

    mockSubscribe.mockImplementation(
      (filters: unknown, onEvent: (e: NostrEvent) => void, onEose: () => void) => {
        const filtersArr = filters as Array<{ kinds?: number[] }>;
        if (filtersArr[0]?.kinds?.includes(3)) {
          capturedKind3OnEvent = onEvent;
          capturedKind3OnEose = onEose;
        }
        return { close: mockCloseFn };
      },
    );

    const stale: NostrEvent = { ...makeKind3Event('mypubkey', ['a', 'b']), id: 'stale', created_at: 1000 };
    const fresh: NostrEvent = { ...makeKind3Event('mypubkey', ['a', 'b', 'c', 'd']), id: 'fresh', created_at: 2000 };

    const store = createFeedStore();
    store.init('mypubkey');
    await flush();

    capturedKind3OnEvent!(stale);
    await flush();
    capturedKind3OnEvent!(fresh);
    capturedKind3OnEose!();
    await flush();

    const kind1Calls = mockSubscribe.mock.calls.filter((call) => {
      const filters = call[0] as Array<{ kinds?: number[]; authors?: string[] }>;
      return filters[0]?.kinds?.includes(1) && filters[0]?.authors !== undefined;
    });
    expect(kind1Calls.length).toBeGreaterThan(0);
    const lastAuthors = (kind1Calls[kind1Calls.length - 1]![0] as Array<{ authors?: string[] }>)[0]!.authors;
    expect(lastAuthors).toEqual(['a', 'b', 'c', 'd']);
  });

  it('addToTimeline calls onUpdate callback', async () => {
    const onUpdate = vi.fn();
    let capturedTimelineOnEvent: ((e: NostrEvent) => void) | null = null;
    let capturedTimelineOnEose: (() => void) | null = null;

    mockSubscribe.mockImplementation(
      (_filters: unknown, onEvent: (e: NostrEvent) => void, onEose: () => void) => {
        if (!capturedTimelineOnEvent) {
          capturedTimelineOnEvent = onEvent;
          capturedTimelineOnEose = onEose;
        }
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore(onUpdate);
    store.switchSource('global');
    await flush();

    onUpdate.mockClear();
    const event = makeEvent('evt1', 1000);
    capturedTimelineOnEvent!(event);
    capturedTimelineOnEose!();

    expect(onUpdate).toHaveBeenCalled();
    expect(store.state.timeline).toHaveLength(1);
  });

  it('applyPayload drives the timeline from an arbitrary hashtag filter (not the following filter)', async () => {
    let capturedTimelineFilters: Array<Record<string, unknown>> | null = null;
    mockSubscribe.mockImplementation(
      (filters: unknown) => {
        const f = filters as Array<Record<string, unknown>>;
        if (!capturedTimelineFilters && f[0]?.since === undefined) {
          capturedTimelineFilters = f;
        }
        return { close: mockCloseFn };
      },
    );

    const store = createFeedStore();
    store.applyPayload({ filters: [{ '#t': ['nostr'] }], origin: 'outbox', title: 'Nostr tag' });
    await flush();

    expect(store.currentPayload).toEqual({ filters: [{ '#t': ['nostr'] }], origin: 'outbox', title: 'Nostr tag' });
    // The paged leg carries the payload filter + the page limit, with NO hard-coded kinds.
    expect(capturedTimelineFilters).toEqual([{ '#t': ['nostr'], limit: 50 }]);
    expect((capturedTimelineFilters as unknown as Array<{ kinds?: number[] }>)![0]?.kinds).toBeUndefined();
  });

  it('applyPayload tears down and rebuilds when a new payload is applied', async () => {
    const store = createFeedStore();
    store.applyPayload({ filters: [{ kinds: [1] }], origin: 'outbox' });
    await flush();
    mockCloseFn.mockClear();

    store.applyPayload({ filters: [{ kinds: [30023] }], origin: 'outbox' });
    await flush();

    // The prior timeline + live subs were closed on the rebuild.
    expect(mockCloseFn).toHaveBeenCalled();
    expect(store.currentPayload).toEqual({ filters: [{ kinds: [30023] }], origin: 'outbox' });
  });

  it('applyPayload with empty filters renders the explicit empty state (no subscription)', async () => {
    const store = createFeedStore();
    mockSubscribe.mockClear();
    store.applyPayload({ filters: [], origin: 'outbox' });
    await flush();

    expect(store.state.timeline).toEqual([]);
    expect(store.state.loading).toBe(false);
    expect(mockSubscribe).not.toHaveBeenCalled();
  });
});
