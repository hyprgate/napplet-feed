<script lang="ts">
  import { createFeedComposerIntentRequest, invokeFeedIntent } from '../lib/feed-actions';

  async function openComposer(): Promise<void> {
    const request = createFeedComposerIntentRequest({ source: { napplet: 'feed' } });
    if (request) await invokeFeedIntent(request);
  }
</script>

<div class="compose-inline border-b border-border-dim px-3 py-2">
  <button
    type="button"
    class="w-full rounded border border-border-dim bg-bg-surface px-3 py-2 text-left font-mono text-sm text-text-muted transition-colors hover:border-accent-green/60 hover:text-text-primary"
    onclick={openComposer}
    aria-label="Open Composer"
  >
    Compose a note
  </button>
</div>
