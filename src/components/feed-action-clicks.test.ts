import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type { NostrEvent } from '@hyprgate/types';
import { inc, intent, outbox, relay } from '@napplet/sdk';
import * as nip19 from 'nostr-tools/nip19';
import FeedProfileHydrationHarness from './__fixtures__/FeedProfileHydrationHarness.svelte';
import EventEmbedHydrationHarness from './__fixtures__/EventEmbedHydrationHarness.svelte';
import EventEmbed from './EventEmbed.svelte';
import ProfileEmbed from './ProfileEmbed.svelte';
import ReplyContextLink from './ReplyContextLink.svelte';
import FeedNoteContent from './NoteContent.svelte';
import NoteActions from './NoteActions.svelte';
import NoteEntry from './NoteEntry.svelte';

vi.mock('@napplet/sdk', () => ({
  inc: {
    emit: vi.fn(),
  },
  intent: {
    invoke: vi.fn(async (request: { archetype: string; action?: string }) => ({
      ok: true,
      archetype: request.archetype,
      action: request.action ?? 'open',
      handled: true,
      handler: request.archetype,
      windowId: `${request.archetype}-window`,
    })),
  },
  relay: {
    publish: vi.fn().mockResolvedValue({ id: 'reaction' }),
    subscribe: vi.fn().mockReturnValue({ close: vi.fn() }),
  },
  outbox: {
    getEvent: vi.fn(),
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

  it('renders nested repost quotes as Feed cards and inherits exact-relay provenance', async () => {
    const quoted: NostrEvent = {
      ...EVENT,
      id: 'd'.repeat(64),
      pubkey: 'e'.repeat(64),
      created_at: 1782063307,
      content: 'Nested quote content',
    };
    const quoteNevent = nip19.neventEncode({
      id: quoted.id,
    });
    const embedded: NostrEvent = {
      ...EMBEDDED_REPOST_TARGET,
      tags: [
        ['e', quoted.id, '', 'mention'],
        ['p', 'a'.repeat(64), '', 'mention'],
      ],
      content: `Original repost target nostr:${quoteNevent}`,
    };
    vi.mocked(outbox.getEvent).mockResolvedValueOnce({
      result: {
        event: quoted,
        sidecar: { relayHints: ['wss://returned.example'] },
      },
    } as never);
    const hydrateProfiles = vi.fn();

    mount(EventEmbedHydrationHarness, {
      target: document.body,
      props: {
        event: embedded,
        referenceRelays: ['wss://sidecar.example'],
        profiles: new Map([[embedded.pubkey, {
          display_name: 'Embedded author',
          picture: 'https://images.example/embedded.png',
        }]]),
        onHydrate: hydrateProfiles,
      },
    });

    await vi.waitFor(() => {
      expect(outbox.getEvent).toHaveBeenCalledWith(quoted.id, {
        relays: ['wss://sidecar.example'],
      });
      expect(document.body.textContent).toContain('Nested quote content');
    });
    expect(hydrateProfiles).toHaveBeenCalledWith([embedded]);
    expect(hydrateProfiles).toHaveBeenCalledWith([quoted]);

    const rootEmbed = document.querySelector<HTMLElement>('[data-feed-event-embed-depth="0"]');
    expect(rootEmbed?.querySelector('[data-feed-embed-author-label]')?.getAttribute('data-feed-embed-author-label'))
      .toBe('Embedded author');
    expect(rootEmbed?.querySelector('[data-feed-embed-timestamp]')).not.toBeNull();
    expect(rootEmbed?.querySelector('img')).not.toBeNull();

    rootEmbed?.querySelector<HTMLButtonElement>('[data-feed-embed-author-pubkey]')?.click();
    await tick();
    expect(intent.invoke).toHaveBeenLastCalledWith({
      archetype: 'profile',
      payload: { pubkey: embedded.pubkey },
    });

    rootEmbed?.querySelector<HTMLButtonElement>('.embed-header')?.click();
    await tick();
    expect(intent.invoke).toHaveBeenLastCalledWith(expect.objectContaining({
      archetype: 'note',
      payload: expect.objectContaining({
        target: expect.objectContaining({
          id: embedded.id,
          kind: embedded.kind,
          pubkey: embedded.pubkey,
          nip19: expect.stringMatching(/^nevent1/),
        }),
        relays: ['wss://sidecar.example'],
      }),
    }));

    const nestedEmbed = document.querySelector<HTMLElement>('[data-feed-event-embed-depth="1"]');
    expect(nestedEmbed?.querySelector('[data-feed-embed-author-label]')?.getAttribute('data-feed-embed-author-label'))
      .toMatch(/^npub1/);
    nestedEmbed?.querySelector<HTMLButtonElement>('[data-feed-embed-author-pubkey]')?.click();
    await tick();
    expect(intent.invoke).toHaveBeenLastCalledWith({
      archetype: 'profile',
      payload: { pubkey: quoted.pubkey },
    });

    nestedEmbed?.querySelector<HTMLButtonElement>('.embed-header')?.click();
    await tick();
    expect(intent.invoke).toHaveBeenLastCalledWith(expect.objectContaining({
      archetype: 'note',
      payload: expect.objectContaining({
        target: expect.objectContaining({
          id: quoted.id,
          kind: quoted.kind,
          pubkey: quoted.pubkey,
          nip19: expect.stringMatching(/^nevent1/),
        }),
        relays: [
          'wss://sidecar.example',
          'wss://returned.example',
        ],
      }),
    }));
  });

  it('uses a bounded not-found state when an embedded note cannot be resolved', async () => {
    vi.mocked(outbox.getEvent).mockResolvedValueOnce({} as never);

    mount(EventEmbed, {
      target: document.body,
      props: { id: 'f'.repeat(64) },
    });
    await vi.waitFor(() => {
      expect(document.querySelector('[data-feed-embed-state="not-found"]')?.textContent).toContain('Note not found.');
    });
    expect(outbox.getEvent).toHaveBeenCalledTimes(1);
  });

  it('distinguishes an incomplete embedded-note lookup from a definitive miss', async () => {
    vi.mocked(outbox.getEvent).mockResolvedValueOnce({ incomplete: true } as never);

    mount(EventEmbed, {
      target: document.body,
      props: { id: 'f'.repeat(64) },
    });

    await vi.waitFor(() => {
      expect(document.querySelector('[data-feed-embed-state="error"]')?.textContent).toContain('Could not load note.');
    });
    expect(outbox.getEvent).toHaveBeenCalledTimes(1);
  });

  it('routes embedded note and profile clicks through canonical intent requests', async () => {
    mount(EventEmbed, {
      target: document.body,
      props: { id: EVENT.id, event: EVENT },
    });
    mount(ProfileEmbed, {
      target: document.body,
      props: { pubkey: EVENT.pubkey },
    });
    await tick();

    document.querySelector<HTMLButtonElement>('.embed-header')?.click();
    await tick();
    expect(intent.invoke).toHaveBeenCalledWith({
      archetype: 'note',
      behavior: { focus: true },
      payload: {
        target: { type: 'event', id: EVENT.id, kind: EVENT.kind, pubkey: EVENT.pubkey },
        behavior: { focus: true },
        source: { napplet: 'feed' },
      },
    });
    expect(intent.invoke).toHaveBeenCalledTimes(1);

    document.querySelector<HTMLButtonElement>('[data-profile-embed]')?.click();
    await tick();
    expect(intent.invoke).toHaveBeenLastCalledWith({
      archetype: 'profile',
      payload: { pubkey: EVENT.pubkey },
    });
    expect(inc.emit).not.toHaveBeenCalled();
  });

  it('routes reply-context and card author clicks through canonical intent requests', async () => {
    const replyId = 'c'.repeat(64);
    mount(ReplyContextLink, {
      target: document.body,
      props: {
        reference: {
          label: 'reply target',
          title: 'reply target',
          reference: { type: 'event', id: replyId },
          target: { type: 'event', id: replyId },
          relays: [],
        },
      },
    });
    const component = mount(FeedProfileHydrationHarness, {
      target: document.body,
    }) as {
      setView(view: 'compact' | 'cards' | 'terminal'): void;
      setEvents(events: NostrEvent[]): void;
    };
    component.setView('cards');
    component.setEvents([EVENT]);
    await tick();

    document.querySelector<HTMLButtonElement>('.reply-context-link')?.click();
    await tick();
    expect(intent.invoke).toHaveBeenCalledWith({
      archetype: 'note',
      behavior: { focus: true },
      payload: {
        target: { type: 'event', id: replyId },
        relays: [],
        behavior: { focus: true },
        source: { napplet: 'feed' },
      },
    });

    document.querySelector<HTMLButtonElement>('[data-feed-author-pubkey]')?.click();
    await tick();
    expect(intent.invoke).toHaveBeenLastCalledWith({
      archetype: 'profile',
      payload: { pubkey: EVENT.pubkey },
    });
    expect(inc.emit).not.toHaveBeenCalled();
    unmount(component);
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
        onEvent({ event: handler });
        onEvent({ event: { ...handler, id: '8'.repeat(64), content: '{"name":"Renamed"}' } });
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

  it('clicking Open and Reply invokes canonical note and composer requests', async () => {
    mount(NoteActions, {
      target: document.body,
      props: { event: EVENT, reactionOptions: [] },
    });

    document.querySelectorAll('button')[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(intent.invoke).toHaveBeenCalledWith({
      archetype: 'note',
      behavior: { focus: true },
      payload: {
        target: { type: 'event', id: EVENT.id, kind: EVENT.kind, pubkey: EVENT.pubkey },
        behavior: { focus: true },
        source: { napplet: 'feed' },
      },
    });

    document.querySelectorAll('button')[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(intent.invoke).toHaveBeenLastCalledWith({
      archetype: 'composer',
      payload: {
        source: { napplet: 'feed' },
        intent: 'reply',
        replyTo: {
          id: EVENT.id,
          pubkey: EVENT.pubkey,
          kind: EVENT.kind,
          content: EVENT.content,
          created_at: EVENT.created_at,
        },
      },
    });
  });

  it('shows a dispatch failure when the canonical note request is unhandled', async () => {
    vi.mocked(intent.invoke).mockResolvedValueOnce({
      ok: false,
      archetype: 'note',
      action: 'open',
      handled: false,
      error: 'No note handler is available',
    });
    mount(NoteActions, {
      target: document.body,
      props: { event: EVENT, reactionOptions: [] },
    });

    document.querySelectorAll('button')[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await vi.waitFor(() => {
      expect(document.querySelector('[role="status"]')?.textContent).toBe('No note handler is available');
    });
  });

  it('clicking a feed author name invokes a canonical profile request', async () => {
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
    await tick();

    expect(intent.invoke).toHaveBeenCalledWith({ archetype: 'profile', payload: { pubkey: EVENT.pubkey } });
  });

  it('clicking an inline note reference invokes a canonical note target', async () => {
    const targetId = 'd'.repeat(64);
    const note = nip19.noteEncode(targetId);
    mount(FeedNoteContent, {
      target: document.body,
      props: { content: `inline nostr:${note}` },
    });
    await tick();

    document.querySelector<HTMLButtonElement>('.note-content .ref')?.click();
    await tick();

    expect(intent.invoke).toHaveBeenCalledWith({
      archetype: 'note',
      behavior: { focus: true },
      payload: {
        target: { type: 'event', id: targetId, nip19: note },
        behavior: { focus: true },
        source: { napplet: 'feed' },
      },
    });
  });

  it('clicking an inline address reference invokes a canonical note target', async () => {
    const pubkey = 'c'.repeat(64);
    const naddr = nip19.naddrEncode({
      kind: 30023,
      pubkey,
      identifier: 'article',
      relays: ['wss://relay.example'],
    });
    mount(FeedNoteContent, {
      target: document.body,
      props: { content: `inline nostr:${naddr}` },
    });
    await tick();

    document.querySelector<HTMLButtonElement>('.note-content .ref')?.click();
    await tick();

    expect(intent.invoke).toHaveBeenCalledWith({
      archetype: 'note',
      behavior: { focus: true },
      payload: {
        target: { type: 'address', kind: 30023, pubkey, identifier: 'article', nip19: naddr },
        relays: ['wss://relay.example'],
        behavior: { focus: true },
        source: { napplet: 'feed' },
      },
    });
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

  it('renders npub and nprofile mention embeds from cached profile metadata', async () => {
    const npubMentionPubkey = 'd'.repeat(64);
    const nprofileMentionPubkey = 'f'.repeat(64);
    const component = mount(FeedProfileHydrationHarness, {
      target: document.body,
    }) as {
      setView(view: 'compact' | 'cards' | 'terminal'): void;
      setEvents(events: NostrEvent[]): void;
      hydratePubkey(pubkey: string, profile: {
        name?: string;
        display_name?: string;
        displayName?: string;
        nip05?: string;
        picture?: string;
      }): void;
    };
    component.hydratePubkey(npubMentionPubkey, {
      display_name: 'Cached Npub',
      picture: 'https://example.test/npub.png',
    });
    component.hydratePubkey(nprofileMentionPubkey, {
      displayName: 'Cached Nprofile',
      nip05: 'nprofile@example.test',
    });
    component.setEvents([{
      ...EVENT,
      content: [
        `nostr:${nip19.npubEncode(npubMentionPubkey)}`,
        `nostr:${nip19.nprofileEncode({ pubkey: nprofileMentionPubkey })}`,
      ].join(' '),
    }]);
    vi.mocked(relay.subscribe).mockClear();

    for (const view of ['compact', 'cards'] as const) {
      component.setView(view);
      await tick();

      const labels = Array.from(document.querySelectorAll('[data-profile-embed-label]'))
        .map((element) => element.getAttribute('data-profile-embed-label'));
      expect(labels).toContain('Cached Npub');
      expect(labels).toContain('Cached Nprofile');
      expect(relay.subscribe).not.toHaveBeenCalled();
    }

    document
      .querySelector<HTMLButtonElement>(`[data-profile-embed-pubkey="${npubMentionPubkey}"]`)
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(intent.invoke).toHaveBeenLastCalledWith({
      archetype: 'profile',
      payload: { pubkey: npubMentionPubkey },
    });

    unmount(component);
  });
});
