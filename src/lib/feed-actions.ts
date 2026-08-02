import {
  createIntentRequest,
  parseIntentResult,
  type IntentRequest,
  type IntentRequestOptions,
  type IntentResult,
  type NostrEvent,
} from '@hyprgate/types';
import {
  createNoteViewerOpenIntentRequest,
  createNoteViewerOpenPayload,
  createProfileIntentRequest,
  type NoteViewerOpenPayload,
} from '@hyprgate/utils';
import { intent, outbox } from '@napplet/sdk';
import * as nip19 from 'nostr-tools/nip19';
import { normalizeRelayHints, relayHintsForEvent } from './event-relay-hints.js';

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

export type FeedIntentDispatchResult =
  | { handled: true; result: IntentResult }
  | { handled: false; error: string };

export function createFeedNoteOpenPayload(
  event: NostrEvent,
  relayHints: readonly string[] = relayHintsForEvent(event),
): NoteViewerOpenPayload | null {
  const relays = normalizeRelayHints(relayHints);
  return createNoteViewerOpenPayload({
    target: {
      type: 'event',
      id: event.id,
      kind: event.kind,
      pubkey: event.pubkey,
    },
    ...(relays.length > 0 ? { relays } : {}),
    behavior: { focus: true },
    source: { napplet: 'feed' },
  });
}

/** Build a public note request while retaining Feed's existing focus policy. */
export function createFeedNoteIntentRequest(
  event: NostrEvent,
  options: IntentRequestOptions = {},
): IntentRequest | null {
  const payload = createFeedNoteOpenPayload(event);
  return payload ? createFeedNoteIntentRequestFromPayload(payload, options) : null;
}

/** Build a public note request from an already-validated Feed note payload. */
export function createFeedNoteIntentRequestFromPayload(
  payload: NoteViewerOpenPayload,
  options: IntentRequestOptions = {},
): IntentRequest | null {
  const behavior = payload.behavior || options.behavior
    ? { ...payload.behavior, ...options.behavior }
    : undefined;
  return createNoteViewerOpenIntentRequest(payload, {
    ...options,
    ...(behavior ? { behavior } : {}),
  });
}

/** Build a public profile request from a Feed identity target. */
export function createFeedProfileIntentRequest(
  pubkey: string,
  options: IntentRequestOptions = {},
): IntentRequest | null {
  return createProfileIntentRequest({ pubkey }, options);
}

/** Build a public composer request without a legacy routing topic. */
export function createFeedComposerIntentRequest(
  payload: FeedComposeOpenPayload | { source: { napplet: 'feed' } },
  options: IntentRequestOptions = {},
): IntentRequest | null {
  return createIntentRequest({ archetype: 'composer', ...options, payload });
}

/** Invoke a request only when the public result preserves request identity and is handled. */
export async function invokeFeedIntent(request: IntentRequest): Promise<FeedIntentDispatchResult> {
  try {
    const result = parseIntentResult(await intent.invoke(request));
    const action = request.action ?? 'open';
    if (!result || result.archetype !== request.archetype || result.action !== action) {
      return { handled: false, error: 'The intent returned an invalid result.' };
    }
    if (!result.ok || !result.handled) {
      return { handled: false, error: result.error ?? `No ${request.archetype} handler is available.` };
    }
    return { handled: true, result };
  } catch (error) {
    return { handled: false, error: error instanceof Error ? error.message : 'The intent could not be dispatched.' };
  }
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

export async function publishPositiveReaction(event: Pick<NostrEvent, 'id' | 'kind' | 'pubkey'>): Promise<NostrEvent> {
  return publishReaction(event, POSITIVE_REACTION);
}

export async function publishReaction(
  event: Pick<NostrEvent, 'id' | 'kind' | 'pubkey'>,
  reaction: string | ReactionInput,
): Promise<NostrEvent> {
  const result = await outbox.publish(
    createReactionTemplate(event, reaction),
    { toInboxes: [event.pubkey] },
  );
  if (!result.ok || !result.event) {
    throw new Error(result.error ?? 'Reaction publish failed');
  }
  return result.event;
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
