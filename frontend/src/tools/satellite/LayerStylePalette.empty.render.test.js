// @vitest-environment happy-dom
/** An empty library says where icons are imported, from the palette that would offer them. */
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import LayerStylePalette from './LayerStylePalette.svelte';
import { uiState } from '../../lib/state.svelte.js';

vi.mock('../../lib/api.js', () => ({ api: { get: vi.fn(async (path) => (path === '/api/icons' ? { icons: [], max: 1000 }
  : path.endsWith('/icons') ? [] : { colours: [] })), put: vi.fn() } }));

let held;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });

it('points an empty library to Settings › Icons', async () => {
  held = mount(LayerStylePalette, { target: document.body, props: { label: 'Marker', caseId: 'c', layer: 'Mine' } });
  for (let round = 0; round < 4; round++) { await tick(); await Promise.resolve(); }
  flushSync();
  expect(document.body.textContent).toContain('Your own icons go here.');
  document.querySelector('.icons .link').click();
  expect([uiState.tool, uiState.settingsTab]).toEqual(['settings', 'icons']);
});
