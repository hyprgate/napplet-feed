<script lang="ts">
  // Thin adapter over the shared @hyprgate/napplet-ui note renderer — supplies feed's
  // navigation wiring (open a profile via inter-pane message).
  import { inc as ipc, link } from '@napplet/sdk';
  import { isCanonicalHexPubkey } from '@hyprgate/utils';
  import NoteContent from '@hyprgate/napplet-ui/NoteContent.svelte';

  interface Props {
    content: string;
    emojiTags?: string[][];
    profileLabel?: (pubkey: string) => string;
  }

  let { content, emojiTags = [], profileLabel }: Props = $props();
  const FEED_RESOURCE_BATCH_SIZE = 10;

  function openProfile(pubkey: string): void {
    if (!isCanonicalHexPubkey(pubkey)) return;
    ipc.emit('profile:open', [], JSON.stringify({ pubkey }));
  }

  // NAP-LINK: route external links through the shell-owned opener so the new
  // browsing context does not inherit this napplet's origin.
  async function openLink(url: string): Promise<boolean> {
    const result = await link.open(url);
    return result.status === 'opened';
  }
</script>

<NoteContent
  {content}
  {emojiTags}
  {profileLabel}
  onProfileClick={openProfile}
  onOpenLink={openLink}
  resourceBatchSize={FEED_RESOURCE_BATCH_SIZE}
  videoTitle="Feed video"
/>
