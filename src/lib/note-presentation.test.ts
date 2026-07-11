import { describe, expect, it } from 'vitest';
import * as nip19 from 'nostr-tools/nip19';
import {
  createReplyReferenceOpenPayload,
  countLabel,
  previewContent,
  replyContextForEvent,
  shouldTruncateContent,
  terminalEngagementLabel,
} from './note-presentation';

const ROOT_ID = '0'.repeat(63) + '1';
const PARENT_ID = '0'.repeat(63) + '2';
const PUBKEY = 'a'.repeat(64);

describe('note presentation helpers', () => {
  it('detects long notes by character count', () => {
    expect(shouldTruncateContent('short', 10, 8)).toBe(false);
    expect(shouldTruncateContent('this is too long', 10, 8)).toBe(true);
  });

  it('detects long notes by line count', () => {
    expect(shouldTruncateContent('1\n2\n3', 100, 4)).toBe(false);
    expect(shouldTruncateContent('1\n2\n3\n4\n5', 100, 4)).toBe(true);
  });

  it('builds a stable preview with an ellipsis marker', () => {
    expect(previewContent('abcdef', 3, 8)).toBe('abc...');
    expect(previewContent('one\ntwo\nthree', 100, 2)).toBe('one\ntwo...');
  });

  it('formats singular and plural count labels', () => {
    expect(countLabel(1, 'reply', 'replies')).toBe('1 reply');
    expect(countLabel(2, 'reply', 'replies')).toBe('2 replies');
  });

  it('formats terminal engagement labels from shared count semantics', () => {
    expect(terminalEngagementLabel({ reactions: 3, comments: 2, zaps: 1, zapMillisats: 21000 })).toBe('3 react / 2 reply / 1 zap 21 sats');
    expect(terminalEngagementLabel({
      reactions: 3,
      reactionGroups: [{ content: '+', count: 2 }, { content: '-', count: 1 }],
      comments: 2,
      zaps: 1,
      zapMillisats: 1500,
    })).toBe('+ 2 - 1 / 2 reply / 1 zap 1.5 sats');
    expect(terminalEngagementLabel(undefined)).toBe('0 react / 0 reply / 0 zap');
  });

  it('renders relay-hinted reply references as note-viewer nevents', () => {
    const context = replyContextForEvent({
      kind: 1,
      tags: [
        ['e', ROOT_ID, 'wss://relay.example', 'root'],
        ['e', PARENT_ID, 'wss://relay.example', 'reply'],
        ['p', PUBKEY],
      ],
    });

    expect(context).not.toBeNull();
    expect(context!.parent.title).toBe(nip19.neventEncode({ id: PARENT_ID, relays: ['wss://relay.example'] }));
    expect(context!.parent.label).toMatch(/^nevent1/);
    expect(context!.parent.label).not.toContain(PARENT_ID.slice(0, 8));

    const payload = createReplyReferenceOpenPayload(context!.parent);
    expect(payload).toMatchObject({
      target: {
        type: 'event',
        id: PARENT_ID,
        nip19: context!.parent.title,
      },
      relays: ['wss://relay.example'],
      source: { napplet: 'feed' },
    });
  });

  it('uses note entities for event references without relay hints', () => {
    const context = replyContextForEvent({
      kind: 1,
      tags: [
        ['e', ROOT_ID, '', 'root'],
        ['e', PARENT_ID, '', 'reply'],
      ],
    });

    expect(context).not.toBeNull();
    expect(context!.parent.title).toBe(nip19.noteEncode(PARENT_ID));
    expect(context!.parent.label).toMatch(/^note1/);
    expect(context!.parent.relays).toEqual([]);
  });
});
