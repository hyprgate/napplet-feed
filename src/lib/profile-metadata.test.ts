import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import { outbox, relay } from '@napplet/sdk';
import { subscribeProfileMetadata } from './profile-metadata.js';

vi.mock('@napplet/sdk', () => ({
  relay: {
    subscribe: vi.fn(),
  },
  outbox: {
    subscribe: vi.fn(),
    query: vi.fn(),
  },
}));

interface FakeOutboxSub {
  close: ReturnType<typeof vi.fn>;
  handlers: Record<string, ((...args: unknown[]) => void) | undefined>;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  emit: (event: string, ...args: unknown[]) => void;
}

function makeOutboxSub(): FakeOutboxSub {
  const sub: FakeOutboxSub = {
    close: vi.fn(),
    handlers: {},
    on(event, cb) {
      this.handlers[event] = cb;
    },
    emit(event, ...args) {
      this.handlers[event]?.(...args);
    },
  };
  return sub;
}

function installShell(supportsOutbox = true): void {
  (globalThis as unknown as { napplet: unknown }).napplet = {
    shell: {
      ready: vi.fn().mockResolvedValue({}),
      supports: vi.fn((domain: string) => (domain === 'outbox' ? supportsOutbox : false)),
    },
  };
}

function flush(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function makeProfileEvent(pubkey: string, createdAt: number, content: unknown): NostrEvent {
  return {
    id: `${pubkey}-${createdAt}`,
    kind: 0,
    pubkey,
    created_at: createdAt,
    tags: [],
    content: typeof content === 'string' ? content : JSON.stringify(content),
    sig: 'sig',
  };
}

describe('subscribeProfileMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(relay.subscribe).mockReturnValue({ close: vi.fn() });
    vi.mocked(outbox.subscribe).mockReturnValue(
      makeOutboxSub() as unknown as ReturnType<typeof outbox.subscribe>,
    );
    vi.mocked(outbox.query).mockResolvedValue({ events: [] });
    installShell();
  });

  afterEach(() => {
    delete (globalThis as unknown as { napplet?: unknown }).napplet;
  });

  it('keeps kind-0 discovery live through outbox.subscribe after the initial UI pass', async () => {
    vi.useFakeTimers();
    try {
      installShell();
      const sub = makeOutboxSub();
      vi.mocked(outbox.subscribe).mockReturnValue(sub as unknown as ReturnType<typeof outbox.subscribe>);
      const event = makeProfileEvent('pk1', 100, {
        name: 'alice',
        display_name: 'Alice',
        picture: 'https://example.com/alice.png',
      });
      const received: Array<[string, unknown]> = [];
      const done = vi.fn();

      const handle = subscribeProfileMetadata(['pk1'], (pubkey, profile) => received.push([pubkey, profile]), done);
      await Promise.resolve();
      await Promise.resolve();

      expect(relay.subscribe).not.toHaveBeenCalled();
      expect(outbox.subscribe).toHaveBeenCalledWith([{ kinds: [0], authors: ['pk1'], limit: 1 }]);
      expect(outbox.query).not.toHaveBeenCalled();
      expect(done).not.toHaveBeenCalled();
      expect(received).toEqual([]);

      vi.advanceTimersByTime(5000);
      expect(done).toHaveBeenCalledOnce();

      sub.emit('event', { event });
      expect(received).toEqual([['pk1', {
        name: 'alice',
        display_name: 'Alice',
        picture: 'https://example.com/alice.png',
      }]]);

      sub.emit('closed');
      expect(done).toHaveBeenCalledOnce();

      handle.close();
      expect(sub.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the newest metadata event per pubkey and ignores malformed content', async () => {
    installShell();
    const sub = makeOutboxSub();
    vi.mocked(outbox.subscribe).mockReturnValue(sub as unknown as ReturnType<typeof outbox.subscribe>);
    const received: Array<[string, string | undefined]> = [];

    const handle = subscribeProfileMetadata(['pk1'], (pubkey, profile) => received.push([pubkey, profile.name]));
    await flush();

    sub.emit('event', { event: makeProfileEvent('pk1', 200, { name: 'new' }) });
    sub.emit('event', { event: makeProfileEvent('pk1', 100, { name: 'old' }) });
    sub.emit('event', { event: makeProfileEvent('pk1', 300, '{malformed') });

    expect(received).toEqual([['pk1', 'new']]);
    handle.close();
  });

  it('falls back to relay.subscribe only when the shell does not support outbox', async () => {
    installShell(false);
    let onEvent: ((result: { event: NostrEvent }) => void) | undefined;
    const close = vi.fn();
    vi.mocked(relay.subscribe).mockImplementation((filters, eventCb) => {
      onEvent = eventCb as (result: { event: NostrEvent }) => void;
      expect(filters).toEqual([{ kinds: [0], authors: ['pk1'], limit: 1 }]);
      return { close };
    });
    const received: Array<[string, string | undefined]> = [];

    subscribeProfileMetadata(['pk1'], (pubkey, profile) => received.push([pubkey, profile.name]));
    await flush();

    expect(outbox.subscribe).not.toHaveBeenCalled();
    expect(outbox.query).not.toHaveBeenCalled();
    onEvent?.({ event: makeProfileEvent('pk1', 100, { name: 'fallback' }) });
    expect(received).toEqual([['pk1', 'fallback']]);
  });

  it('honors close() called before the ready() gate resolves (no subscription opened)', async () => {
    installShell();
    const close = vi.fn();
    vi.mocked(relay.subscribe).mockReturnValue({ close });

    const handle = subscribeProfileMetadata(['pk1'], () => { /* no-op */ });
    handle.close(); // before await ready() resolves
    await flush();

    // Closed before the gate resolved: no connection is ever opened.
    expect(outbox.subscribe).not.toHaveBeenCalled();
    expect(outbox.query).not.toHaveBeenCalled();
    expect(relay.subscribe).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('returns the NOOP subscription synchronously when there are no authors', () => {
    const done = vi.fn();
    const handle = subscribeProfileMetadata([], () => { /* no-op */ }, done);
    expect(done).toHaveBeenCalledOnce();
    expect(() => handle.close()).not.toThrow();
  });

  it('uses one limit-1 filter per author so one profile cannot starve the rest', async () => {
    installShell();
    vi.mocked(outbox.subscribe).mockImplementation((filters) => {
      expect(filters).toEqual([
        { kinds: [0], authors: ['pk1'], limit: 1 },
        { kinds: [0], authors: ['pk2'], limit: 1 },
      ]);
      return makeOutboxSub() as unknown as ReturnType<typeof outbox.subscribe>;
    });

    const handle = subscribeProfileMetadata(['pk1', 'pk2'], () => { /* no-op */ });
    await flush();

    expect(outbox.subscribe).toHaveBeenCalledOnce();
    expect(outbox.query).not.toHaveBeenCalled();
    handle.close();
  });
});
