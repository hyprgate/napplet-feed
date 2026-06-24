<script lang="ts">
  import { requestRuntimePlayback, resourceImageBatch as resourceImage, resolveExternalVideoEmbed, shouldInterceptLinkClick } from '@hyprgate/utils';
  import { link } from '@napplet/sdk';

  interface Props {
    source: string;
    mediaType?: 'image' | 'video';
  }

  let { source, mediaType = 'image' }: Props = $props();
  let pending = $state(false);
  let error = $state<string | null>(null);
  const externalVideo = $derived(mediaType === 'video' ? resolveExternalVideoEmbed(source) : null);

  // NAP-LINK: open the external provider page via the shell-owned opener so the
  // new browsing context does not inherit this napplet's origin.
  async function openProviderLink(event: MouseEvent): Promise<void> {
    if (!shouldInterceptLinkClick(event)) return;
    event.preventDefault();
    const result = await link.open(source);
    if (result.status !== 'opened') {
      window.open(source, '_blank', 'noopener,noreferrer');
    }
  }

  async function playVideo(): Promise<void> {
    if (pending) return;
    pending = true;
    error = null;
    try {
      await requestRuntimePlayback({
        url: source,
        kind: source.toLowerCase().includes('.m3u8') ? 'hls' : 'video',
        title: 'Feed video',
        capabilities: ['play', 'pause', 'stop', 'seek', 'setVolume', 'setMuted'],
        autoplay: true,
        live: false,
      });
    } catch (err) {
      error = err instanceof Error ? err.message : 'runtime playback failed';
    } finally {
      pending = false;
    }
  }
</script>

<div class="resource-embed">
  {#if mediaType === 'image'}
    <img use:resourceImage={source} alt="embedded resource" loading="lazy" />
  {:else if externalVideo}
    <a class="provider-card" href={source} target="_blank" rel="noopener noreferrer" onclick={(e) => void openProviderLink(e)}>
      <span class="provider-art" class:empty={!externalVideo.thumbnailUrl}>
        {#if externalVideo.thumbnailUrl}
          <img use:resourceImage={externalVideo.thumbnailUrl} alt="" loading="lazy" />
        {:else}
          <span>{externalVideo.provider.slice(0, 1).toUpperCase()}</span>
        {/if}
      </span>
      <span class="provider-copy">
        <span class="provider-name">{externalVideo.provider} video</span>
        <span class="source">{source}</span>
      </span>
    </a>
  {:else}
    <button
      type="button"
      class="video-placeholder"
      onclick={playVideo}
      disabled={pending}
      aria-label="Play video in runtime player"
    >
      <span>Video resource</span>
      <span class="source">{source}</span>
      {#if error}
        <span class="error">{error}</span>
      {/if}
    </button>
  {/if}
</div>

<style>
  .resource-embed {
    max-width: 100%;
    overflow: hidden;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 6px;
    background: var(--hg-surface, #101010);
  }

  img {
    display: block;
    max-width: 100%;
    max-height: 280px;
    object-fit: contain;
  }

  .provider-card {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr);
    gap: 10px;
    align-items: center;
    padding: 8px;
    color: var(--hg-text-primary, #f2efe7);
    text-decoration: none;
  }

  .provider-card:hover {
    background: color-mix(in srgb, var(--hg-accent-primary, #5d5dff) 12%, transparent);
  }

  .provider-art {
    display: grid;
    aspect-ratio: 16 / 9;
    place-items: center;
    overflow: hidden;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    background: var(--hg-bg-base, #050505);
    color: var(--hg-accent-cyan, #82d8f7);
    font-size: 16px;
    font-weight: 700;
  }

  .provider-art img {
    width: 100%;
    height: 100%;
    max-height: none;
    object-fit: cover;
  }

  .provider-copy {
    display: grid;
    min-width: 0;
    gap: 3px;
  }

  .provider-name {
    color: var(--hg-text-primary, #f2efe7);
    font-size: 12px;
    text-transform: capitalize;
  }

  .provider-card:hover .provider-name {
    color: var(--hg-accent-cyan, #82d8f7);
  }

  .provider-card .source {
    font-size: 11px;
  }

  .video-placeholder {
    display: grid;
    gap: 4px;
    width: 100%;
    padding: 10px;
    color: var(--hg-text-primary, #f2efe7);
    text-align: left;
    font: inherit;
    font-size: 12px;
    background: transparent;
    border: 0;
    cursor: pointer;
  }

  .video-placeholder:hover {
    background: color-mix(in srgb, var(--hg-accent-primary, #5d5dff) 14%, transparent);
  }

  .video-placeholder:disabled {
    cursor: wait;
    opacity: 0.75;
  }

  .source {
    overflow-wrap: anywhere;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 10px;
  }

  .error {
    color: var(--hg-accent-red, #ff6b6b);
    font-size: 10px;
  }
</style>
