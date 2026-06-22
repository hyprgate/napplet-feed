import { describe, expect, it } from 'vitest';
import { KIND_REPOST, type NostrEvent } from '@hyprgate/types';
import {
  isFeedRenderableEvent,
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
});
