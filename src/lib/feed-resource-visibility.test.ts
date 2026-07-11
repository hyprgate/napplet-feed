import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FEED_RESOURCE_VISIBILITY_DEBOUNCE_MS,
  FEED_RESOURCE_VISIBILITY_MAX_WAIT_MS,
  createFeedResourceVisibilityTracker,
  selectResourceLoadIds,
} from './feed-resource-visibility';

const EVENTS = Array.from({ length: 12 }, (_, index) => ({ id: `event-${index}` }));

interface MockObserverInstance {
  callback: IntersectionObserverCallback;
  root: Element | Document | null;
  rootMargin: string;
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

let observerInstances: MockObserverInstance[] = [];

class MockIntersectionObserver {
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();
  readonly takeRecords = vi.fn(() => []);
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds: readonly number[];

  constructor(
    readonly callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.root = options?.root ?? null;
    this.rootMargin = options?.rootMargin ?? '0px';
    this.thresholds = Array.isArray(options?.threshold)
      ? options.threshold
      : [options?.threshold ?? 0];
    observerInstances.push({
      callback,
      root: this.root,
      rootMargin: this.rootMargin,
      observe: this.observe,
      unobserve: this.unobserve,
      disconnect: this.disconnect,
    });
  }
}

function entry(target: Element, isIntersecting: boolean): IntersectionObserverEntry {
  return { target, isIntersecting } as IntersectionObserverEntry;
}

function rect(top: number, bottom: number, left = 0, right = 300): DOMRect {
  return {
    x: left,
    y: top,
    top,
    bottom,
    left,
    right,
    width: right - left,
    height: bottom - top,
    toJSON: () => ({}),
  } as DOMRect;
}

describe('feed resource visibility', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    observerInstances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('selects visible events, five following events, and already-loaded events', () => {
    expect(selectResourceLoadIds(EVENTS, ['event-2', 'event-3'], [])).toEqual([
      'event-2',
      'event-3',
      'event-4',
      'event-5',
      'event-6',
      'event-7',
      'event-8',
    ]);

    expect(selectResourceLoadIds(
      EVENTS,
      ['event-5', 'event-6'],
      ['event-0', 'event-1', 'event-2', 'event-3', 'event-4', 'event-5'],
    )).toEqual(EVENTS.map((event) => event.id));
  });

  it('uses one exact-viewport observer and debounces scroll visibility changes', async () => {
    const root = document.createElement('div');
    const nodes = EVENTS.map(() => document.createElement('article'));
    const onChange = vi.fn<(ids: string[]) => void>();
    const tracker = createFeedResourceVisibilityTracker(
      () => root,
      () => EVENTS,
      onChange,
    );
    const actions = nodes.map((node, index) => tracker.track(node, EVENTS[index]!.id));
    await Promise.resolve();

    expect(observerInstances).toHaveLength(1);
    expect(observerInstances[0]).toMatchObject({ root, rootMargin: '0px' });
    expect(observerInstances[0]!.observe).toHaveBeenCalledTimes(EVENTS.length);
    tracker.refresh();
    tracker.refresh();
    await Promise.resolve();
    expect(observerInstances[0]!.observe).toHaveBeenCalledTimes(EVENTS.length);

    observerInstances[0]!.callback(
      [entry(nodes[2]!, true), entry(nodes[3]!, true), entry(nodes[4]!, true)],
      {} as IntersectionObserver,
    );
    expect(onChange).toHaveBeenLastCalledWith([
      'event-2',
      'event-3',
      'event-4',
      'event-5',
      'event-6',
      'event-7',
      'event-8',
      'event-9',
    ]);

    observerInstances[0]!.callback(
      [
        entry(nodes[2]!, false),
        entry(nodes[5]!, true),
      ],
      {} as IntersectionObserver,
    );
    await vi.advanceTimersByTimeAsync(FEED_RESOURCE_VISIBILITY_DEBOUNCE_MS - 1);
    expect(onChange).toHaveBeenCalledTimes(1);

    observerInstances[0]!.callback(
      [entry(nodes[3]!, false), entry(nodes[6]!, true)],
      {} as IntersectionObserver,
    );
    await vi.advanceTimersByTimeAsync(FEED_RESOURCE_VISIBILITY_DEBOUNCE_MS - 1);
    expect(onChange).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(onChange).toHaveBeenLastCalledWith([
      'event-2',
      'event-3',
      'event-4',
      'event-5',
      'event-6',
      'event-7',
      'event-8',
      'event-9',
      'event-10',
      'event-11',
    ]);

    observerInstances[0]!.callback(
      [entry(nodes[4]!, true), entry(nodes[5]!, true)],
      {} as IntersectionObserver,
    );
    await vi.advanceTimersByTimeAsync(FEED_RESOURCE_VISIBILITY_DEBOUNCE_MS);
    expect(onChange).toHaveBeenCalledTimes(2);

    for (const action of actions) action.destroy();
    expect(observerInstances[0]!.disconnect).toHaveBeenCalledOnce();
  });

  it('stops emitting once every event has been enabled', async () => {
    const nodes = EVENTS.map(() => document.createElement('article'));
    const onChange = vi.fn<(ids: string[]) => void>();
    const tracker = createFeedResourceVisibilityTracker(
      () => document.body,
      () => EVENTS,
      onChange,
    );
    nodes.forEach((node, index) => tracker.track(node, EVENTS[index]!.id));
    await Promise.resolve();

    observerInstances[0]!.callback(
      nodes.map((node) => entry(node, true)),
      {} as IntersectionObserver,
    );
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenLastCalledWith(EVENTS.map((event) => event.id));

    observerInstances[0]!.callback(
      [entry(nodes[0]!, false), entry(nodes[11]!, false)],
      {} as IntersectionObserver,
    );
    await vi.advanceTimersByTimeAsync(FEED_RESOURCE_VISIBILITY_DEBOUNCE_MS);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('reconciles appended events and bounds a continuously reset debounce', async () => {
    let events = EVENTS.slice(0, 8);
    const nodes = EVENTS.map(() => document.createElement('article'));
    const onChange = vi.fn<(ids: string[]) => void>();
    const tracker = createFeedResourceVisibilityTracker(
      () => document.body,
      () => events,
      onChange,
    );
    events.forEach((event, index) => tracker.track(nodes[index]!, event.id));
    await Promise.resolve();

    observerInstances[0]!.callback(
      [entry(nodes[5]!, true)],
      {} as IntersectionObserver,
    );
    expect(onChange).toHaveBeenLastCalledWith(['event-5', 'event-6', 'event-7']);

    events = EVENTS;
    for (let index = 8; index < EVENTS.length; index++) {
      tracker.track(nodes[index]!, EVENTS[index]!.id);
    }
    tracker.refresh();
    await vi.advanceTimersByTimeAsync(FEED_RESOURCE_VISIBILITY_DEBOUNCE_MS);
    expect(onChange).toHaveBeenLastCalledWith([
      'event-5',
      'event-6',
      'event-7',
      'event-8',
      'event-9',
      'event-10',
    ]);

    observerInstances[0]!.callback(
      [entry(nodes[5]!, false), entry(nodes[6]!, true)],
      {} as IntersectionObserver,
    );
    for (let elapsed = 40; elapsed < FEED_RESOURCE_VISIBILITY_MAX_WAIT_MS; elapsed += 40) {
      await vi.advanceTimersByTimeAsync(40);
      tracker.refresh();
    }
    await vi.advanceTimersByTimeAsync(39);
    expect(onChange).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenLastCalledWith(EVENTS.slice(5).map((event) => event.id));
  });

  it('falls back to bounded geometry instead of enabling every rendered event', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const root = document.createElement('div');
    const nodes = EVENTS.map(() => document.createElement('article'));
    let scrollOffset = 0;
    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(rect(0, 300));
    const rectSpies = nodes.map((node, index) => (
      vi.spyOn(node, 'getBoundingClientRect').mockImplementation(() => (
        rect(index * 100 - scrollOffset, (index + 1) * 100 - scrollOffset)
      ))
    ));
    const onChange = vi.fn<(ids: string[]) => void>();
    const tracker = createFeedResourceVisibilityTracker(
      () => root,
      () => EVENTS,
      onChange,
    );

    nodes.forEach((node, index) => tracker.track(node, EVENTS[index]!.id));
    await Promise.resolve();
    expect(observerInstances).toEqual([]);
    expect(onChange).toHaveBeenLastCalledWith(EVENTS.slice(0, 8).map((event) => event.id));

    scrollOffset = 500;
    const scanCounts = rectSpies.map((spy) => spy.mock.calls.length);
    tracker.refresh();
    tracker.refresh();
    tracker.refresh();
    expect(rectSpies.map((spy) => spy.mock.calls.length)).toEqual(scanCounts);
    await vi.advanceTimersByTimeAsync(FEED_RESOURCE_VISIBILITY_DEBOUNCE_MS - 1);
    expect(rectSpies.map((spy) => spy.mock.calls.length)).toEqual(scanCounts);
    await vi.advanceTimersByTimeAsync(1);
    expect(rectSpies.map((spy) => spy.mock.calls.length)).toEqual(
      scanCounts.map((count) => count + 1),
    );
    expect(onChange).toHaveBeenLastCalledWith(EVENTS.map((event) => event.id));
    tracker.destroy();
  });
});
