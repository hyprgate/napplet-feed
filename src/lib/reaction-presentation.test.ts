import * as nip19 from 'nostr-tools/nip19';
import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import { collectFeedProfilePubkeys, isFeedRenderableEvent, terminalEventContent } from './rendering-fallbacks';
import { reactionPresentation, reactionTarget } from './reaction-presentation';

const targetId = 'e'.repeat(64);
const author = 'a'.repeat(64);
const reactor = 'b'.repeat(64);

function reaction(content = '+', tags: string[][] = [['e', targetId]]): NostrEvent {
  return { id: '7'.repeat(64), pubkey: reactor, kind: 7, created_at: 1, content, tags, sig: 's' };
}

describe('NIP-25 timeline reactions', () => {
  it.each([
    ['', 'Liked'], ['+', 'Liked'], ['-', 'Disliked'], ['🔥', 'Reacted with'],
  ])('presents %j with its reaction meaning', (content, label) => {
    expect(reactionPresentation(reaction(content))).toMatchObject({ label });
    expect(isFeedRenderableEvent(reaction(content))).toBe(true);
    expect(terminalEventContent(reaction(content))).toContain(label);
    expect(terminalEventContent(reaction(content))).toContain(targetId.slice(0, 12));
  });

  it('uses the shared valid NIP-30 image and accessible shortcode', () => {
    expect(reactionPresentation(reaction(':party_parrot:', [
      ['emoji', 'party_parrot', 'https://example.test/parrot.gif'],
    ]))).toEqual({
      label: 'Reacted with', value: ':party_parrot:',
      emoji: { shortcode: 'party_parrot', imageUrl: 'https://example.test/parrot.gif' },
    });
  });

  it.each(['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'file:///tmp/emoji', 'not a URL'])('keeps invalid emoji URL %j literal', (url) => {
    expect(reactionPresentation(reaction(':party:', [['emoji', 'party', url]]))).toEqual({
      label: 'Reacted with', value: ':party:',
    });
  });

  it('keeps missing and malformed shortcodes literal', () => {
    expect(reactionPresentation(reaction(':missing:'))).toEqual({ label: 'Reacted with', value: ':missing:' });
    expect(reactionPresentation(reaction(':bad.name:'))).toEqual({ label: 'Reacted with', value: ':bad.name:' });
  });

  it('selects the last valid e tag with its own relay and author', () => {
    const event = reaction('+', [
      ['e', 'c'.repeat(64), 'wss://old.example', 'd'.repeat(64)],
      ['e', targetId, ' wss://target.example ', author],
      ['e', 'invalid', 'wss://invalid.example'],
      ['p', 'f'.repeat(64)], ['k', '1'],
    ]);
    expect(reactionTarget(event)).toEqual({ id: targetId, author, kind: 1, relays: ['wss://target.example'] });
    expect(collectFeedProfilePubkeys([event])).toEqual(new Set([reactor, author]));
  });

  it('uses only an unambiguous p hint and kind, without guessing multiple tag relationships', () => {
    expect(reactionTarget(reaction('+', [
      ['e', targetId, '', 'mention'], ['p', author], ['p', author], ['k', '1'], ['k', '1'],
    ]))).toEqual({ id: targetId, author, kind: 1, relays: [] });
    expect(reactionTarget(reaction('+', [
      ['e', targetId], ['p', author], ['p', reactor], ['k', '1'], ['k', '1111'],
    ]))).toEqual({ id: targetId, relays: [] });
  });

  it.each(['-1', 'NaN', '1.5', '', '65536', '9007199254740993'])('omits invalid kind %j', (kind) => {
    expect(reactionTarget(reaction('+', [['e', targetId], ['k', kind]]))).toEqual({ id: targetId, relays: [] });
  });

  it('keeps the exact last e target and carries consistent address coordinates including colon identifiers', () => {
    const target = reactionTarget(reaction('+', [
      ['e', targetId], ['p', author], ['k', '30023'], ['a', `30023:${author}:garden:2026`, 'wss://address.example'],
    ]));
    expect(target).toMatchObject({ id: targetId, author, kind: 30023, relays: ['wss://address.example'] });
    expect(nip19.decode(target!.source!)).toEqual({ type: 'naddr', data: {
      kind: 30023, pubkey: author, identifier: 'garden:2026', relays: ['wss://address.example'],
    } });
  });

  it.each([
    `1:${author}:x`, `40000:${author}:x`, '30023:bad:x', `30023:${reactor}:x`,
  ])('ignores malformed or contradictory address %j', (address) => {
    expect(reactionTarget(reaction('+', [['e', targetId], ['p', author], ['a', address]]))?.source).toBeUndefined();
  });

  it('rejects ambiguous addresses and mismatched kind hints, and requires an e target', () => {
    expect(reactionTarget(reaction('+', [['e', targetId], ['a', `30023:${author}:one`], ['a', `30023:${author}:two`]]))?.source).toBeUndefined();
    expect(reactionTarget(reaction('+', [['e', targetId], ['k', '1'], ['a', `30023:${author}:one`]]))?.source).toBeUndefined();
    expect(reactionTarget(reaction('+', [['a', `30023:${author}:one`]]))).toBeNull();
  });

  it('falls back to the exact event if address encoding fails', () => {
    const target = reactionTarget(reaction('+', [['e', targetId], ['a', `30023:${author}:${'x'.repeat(1000)}`]]));
    expect(target?.id).toBe(targetId);
    expect(target?.source).toBeUndefined();
  });

  it('handles absent and malformed targets without treating other event kinds as reactions', () => {
    expect(reactionTarget(reaction('+', []))).toBeNull();
    expect(reactionTarget(reaction('+', [['e'], ['e', 'not-an-id']]))).toBeNull();
    expect(reactionTarget({ ...reaction(), kind: 1 })).toBeNull();
    expect(terminalEventContent(reaction('+', []))).toContain('Reaction target unavailable');
  });
});
