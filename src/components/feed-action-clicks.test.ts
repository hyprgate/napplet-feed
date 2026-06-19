import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import type { NostrEvent } from '@hyprgate/types';
import { inc } from '@napplet/sdk';
import FeedProfileHydrationHarness from './__fixtures__/FeedProfileHydrationHarness.svelte';
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
