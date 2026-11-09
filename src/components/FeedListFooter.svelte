<script lang="ts">
  interface Props {
    loading: boolean;
    canLoadMore: boolean;
  }

  let { loading, canLoadMore }: Props = $props();
</script>

{#if loading}
  <p class="feed-list-footer" role="status">Loading older notes...</p>
{:else if !canLoadMore}
  <p class="feed-list-footer" data-feed-end>That's everything for now.</p>
{/if}

<style>
  .feed-list-footer {
    margin: 0;
    padding: 14px 12px 6px;
    color: var(--hg-text-muted, #b8b1a4);
    font-size: 11px;
    text-align: center;
  }
</style>
