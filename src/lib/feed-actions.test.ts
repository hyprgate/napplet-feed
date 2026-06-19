import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import {
  FEED_REACTION_CLIENT_TAG,
  POSITIVE_REACTION,
  REACTION_CHOICES,
  createFeedNoteOpenPayload,
  createFeedReplyComposePayload,
  createPositiveReactionTemplate,
  createReactionTemplate,
  publishPositiveReaction,
  publishReaction,
} from './feed-actions';
import { relay } from '@napplet/sdk';

vi.mock('@napplet/sdk', () => ({
  relay: {
    publish: vi.fn().mockResolvedValue({ id: 'reaction' }),
  },
}));

const EVENT: Pick<NostrEvent, 'id' | 'kind' | 'pubkey'> = {
  id: 'b'.repeat(64),
  kind: 1,
  pubkey: 'a'.repeat(64),
};

const FULL_EVENT: Pick<NostrEvent, 'id' | 'kind' | 'pubkey' | 'content' | 'created_at'> = {
  ...EVENT,
  content: 'hello from feed',
  created_at: 1780531200,
};

describe('feed actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates Note Viewer open payloads for feed notes', () => {
    expect(createFeedNoteOpenPayload(EVENT)).toEqual({
      target: {
        type: 'event',
        id: EVENT.id,
        kind: 1,
        pubkey: EVENT.pubkey,
      },
      behavior: { focus: true },
      source: { napplet: 'feed' },
    });
  });

  it('creates valid positive reaction templates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T00:00:00Z'));
    try {
      expect(createPositiveReactionTemplate(EVENT)).toEqual({
        kind: 7,
        content: POSITIVE_REACTION,
          tags: [
            ['e', EVENT.id],
            ['p', EVENT.pubkey],
            ['k', String(EVENT.kind)],
            [...FEED_REACTION_CLIENT_TAG],
          ],
        created_at: 1780531200,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('creates selectable reaction templates', () => {
    expect(REACTION_CHOICES).toContain('❤️');
    expect(createReactionTemplate(EVENT, '😂')).toMatchObject({
      kind: 7,
      content: '😂',
        tags: [
          ['e', EVENT.id],
          ['p', EVENT.pubkey],
          ['k', String(EVENT.kind)],
          [...FEED_REACTION_CLIENT_TAG],
        ],
    });
  });

  it('creates compose reply payloads for feed notes', () => {
    expect(createFeedReplyComposePayload(FULL_EVENT)).toEqual({
      source: { napplet: 'feed' },
      intent: 'reply',
      replyTo: {
        id: EVENT.id,
        pubkey: EVENT.pubkey,
        kind: 1,
        content: FULL_EVENT.content,
        created_at: FULL_EVENT.created_at,
      },
    });
  });

  it('publishes positive reactions through SDK relay', async () => {
    await publishPositiveReaction(EVENT);
    expect(vi.mocked(relay.publish)).toHaveBeenCalledWith(expect.objectContaining({
      kind: 7,
      content: '+',
      tags: [
        ['e', EVENT.id],
        ['p', EVENT.pubkey],
        ['k', String(EVENT.kind)],
        [...FEED_REACTION_CLIENT_TAG],
      ],
    }));
  });

  it('publishes selected reactions through SDK relay', async () => {
    await publishReaction(EVENT, '👀');
    expect(vi.mocked(relay.publish)).toHaveBeenCalledWith(expect.objectContaining({
      kind: 7,
      content: '👀',
    }));
  });

  it('adds custom emoji tags to shortcode reactions', () => {
    expect(createReactionTemplate(EVENT, {
      content: ':blobcat:',
      tags: [['emoji', 'blobcat', 'https://emoji.example/blobcat.png', '30030:pubkey:cats']],
    })).toMatchObject({
      kind: 7,
      content: ':blobcat:',
      tags: [
        ['e', EVENT.id],
        ['p', EVENT.pubkey],
        ['k', String(EVENT.kind)],
        ['emoji', 'blobcat', 'https://emoji.example/blobcat.png', '30030:pubkey:cats'],
        [...FEED_REACTION_CLIENT_TAG],
      ],
    });
  });
});
