<script lang="ts">
  import { onMount } from 'svelte';
  import { inc as ipc } from '@napplet/sdk';
  import { pubkeyColorStyle, resourceImage } from '@hyprgate/utils';
  import { nip19 } from 'nostr-tools';
  import { subscribeProfileMetadata } from '../lib/profile-metadata';

  interface Props {
    pubkey: string;
  }

  interface ProfileContent {
    name?: string;
    display_name?: string;
    picture?: string;
  }

  let { pubkey }: Props = $props();
  let profile = $state<ProfileContent | null>(null);
  let status = $state<'loading' | 'ready' | 'empty' | 'error'>('loading');

  function openProfile(): void {
    ipc.emit('profile:open', [], JSON.stringify({ pubkey }));
  }

  function shortNpub(): string {
    try {
      return `${nip19.npubEncode(pubkey).slice(0, 16)}...`;
    } catch {
      return `${pubkey.slice(0, 12)}...`;
    }
  }

  let displayName = $derived(profile?.display_name ?? profile?.name ?? shortNpub());
  let fallback = $derived((profile?.display_name ?? profile?.name ?? pubkey).slice(0, 2).toUpperCase());

  onMount(() => {
    let sawProfile = false;
    try {
      const subscription = subscribeProfileMetadata(
        [pubkey],
        (_profilePubkey, next) => {
          profile = next;
          sawProfile = true;
          status = 'ready';
        },
        () => {
          if (!sawProfile) status = 'empty';
        },
      );
      return () => subscription.close();
    } catch {
      status = 'error';
    }
  });
</script>

<button type="button" class="profile-embed" onclick={openProfile}>
  <span class="avatar">
    {#if profile?.picture}
      <img use:resourceImage={profile.picture} alt="" loading="lazy" />
    {:else}
      <span>{fallback}</span>
    {/if}
  </span>
  <span class="body">
    <span class="label">profile</span>
    <span class="name" style={pubkeyColorStyle(pubkey)}>{status === 'loading' ? 'Loading profile...' : displayName}</span>
  </span>
</button>

<style>
  .profile-embed {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 6px;
    background: var(--hg-surface, #101010);
    color: var(--hg-text-primary, #f2efe7);
    cursor: pointer;
    text-align: left;
  }

  .profile-embed:hover {
    border-color: var(--hg-accent-cyan, #82d8f7);
  }

  .avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: var(--hg-bg-base, #050505);
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 11px;
  }

  .avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .body {
    display: grid;
    min-width: 0;
  }

  .label {
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 10px;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
  }
</style>
