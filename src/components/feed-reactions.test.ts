import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import { intent, outbox, relay } from '@napplet/sdk';
import type { NostrEvent } from '@hyprgate/types';
import FeedProfileHydrationHarness from './__fixtures__/FeedProfileHydrationHarness.svelte';
import EventEmbed from './EventEmbed.svelte';
import FeedEventContent from './FeedEventContent.svelte';

vi.mock('@napplet/sdk', () => ({
  intentInvoke: (...args: Parameters<typeof intent.invoke>) => intent.invoke(...args),
  intent: { invoke: vi.fn(async (uri: string) => ({ ok: true, archetype: uri.slice(8).split('/')[0], action: uri.split('/')[1], convention: uri, handler: 'test-handler' })) },
  outbox: { getEvent: vi.fn(), query: vi.fn() },
  relay: { subscribe: vi.fn(() => ({ close: vi.fn() })) },
}));

const TARGET: NostrEvent = {
  id: 'e'.repeat(64), pubkey: 'a'.repeat(64), kind: 1,
  created_at: 1782063307, content: 'The reacted note', tags: [], sig: 's',
};
const REACTION: NostrEvent = {
  ...TARGET, id: '7'.repeat(64), pubkey: 'b'.repeat(64), kind: 7, content: '+',
  tags: [['e', TARGET.id, 'wss://target.example', TARGET.pubkey], ['k', '1']],
};
const mounted: ReturnType<typeof mount>[] = [];
function render(event: NostrEvent, extra: Record<string, unknown> = {}) {
  const component = mount(FeedEventContent, {
    target: document.body,
    props: { event, profiles: new Map(), profileLabel: (pk: string) => pk, reactionOptions: [], ...extra },
  });
  mounted.push(component);
  return component;
}

describe('Feed reaction presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(outbox.getEvent).mockResolvedValue({ result: { event: TARGET, sidecar: { relayHints: ['wss://observed.example'] } } } as never);
  });
  afterEach(async () => {
    for (const component of mounted.splice(0)) await unmount(component);
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it.each([['', 'Liked'], ['+', 'Liked'], ['-', 'Disliked'], ['🔥', '🔥']])('renders reaction %j above the target and omits note actions', async (content, expected) => {
    render({ ...REACTION, content });
    await vi.waitFor(() => expect(document.body.textContent).toContain('The reacted note'));
    expect(document.querySelector('[data-feed-reaction-value]')?.textContent).toContain(expected);
    expect(document.body.textContent).not.toContain('cannot render this event');
    expect(document.querySelector('.note-actions')).toBeNull();
    expect(document.querySelector('[data-feed-reaction-value]')!.compareDocumentPosition(document.querySelector('.event-embed')!))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(outbox.getEvent).toHaveBeenCalledWith(TARGET.id, { author: TARGET.pubkey, relays: ['wss://target.example'] });
  });

  it('renders accessible custom emoji and falls back to a literal shortcode on image failure', async () => {
    render({ ...REACTION, content: ':party:', tags: [...REACTION.tags, ['emoji', 'party', 'https://example.test/party.gif']] });
    await tick();
    const image = document.querySelector<HTMLImageElement>('[data-feed-reaction-value] img');
    expect(image?.alt).toBe(':party:');
    image?.dispatchEvent(new Event('error'));
    await tick();
    expect(document.querySelector('[data-feed-reaction-value] img')).toBeNull();
    expect(document.querySelector('[data-feed-reaction-value]')?.textContent).toContain(':party:');
  });

  it.each([{ tags: [] }, { tags: [['emoji', 'party', 'javascript:alert(1)']] }])('uses safe text when no valid custom emoji image exists', async ({ tags }) => {
    render({ ...REACTION, content: ':party:', tags: [...REACTION.tags, ...tags] });
    await tick();
    expect(document.querySelector('[data-feed-reaction-value] img')).toBeNull();
    expect(document.querySelector('[data-feed-reaction-value]')?.textContent).toContain(':party:');
  });

  it.each(['compact', 'cards', 'terminal'] as const)('preserves the reacting author, hydrated and fallback profile clicks, and target navigation in %s', async (view) => {
    const component = mount(FeedProfileHydrationHarness, { target: document.body }) as {
      setView(value: typeof view): void;
      setEvents(events: NostrEvent[]): void;
      hydratePubkey(pubkey: string, profile: { displayName: string; picture: string }): void;
    };
    mounted.push(component);
    component.setView(view);
    component.setEvents([REACTION]);
    await tick();
    let author = document.querySelector<HTMLButtonElement>('[data-feed-author-pubkey]');
    expect(author?.getAttribute('data-feed-author-label')).toMatch(/^npub1/);
    expect(author?.getAttribute('title')).toMatch(/^npub1/);
    author?.click();
    await tick();
    expect(intent.invoke).toHaveBeenLastCalledWith('napplet:profile/open', { payload: { pubkey: REACTION.pubkey } });

    component.hydratePubkey(REACTION.pubkey, { displayName: 'The reactor', picture: 'https://example.test/reactor.png' });
    await tick();
    author = document.querySelector<HTMLButtonElement>('[data-feed-author-pubkey]');
    expect(author?.getAttribute('data-feed-author-label')).toBe('The reactor');
    expect(author?.getAttribute('data-feed-author-pubkey')).toBe(REACTION.pubkey);
    if (view !== 'terminal') {
      expect(author?.closest('[data-feed-event-id]')?.querySelector('button[aria-label^="Open profile"] img')).not.toBeNull();
    }
    author?.click();
    await tick();
    expect(intent.invoke).toHaveBeenLastCalledWith('napplet:profile/open', { payload: { pubkey: REACTION.pubkey } });
    expect(document.querySelector('.note-actions')).toBeNull();
    expect(document.querySelector('[aria-label="Engagement counts"]')).toBeNull();

    const selector = '.embed-header';
    await vi.waitFor(() => expect(document.body.textContent).toContain(TARGET.content));
    document.querySelector<HTMLButtonElement>(selector)?.click();
    await tick();
    expect(intent.invoke).toHaveBeenLastCalledWith('napplet:note/open', expect.objectContaining({ behavior: { focus: true },
      payload: expect.objectContaining({
        target: expect.objectContaining({ id: TARGET.id, kind: 1, pubkey: TARGET.pubkey }),
        relays: ['wss://target.example', 'wss://observed.example'],
      }),
    }));
    expect(document.body.textContent).not.toContain('cannot render this event');
  });

  it('keeps terminal reaction text concise above the rendered target', async () => {
    const component = mount(FeedProfileHydrationHarness, { target: document.body }) as {
      setView(value: 'terminal'): void;
      setEvents(events: NostrEvent[]): void;
    };
    mounted.push(component);
    component.setView('terminal');
    component.setEvents([{ ...REACTION, content: 'long reaction '.repeat(100) }]);
    await tick();
    expect(document.querySelector('[data-feed-reaction-value]')?.textContent?.length).toBeLessThan(220);
    await vi.waitFor(() => expect(document.querySelector('.event-embed')?.textContent).toContain(TARGET.content));
    expect(document.querySelector('[data-feed-reaction-value]')!.compareDocumentPosition(document.querySelector('.event-embed')!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it.each([{ tags: [] }, { tags: [['e', 'bad-id']] }])('does not query a missing or malformed reaction target', async ({ tags }) => {
    render({ ...REACTION, tags });
    await tick();
    expect(document.body.textContent).toContain('Reaction target unavailable');
    expect(outbox.getEvent).not.toHaveBeenCalled();
    expect(relay.subscribe).not.toHaveBeenCalled();
  });

  it.each([
    [{}, 'not-found'], [{ incomplete: true }, 'error'], [{ error: 'offline' }, 'error'],
  ])('settles a failed target lookup %j without a live subscription', async (result, state) => {
    vi.mocked(outbox.getEvent).mockResolvedValue(result as never);
    render(REACTION);
    await vi.waitFor(() => expect(document.querySelector(`[data-feed-embed-state="${state}"]`)).not.toBeNull());
    document.querySelector<HTMLButtonElement>('.embed-header')?.click();
    await tick();
    expect(intent.invoke).toHaveBeenLastCalledWith('napplet:note/open', expect.objectContaining({ payload: expect.objectContaining({
      target: expect.objectContaining({ type: 'event', id: TARGET.id, pubkey: TARGET.pubkey, kind: 1 }), relays: ['wss://target.example'],
    }) }));
    expect(outbox.getEvent).toHaveBeenCalledTimes(1);
    expect(relay.subscribe).not.toHaveBeenCalled();
  });

  it('handles a rejected relay lookup without an unhandled error or retry', async () => {
    vi.mocked(outbox.getEvent).mockRejectedValue(new Error('relay failed'));
    render(REACTION);
    await vi.waitFor(() => expect(document.querySelector('[data-feed-embed-state="error"]')).not.toBeNull());
    expect(outbox.getEvent).toHaveBeenCalledTimes(1);
  });

  it('stops a reaction-to-reaction chain at the existing inline depth limit', async () => {
    vi.mocked(outbox.getEvent).mockResolvedValue({ result: { event: REACTION } } as never);
    render(REACTION);
    await vi.waitFor(() => expect(document.querySelector('[data-feed-inline-depth-limit]')).not.toBeNull());
    expect(outbox.getEvent).toHaveBeenCalledTimes(2);
    expect(relay.subscribe).not.toHaveBeenCalled();
  });

  it('does not begin retrieval when already at the depth limit', async () => {
    render(REACTION, { depth: 2 });
    await tick();
    expect(document.querySelector('[data-feed-inline-depth-limit]')).not.toBeNull();
    expect(outbox.getEvent).not.toHaveBeenCalled();
  });

  it('bounds repost chains inside reaction targets too', async () => {
    const repost = { ...TARGET, kind: 6, content: '', tags: [['e', TARGET.id]] };
    vi.mocked(outbox.getEvent)
      .mockReset()
      .mockResolvedValueOnce({ result: { event: repost } } as never)
      .mockResolvedValueOnce({ result: { event: repost } } as never)
      .mockRejectedValue(new Error('unexpected lookup beyond the depth limit'));
    render(REACTION);
    await vi.waitFor(() => expect(document.querySelector('[data-feed-inline-depth-limit]')).not.toBeNull());
    expect(outbox.getEvent).toHaveBeenCalledTimes(2);
  });


  const article: NostrEvent = { ...TARGET, kind: 30023, content: 'A detailed article body', tags: [
    ['d', 'garden:2026'], ['title', 'A garden guide'], ['summary', 'A seasonal introduction'],
  ] };
  const articleReaction = { ...REACTION, tags: [
    ['e', article.id, 'wss://target.example', article.pubkey], ['k', '30023'],
    ['a', `30023:${article.pubkey}:garden:2026`, 'wss://address.example'],
  ] };

  it.each(['compact', 'cards', 'terminal'] as const)('renders addressable title, summary, body, and naddr navigation in %s', async (view) => {
    vi.mocked(outbox.getEvent).mockResolvedValue({ result: { event: article } } as never);
    const component = mount(FeedProfileHydrationHarness, { target: document.body }) as {
      setView(value: typeof view): void;
      setEvents(events: NostrEvent[]): void;
      hydratePubkey(pubkey: string, profile: { displayName: string; picture: string }): void;
    };
    mounted.push(component);
    component.setView(view);
    component.setEvents([articleReaction]);
    component.hydratePubkey(article.pubkey, { displayName: 'The gardener', picture: 'https://example.test/garden.png' });
    await vi.waitFor(() => expect(document.querySelector('[data-feed-embed-title]')?.textContent).toBe('A garden guide'));
    expect(document.querySelector('[data-feed-embed-summary]')?.textContent).toBe('A seasonal introduction');
    expect(document.querySelector('.event-embed')?.textContent).toContain(article.content);
    expect(document.querySelector('[data-feed-embed-author-label]')?.getAttribute('data-feed-embed-author-label')).toBe('The gardener');
    document.querySelector<HTMLButtonElement>('.embed-header')?.click();
    await tick();
    const [uri, request] = vi.mocked(intent.invoke).mock.calls.at(-1)!;
    expect(uri).toBe('napplet:note/open');
    expect(request).toMatchObject({ payload: { target: {
      type: 'address', kind: 30023, pubkey: article.pubkey, identifier: 'garden:2026', nip19: expect.stringMatching(/^naddr1/),
    } } });
    expect(outbox.query).not.toHaveBeenCalled();
  });

  it('falls back once to the matching address when the exact reacted revision is unavailable', async () => {
    vi.mocked(outbox.getEvent).mockResolvedValue({} as never);
    vi.mocked(outbox.query).mockResolvedValue({ events: [
      { event: { ...article, pubkey: 'c'.repeat(64), created_at: 9999999999 } },
      { event: { ...article, content: 'Older revision', created_at: 1 } },
      { event: article, sidecar: { relayHints: ['wss://observed.example'] } },
    ] } as never);
    render(articleReaction);
    await vi.waitFor(() => expect(document.body.textContent).toContain(article.content));
    expect(document.body.textContent).not.toContain('Older revision');
    expect(outbox.getEvent).toHaveBeenCalledTimes(1);
    expect(outbox.query).toHaveBeenCalledExactlyOnceWith({
      kinds: [30023], authors: [article.pubkey], '#d': ['garden:2026'], limit: 1,
    }, { relays: ['wss://target.example', 'wss://address.example'], timeoutMs: 5000 });
    expect(relay.subscribe).not.toHaveBeenCalled();
  });

  it.each([{ events: [] }, { events: [], incomplete: true }, { events: [], error: 'offline' }])('settles unavailable address context and keeps naddr navigation: %j', async (result) => {
    vi.mocked(outbox.getEvent).mockResolvedValue({} as never);
    vi.mocked(outbox.query).mockResolvedValue(result as never);
    render(articleReaction);
    const state = 'error' in result || 'incomplete' in result ? 'error' : 'not-found';
    await vi.waitFor(() => expect(document.querySelector(`[data-feed-embed-state="${state}"]`)).not.toBeNull());
    document.querySelector<HTMLButtonElement>('.embed-header')?.click();
    await tick();
    expect(intent.invoke).toHaveBeenLastCalledWith('napplet:note/open', expect.objectContaining({ payload: expect.objectContaining({
      target: expect.objectContaining({ type: 'address', identifier: 'garden:2026' }),
    }) }));
    expect(outbox.query).toHaveBeenCalledTimes(1);
  });

  it('uses metadata without exposing raw JSON for structured addressable events', async () => {
    vi.mocked(outbox.getEvent).mockResolvedValue({ result: { event: {
      ...article, kind: 35129, content: '{"files":[{"secret":"raw manifest"}]}',
      tags: [['d', 'manifest'], ['name', 'Garden app'], ['summary', 'A planting calendar']],
    } } } as never);
    render(articleReaction);
    await vi.waitFor(() => expect(document.body.textContent).toContain('Garden app'));
    expect(document.body.textContent).toContain('A planting calendar');
    expect(document.body.textContent).not.toContain('raw manifest');
    expect(document.body.textContent).not.toContain('"files"');
  });

  it('does not redirect an exact event to mismatched address coordinates', async () => {
    vi.mocked(outbox.getEvent).mockResolvedValue({ result: { event: TARGET } } as never);
    render(articleReaction);
    await vi.waitFor(() => expect(document.body.textContent).toContain(TARGET.content));
    document.querySelector<HTMLButtonElement>('.embed-header')?.click();
    await tick();
    expect(intent.invoke).toHaveBeenLastCalledWith('napplet:note/open', expect.objectContaining({ payload: expect.objectContaining({
      target: expect.objectContaining({ type: 'event', id: TARGET.id }),
    }) }));
  });

  it('ignores address fallback results arriving after unmount', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(outbox.getEvent).mockResolvedValue({} as never);
    vi.mocked(outbox.query).mockReturnValue(new Promise((done) => { resolve = done; }) as never);
    const component = render(articleReaction);
    await vi.waitFor(() => expect(outbox.query).toHaveBeenCalledTimes(1));
    await unmount(component);
    mounted.splice(mounted.indexOf(component), 1);
    resolve({ events: [{ event: article }] });
    await tick();
    expect(document.body.textContent).toBe('');
    expect(outbox.query).toHaveBeenCalledTimes(1);
    expect(relay.subscribe).not.toHaveBeenCalled();
  });

  it('ignores a late response after unmount', async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(outbox.getEvent).mockReturnValue(new Promise((done) => { resolve = done; }) as never);
    const component = mount(EventEmbed, { target: document.body, props: { id: TARGET.id } });
    await tick();
    await unmount(component);
    resolve({ result: { event: TARGET } });
    await tick();
    expect(document.body.textContent).toBe('');
    expect(outbox.getEvent).toHaveBeenCalledTimes(1);
    expect(relay.subscribe).not.toHaveBeenCalled();
  });
});
