<script lang="ts">
  // Thin adapter over the shared @hyprgate/napplet-ui note renderer — supplies feed's
  // navigation wiring (open a profile via inter-pane message).
  import { inc as ipc } from '@napplet/sdk';
  import { isCanonicalHexPubkey } from '@hyprgate/utils';
  import NoteContent from '@hyprgate/napplet-ui/NoteContent.svelte';

  interface Props {
    content: string;
    profileLabel?: (pubkey: string) => string;
  }

  let { content, profileLabel }: Props = $props();

  function openProfile(pubkey: string): void {
    if (!isCanonicalHexPubkey(pubkey)) return;
    ipc.emit('profile:open', [], JSON.stringify({ pubkey }));
  }
</script>

<NoteContent {content} {profileLabel} onProfileClick={openProfile} videoTitle="Feed video" />
