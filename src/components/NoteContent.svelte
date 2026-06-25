<script lang="ts">
  // Thin adapter over the shared @hyprgate/napplet-ui note renderer — supplies feed's
  // navigation wiring (open a profile via inter-pane message).
  import { inc as ipc } from '@napplet/sdk';
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
</script>

<NoteContent
  {content}
  {emojiTags}
  {profileLabel}
  onProfileClick={openProfile}
  resourceBatchSize={FEED_RESOURCE_BATCH_SIZE}
  videoTitle="Feed video"
/>
