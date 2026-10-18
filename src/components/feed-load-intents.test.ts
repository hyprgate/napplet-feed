import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type { NostrEvent } from '@hyprgate/types';
import FeedCards from './FeedCards.svelte';
import FeedList from './FeedList.svelte';
import FeedTerminal from './FeedTerminal.svelte';
import type { FeedLoadIntent } from '../lib/feed-store';
import { feedPayloadFromIntentDelivery, type IntentDelivery } from '../feed-intent-delivery';

vi.mock('@napplet/sdk', () => ({
  inc: {
    emit: vi.fn(),
  },
}));

const EVENT: NostrEvent = {
  id: 'b'.repeat(64),
  kind: 1,
  pubkey: 'a'.repeat(64),
  created_at: 1780531200,
  tags: [],
  content: 'hello from feed',
  sig: 'sig',
};

interface MockObserverInstance {
  callback: IntersectionObserverCallback;
  rootMargin: string;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

let observerInstances: MockObserverInstance[] = [];

class MockIntersectionObserver {
  readonly rootMargin: string;
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();
  readonly takeRecords = vi.fn(() => []);
  readonly unobserve = vi.fn();
  readonly root = null;
  readonly thresholds = [];

  constructor(
    readonly callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.rootMargin = options?.rootMargin ?? '0px';
    observerInstances.push({
      callback,
      rootMargin: this.rootMargin,
      observe: this.observe,
      disconnect: this.disconnect,
    });
  }
}

function setScrollGeometry(element: Element, scrollTop: number): void {
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: 2000 },
    clientHeight: { configurable: true, value: 1000 },
    scrollTop: { configurable: true, value: scrollTop },
  });
}

describe('feed proactive load intents', () => {
  beforeEach(() => {
    observerInstances = [];
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it.each([
    {
      name: 'compact',
      component: FeedList,
      scrollerSelector: '.feed-list',
      props: {
        events: [EVENT],
        profiles: new Map(),
        engagement: new Map(),
        reactionOptions: [],
        loading: false,
        canLoadMore: true,
      },
    },
    {
      name: 'cards',
      component: FeedCards,
      scrollerSelector: '.feed-cards',
      props: {
        events: [EVENT],
        profiles: new Map(),
        engagement: new Map(),
        reactionOptions: [],
        loading: false,
        canLoadMore: true,
      },
    },
    {
      name: 'terminal',
      component: FeedTerminal,
      scrollerSelector: '.feed-terminal',
      props: {
        events: [EVENT],
        profiles: new Map(),
        engagement: new Map(),
        loading: false,
        canLoadMore: true,
      },
    },
  ])('emits proactive load intents in $name view', async ({ component, props, scrollerSelector }) => {
    const onLoadMore = vi.fn<(intent?: FeedLoadIntent) => void>();
    const mounted = mount(component, {
      target: document.body,
      props: { ...props, onLoadMore },
    });

    await tick();
    await tick();

    const loadObservers = observerInstances.filter((observer) => observer.rootMargin !== '0px');
    expect(loadObservers.map((observer) => observer.rootMargin)).toEqual([
      '0px 0px 30% 0px',
      '0px 0px 20% 0px',
      '0px 0px 10% 0px',
    ]);

    const callsBeforeObserver = onLoadMore.mock.calls.length;
    loadObservers[2]!.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
    expect(onLoadMore).toHaveBeenCalledTimes(callsBeforeObserver + 1);
    expect(onLoadMore).toHaveBeenLastCalledWith('urgent');

    const scroller = document.querySelector(scrollerSelector);
    expect(scroller).toBeDefined();
    setScrollGeometry(scroller!, 900);
    const callsBeforeScroll = onLoadMore.mock.calls.length;
    scroller!.dispatchEvent(new Event('scroll'));
    expect(onLoadMore).toHaveBeenCalledTimes(callsBeforeScroll + 1);
    expect(onLoadMore).toHaveBeenLastCalledWith('urgent');

    unmount(mounted);
  });
});

describe('feed canonical INTENT delivery adapter', () => {
  const payload = { filters: [{ kinds: [1] }], origin: 'outbox' };

  it.each(['warm direct', 'cold persisted state followed by a warm update'])('accepts a valid %s IntentDelivery payload', (delivery) => {
    expect(delivery).toBeTruthy();
    expect(feedPayloadFromIntentDelivery({ archetype: 'feed', action: 'open', convention: 'napplet:feed/open', sender: 'hyprgate-shell', payload } as IntentDelivery)).toEqual(payload);
  });

  it('rejects absent and malformed IntentDelivery payloads', () => {
    expect(feedPayloadFromIntentDelivery({ archetype: 'feed', action: 'open', convention: 'napplet:feed/open', sender: 'hyprgate-shell' } as IntentDelivery)).toBeNull();
    expect(feedPayloadFromIntentDelivery({ archetype: 'feed', action: 'open', convention: 'napplet:feed/open', sender: 'hyprgate-shell', payload: { origin: 'outbox' } } as IntentDelivery)).toBeNull();
  });
});
