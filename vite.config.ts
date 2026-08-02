import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import UnoCSS from '@unocss/vite';
import { nip5aManifest } from '@napplet/vite-plugin';

export default defineConfig({
  plugins: [
    UnoCSS(),
    svelte(),
    // The sealed public plugin emits the canonical
    // ['archetype', slug, 'napplet:<archetype>/<intent>'] manifest tag at build
    // time. The resolution-sim harness serves it verbatim — no serve-time
    // injection or re-sign.
    nip5aManifest({
      nappletType: 'feed',
      // Phase 88 (FEED-02): the feed now routes its timeline through the
      // NAP-OUTBOX service (origin:'outbox' discovery + origin:'relay' exact
      // pin). The runtime ACL gates service messages by declared capability, so
      // WITHOUT 'outbox' here every outbox.subscribe is silently dropped and the
      // feed never fetches. (Found via the feed-intent e2e: supports('outbox')
      // was true shell-side but the router was never reached — missing capability.)
      requires: ['identity', 'relay', 'inc', 'outbox', 'storage', 'resource', 'theme'],
      artifactMode: 'single-file',
      archetypes: [{ slug: 'feed', convention: 'napplet:feed/open' }],
    }),
  ],
  resolve: {
    dedupe: ['svelte'],
  },
  server: {
    port: 5174,
    cors: true,
  },
  build: {
    outDir: 'dist',
  },
});
