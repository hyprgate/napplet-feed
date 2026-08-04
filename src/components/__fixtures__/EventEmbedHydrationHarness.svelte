<script lang="ts">
  import { setContext } from 'svelte';
  import type { NostrEvent } from '@hyprgate/types';
  import type { ProfileContent } from '../../lib/profile-metadata';
  import {
    FEED_PROFILE_HYDRATION_CONTEXT,
    type FeedProfileHydrator,
  } from '../../lib/profile-hydration-context';
  import EventEmbed from '../EventEmbed.svelte';

  interface Props {
    event: NostrEvent;
    profiles?: Map<string, ProfileContent>;
    referenceRelays?: string[];
    onHydrate: FeedProfileHydrator;
  }

  let {
    event,
    profiles = new Map<string, ProfileContent>(),
    referenceRelays = [],
    onHydrate,
  }: Props = $props();
  setContext(FEED_PROFILE_HYDRATION_CONTEXT, (events: NostrEvent[]) => onHydrate(events));
</script>

<EventEmbed id={event.id} {event} {profiles} {referenceRelays} />
