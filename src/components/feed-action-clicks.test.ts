import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type { NostrEvent } from '@hyprgate/types';
import { inc, relay } from '@napplet/sdk';
import { nip19 } from 'nostr-tools';
import FeedProfileHydrationHarness from './__fixtures__/FeedProfileHydrationHarness.svelte';
import EventEmbed from './EventEmbed.svelte';
import NoteActions from './NoteActions.svelte';
import NoteEntry from './NoteEntry.svelte';
import { NOTE_VIEWER_OPEN_TOPIC } from '../lib/feed-actions';

vi.mock('@napplet/sdk', () => ({
  inc: {
    emit: vi.fn(),
  },
  relay: {
    publish: vi.fn().mockResolvedValue({ id: 'reaction' }),
    subscribe: vi.fn().mockReturnValue({ close: vi.fn() }),
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

const EMBEDDED_REPOST_TARGET: NostrEvent = {
  id: 'e'.repeat(64),
  kind: 1,
  pubkey: 'c'.repeat(64),
  created_at: 1782063307,
  tags: [],
  content: "Who knows what it's good for.\n\nhttps://dergigi.com/2026/06/21/sayings/",
  sig: '3fe31509f8b16562356ccae8fbb9f4fafc52a5448b6a3b24c9abebde0c9790d4f33f7e869b8a02e21cba5b4f6a8517a9935fc0efe22e2bad3fcaf22ff52535ec',
};

function parseEmitPayload(callIndex: number): unknown {
  const payload = vi.mocked(inc.emit).mock.calls[callIndex]?.[2];
  expect(typeof payload).toBe('string');
  return JSON.parse(payload as string);
}

describe('feed action click wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders kind-6 repost targets without leaking embedded event JSON', async () => {
    const repost = {
      ...EVENT,
      id: '6'.repeat(64),
      kind: 6,
      content: JSON.stringify(EMBEDDED_REPOST_TARGET),
    };

    const component = mount(FeedProfileHydrationHarness, {
      target: document.body,
    }) as {
      setView(view: 'compact' | 'cards' | 'terminal'): void;
      setEvents(events: NostrEvent[]): void;
    };
    component.setEvents([repost]);

    for (const view of ['compact', 'cards', 'terminal'] as const) {
      component.setView(view);
      await tick();
      expect(document.body.textContent).toContain("Who knows what it's good for");
      expect(document.body.textContent).not.toContain('"id"');
      expect(document.body.textContent).not.toContain('"sig"');
    }

    unmount(component);
  });

  it('renders unsupported event fallback text without raw JSON when no handlers are found', async () => {
    vi.mocked(relay.subscribe).mockReturnValue({ close: vi.fn() });
    mount(NoteEntry, {
      target: document.body,
      props: {
        event: { ...EVENT, id: '7'.repeat(64), kind: 1063, content: JSON.stringify(EMBEDDED_REPOST_TARGET) },
        profiles: new Map(),
        reactionOptions: [],
      },
    });
    await tick();

    expect(document.body.textContent).toContain('cannot render this event (kind 1063)');
    expect(document.body.textContent).not.toContain('"id"');
    expect(document.body.textContent).not.toContain('"sig"');
  });

  it('renders nested note references inline until the depth limit, then stops', async () => {
    const nestedId = 'd'.repeat(64);
    const root = {
      ...EMBEDDED_REPOST_TARGET,
      id: 'e'.repeat(64),
      content: `root note nostr:${nip19.noteEncode(nestedId)}`,
    };

    mount(EventEmbed, {
      target: document.body,
      props: {
        id: root.id,
        event: root,
        maxDepth: 0,
        profileLabel: (pubkey: string) => `profile:${pubkey.slice(0, 4)}`,
      },
    });
    await tick();

    expect(document.body.textContent).toContain('root note');
    expect(document.querySelector('[data-feed-inline-depth-limit]')?.textContent).toContain('Nested note limit reached.');
    expect(document.body.textContent).not.toContain('"sig"');
  });

  it('uses a note-specific fallback when an embedded note cannot be resolved', async () => {
    vi.mocked(relay.subscribe).mockImplementation((_filters, _onEvent, onEose) => {
      onEose?.();
      return { close: vi.fn() };
    });

    mount(EventEmbed, {
      target: document.body,
      props: { id: 'f'.repeat(64) },
    });
    await tick();

    expect(document.body.textContent).toContain('cannot render note');
  });

  it('renders deduped NIP-89 handler buttons for unsupported events', async () => {
    const handler: NostrEvent = {
      id: '9'.repeat(64),
      pubkey: 'd'.repeat(64),
      created_at: 1,
      kind: 31990,
      tags: [
        ['d', 'media-viewer'],
        ['k', '1063'],
        ['name', 'Media Viewer'],
        ['web', 'https://example.test/open/bech32', 'nevent'],
      ],
      content: '',
      sig: 's',
    };
    vi.mocked(relay.subscribe).mockImplementation((filters, onEvent) => {
      if (JSON.stringify(filters).includes('"#k":["1063"]')) {
        onEvent(handler);
        onEvent({ ...handler, id: '8'.repeat(64), content: '{"name":"Renamed"}' });
      }
      return { close: vi.fn() };
    });

    mount(NoteEntry, {
      target: document.body,
      props: {
        event: { ...EVENT, id: '7'.repeat(64), kind: 1063, content: JSON.stringify(EMBEDDED_REPOST_TARGET) },
        profiles: new Map(),
        reactionOptions: [],
      },
    });
    await tick();

    const links = document.querySelectorAll('[data-feed-handler-action]');
    expect(links).toHaveLength(1);
    expect(links[0]?.textContent).toBe('Media Viewer');
    expect(links[0]?.getAttribute('href')).toMatch(/^https:\/\/example\.test\/open\/nevent1/);
  });

  it('clicking Open and Reply emits note-viewer and compose NAP topics', () => {
    mount(NoteActions, {
      target: document.body,
      props: { event: EVENT, reactionOptions: [] },
    });

    document.querySelectorAll('button')[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(inc.emit).toHaveBeenCalledWith(
      NOTE_VIEWER_OPEN_TOPIC,
      [],
      expect.any(String),
    );
    expect(parseEmitPayload(0)).toEqual({
      target: {
        type: 'event',
        id: EVENT.id,
        kind: EVENT.kind,
        pubkey: EVENT.pubkey,
      },
      behavior: { focus: true },
      source: { napplet: 'feed' },
    });

    document.querySelectorAll('button')[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(inc.emit).toHaveBeenLastCalledWith('compose:open', [], expect.any(String));
    expect(parseEmitPayload(1)).toEqual({
      source: { napplet: 'feed' },
      intent: 'reply',
      replyTo: {
        id: EVENT.id,
        pubkey: EVENT.pubkey,
        kind: EVENT.kind,
        content: EVENT.content,
        created_at: EVENT.created_at,
      },
    });
  });

  it('clicking a feed author name emits the profile open NAP topic', () => {
    mount(NoteEntry, {
      target: document.body,
      props: {
        event: EVENT,
        profiles: new Map([[EVENT.pubkey, { display_name: 'Alice' }]]),
        profile: { display_name: 'Alice' },
        reactionOptions: [],
      },
    });

    const authorButton = Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Alice');
    expect(authorButton).toBeDefined();
    authorButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(inc.emit).toHaveBeenCalledWith(
      'profile:open',
      [],
      JSON.stringify({ pubkey: EVENT.pubkey }),
    );
  });

  it('updates visible feed author labels when profile metadata hydrates after render', async () => {
    for (const view of ['compact', 'cards', 'terminal'] as const) {
      document.body.innerHTML = '';
      const component = mount(FeedProfileHydrationHarness, {
        target: document.body,
      }) as {
        setView(view: 'compact' | 'cards' | 'terminal'): void;
        hydrate(profile: { name?: string; display_name?: string; picture?: string }): void;
      };
      component.setView(view);
      await tick();

      const before = document.querySelector('[data-feed-author-label]')?.getAttribute('data-feed-author-label');
      expect(before).toMatch(/^npub1/);

      component.hydrate({
        name: 'jeroen',
        display_name: 'Jeroen ✅',
        picture: 'https://example.com/jeroen.png',
      });
      await tick();

      expect(document.querySelector('[data-feed-author-label]')?.getAttribute('data-feed-author-label')).toBe('Jeroen ✅');
      unmount(component);
    }
  });
});
