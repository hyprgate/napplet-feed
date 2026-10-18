import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import UnoCSS from '@unocss/vite';
import { nip5aManifest } from '@napplet/vite-plugin';

export default defineConfig({
  plugins: [
    UnoCSS(),
    svelte(),
    // The plugin emits independent z/i advertisements in the signed manifest.
    nip5aManifest({
      nappletType: 'feed',
      // Phase 88 (FEED-02): the feed now routes its timeline through the
      // NAP-OUTBOX service (origin:'outbox' discovery + origin:'relay' exact
      // pin) and opens related apps through NAP-INTENT. The runtime ACL gates
      // service messages by declared capability, so both services must be in
      // the signed manifest rather than granted by a host compatibility shim.
      requires: ['identity', 'relay', 'inc', 'intent', 'outbox', 'storage', 'resource'],
      optional: ['theme'],
      icon: { data: readFileSync(new URL('./icon.png', import.meta.url)), mimeType: 'image/png' },
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
