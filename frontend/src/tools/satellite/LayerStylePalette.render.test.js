// @vitest-environment happy-dom
/**
 * The analyst's own icons in a layer's palette: the layer's own first (the ones
 * the library lacks), then the library group by group, then the app's. What can
 * go wrong in front of the analyst is an icon offered twice, a pick that leaves
 * the old icon on, and a colour pick read as recolouring an icon that keeps its own.
 */
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import LayerStylePalette from './LayerStylePalette.svelte';
import choices from '../../lib/map/layerSymbols.json';

const LIBRARY = [
  { key: 'aaaaaaaaaaaaaaaa', name: 'Tank', group: 'Armour', mode: 'disc', aliases: ['cccccccccccccccc'] },
  { key: 'bbbbbbbbbbbbbbbb', name: 'Camp', group: 'My icons', mode: 'image' },
];
const HELD = [
  { key: 'dddddddddddddddd', digest: 'cccccccccccccccc', mode: 'image', name: 'Copied tank', count: 4 },
  { key: 'eeeeeeeeeeeeeeee', digest: 'eeeeeeeeeeeeeeee', mode: 'image', name: 'Strike', count: 2 },
];
const answers = { icons: LIBRARY };
vi.mock('../../lib/api.js', () => ({ api: { get: vi.fn(async (path) => {
  if (path === '/api/icons') return { icons: answers.icons, max: 1000 };
  if (path.endsWith('/icons')) return HELD;
  return { colours: [] };
}), put: vi.fn() } }));

let held;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });
async function show(props) {
  held = mount(LayerStylePalette, { target: document.body, props: { label: 'Marker', caseId: 'c', layer: 'Mine', ...props } });
  for (let round = 0; round < 4; round++) { await tick(); await Promise.resolve(); }
  flushSync();
}
const themes = () => [...document.querySelectorAll('.icons .theme')].map((node) => node.textContent.trim());
const pick = (label) => { document.querySelector(`[aria-label="${label}"]`).click(); flushSync(); };

it("offers the layer's own icons the library lacks, then the library by group, then the app's", async () => {
  await show({});
  expect(themes().slice(0, 3)).toEqual(["This layer's icons", 'Armour', 'My icons']);
  // the copied tank is the library's Tank under another key: offered once, in the library
  expect(document.querySelector('[aria-label="Marker Copied tank icon, this layer"]')).toBeNull();
  expect(document.querySelector('[aria-label="Marker Strike icon, this layer"]')).toBeTruthy();
  expect(document.querySelectorAll('.icons button:not(.link)')).toHaveLength(1 + LIBRARY.length + choices.length);
});

it('picks an own icon as an icon, and one of the app\'s as a symbol that takes it off', async () => {
  const onpick = vi.fn();
  await show({ onpick });
  pick('Marker Tank icon, Armour');
  expect(onpick).toHaveBeenLastCalledWith({ icon: 'aaaaaaaaaaaaaaaa' });
  pick('Marker Strike icon, this layer');
  expect(onpick).toHaveBeenLastCalledWith({ icon: 'eeeeeeeeeeeeeeee' });
  pick(`Marker ${choices[0].label} icon`);
  expect(onpick).toHaveBeenLastCalledWith({ symbol: choices[0].id, icon: '' });
});

it('marks the icon worn, not the symbol kept under it', async () => {
  await show({ symbol: choices[0].id, icon: 'aaaaaaaaaaaaaaaa' });
  expect(document.querySelector('[aria-label="Marker Tank icon, Armour"]').getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelector(`[aria-label="Marker ${choices[0].label} icon"]`).getAttribute('aria-pressed')).toBe('false');
});

it('says an icon drawn as it is keeps its own colours', async () => {
  await show({ icon: 'bbbbbbbbbbbbbbbb' });
  expect(document.body.textContent).toContain('This icon keeps its own colours.');
  unmount(held); held = null; document.body.innerHTML = '';
  await show({ icon: 'aaaaaaaaaaaaaaaa' });
  expect(document.body.textContent).not.toContain('keeps its own colours');
});

it('finds own icons by name and group', async () => {
  await show({});
  const find = document.querySelector('[aria-label="Marker find icon"]');
  find.value = 'armour'; find.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
  expect(document.querySelector('[aria-label="Marker Tank icon, Armour"]')).toBeTruthy();
  expect(document.querySelector('[aria-label="Marker Camp icon, My icons"]')).toBeNull();
});

it("offers none of the analyst's icons where a symbol is the app's only", async () => {
  const onpick = vi.fn();
  await show({ own: false, onpick });
  expect(themes()).not.toContain('Armour');
  pick(`Marker ${choices[0].label} icon`);
  expect(onpick).toHaveBeenLastCalledWith({ symbol: choices[0].id });
});
