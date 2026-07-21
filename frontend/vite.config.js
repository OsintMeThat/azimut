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
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8477',
      '/files': 'http://127.0.0.1:8477',
    },
  },
});
