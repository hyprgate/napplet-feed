import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [
    svelte(),
  ],
  resolve: {
    conditions: ['browser'],
    alias: {
      '@napplet/sdk': fileURLToPath(
        new URL('../../node_modules/.pnpm/@napplet+sdk@0.13.0/node_modules/@napplet/sdk/dist/index.js', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
