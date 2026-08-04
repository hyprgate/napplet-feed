import {
  KIND_NOTE,
  KIND_REPOST,
  type NostrEvent,
} from '@hyprgate/types';
import {
  isCanonicalHexPubkey,
  parseNoteContent,
  type NoteContentBlock,
} from '@hyprgate/utils';
import { normalizeRelayHints, relayHintsForEvent } from './event-relay-hints';
import { previewContent } from './note-presentation';

export const KIND_COMMENT = 1111;
export const MAX_INLINE_EVENT_DEPTH = 2;

export type FeedEventContentReference = Extract<NoteContentBlock, { type: 'event' }>;

export interface FeedEventReference {
  id: string;
  source?: string;
  author?: string;
  kind?: number;
  relays: string[];
}

export function isFeedRenderableEvent(event: NostrEvent): boolean {
  return event.kind === KIND_NOTE || event.kind === KIND_COMMENT || event.kind === KIND_REPOST;
}

export function parsedRepostEvent(event: NostrEvent): NostrEvent | null {
  if (event.kind !== KIND_REPOST) return null;
  const content = event.content.trim();
  if (!content) return null;
  try {
    const parsed = JSON.parse(content) as Partial<NostrEvent>;
    if (
      typeof parsed.id !== 'string'
      || typeof parsed.pubkey !== 'string'
      || typeof parsed.created_at !== 'number'
      || typeof parsed.kind !== 'number'
      || !Array.isArray(parsed.tags)
      || typeof parsed.content !== 'string'
      || typeof parsed.sig !== 'string'
    ) {
      return null;
    }
    return {
      id: parsed.id,
      pubkey: parsed.pubkey,
      created_at: parsed.created_at,
      kind: parsed.kind,
      tags: parsed.tags.filter(isStringTag),
      content: parsed.content,
      sig: parsed.sig,
    };
  } catch {
    return null;
  }
}

export function repostTargetId(event: NostrEvent): string | null {
  if (event.kind !== KIND_REPOST) return null;
  return event.tags.find((tag) => tag[0] === 'e' && isHexEventId(tag[1]))?.[1] ?? null;
}

export function feedEventReference(
  event: NostrEvent,
  reference: FeedEventContentReference,
): FeedEventReference {
  const matchingReferenceTags = event.tags
    .filter(isEventReferenceTag)
    .filter((tag) => tag[1] === reference.value);
  const directTagAuthor = uniquePubkey(matchingReferenceTags.map((tag) => tag[3]));
  const author = isCanonicalHexPubkey(reference.author)
    ? reference.author
    : directTagAuthor;

  return {
    id: reference.value,
    ...(reference.source ? { source: reference.source } : {}),
    ...(author ? { author } : {}),
    ...(typeof reference.kind === 'number' ? { kind: reference.kind } : {}),
    relays: normalizeRelayHints([
      ...(reference.relays ?? []),
      ...matchingReferenceTags.map((tag) => tag[2] ?? ''),
      ...relayHintsForEvent(event),
    ]),
  };
}

export function collectFeedProfilePubkeys(events: NostrEvent[]): Set<string> {
  const pubkeys = new Set<string>();
  const visited = new Set<string>();

  function add(pubkey: unknown): void {
    if (isCanonicalHexPubkey(pubkey)) pubkeys.add(pubkey);
  }

  function visit(event: NostrEvent, depth: number): void {
    if (visited.has(event.id)) return;
    visited.add(event.id);
    add(event.pubkey);

    if (event.kind === KIND_REPOST) {
      const embedded = parsedRepostEvent(event);
      if (embedded && depth < MAX_INLINE_EVENT_DEPTH) {
        visit(embedded, depth + 1);
        return;
      }
      const targetId = repostTargetId(event);
      if (targetId) {
        add(feedEventReference(event, { type: 'event', value: targetId, source: '' }).author);
      }
      return;
    }

    for (const block of parseNoteContent(event.content)) {
      if (block.type === 'profile') add(block.value);
      if (block.type === 'event') add(feedEventReference(event, block).author);
    }
  }

  for (const event of events) visit(event, 0);
  return pubkeys;
}

export function terminalEventContent(event: NostrEvent): string {
  if (event.kind === KIND_REPOST) {
    const embedded = parsedRepostEvent(event);
    if (embedded) return `repost: ${previewContent(embedded.content || '[empty note]', 180, 3)}`;
    const target = repostTargetId(event);
    return target ? `repost: ${target.slice(0, 12)}...` : 'Repost target unavailable';
  }
  if (!isFeedRenderableEvent(event)) return 'cannot render this event';
  return event.content;
}

export function isInlineDepthExhausted(depth: number, maxDepth = MAX_INLINE_EVENT_DEPTH): boolean {
  return depth >= maxDepth;
}

function isStringTag(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isHexEventId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

function isEventReferenceTag(tag: string[]): boolean {
  return (tag[0] === 'e' || tag[0] === 'q') && isHexEventId(tag[1]);
}

function uniquePubkey(values: unknown[]): string | undefined {
  const pubkeys = [...new Set(values.filter(isCanonicalHexPubkey))];
  return pubkeys.length === 1 ? pubkeys[0] : undefined;
}
