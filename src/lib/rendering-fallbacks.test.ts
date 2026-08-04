import { describe, expect, it } from 'vitest';
import { KIND_REPOST, type NostrEvent } from '@hyprgate/types';
import { parseNoteContent } from '@hyprgate/utils';
import * as nip19 from 'nostr-tools/nip19';
import { rememberEventRelayHints } from './event-relay-hints';
import {
  collectFeedProfilePubkeys,
  feedEventReference,
  isFeedRenderableEvent,
  isInlineDepthExhausted,
  parsedRepostEvent,
  repostTargetId,
  terminalEventContent,
} from './rendering-fallbacks';

const TARGET: NostrEvent = {
  id: 'e'.repeat(64),
  pubkey: 'a'.repeat(64),
  created_at: 1782063307,
  kind: 1,
  tags: [],
  content: "Who knows what it's good for.\n\nhttps://dergigi.com/2026/06/21/sayings/",
  sig: 's',
};

function event(overrides: Partial<NostrEvent>): NostrEvent {
  return {
    id: 'b'.repeat(64),
    pubkey: 'c'.repeat(64),
    created_at: 1,
    kind: 1,
    tags: [],
    content: 'hello',
    sig: 's',
    ...overrides,
  };
}

describe('feed rendering fallback helpers', () => {
  it('parses kind-6 embedded event JSON without treating all JSON notes as special', () => {
    const repost = event({ kind: KIND_REPOST, content: JSON.stringify(TARGET) });
    expect(parsedRepostEvent(repost)).toMatchObject({ id: TARGET.id, content: TARGET.content });
    expect(parsedRepostEvent(event({ content: JSON.stringify(TARGET) }))).toBeNull();
  });

  it('falls back to e-tag targets for malformed repost JSON', () => {
    const repost = event({
      kind: KIND_REPOST,
      content: '{"id":',
      tags: [['e', TARGET.id]],
    });

    expect(parsedRepostEvent(repost)).toBeNull();
    expect(repostTargetId(repost)).toBe(TARGET.id);
  });

  it('keeps terminal rendering non-raw for repost and unsupported events', () => {
    expect(terminalEventContent(event({ kind: KIND_REPOST, content: JSON.stringify(TARGET) }))).toContain("Who knows what it's good for");
    expect(terminalEventContent(event({ kind: 1063, content: JSON.stringify(TARGET) }))).toBe('cannot render this event');
  });

  it('declares only current feed-renderable kinds as directly renderable', () => {
    expect(isFeedRenderableEvent(event({ kind: 1 }))).toBe(true);
    expect(isFeedRenderableEvent(event({ kind: 1111 }))).toBe(true);
    expect(isFeedRenderableEvent(event({ kind: KIND_REPOST }))).toBe(true);
    expect(isFeedRenderableEvent(event({ kind: 1063 }))).toBe(false);
  });

  it('enforces a deterministic inline note recursion depth limit', () => {
    expect(isInlineDepthExhausted(0, 2)).toBe(false);
    expect(isInlineDepthExhausted(1, 2)).toBe(false);
    expect(isInlineDepthExhausted(2, 2)).toBe(true);
  });

  it('does not guess that the supplied p mention authored its event reference', () => {
    const quotedId = 'd'.repeat(64);
    const quotedAuthor = 'f'.repeat(64);
    const source = `nostr:${nip19.neventEncode({ id: quotedId })}`;
    const suppliedShape = event({
      tags: [
        ['e', quotedId, '', 'mention'],
        ['p', quotedAuthor, '', 'mention'],
      ],
      content: `quoted ${source}`,
    });
    const block = parseNoteContent(suppliedShape.content).find((item) => item.type === 'event');

    expect(block?.type).toBe('event');
    if (!block || block.type !== 'event') throw new Error('expected event reference');
    expect(feedEventReference(suppliedShape, block)).toEqual({
      id: quotedId,
      source,
      relays: [],
    });
  });

  it('merges decoded, tag, and sidecar hints and collects nested authors for shared hydration', () => {
    const quotedId = 'd'.repeat(64);
    const quotedAuthor = 'f'.repeat(64);
    const nevent = nip19.neventEncode({
      id: quotedId,
      author: quotedAuthor,
      kind: 1,
      relays: ['wss://nevent.example'],
    });
    const embedded = event({
      id: TARGET.id,
      pubkey: TARGET.pubkey,
      tags: [['q', quotedId, 'wss://tag.example', quotedAuthor]],
      content: `quoted nostr:${nevent}`,
    });
    rememberEventRelayHints(embedded, ['wss://sidecar.example']);
    const block = parseNoteContent(embedded.content).find((item) => item.type === 'event');

    if (!block || block.type !== 'event') throw new Error('expected event reference');
    expect(feedEventReference(embedded, block)).toEqual({
      id: quotedId,
      source: `nostr:${nevent}`,
      author: quotedAuthor,
      kind: 1,
      relays: ['wss://nevent.example', 'wss://tag.example', 'wss://sidecar.example'],
    });

    const repost = event({ kind: KIND_REPOST, content: JSON.stringify(embedded) });
    expect(collectFeedProfilePubkeys([repost])).toEqual(new Set([
      repost.pubkey,
      embedded.pubkey,
      quotedAuthor,
    ]));
  });
});
