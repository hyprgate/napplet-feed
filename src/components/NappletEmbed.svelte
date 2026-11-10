<script lang="ts">
  import { onMount } from 'svelte';
  import { outbox } from '@napplet/sdk';
  import {
    createNappletEmbedIntentRequest,
    napDomainInfo,
    nappletEmbedOpenContract,
    napshotLabelFilters,
    napshotTrustConfig,
    resourceBlobLoader,
    selectNapshotPreview,
    verifiedAppMedia,
    type NappletEmbed,
    type NapshotSignedEvent,
  } from '@hyprgate/utils';
  import { invokeFeedIntent } from '../lib/feed-actions';
  import { nappletOpenStatus, type NappletOpenStatus } from '../lib/napplet-embed-status';

  interface Props {
    embed: NappletEmbed;
    relays?: string[];
    loadResources?: boolean;
  }

  let { embed, relays = [], loadResources = true }: Props = $props();

  const trust = napshotTrustConfig((import.meta as { env?: Record<string, unknown> }).env ?? {});
  let preview = $state<{ url: string; source: 'author' | 'napshot' } | null>(null);
  let previewState = $state<'loading' | 'ready' | 'none'>('loading');
  let openState = $state<NappletOpenStatus>({ phase: 'idle' });

  let contract = $derived(nappletEmbedOpenContract(embed));
  // NAP-INTENT routes only to advertised z/i contracts; there is no generic "launch" request.
  const NO_CONTRACT_REASON = "Can't open from a post: this app doesn't list any requests it accepts. Find it in the App Store instead.";
  const uid = $props.id();
  const reasonId = `napplet-embed-reason-${uid}`;
  let required = $derived(embed.required.map(napDomainInfo));
  let optional = $derived(embed.optional.map(napDomainInfo));
  let initials = $derived(embed.name.split(/\s+/).map((word) => word[0] ?? '').join('').slice(0, 2).toUpperCase());

  async function authorPreview(): Promise<string | null> {
    for (const media of embed.media.screenshots) {
      const url = await verifiedAppMedia(media, { loadBytes: resourceBlobLoader });
      if (url) return url;
    }
    return null;
  }

  /** Napshot covers root and named manifests whose author shipped no screenshot. */
  async function napshotPreview(): Promise<string | null> {
    if (embed.kind === 5129 || embed.media.screenshots.length > 0) return null;
    const [filter] = napshotLabelFilters([embed.event.id], trust.signers);
    if (!filter || trust.relays.length === 0) return null;
    const result = await outbox.query(filter, { relays: trust.relays });
    const labels = result.events.map((item) => item.event as unknown as NapshotSignedEvent);
    const selected = selectNapshotPreview(embed.event as unknown as NapshotSignedEvent, labels, trust.signers);
    return selected ? verifiedAppMedia(selected.media, { loadBytes: resourceBlobLoader }) : null;
  }

  onMount(() => {
    if (!loadResources) {
      previewState = 'none';
      return;
    }
    let disposed = false;
    void (async () => {
      try {
        const author = await authorPreview();
        const url = author ?? await napshotPreview();
        if (disposed) return;
        preview = url ? { url, source: author ? 'author' : 'napshot' } : null;
      } catch {
        // A missing preview never blocks the card.
      }
      if (!disposed) previewState = preview ? 'ready' : 'none';
    })();
    return () => { disposed = true; };
  });

  async function openApp(): Promise<void> {
    const request = createNappletEmbedIntentRequest(embed, relays);
    if (!request || openState.phase === 'opening') return;
    openState = { phase: 'opening' };
    const result = await invokeFeedIntent(request);
    openState = nappletOpenStatus(result);
  }
</script>

<section
  class="napplet-embed"
  aria-label={`App: ${embed.name}`}
  data-feed-napplet-embed={embed.namedAddress ?? embed.event.id}
  data-feed-napplet-preview={previewState === 'ready' ? preview?.source : previewState}
>
  <div class="preview" class:empty={!preview}>
    {#if preview}
      <img
        src={preview.url}
        alt={preview.source === 'napshot' ? `Automated preview of ${embed.name}` : `Screenshot of ${embed.name}`}
        data-feed-napplet-preview-image={preview.source}
      />
      {#if preview.source === 'napshot'}<span class="badge" title="Captured by Napshot, not by the app's author">Automated preview</span>{/if}
    {:else}
      <span class="placeholder" aria-hidden="true">{initials}</span>
      {#if previewState === 'loading'}<span class="badge">Loading preview…</span>{/if}
    {/if}
  </div>
  <div class="details">
    <span class="eyebrow">App</span>
    <strong class="name" data-feed-napplet-name>{embed.name}</strong>
    {#if embed.summary}<span class="summary">{embed.summary}</span>{/if}
    {#if required.length > 0}
      <div class="domains" aria-label="Required capabilities" data-feed-napplet-required>
        <span class="domains-label">Needs</span>
        {#each required as domain (domain.domain)}
          <span class="domain" class:sensitive={domain.sensitive} title={domain.description} data-domain={domain.domain}>{domain.label}</span>
        {/each}
      </div>
    {/if}
    {#if optional.length > 0}
      <div class="domains optional" aria-label="Optional capabilities" data-feed-napplet-optional>
        <span class="domains-label">Can use</span>
        {#each optional as domain (domain.domain)}
          <span class="domain" title={domain.description} data-domain={domain.domain}>{domain.label}</span>
        {/each}
      </div>
    {/if}
    <div class="actions">
      <button
        type="button"
        class="open"
        onclick={openApp}
        disabled={!contract || openState.phase === 'opening'}
        aria-describedby={contract ? undefined : reasonId}
        data-feed-napplet-open={contract?.convention ?? ''}
      >
        {openState.phase === 'opening' ? 'Opening…' : 'Open app'}
      </button>
      {#if !contract}
        <span id={reasonId} class="status muted" data-feed-napplet-no-contract>{NO_CONTRACT_REASON}</span>
      {/if}
      {#if openState.phase !== 'idle' && openState.phase !== 'opening'}
        <span class="status" class:failure={openState.phase === 'failed'} role="status" data-feed-napplet-status={openState.phase}>{openState.message}</span>
      {/if}
    </div>
  </div>
</section>

<style>
  .napplet-embed {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    overflow: hidden;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 8px;
    background: var(--hg-surface-raised, #151515);
    color: var(--hg-text-primary, #f2efe7);
    min-width: 0;
  }

  .preview {
    position: relative;
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: 16 / 9;
    max-height: 300px;
    overflow: hidden;
    background: var(--hg-surface, #0d0d0d);
    border-bottom: 1px solid var(--hg-border, #303030);
  }

  .preview img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: top center;
  }

  .placeholder {
    font-size: 34px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--hg-text-muted, #8a877f);
  }

  .badge {
    position: absolute;
    right: 8px;
    bottom: 8px;
    padding: 2px 7px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--hg-bg-overlay, var(--hg-bg)) 82%, transparent);
    color: var(--hg-text-primary);
    font-size: 11px;
  }

  .details {
    display: grid;
    gap: 6px;
    padding: 10px 12px 12px;
    min-width: 0;
  }

  .eyebrow {
    color: var(--hg-accent-cyan, #82d8f7);
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .name {
    font-size: 16px;
    overflow-wrap: anywhere;
  }

  .summary {
    color: var(--hg-text-secondary, #c9c5bb);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .domains {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
  }

  .domains-label {
    color: var(--hg-text-muted, #8a877f);
    font-size: 12px;
    margin-right: 2px;
  }

  .domain {
    padding: 2px 8px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 999px;
    font-size: 12px;
  }

  .domain.sensitive {
    border-color: color-mix(in srgb, var(--hg-accent-amber, #e8b25b) 60%, transparent);
  }

  .optional .domain {
    color: var(--hg-text-muted, #8a877f);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px;
    margin-top: 4px;
  }

  .open {
    padding: 6px 14px;
    border: 1px solid var(--hg-accent-cyan, #82d8f7);
    border-radius: 6px;
    background: var(--hg-accent-cyan, #82d8f7);
    color: var(--hg-bg, #080808);
    font-weight: 700;
    cursor: pointer;
  }

  .open:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .status {
    font-size: 12px;
    color: var(--hg-text-secondary, #c9c5bb);
  }

  .status.muted {
    color: var(--hg-text-muted, #8a877f);
  }

  .status.failure {
    color: var(--hg-danger, #ff8c8c);
  }
</style>
