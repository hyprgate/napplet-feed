<script lang="ts">
  import type { NostrEvent } from '@hyprgate/types';
  import type { EngagementCounts } from '../lib/feed-store';
  import type { EmojiOption } from '../lib/emoji-sets';
  import type { ProfileContent } from '../../lib/profile-metadata';
  import FeedCards from '../FeedCards.svelte';
  import FeedList from '../FeedList.svelte';
  import FeedTerminal from '../FeedTerminal.svelte';

  const authorPubkey = 'f'.repeat(64);
  const event: NostrEvent = {
    id: 'e'.repeat(64),
    kind: 1,
    pubkey: authorPubkey,
    created_at: 1780531200,
    tags: [],
    content: 'hello from feed',
    sig: 'sig',
  };

  let view = $state<'compact' | 'cards' | 'terminal'>('compact');
  let events = $state<NostrEvent[]>([event]);
  let profiles = $state(new Map<string, ProfileContent>());
  let engagement = $state(new Map<string, EngagementCounts>());
  let reactionOptions = $state<EmojiOption[]>([]);

  export function setView(nextView: 'compact' | 'cards' | 'terminal'): void {
    view = nextView;
  }

  export function hydrate(profile: ProfileContent): void {
    profiles = new Map(profiles).set(authorPubkey, profile);
  }

  export function hydratePubkey(pubkey: string, profile: ProfileContent): void {
    profiles = new Map(profiles).set(pubkey, profile);
  }

  export function setEvents(nextEvents: NostrEvent[]): void {
    events = nextEvents;
  }
</script>

{#if view === 'compact'}
  <FeedList {events} {profiles} {engagement} {reactionOptions} loading={false} canLoadMore={false} />
{:else if view === 'cards'}
  <FeedCards {events} {profiles} {engagement} {reactionOptions} loading={false} canLoadMore={false} />
{:else}
  <FeedTerminal {events} {profiles} {engagement} loading={false} canLoadMore={false} />
{/if}
