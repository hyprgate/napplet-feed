import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import {
  FEED_EMOJI_DEFAULTS_STORAGE_KEY,
  KIND_EMOJI_SET,
  KIND_USER_EMOJI_LIST,
  createEmojiSetStore,
  customReactionInput,
} from './emoji-sets';
import { relay, storage } from '@napplet/sdk';

vi.mock('@napplet/sdk', () => ({
  relay: {
    subscribe: vi.fn().mockReturnValue({ close: vi.fn() }),
    publish: vi.fn(),
  },
  storage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

const PUBKEY = 'a'.repeat(64);
type RelayEventResult = { event: NostrEvent };

describe('emoji set store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getItem).mockResolvedValue(null);
    vi.mocked(storage.setItem).mockResolvedValue(undefined);
    vi.mocked(storage.removeItem).mockResolvedValue(undefined);
    vi.mocked(relay.subscribe).mockReturnValue({ close: vi.fn() });
    vi.mocked(relay.publish).mockResolvedValue(makeEvent({
      id: 'set-event',
      kind: KIND_EMOJI_SET,
      pubkey: PUBKEY,
      tags: [['d', 'cats'], ['emoji', 'blobcat', 'https://emoji.example/blobcat.png']],
    }));
  });

  it('uses a kind 10030 user emoji list instead of defaults when present', async () => {
    let onEvent: ((result: RelayEventResult) => void) | null = null;
    let onEose: (() => void) | null = null;
    vi.mocked(relay.subscribe).mockImplementation((_filters, eventCallback, eoseCallback) => {
      onEvent = eventCallback as (result: RelayEventResult) => void;
      onEose = eoseCallback as () => void;
      return { close: vi.fn() };
    });

    const store = createEmojiSetStore();
    store.init(PUBKEY);
    await Promise.resolve();

    onEvent!({ event: makeEvent({
      id: 'preferred',
      kind: KIND_USER_EMOJI_LIST,
      tags: [['emoji', 'blobcat', 'https://emoji.example/blobcat.png']],
    }) });
    onEose!();

    expect(store.state.activeSource).toBe('preferred');
    expect(store.state.options).toEqual([
      {
        content: ':blobcat:',
        label: 'blobcat',
        source: 'preferred',
        shortcode: 'blobcat',
        imageUrl: 'https://emoji.example/blobcat.png',
        tags: [['emoji', 'blobcat', 'https://emoji.example/blobcat.png']],
      },
    ]);
  });

  it('persists modified local defaults', async () => {
    const store = createEmojiSetStore();
    await store.addDefaultEmoji('🔥');

    expect(storage.setItem).toHaveBeenCalledWith(
      FEED_EMOJI_DEFAULTS_STORAGE_KEY,
      expect.stringContaining('🔥'),
    );
    expect(store.state.defaults.some((option) => option.content === '🔥')).toBe(true);
  });

  it('publishes a kind 30030 emoji set and kind 10030 preferred list', async () => {
    const store = createEmojiSetStore();
    store.init(PUBKEY);
    await Promise.resolve();

    await store.publishEmojiSet({
      identifier: 'cats',
      title: 'Cats',
      rows: [{ shortcode: 'blobcat', url: 'https://emoji.example/blobcat.png' }],
    });

    expect(relay.publish).toHaveBeenNthCalledWith(1, expect.objectContaining({
      kind: KIND_EMOJI_SET,
      content: '',
      tags: [
        ['d', 'cats'],
        ['title', 'Cats'],
        ['emoji', 'blobcat', 'https://emoji.example/blobcat.png'],
      ],
    }));
    expect(relay.publish).toHaveBeenNthCalledWith(2, expect.objectContaining({
      kind: KIND_USER_EMOJI_LIST,
      tags: [
        ['a', `${KIND_EMOJI_SET}:${PUBKEY}:cats`],
        ['emoji', 'blobcat', 'https://emoji.example/blobcat.png', `${KIND_EMOJI_SET}:${PUBKEY}:cats`],
      ],
    }));
  });

  it('publishes emoji sets without replacing existing preferred emoji or set refs', async () => {
    let onEvent: ((result: RelayEventResult) => void) | null = null;
    vi.mocked(relay.subscribe).mockImplementation((_filters, eventCallback) => {
      onEvent = eventCallback as (result: RelayEventResult) => void;
      return { close: vi.fn() };
    });
    const store = createEmojiSetStore();
    store.init(PUBKEY);
    await Promise.resolve();
    onEvent!({ event: makeEvent({
      id: 'preferred',
      kind: KIND_USER_EMOJI_LIST,
      tags: [
        ['emoji', '😀'],
        ['a', `${KIND_EMOJI_SET}:${PUBKEY}:old-pack`],
        ['emoji', 'oldcat', 'https://emoji.example/oldcat.png', `${KIND_EMOJI_SET}:${PUBKEY}:old-pack`],
      ],
    }) });

    await store.publishEmojiSet({
      identifier: 'cats',
      title: 'Cats',
      rows: [{ shortcode: 'blobcat', url: 'https://emoji.example/blobcat.png' }],
    });

    expect(relay.publish).toHaveBeenNthCalledWith(2, expect.objectContaining({
      kind: KIND_USER_EMOJI_LIST,
      tags: [
        ['emoji', '😀'],
        ['a', `${KIND_EMOJI_SET}:${PUBKEY}:old-pack`],
        ['emoji', 'oldcat', 'https://emoji.example/oldcat.png', `${KIND_EMOJI_SET}:${PUBKEY}:old-pack`],
        ['a', `${KIND_EMOJI_SET}:${PUBKEY}:cats`],
        ['emoji', 'blobcat', 'https://emoji.example/blobcat.png', `${KIND_EMOJI_SET}:${PUBKEY}:cats`],
      ],
    }));
  });

  it('shows standard unicode emoji from a kind 10030 list (two-element emoji tags)', () => {
    let onEvent: ((result: RelayEventResult) => void) | null = null;
    let onEose: (() => void) | null = null;
    vi.mocked(relay.subscribe).mockImplementation((_filters, eventCallback, eoseCallback) => {
      onEvent = eventCallback as (result: RelayEventResult) => void;
      onEose = eoseCallback as () => void;
      return { close: vi.fn() };
    });

    const store = createEmojiSetStore();
    store.init(PUBKEY);

    onEvent!({ event: makeEvent({
      id: 'standard-list',
      kind: KIND_USER_EMOJI_LIST,
      tags: [['emoji', '😀'], ['emoji', '🔥']],
    }) });
    onEose!();

    expect(store.state.activeSource).toBe('preferred');
    expect(store.state.options.map((option) => option.content)).toEqual(['😀', '🔥']);
  });

  it('keeps an explicit Default selection even when a 10030 list exists', () => {
    let onEvent: ((result: RelayEventResult) => void) | null = null;
    let onEose: (() => void) | null = null;
    vi.mocked(relay.subscribe).mockImplementation((_filters, eventCallback, eoseCallback) => {
      onEvent = eventCallback as (result: RelayEventResult) => void;
      onEose = eoseCallback as () => void;
      return { close: vi.fn() };
    });

    const store = createEmojiSetStore();
    store.init(PUBKEY);
    onEvent!({ event: makeEvent({ id: 'l', kind: KIND_USER_EMOJI_LIST, tags: [['emoji', '😀']] }) });
    onEose!();
    expect(store.state.activeSource).toBe('preferred');

    store.setActiveSource('default');
    expect(store.state.activeSource).toBe('default');

    // A later event recompute must not silently switch back to the list.
    onEvent!({ event: makeEvent({ id: 'l2', kind: KIND_USER_EMOJI_LIST, created_at: 2, tags: [['emoji', '😀'], ['emoji', '🎉']] }) });
    expect(store.state.activeSource).toBe('default');
  });

  it('maps typed custom shortcode reactions to their emoji tag', () => {
    expect(customReactionInput(':blobcat:', [{
      content: ':blobcat:',
      label: 'blobcat',
      source: 'preferred',
      shortcode: 'blobcat',
      imageUrl: 'https://emoji.example/blobcat.png',
      tags: [['emoji', 'blobcat', 'https://emoji.example/blobcat.png']],
    }])).toEqual({
      content: ':blobcat:',
      tags: [['emoji', 'blobcat', 'https://emoji.example/blobcat.png']],
    });
  });
});

function makeEvent(overrides: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'event-id',
    kind: 1,
    pubkey: PUBKEY,
    created_at: 1,
    tags: [],
    content: '',
    sig: 'sig',
    ...overrides,
  };
}
