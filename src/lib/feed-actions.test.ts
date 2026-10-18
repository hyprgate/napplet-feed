import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import * as nip19 from 'nostr-tools/nip19';
import {
  FEED_REACTION_CLIENT_TAG,
  POSITIVE_REACTION,
  REACTION_CHOICES,
  createFeedComposerIntentRequest,
  createFeedNoteOpenPayload,
  createFeedNoteIntentRequest,
  createFeedProfileIntentRequest,
  createFeedReferenceOpenPayload,
  createFeedReplyComposePayload,
  createPositiveReactionTemplate,
  createReactionTemplate,
  publishPositiveReaction,
  publishReaction,
  invokeFeedIntent,
} from './feed-actions';
import { rememberEventRelayHints } from './event-relay-hints';
import { intentInvoke, outbox, relay } from '@napplet/sdk';

vi.mock('@napplet/sdk', () => ({
  intentInvoke: vi.fn(),
  relay: {
    publish: vi.fn().mockResolvedValue({ id: 'reaction' }),
  },
  outbox: {
    publish: vi.fn().mockResolvedValue({
      ok: true,
      event: { id: 'reaction' },
      eventId: 'reaction',
      relays: { 'wss://write.example': true },
    }),
  },
}));

const EVENT: NostrEvent = {
  id: 'b'.repeat(64),
  kind: 1,
  pubkey: 'a'.repeat(64),
  created_at: 1780531200,
  tags: [],
  content: 'hello from feed',
  sig: 's'.repeat(128),
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

  it('builds archetype-led note, profile, and composer requests with explicit new-window behavior only when requested', () => {
    expect(createFeedNoteIntentRequest(EVENT)).toEqual({
      archetype: 'note',
      action: 'open',
      convention: 'napplet:note/open',
      behavior: { focus: true },
      payload: createFeedNoteOpenPayload(EVENT),
    });
    expect(createFeedNoteIntentRequest(EVENT, { behavior: { reuse: false } })).toMatchObject({
      archetype: 'note',
      action: 'open',
      convention: 'napplet:note/open',
      behavior: { focus: true, reuse: false },
    });
    expect(createFeedProfileIntentRequest(EVENT.pubkey)).toEqual({
      archetype: 'profile',
      action: 'open',
      convention: 'napplet:profile/open',
      payload: { pubkey: EVENT.pubkey },
    });
    expect(createFeedProfileIntentRequest(EVENT.pubkey, { behavior: { reuse: false } })).toMatchObject({
      archetype: 'profile',
      behavior: { reuse: false },
    });
    expect(createFeedComposerIntentRequest({ source: { napplet: 'feed' } })).toEqual({
      archetype: 'composer',
      action: 'open',
      convention: 'napplet:composer/open',
      payload: { source: { napplet: 'feed' } },
    });
  });

  it('accepts only accepted-delivery results with the canonical request identity', async () => {
    const request = createFeedNoteIntentRequest(EVENT)!;
    vi.mocked(intentInvoke).mockResolvedValueOnce({
      ok: true,
      archetype: 'note',
      action: 'open',
      convention: 'napplet:note/open',
      handler: 'note-viewer',
    });

    await expect(invokeFeedIntent(request)).resolves.toEqual({
      accepted: true,
      result: expect.objectContaining({ archetype: 'note', action: 'open', convention: 'napplet:note/open', handler: 'note-viewer' }),
    });
    expect(intentInvoke).toHaveBeenCalledWith('napplet:note/open', { payload: request.payload, behavior: request.behavior });
  });

  it('keeps a pre-acceptance failure on the existing failure branch', async () => {
    const request = createFeedNoteIntentRequest(EVENT)!;
    vi.mocked(intentInvoke).mockResolvedValueOnce({
      ok: false,
      archetype: 'note',
      action: 'open',
      error: 'no note handler',
    });

    await expect(invokeFeedIntent(request)).resolves.toEqual({ accepted: false, error: 'no note handler' });
  });

  it('creates relay-hinted Note Viewer open payloads when the event has known relays', () => {
    const payload = createFeedNoteOpenPayload(EVENT, ['wss://relay.example', 'wss://relay.example'])!;

    expect(payload.relays).toEqual(['wss://relay.example']);
    expect(payload.target.nip19).toMatch(/^nevent1/);
    expect(nip19.decode(payload.target.nip19!).data).toMatchObject({
      id: EVENT.id,
      author: EVENT.pubkey,
      kind: EVENT.kind,
      relays: ['wss://relay.example'],
    });
  });

  it('uses sidecar relay hints remembered for the rendered event', () => {
    const event: NostrEvent = { ...EVENT, id: 'c'.repeat(64) };
    rememberEventRelayHints(event, ['wss://sidecar.example']);

    const payload = createFeedNoteOpenPayload(event)!;

    expect(payload.relays).toEqual(['wss://sidecar.example']);
    expect(nip19.decode(payload.target.nip19!).data).toMatchObject({
      id: event.id,
      author: event.pubkey,
      kind: event.kind,
      relays: ['wss://sidecar.example'],
    });
  });

  it('preserves the original nevent and its decoded lookup provenance', () => {
    const nevent = nip19.neventEncode({
      id: EVENT.id,
      author: EVENT.pubkey,
      kind: EVENT.kind,
      relays: ['wss://reference.example'],
    });

    expect(createFeedReferenceOpenPayload(`nostr:${nevent}`)).toEqual({
      target: {
        type: 'event',
        id: EVENT.id,
        kind: EVENT.kind,
        pubkey: EVENT.pubkey,
        nip19: nevent,
      },
      relays: ['wss://reference.example'],
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

  it('publishes positive reactions through the authored-event outbox and target inbox', async () => {
    await expect(publishPositiveReaction(EVENT)).resolves.toMatchObject({ id: 'reaction' });
    expect(vi.mocked(outbox.publish)).toHaveBeenCalledWith(expect.objectContaining({
      kind: 7,
      content: '+',
      tags: [
        ['e', EVENT.id],
        ['p', EVENT.pubkey],
        ['k', String(EVENT.kind)],
        [...FEED_REACTION_CLIENT_TAG],
      ],
    }), { toInboxes: [EVENT.pubkey] });
    expect(vi.mocked(relay.publish)).not.toHaveBeenCalled();
  });

  it('publishes selected reactions through the authored-event outbox', async () => {
    await publishReaction(EVENT, '👀');
    expect(vi.mocked(outbox.publish)).toHaveBeenCalledWith(expect.objectContaining({
      kind: 7,
      content: '👀',
    }), { toInboxes: [EVENT.pubkey] });
  });

  it('rejects a structured outbox publish failure', async () => {
    vi.mocked(outbox.publish).mockResolvedValueOnce({
      ok: false,
      error: 'relay list unavailable',
    });

    await expect(publishReaction(EVENT, '+')).rejects.toThrow('relay list unavailable');
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
