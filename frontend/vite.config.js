import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// Builds straight into the Python package so `pip install .` ships the UI.
export default defineConfig({
  plugins: [svelte()],
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
