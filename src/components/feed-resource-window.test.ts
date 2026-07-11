import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type { NostrEvent } from '@hyprgate/types';
import { FEED_RESOURCE_VISIBILITY_DEBOUNCE_MS } from '../lib/feed-resource-visibility';
import FeedCards from './FeedCards.svelte';
import FeedList from './FeedList.svelte';
import FeedTerminal from './FeedTerminal.svelte';

const requestedSources = vi.hoisted(() => [] as string[]);
const resourceImageBatch = vi.hoisted(() => vi.fn(
  (node: HTMLImageElement, parameter: string | null | undefined | { source?: string | null }) => {
    let currentSource: string | null = null;
    function record(next: string | null | undefined | { source?: string | null }): void {
      const rawSource = typeof next === 'object' && next !== null ? next.source : next;
      const source = rawSource ?? null;
      if (source === currentSource) return;
      currentSource = source;
      if (source) {
        requestedSources.push(source);
        node.dataset.resourceSource = source;
      } else {
        delete node.dataset.resourceSource;
      }
    }
    record(parameter);
    return {
      update: record,
      destroy(): void {
        delete node.dataset.resourceSource;
      },
    };
  },
));

vi.mock('@hyprgate/utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('@hyprgate/utils')>(),
  resourceImageBatch,
}));

vi.mock('@hyprgate/utils/resource-client', async (importOriginal) => ({
  ...await importOriginal<typeof import('@hyprgate/utils/resource-client')>(),
  resourceImageBatch,
}));

vi.mock('@napplet/sdk', () => ({
  inc: { emit: vi.fn() },
  link: { open: vi.fn() },
}));

const EVENTS: NostrEvent[] = Array.from({ length: 12 }, (_, index) => ({
  id: index.toString(16).padStart(64, '0'),
  kind: 1,
  pubkey: (index + 32).toString(16).padStart(64, '0'),
  created_at: 1780531200 - index,
  tags: [],
  content: `event ${index} https://example.com/media-${index}.png`,
  sig: 'sig',
}));

const PROFILES = new Map(EVENTS.map((event, index) => [
  event.pubkey,
  { name: `author-${index}`, picture: `https://example.com/avatar-${index}.png` },
]));

interface MockObserverInstance {
  callback: IntersectionObserverCallback;
  root: Element | Document | null;
  rootMargin: string;
  observed: Element[];
}

let observerInstances: MockObserverInstance[] = [];

class MockIntersectionObserver {
  readonly observed: Element[] = [];
  readonly disconnect = vi.fn();
  readonly takeRecords = vi.fn(() => []);
  readonly unobserve = vi.fn((node: Element) => {
    const index = this.observed.indexOf(node);
    if (index >= 0) this.observed.splice(index, 1);
  });
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
      observed: this.observed,
    });
  }

  observe(node: Element): void {
    this.observed.push(node);
  }
}

function intersection(target: Element, isIntersecting: boolean): IntersectionObserverEntry {
  return { target, isIntersecting } as IntersectionObserverEntry;
}

function expectedSources(start: number, end: number): string[] {
  return Array.from({ length: end - start }, (_, offset) => offset + start)
    .flatMap((index) => [
      `https://example.com/avatar-${index}.png`,
      `https://example.com/media-${index}.png`,
    ])
    .sort();
}

function enabledEventIds(): string[] {
  return [...document.querySelectorAll<HTMLElement>('[data-feed-resources-enabled="true"]')]
    .map((node) => node.dataset.feedEventId ?? '');
}

function resourceObserver(scroller: Element): MockObserverInstance {
  const observer = observerInstances.find((candidate) => (
    candidate.root === scroller
    && candidate.rootMargin === '0px'
    && candidate.observed.length === EVENTS.length
  ));
  if (!observer) {
    throw new Error(`feed resource observer not found: ${JSON.stringify(observerInstances.map((candidate) => ({
      rootClass: candidate.root instanceof Element ? candidate.root.className : null,
      rootMargin: candidate.rootMargin,
      observed: candidate.observed.length,
    })))}`);
  }
  return observer;
}

describe('feed resource window', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    observerInstances = [];
    requestedSources.length = 0;
    resourceImageBatch.mockClear();
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it.each([
    { name: 'compact', component: FeedList, scrollerSelector: '.feed-list' },
    { name: 'cards', component: FeedCards, scrollerSelector: '.feed-cards' },
  ])('loads only visible and next-five event resources in $name view', async ({ component, scrollerSelector }) => {
    const mounted = mount(component, {
      target: document.body,
      props: {
        events: EVENTS,
        profiles: PROFILES,
        engagement: new Map(),
        reactionOptions: [],
        loading: false,
        canLoadMore: true,
      },
    });
    await tick();

    expect(requestedSources).toEqual([]);
    expect(document.querySelectorAll('img.media.resource-pending')).toHaveLength(EVENTS.length);
    const scroller = document.querySelector(scrollerSelector);
    expect(scroller).not.toBeNull();
    const observer = resourceObserver(scroller!);

    observer.callback(
      [intersection(observer.observed[2]!, true), intersection(observer.observed[3]!, true)],
      {} as IntersectionObserver,
    );
    await tick();

    expect([...requestedSources].sort()).toEqual(expectedSources(2, 9));
    expect(enabledEventIds()).toEqual(EVENTS.slice(2, 9).map((event) => event.id));
    const loadedMedia = document.querySelector<HTMLImageElement>(
      `[data-feed-event-id="${EVENTS[2]!.id}"] img.media`,
    );
    loadedMedia?.dispatchEvent(new Event('load'));
    await tick();
    expect(loadedMedia?.classList.contains('resource-pending')).toBe(false);

    observer.callback(
      [
        intersection(observer.observed[2]!, false),
        intersection(observer.observed[3]!, false),
        intersection(observer.observed[7]!, true),
      ],
      {} as IntersectionObserver,
    );
    await vi.advanceTimersByTimeAsync(FEED_RESOURCE_VISIBILITY_DEBOUNCE_MS - 1);
    await tick();
    expect(requestedSources).toHaveLength(14);

    await vi.advanceTimersByTimeAsync(1);
    await tick();
    expect([...requestedSources].sort()).toEqual(expectedSources(2, 12));
    expect(enabledEventIds()).toEqual(EVENTS.slice(2).map((event) => event.id));
    const previouslyLoadedSources = [...document.querySelectorAll<HTMLImageElement>(
      `[data-feed-event-id="${EVENTS[2]!.id}"] img`,
    )].map((image) => image.dataset.resourceSource).filter(Boolean).sort();
    expect(previouslyLoadedSources).toEqual(expectedSources(2, 3));

    observer.callback(
      [intersection(observer.observed[7]!, true)],
      {} as IntersectionObserver,
    );
    await vi.advanceTimersByTimeAsync(FEED_RESOURCE_VISIBILITY_DEBOUNCE_MS);
    await tick();
    expect(requestedSources).toHaveLength(20);
    expect(requestedSources).not.toContain('https://example.com/avatar-0.png');
    expect(requestedSources).not.toContain('https://example.com/avatar-1.png');

    unmount(mounted);
  });

  it('keeps terminal view resource-free', async () => {
    const mounted = mount(FeedTerminal, {
      target: document.body,
      props: {
        events: EVENTS,
        profiles: PROFILES,
        engagement: new Map(),
        loading: false,
        canLoadMore: true,
      },
    });
    await tick();

    expect(requestedSources).toEqual([]);
    unmount(mounted);
  });
});
