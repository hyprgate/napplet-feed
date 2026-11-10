import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import type { NostrEvent } from '@hyprgate/types';
import { parseVerifiedNappletEmbed } from '@hyprgate/utils';

const sdk = vi.hoisted(() => ({ query: vi.fn() }));
const media = vi.hoisted(() => ({ verifiedAppMedia: vi.fn() }));
const actions = vi.hoisted(() => ({ invokeFeedIntent: vi.fn() }));

vi.mock('@napplet/sdk', () => ({ outbox: { query: sdk.query } }));
vi.mock('@hyprgate/utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('@hyprgate/utils')>(),
  verifiedAppMedia: media.verifiedAppMedia,
}));
vi.mock('../lib/feed-actions', () => ({ invokeFeedIntent: actions.invokeFeedIntent }));

import NappletEmbed from './NappletEmbed.svelte';

// Real signed events captured from public relays (see e2e/fixtures/napshot).
const napshot = JSON.parse(readFileSync(resolve(process.cwd(), '../../e2e/fixtures/napshot/seedhammer-viewer.json'), 'utf8')) as {
  manifest: NostrEvent; currentLabel: NostrEvent; previousRevisionLabel: NostrEvent;
};
const NAPSHOT_HASH = 'aa1e1b90782c6ca2a744104d661009f7a215d783b08e7177c2a99314469284b0';
const NAPSHOT_RELAYS = ['wss://relay.napplet.soy/', 'wss://relay.primal.net/'];

// Disposable fixture key for a third-party app with its own screenshot.
const KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 11);
const AUTHOR = getPublicKey(KEY);
const SCREENSHOT = 'e'.repeat(64);

function sketchPad(tags: string[][] = []): NostrEvent {
  return finalizeEvent({
    kind: 35129, created_at: 1_760_000_000, content: 'Sketch on a shared canvas.',
    tags: [
      ['d', 'sketch-pad'], ['x', 'a'.repeat(64)], ['title', 'Sketch Pad'],
      ['R', 'intent'], ['R', 'relay'], ['O', 'theme'],
      ['server', 'https://blossom.example/'],
      ['screenshot', `x ${SCREENSHOT}`, 'm image/png', 'dim 1280x720'],
      ...tags,
    ],
  }, KEY) as NostrEvent;
}

const WITH_CONTRACT = [['z', 'sketch'], ['i', 'napplet:sketch/open']];
let component: ReturnType<typeof mount> | null = null;

function render(event: NostrEvent, relays: string[] = []): HTMLElement {
  const embed = parseVerifiedNappletEmbed(event);
  if (!embed) throw new Error('fixture is not a verified app manifest');
  component = mount(NappletEmbed, { target: document.body, props: { embed, relays } });
  flushSync();
  return document.body.querySelector('[data-feed-napplet-embed]')!;
}

async function settle(): Promise<void> {
  for (let index = 0; index < 6; index += 1) { await Promise.resolve(); await tick(); }
}

describe('Feature: an app embedded in a note renders as an app card', () => {
  beforeEach(() => {
    sdk.query.mockReset();
    media.verifiedAppMedia.mockReset();
    actions.invokeFeedIntent.mockReset();
    media.verifiedAppMedia.mockImplementation(async (declaration: { hash: string }) => (
      declaration.hash === SCREENSHOT ? 'blob:author' : declaration.hash === NAPSHOT_HASH ? 'blob:napshot' : null
    ));
    sdk.query.mockImplementation(async () => ({ events: [{ event: napshot.currentLabel }, { event: napshot.previousRevisionLabel }] }));
  });

  afterEach(() => {
    if (component) unmount(component);
    component = null;
    document.body.innerHTML = '';
  });

  describe('Scenario: the author supplied a screenshot', () => {
    it('Given a signed manifest with a screenshot When the card renders Then it shows that screenshot, the name and its capabilities', async () => {
      const card = render(sketchPad(WITH_CONTRACT));
      await settle();

      expect(card.querySelector('[data-feed-napplet-name]')?.textContent).toBe('Sketch Pad');
      expect(card.querySelector('[data-feed-napplet-preview-image="author"]')?.getAttribute('src')).toBe('blob:author');
      expect([...card.querySelectorAll('[data-feed-napplet-required] .domain')].map((node) => node.textContent))
        .toEqual(['Open requests', 'Relays']);
      expect([...card.querySelectorAll('[data-feed-napplet-optional] .domain')].map((node) => node.textContent)).toEqual(['Theme']);
      // Author media wins, so Napshot is never asked.
      expect(sdk.query).not.toHaveBeenCalled();
      expect(media.verifiedAppMedia).toHaveBeenCalledWith(expect.objectContaining({ hash: SCREENSHOT }), { loadBytes: expect.any(Function) });
    });
  });

  describe('Scenario: the author supplied no screenshot', () => {
    it('Given a real manifest without media When the card renders Then it falls back to the trusted Napshot capture for that exact revision', async () => {
      const card = render(napshot.manifest);
      await settle();

      expect(sdk.query).toHaveBeenCalledWith(
        { kinds: [1985], authors: ['94b92a261c88f6b14098e6ec15c93bed544380883745f9a030b27d4a5c554f81'], '#e': [napshot.manifest.id], '#L': ['#screenshot'] },
        { relays: NAPSHOT_RELAYS },
      );
      const image = card.querySelector('[data-feed-napplet-preview-image="napshot"]');
      expect(image?.getAttribute('src')).toBe('blob:napshot');
      expect(image?.getAttribute('alt')).toBe('Automated preview of SeedHammer 3D viewer');
      expect(card.textContent).toContain('Automated preview');
      expect(card.querySelector('[data-feed-napplet-name]')?.textContent).toBe('SeedHammer 3D viewer');
    });

    it('Given no trusted label When the card renders Then it keeps a placeholder instead of an image', async () => {
      sdk.query.mockResolvedValue({ events: [] });
      const card = render(napshot.manifest);
      await settle();
      expect(card.querySelector('img')).toBeNull();
      expect(card.getAttribute('data-feed-napplet-preview')).toBe('none');
    });
  });

  describe('Scenario: opening the app through NAP-INTENT', () => {
    it('Given an app with an open contract When the reader clicks Open app Then the feed invokes its convention with a handler hint', async () => {
      actions.invokeFeedIntent.mockResolvedValue({ accepted: true, result: { ok: true } });
      const card = render(sketchPad(WITH_CONTRACT), ['wss://relay.example/']);
      (card.querySelector('[data-feed-napplet-open]') as HTMLButtonElement).click();
      await settle();

      expect(actions.invokeFeedIntent).toHaveBeenCalledWith({
        archetype: 'sketch', action: 'open', convention: 'napplet:sketch/open',
        handlerHint: { address: `35129:${AUTHOR}:sketch-pad`, relays: ['wss://relay.example/'] },
        behavior: { focus: true },
      });
      expect(card.querySelector('[data-feed-napplet-status]')?.textContent).toBe('Opened in the shell.');
    });

    it.each([
      ['user cancelled', 'declined', 'Not opened.'],
      ['no handler', 'failed', 'No installed app can open this, and it was not installed.'],
      ['intent.invoke timed out', 'pending', 'Still waiting on the shell.'],
    ])('Given the shell answers %s When the open settles Then the card says so', async (error, phase, message) => {
      actions.invokeFeedIntent.mockResolvedValue({ accepted: false, error });
      const card = render(sketchPad(WITH_CONTRACT));
      (card.querySelector('[data-feed-napplet-open]') as HTMLButtonElement).click();
      await settle();
      const status = card.querySelector('[data-feed-napplet-status]');
      expect(status?.getAttribute('data-feed-napplet-status')).toBe(phase);
      expect(status?.textContent).toBe(message);
    });

    it('Given an app without an intent contract When the card renders Then Open app is disabled and says why', () => {
      const card = render(sketchPad());
      const button = card.querySelector('[data-feed-napplet-open]') as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      const reason = card.querySelector('[data-feed-napplet-no-contract]')!;
      expect(button.getAttribute('aria-describedby')).toBe(reason.id);
      expect(reason.textContent).toBe("Can't open from a post: this app doesn't list any requests it accepts. Find it in the App Store instead.");
      button.click();
      expect(actions.invokeFeedIntent).not.toHaveBeenCalled();
    });
  });
});
