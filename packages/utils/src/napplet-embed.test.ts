import { describe, expect, it } from 'vitest';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import type { NostrEvent } from '@hyprgate/types';
import {
  createNappletEmbedIntentRequest,
  nappletEmbedOpenContract,
  parseNappletEmbed,
  parseVerifiedNappletEmbed,
} from './napplet-embed.js';

// Disposable fixture key; never a real identity.
const KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 7);
const AUTHOR = getPublicKey(KEY);
const ARTIFACT = 'a'.repeat(64);
const SCREENSHOT = 'b'.repeat(64);
const ICON = 'c'.repeat(64);

function manifest(kind: number, tags: string[][], content = 'Sketch on a shared canvas. Then export it.'): NostrEvent {
  return finalizeEvent({ kind, created_at: 1_760_000_000, content, tags: [['x', ARTIFACT], ...tags] }, KEY) as NostrEvent;
}

describe('Feature: a note can embed a NIP-5D app as a card', () => {
  describe('Scenario: a named app manifest with presentation media and an open contract', () => {
    const event = manifest(35129, [
      ['d', 'sketch-pad'], ['title', 'Sketch Pad'],
      ['R', 'intent'], ['R', 'relay'], ['O', 'theme'], ['O', 'relay'],
      ['z', 'sketch'], ['i', 'napplet:sketch/share'], ['i', 'napplet:sketch/open'],
      ['server', 'https://blossom.example/'],
      ['screenshot', `x ${SCREENSHOT}`, 'm image/png', 'dim 1280x720'],
      ['icon', ICON, 'image/png'],
    ]);

    it('Given the signed manifest When it is parsed Then the card has its name, summary, domains and media', () => {
      const embed = parseNappletEmbed(event);
      expect(embed).toMatchObject({
        kind: 35129,
        pubkey: AUTHOR,
        namedAddress: `35129:${AUTHOR}:sketch-pad`,
        name: 'Sketch Pad',
        summary: 'Sketch on a shared canvas.',
        required: ['intent', 'relay'],
        optional: ['theme'],
        icon: { hash: ICON, mimeType: 'image/png', servers: ['https://blossom.example/'] },
      });
      expect(embed?.media.screenshots).toEqual([expect.objectContaining({ hash: SCREENSHOT, width: 1280, height: 720 })]);
    });

    it('Given two contracts When the card picks one Then it opens rather than shares', () => {
      expect(nappletEmbedOpenContract(parseNappletEmbed(event)!)).toEqual({
        archetype: 'sketch', action: 'open', convention: 'napplet:sketch/open',
      });
    });

    it('Given relay hints When the open request is built Then it names the app as a 35129 handler hint', () => {
      const request = createNappletEmbedIntentRequest(parseNappletEmbed(event)!, ['wss://relay.example/', 'https://not-a-relay']);
      expect(request).toEqual({
        archetype: 'sketch',
        action: 'open',
        convention: 'napplet:sketch/open',
        handlerHint: { address: `35129:${AUTHOR}:sketch-pad`, relays: ['wss://relay.example/'] },
        behavior: { focus: true },
      });
    });
  });

  describe('Scenario: a manifest without a usable intent contract', () => {
    it('Given an i tag without its z role When parsed Then no contract and no open request exist', () => {
      const embed = parseNappletEmbed(manifest(35129, [['d', 'lonely'], ['i', 'napplet:sketch/open']]))!;
      expect(embed.contracts).toEqual([]);
      expect(embed.name).toBe('Lonely');
      expect(createNappletEmbedIntentRequest(embed)).toBeNull();
    });

    it('Given a z role without an i tag When parsed Then there is still no contract', () => {
      expect(parseNappletEmbed(manifest(35129, [['d', 'role-only'], ['z', 'sketch']]))!.contracts).toEqual([]);
    });
  });

  describe('Scenario: snapshots and root apps', () => {
    it('Given a snapshot of a named app When the open request is built Then the hint names the parent app', () => {
      const snapshot = manifest(5129, [['a', `35129:${AUTHOR}:sketch-pad`], ['z', 'sketch'], ['i', 'napplet:sketch/open']]);
      const request = createNappletEmbedIntentRequest(parseNappletEmbed(snapshot)!);
      expect(request?.handlerHint).toEqual({ address: `35129:${AUTHOR}:sketch-pad` });
    });

    it('Given a snapshot whose parent belongs to another author When parsed Then it carries no hint', () => {
      const snapshot = manifest(5129, [['a', `35129:${'d'.repeat(64)}:sketch-pad`], ['z', 'sketch'], ['i', 'napplet:sketch/open']]);
      expect(parseNappletEmbed(snapshot)!.namedAddress).toBeNull();
    });

    it('Given a root app When the open request is built Then it has no hint, because hints are kind 35129 only', () => {
      const root = manifest(15129, [['z', 'sketch'], ['i', 'napplet:sketch/open']]);
      const request = createNappletEmbedIntentRequest(parseNappletEmbed(root)!);
      expect(request).toMatchObject({ convention: 'napplet:sketch/open' });
      expect(request).not.toHaveProperty('handlerHint');
    });
  });

  describe('Scenario: a tampered manifest', () => {
    it('Given a manifest whose title changed after signing When verified Then it is not an app card', () => {
      const signed = manifest(35129, [['d', 'sketch-pad'], ['title', 'Sketch Pad']]);
      expect(parseVerifiedNappletEmbed(signed)?.name).toBe('Sketch Pad');
      const tampered = { ...signed, tags: signed.tags.map((tag) => (tag[0] === 'title' ? ['title', 'Wallet Drainer'] : tag)) };
      expect(parseVerifiedNappletEmbed(tampered)).toBeNull();
    });
  });

  describe('Scenario: events that are not app manifests', () => {
    it('Given a note or a manifest without one artifact hash When parsed Then it is not an app card', () => {
      expect(parseNappletEmbed(manifest(1, []))).toBeNull();
      const noHash = finalizeEvent({ kind: 35129, created_at: 1, content: '', tags: [['d', 'x']] }, KEY) as NostrEvent;
      expect(parseNappletEmbed(noHash)).toBeNull();
    });
  });
});
