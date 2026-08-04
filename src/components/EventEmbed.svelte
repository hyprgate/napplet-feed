<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { format } from 'timeago.js';
  import * as nip19 from 'nostr-tools/nip19';
  import type { NostrEvent } from '@hyprgate/types';
  import { KIND_REPOST } from '@hyprgate/types';
  import { outbox } from '@napplet/sdk';
  import { createNoteViewerOpenPayload, pubkeyColorStyle, resourceImageBatch as resourceImage } from '@hyprgate/utils';
  import { isFeedRenderableEvent, isInlineDepthExhausted, MAX_INLINE_EVENT_DEPTH } from '../lib/rendering-fallbacks';
  import {
    createFeedNoteIntentRequestFromPayload,
    createFeedNoteOpenPayload,
    createFeedProfileIntentRequest,
    createFeedReferenceOpenPayload,
    invokeFeedIntent,
  } from '../lib/feed-actions';
  import { normalizeRelayHints, relayHintsForEvent, rememberEventRelayHints } from '../lib/event-relay-hints';
  import {
    FEED_PROFILE_HYDRATION_CONTEXT,
    type FeedProfileHydrator,
  } from '../lib/profile-hydration-context';
  import ExpandableNoteContent from './ExpandableNoteContent.svelte';
  import FeedEmbeds from './FeedEmbeds.svelte';
  import RepostContent from './RepostContent.svelte';
  import UnsupportedEventFallback from './UnsupportedEventFallback.svelte';
  import type { ProfileContent } from '../lib/profile-metadata';

  interface Props {
    id: string;
    event?: NostrEvent | null;
    label?: string;
    profiles?: Map<string, ProfileContent>;
    profileLabel?: (pubkey: string) => string;
    depth?: number;
    maxDepth?: number;
    loadResources?: boolean;
    referenceSource?: string;
    referenceAuthor?: string;
    referenceKind?: number;
    referenceRelays?: string[];
  }

  function npubFor(pubkey: string): string {
    try {
      return nip19.npubEncode(pubkey);
    } catch {
      return pubkey;
    }
  }

  function shortIdentity(pubkey: string): string {
    const identity = npubFor(pubkey);
    return identity.length > 16 ? `${identity.slice(0, 16)}...` : identity;
  }

  let {
    id,
    event: providedEvent = null,
    label = 'quoted note',
    profiles = new Map<string, ProfileContent>(),
    profileLabel = shortIdentity,
    depth = 0,
    maxDepth = MAX_INLINE_EVENT_DEPTH,
    loadResources = true,
    referenceSource,
    referenceAuthor,
    referenceKind,
    referenceRelays = [],
  }: Props = $props();
  const hydrateProfiles = getContext<FeedProfileHydrator | undefined>(FEED_PROFILE_HYDRATION_CONTEXT);
  let fetchedEvent = $state<NostrEvent | null>(null);
  let fetchedRelayHints = $state<string[]>([]);
  let fetchStatus = $state<'loading' | 'ready' | 'empty' | 'error'>('loading');
  let event = $derived(providedEvent ?? fetchedEvent);
  let status = $derived(providedEvent ? 'ready' : fetchStatus);
  let canRenderNestedEvents = $derived(!isInlineDepthExhausted(depth, maxDepth));
  let profile = $derived(event ? profiles.get(event.pubkey) : undefined);
  let displayName = $derived(event
    ? profile?.display_name
      ?? profile?.displayName
      ?? profile?.name
      ?? profile?.nip05
      ?? profileLabel(event.pubkey)
    : '');
  let relayHints = $derived(normalizeRelayHints([
    ...referenceRelays,
    ...fetchedRelayHints,
    ...(event ? relayHintsForEvent(event) : []),
  ]));
  let canonicalIdentity = $derived(event ? npubFor(event.pubkey) : '');

  function openPayload() {
    const referencePayload = referenceSource ? createFeedReferenceOpenPayload(referenceSource) : null;
    if (event) {
      const payload = createFeedNoteOpenPayload(event, relayHints);
      if (!payload || !referencePayload || referencePayload.target.type !== 'event') return payload;
      return {
        ...payload,
        target: {
          ...payload.target,
          nip19: referencePayload.target.nip19 ?? payload.target.nip19,
        },
        ...(relayHints.length > 0 ? { relays: relayHints } : {}),
      };
    }
    if (referencePayload && referencePayload.target.type === 'event') {
      return {
        ...referencePayload,
        target: {
          ...referencePayload.target,
          ...(referenceAuthor && !referencePayload.target.pubkey ? { pubkey: referenceAuthor } : {}),
        },
        ...(relayHints.length > 0 ? { relays: relayHints } : {}),
      };
    }
    return createNoteViewerOpenPayload({
      target: {
        type: 'event',
        id,
        ...(typeof referenceKind === 'number' ? { kind: referenceKind } : {}),
        ...(referenceAuthor ? { pubkey: referenceAuthor } : {}),
      },
      ...(relayHints.length > 0 ? { relays: relayHints } : {}),
      behavior: { focus: true },
      source: { napplet: 'feed' },
    });
  }

  async function openNote(): Promise<void> {
    const payload = openPayload();
    const request = payload ? createFeedNoteIntentRequestFromPayload(payload) : null;
    if (request) await invokeFeedIntent(request);
  }

  async function openProfile(): Promise<void> {
    if (!event) return;
    const request = createFeedProfileIntentRequest(event.pubkey);
    if (request) await invokeFeedIntent(request);
  }

  onMount(() => {
    if (providedEvent) {
      hydrateProfiles?.([providedEvent]);
      return;
    }
    let disposed = false;
    void (async () => {
      try {
        const result = await outbox.getEvent(id, {
          ...(referenceAuthor ? { author: referenceAuthor } : {}),
          ...(relayHints.length > 0 ? { relays: relayHints } : {}),
        });
        if (disposed) return;
        if (result.result?.event) {
          const resolvedEvent = result.result.event as NostrEvent;
          fetchedRelayHints = normalizeRelayHints(result.result.sidecar?.relayHints);
          rememberEventRelayHints(resolvedEvent, fetchedRelayHints);
          hydrateProfiles?.([resolvedEvent]);
          fetchedEvent = resolvedEvent;
          fetchStatus = 'ready';
        } else {
          fetchStatus = result.error || result.incomplete ? 'error' : 'empty';
        }
      } catch {
        if (!disposed) fetchStatus = 'error';
      }
    })();
    return () => { disposed = true; };
  });
</script>

<article class="event-embed" data-feed-event-embed-depth={depth}>
  <button type="button" class="embed-header" onclick={openNote}>
    <span class="label">{label}</span>
  </button>
  {#if status === 'loading'}
    <span class="body muted" data-feed-embed-state="loading">Loading note...</span>
  {:else if status === 'error'}
    <span class="body muted" data-feed-embed-state="error">Could not load note.</span>
  {:else if event}
    <div class="embed-body">
      <button
        type="button"
        class="embed-author"
        onclick={openProfile}
        data-feed-embed-author-pubkey={event.pubkey}
        data-feed-embed-author-label={displayName}
      >
        <span class="avatar">
          <span>{displayName.slice(0, 2).toUpperCase()}</span>
          {#if profile?.picture}
            <img use:resourceImage={loadResources ? profile.picture : null} alt="" loading="lazy" />
          {/if}
        </span>
        <span class="author-details">
          <span class="author-name" style={pubkeyColorStyle(event.pubkey)}>{displayName}</span>
          <span class="timestamp" data-feed-embed-timestamp>{format(event.created_at * 1000)}</span>
        </span>
      </button>
      {#if event.kind === KIND_REPOST}
        <RepostContent {event} {profiles} {profileLabel} {depth} {maxDepth} {loadResources} />
      {:else if isFeedRenderableEvent(event)}
        <ExpandableNoteContent content={event.content} emojiTags={event.tags} {profileLabel} {loadResources} />
        {#if canRenderNestedEvents}
          <FeedEmbeds
            {event}
            {profiles}
            {profileLabel}
            {depth}
            {maxDepth}
            {loadResources}
            inheritedRelays={relayHints}
          />
        {:else}
          <div class="depth-limit" data-feed-inline-depth-limit>Nested note limit reached.</div>
        {/if}
      {:else}
        <UnsupportedEventFallback {event} />
      {/if}
    </div>
    <span class="meta" style={pubkeyColorStyle(event.pubkey)} title={canonicalIdentity}>{shortIdentity(event.pubkey)}</span>
  {:else}
    <span class="body muted" data-feed-embed-state="not-found">Note not found.</span>
  {/if}
</article>

<style>
  .event-embed {
    display: grid;
    gap: 4px;
    width: 100%;
    max-width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--hg-border, #303030);
    border-left: 3px solid var(--hg-accent-cyan, #82d8f7);
    border-radius: 6px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-primary, #f2efe7);
    text-align: left;
  }

  .event-embed:hover,
  .embed-header:hover {
    border-color: var(--hg-accent-cyan, #82d8f7);
  }

  .embed-header {
    display: flex;
    width: max-content;
    max-width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .embed-author {
    display: flex;
    align-items: center;
    gap: 7px;
    width: max-content;
    max-width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .avatar {
    position: relative;
    display: inline-grid;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    place-items: center;
    overflow: hidden;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 50%;
    background: var(--hg-bg-base, #050505);
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 9px;
  }

  .avatar > span,
  .avatar > img {
    grid-area: 1 / 1;
  }

  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .author-details {
    display: grid;
    min-width: 0;
  }

  .author-name,
  .timestamp {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .author-name {
    font-size: 12px;
    font-weight: 600;
  }

  .timestamp {
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 10px;
  }

  .embed-body {
    display: grid;
    gap: 6px;
  }

  .label,
  .meta,
  .muted {
    color: var(--hg-text-muted, #b8b1a4);
  }

  .label {
    font-size: 10px;
    text-transform: uppercase;
  }

  .body {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    font-size: 12px;
    line-height: 1.4;
  }

  .meta {
    font-size: 10px;
  }

  .depth-limit {
    padding: 8px;
    border: 1px dashed var(--hg-border, #303030);
    border-radius: 6px;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 11px;
  }
</style>
