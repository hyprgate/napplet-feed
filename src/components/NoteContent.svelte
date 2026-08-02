<script lang="ts">
  // Thin adapter over the shared @hyprgate/napplet-ui note renderer — supplies feed's
  // navigation wiring (open canonical shell intent requests).
  import { link } from '@napplet/sdk';
  import { isCanonicalHexPubkey } from '@hyprgate/utils';
  import NoteContent from '@hyprgate/napplet-ui/NoteContent.svelte';
  import {
    createFeedNoteIntentRequestFromPayload,
    createFeedProfileIntentRequest,
    createFeedReferenceOpenPayload,
    invokeFeedIntent,
  } from '../lib/feed-actions';

  interface Props {
    content: string;
    emojiTags?: string[][];
    profileLabel?: (pubkey: string) => string;
    loadResources?: boolean;
  }

  let { content, emojiTags = [], profileLabel, loadResources = true }: Props = $props();
  const FEED_RESOURCE_BATCH_SIZE = 10;

  async function openProfile(pubkey: string): Promise<void> {
    if (!isCanonicalHexPubkey(pubkey)) return;
    const request = createFeedProfileIntentRequest(pubkey);
    if (request) await invokeFeedIntent(request);
  }

  // NAP-LINK: route external links through the shell-owned opener so the new
  // browsing context does not inherit this napplet's origin.
  async function openLink(url: string): Promise<boolean> {
    const result = await link.open(url);
    return result.status === 'opened';
  }

  async function openReference(source: string): Promise<void> {
    const payload = createFeedReferenceOpenPayload(source);
    const request = payload ? createFeedNoteIntentRequestFromPayload(payload) : null;
    if (request) await invokeFeedIntent(request);
  }
</script>

<NoteContent
  {content}
  {emojiTags}
  {profileLabel}
  onProfileClick={openProfile}
  onReferenceClick={openReference}
  onOpenLink={openLink}
  resourceBatchSize={FEED_RESOURCE_BATCH_SIZE}
  {loadResources}
  videoTitle="Feed video"
/>
