import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Builds straight into the Python package so `pip install .` ships the UI.
export default defineConfig({
  plugins: [svelte()],
  // Vitest's dependency optimiser writes beside the file whose imports it is
  // resolving, so a suite run left two `node_modules` trees inside `src/`. They
  // are ignored by git and never shipped, but they shadow module resolution in
  // an editor and answer every grep over the source with a dozen false hits.
  cacheDir: 'node_modules/.vite',
  // Under vitest, resolve Svelte's browser build so a `*.render.test.js` can mount a
  // component and drive it. Without this, `mount()` gets the server build and every
  // interaction test fails on import — which is why the suite could only ever read
  // source strings, and why "these inputs accept nothing" went unnoticed. Gated on
  // VITEST so the production build keeps resolving exactly as it did.
  resolve: process.env.VITEST ? { conditions: ['browser'] } : {},
  test: {
    include: ['src/**/*.test.js'],
  },
  build: {
    outDir: '../src/azimut/static',
    emptyOutDir: true,
    // Mermaid's Langium parser lands in one ~660 kB chunk, read off local disk
    // and only when a note holds a diagram whose grammar needs it. The default
    // 500 kB limit flags it on every build, which trains us to ignore the
    // warning. Our own chunks top out under 200 kB, so anything reaching this
    // ceiling is still a regression worth reading.
    chunkSizeWarningLimit: 700,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8477',
      '/files': 'http://127.0.0.1:8477',
    },
  },
});
