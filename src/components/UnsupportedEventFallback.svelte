<script lang="ts">
  import { onMount } from 'svelte';
  import type { NostrEvent, NostrFilter } from '@hyprgate/types';
  import { relay, link, type Subscription } from '@napplet/sdk';
  import {
    KIND_APP_HANDLER,
    KIND_APP_HANDLER_RECOMMENDATION,
    dedupeNip89Handlers,
    formatNip89HandlerLink,
    nip89HandlerFromEvent,
    nip89HandlerSupportsKind,
    nip89RecommendationRefsForKind,
    shouldInterceptLinkClick,
    type Nip89Handler,
  } from '@hyprgate/utils';

  interface HandlerAction {
    identity: string;
    label: string;
    href: string;
  }

  interface Props {
    event: NostrEvent;
  }

  let { event }: Props = $props();
  let handlers = $state<Nip89Handler[]>([]);
  let subscriptions: Subscription[] = [];

  let actions = $derived.by<HandlerAction[]>(() =>
    dedupeNip89Handlers(handlers)
      .map((handler) => {
        const href = formatNip89HandlerLink(handler, event);
        if (!href) return null;
        return { identity: handler.identity, label: handler.name, href };
      })
      .filter((action): action is HandlerAction => action != null),
  );

  function addHandlerEvent(candidate: NostrEvent): void {
    const handler = nip89HandlerFromEvent(candidate);
    if (!handler || !nip89HandlerSupportsKind(handler, event.kind)) return;
    handlers = dedupeNip89Handlers([...handlers, handler]);
  }

  function subscribe(filters: NostrFilter[]): void {
    try {
      subscriptions.push(relay.subscribe(filters, addHandlerEvent));
    } catch {
      // Fallback text remains sufficient when handler discovery is unavailable.
    }
  }

  onMount(() => {
    subscribe([
      { kinds: [KIND_APP_HANDLER], '#k': [String(event.kind)], limit: 24 },
    ]);
    let recommendationSub: Subscription | null = null;
    try {
      recommendationSub = relay.subscribe(
        [{ kinds: [KIND_APP_HANDLER_RECOMMENDATION], '#d': [String(event.kind)], limit: 12 }],
        (recommendation: NostrEvent) => {
          const refs = nip89RecommendationRefsForKind(recommendation, event.kind);
          if (refs.length === 0) return;
          const filters = refs.map((ref) => ({
            kinds: [KIND_APP_HANDLER],
            authors: [ref.pubkey],
            '#d': [ref.dTag],
            limit: 1,
          }));
          subscribe(filters);
        },
      );
      subscriptions.push(recommendationSub);
    } catch {
      // Direct handler lookup above still covers the normal local runtime path.
    }
    return () => {
      for (const subscription of subscriptions) subscription.close();
      subscriptions = [];
    };
  });

  // NAP-LINK: open the NIP-89 handler URL via the shell-owned opener so the new
  // browsing context does not inherit this napplet's origin.
  async function openHandlerLink(event: MouseEvent, href: string): Promise<void> {
    if (!shouldInterceptLinkClick(event)) return;
    event.preventDefault();
    const result = await link.open(href);
    if (result.status !== 'opened') {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  }
</script>

<div class="unsupported-event" data-feed-unsupported-kind={event.kind}>
  <p>cannot render this event (kind {event.kind})</p>
  {#if actions.length > 0}
    <div class="handler-actions" aria-label="Application handlers">
      {#each actions as action (action.identity)}
        <a class="handler-action" href={action.href} target="_blank" rel="noreferrer" data-feed-handler-action={action.identity} onclick={(e) => void openHandlerLink(e, action.href)}>
          {action.label}
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .unsupported-event {
    display: grid;
    gap: 8px;
    margin: 4px 0 8px;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 12px;
  }

  .unsupported-event p {
    margin: 0;
  }

  .handler-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .handler-action {
    display: inline-flex;
    align-items: center;
    min-height: 28px;
    padding: 4px 8px;
    border: 1px solid var(--hg-border, #303030);
    border-radius: 4px;
    color: var(--hg-accent-cyan, #82d8f7);
    text-decoration: none;
  }

  .handler-action:hover {
    border-color: var(--hg-accent-cyan, #82d8f7);
  }
</style>
