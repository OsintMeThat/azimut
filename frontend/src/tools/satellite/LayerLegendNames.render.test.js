// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const palette = vi.hoisted(() => ({ colours: [{ name: 'Side A', colour: '#0072b2' }], load: vi.fn(), save: vi.fn(async () => []) }));
vi.mock('../../lib/map/layerPalette.svelte.js', () => ({ layerPalette: {
  get colours() { return palette.colours; }, load: palette.load, save: palette.save,
  nameOf: (colour) => palette.colours.find((entry) => entry.colour === String(colour).toLowerCase())?.name ?? '',
} }));
vi.mock('../../lib/state.svelte.js', () => ({ caseState: { current: { id: 'case' } }, toast: vi.fn() }));
const { default: AddedLayers } = await import('./AddedLayers.svelte');
const { default: LayerPaletteEditor } = await import('./LayerPaletteEditor.svelte');

let held;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a personal layer legend', () => {
  it('shows a uniform group by its pictogram and counts the colours the case named', () => {
    const row = { name: 'work', title: 'Working', editable: true, enabled: true, features: 3, hidden: [],
      categories: [{ name: 'Strikes', count: 3, colour: '#d55e00', symbol: 'badge-explosion' }],
      colours: { '#0072b2': 2, '#d55e00': 1 } };
    held = mount(AddedLayers, { target: document.body, props: { rows: [row], busy: '' } }); flushSync();
    [...document.querySelectorAll('.fold')].find((node) => node.textContent.includes('Working'))?.click(); flushSync();
    document.querySelector('.legend-head').click(); flushSync();
    expect(palette.load).toHaveBeenCalledWith('case');
    const legend = document.querySelector('.legend');
    expect(legend.querySelector('.cat svg.marker-symbol')).toBeTruthy();
    const named = [...legend.querySelectorAll('.named')].map((node) =>
      [node.querySelector('.cat-name').textContent, node.querySelector('.cat-count').textContent]);
    expect(named).toEqual([['Side A', '2']]);
  });
});

describe('naming the case colours', () => {
  it('saves only the colours given a name', async () => {
    const onclose = vi.fn();
    held = mount(LayerPaletteEditor, { target: document.body, props: { caseId: 'case', onclose } }); flushSync();
    [...document.querySelectorAll('button')].find((node) => node.textContent.includes('Add a colour')).click(); flushSync();
    const names = document.querySelectorAll('input:not([type="color"])');
    names[1].value = ' Unknown '; names[1].dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    [...document.querySelectorAll('button')].find((node) => node.textContent === 'Save colours').click(); await settle();
    expect(palette.save).toHaveBeenCalledWith('case', [{ name: 'Side A', colour: '#0072b2' }, { name: 'Unknown', colour: '#cc79a7' }]);
    expect(onclose).toHaveBeenCalled();
  });
});
