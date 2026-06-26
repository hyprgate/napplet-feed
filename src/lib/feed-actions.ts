import type { NostrEvent } from '@hyprgate/types';
import {
  NOTE_VIEWER_OPEN_TOPIC,
  createNoteViewerOpenPayload,
  type NoteViewerOpenPayload,
} from '@hyprgate/utils';
import { relay } from '@napplet/sdk';
import { nip19 } from 'nostr-tools';

export const POSITIVE_REACTION = '+' as const;
export const FEED_REACTION_CLIENT_TAG = ['client', '@hyprgate/feed/reaction'] as const;
export const REACTION_CHOICES = ['+', '-', '❤️', '😂', '🤙', '👀'] as const;

export type ReactionChoice = typeof REACTION_CHOICES[number];

export interface ReactionInput {
  content: string;
  tags?: string[][];
}

export interface FeedComposeOpenPayload {
  source: { napplet: 'feed' };
  intent: 'reply';
  replyTo: {
    id: string;
    pubkey: string;
    kind: number;
    content?: string;
    created_at?: number;
  };
}

export function createFeedNoteOpenPayload(event: Pick<NostrEvent, 'id' | 'kind' | 'pubkey'>): NoteViewerOpenPayload | null {
  return createNoteViewerOpenPayload({
    target: {
      type: 'event',
      id: event.id,
      kind: event.kind,
      pubkey: event.pubkey,
    },
    behavior: { focus: true },
    source: { napplet: 'feed' },
  });
}

export function createFeedReferenceOpenPayload(source: string): NoteViewerOpenPayload | null {
  const encoded = source.trim().replace(/^nostr:/i, '');
  if (!encoded) return null;

  try {
    const decoded = nip19.decode(encoded);
    if (decoded.type === 'note') {
      return createNoteViewerOpenPayload({
        target: { type: 'event', id: decoded.data, nip19: encoded },
        behavior: { focus: true },
        source: { napplet: 'feed' },
      });
    }
    if (decoded.type === 'nevent') {
      const data = decoded.data;
      return createNoteViewerOpenPayload({
        target: {
          type: 'event',
          id: data.id,
          ...(typeof data.kind === 'number' ? { kind: data.kind } : {}),
          ...(typeof data.author === 'string' ? { pubkey: data.author } : {}),
          nip19: encoded,
        },
        ...(Array.isArray(data.relays) ? { relays: data.relays } : {}),
        behavior: { focus: true },
        source: { napplet: 'feed' },
      });
    }
    if (decoded.type === 'naddr') {
      const data = decoded.data;
      return createNoteViewerOpenPayload({
        target: {
          type: 'address',
          kind: data.kind,
          pubkey: data.pubkey,
          identifier: data.identifier,
          nip19: encoded,
        },
        ...(Array.isArray(data.relays) ? { relays: data.relays } : {}),
        behavior: { focus: true },
        source: { napplet: 'feed' },
      });
    }
  } catch {
    return null;
  }

  return null;
}

export function createPositiveReactionTemplate(event: Pick<NostrEvent, 'id' | 'kind' | 'pubkey'>): {
  kind: 7;
  content: typeof POSITIVE_REACTION;
  tags: string[][];
  created_at: number;
} {
  return {
    kind: 7,
    content: POSITIVE_REACTION,
    tags: [
      ['e', event.id],
      ['p', event.pubkey],
      ['k', String(event.kind)],
      [...FEED_REACTION_CLIENT_TAG],
    ],
    created_at: Math.floor(Date.now() / 1000),
  };
}

export function createReactionTemplate(event: Pick<NostrEvent, 'id' | 'kind' | 'pubkey'>, reaction: string | ReactionInput): {
  kind: 7;
  content: string;
  tags: string[][];
  created_at: number;
} {
  const content = typeof reaction === 'string' ? reaction : reaction.content;
  const customTags = typeof reaction === 'string' ? [] : reaction.tags ?? [];
  return {
    ...createPositiveReactionTemplate(event),
    content,
    tags: [
      ['e', event.id],
      ['p', event.pubkey],
      ['k', String(event.kind)],
      ...customTags,
      [...FEED_REACTION_CLIENT_TAG],
    ],
  };
}

export async function publishPositiveReaction(event: Pick<NostrEvent, 'id' | 'kind' | 'pubkey'>): Promise<object> {
  return publishReaction(event, POSITIVE_REACTION);
}

export async function publishReaction(event: Pick<NostrEvent, 'id' | 'kind' | 'pubkey'>, reaction: string | ReactionInput): Promise<object> {
  return relay.publish(createReactionTemplate(event, reaction));
}

export function createFeedReplyComposePayload(
  event: Pick<NostrEvent, 'id' | 'pubkey' | 'kind'> & Partial<Pick<NostrEvent, 'content' | 'created_at'>>,
): FeedComposeOpenPayload {
  return {
    source: { napplet: 'feed' },
    intent: 'reply',
    replyTo: {
      id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      ...(typeof event.content === 'string' ? { content: event.content } : {}),
      ...(typeof event.created_at === 'number' ? { created_at: event.created_at } : {}),
    },
  };
}

export { NOTE_VIEWER_OPEN_TOPIC };
