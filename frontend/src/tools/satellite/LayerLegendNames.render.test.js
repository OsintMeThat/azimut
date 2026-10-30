// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const palette = vi.hoisted(() => ({ colours: [{ name: 'Side A', colour: '#0072b2' }], icons: [{ name: 'Strike', key: 'badge-explosion' }],
  load: vi.fn(), save: vi.fn(async () => []) }));
vi.mock('../../lib/map/layerPalette.svelte.js', () => ({ PLAIN_COLOURS: [['#0072b2', 'Blue']], layerPalette: {
  get colours() { return palette.colours; }, get icons() { return palette.icons; }, load: palette.load, save: palette.save,
  nameOf: (colour) => palette.colours.find((entry) => entry.colour === String(colour).toLowerCase())?.name ?? '',
  iconNameOf: (key) => palette.icons.find((entry) => entry.key === key)?.name ?? '',
} }));
vi.mock('../../lib/state.svelte.js', () => ({ caseState: { current: { id: 'case' } }, toast: vi.fn() }));
const { default: AddedLayers } = await import('./AddedLayers.svelte');
const { default: LayerPaletteEditor } = await import('./LayerPaletteEditor.svelte');

let held;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a personal layer legend', () => {
  it('shows a uniform group by its pictogram and counts the colours and icons the case named', () => {
    const row = { name: 'work', title: 'Working', editable: true, enabled: true, features: 3, hidden: [],
      categories: [{ name: 'Strikes', count: 3, colour: '#d55e00', symbol: 'badge-explosion' }],
      colours: { '#0072b2': 2, '#d55e00': 1 }, symbols: { 'badge-explosion': 2, flag: 1 } };
    held = mount(AddedLayers, { target: document.body, props: { rows: [row], busy: '' } }); flushSync();
    [...document.querySelectorAll('.fold')].find((node) => node.textContent.includes('Working'))?.click(); flushSync();
    document.querySelector('.legend-head').click(); flushSync();
    expect(palette.load).toHaveBeenCalledWith('case');
    const legend = document.querySelector('.legend');
    expect(legend.querySelector('.cat svg.marker-symbol')).toBeTruthy();
    const named = [...legend.querySelectorAll('.named')].map((node) =>
      [node.querySelector('.cat-name').textContent, node.querySelector('.cat-count').textContent]);
    expect(named).toEqual([['Side A', '2'], ['Strike', '2']]);
    // orange and the flag have no name yet: the key that names them is said in words
    const key = legend.querySelector('.key-row button');
    expect(key.textContent.trim()).toBe('Name colours and icons');
    key.click(); flushSync();
    expect(document.querySelector('[aria-label="Named colours and icons"] [aria-label="Name of icon Flag"]')).toBeTruthy();
  });

  it('offers no key under a legend whose colours and icons all have names', () => {
    const row = { name: 'work', title: 'Working', editable: true, enabled: true, features: 2, hidden: [],
      categories: [{ name: 'Strikes', count: 2, colour: '#0072b2' }],
      colours: { '#0072b2': 2 }, symbols: { 'badge-explosion': 2 } };
    held = mount(AddedLayers, { target: document.body, props: { rows: [row], busy: '' } }); flushSync();
    [...document.querySelectorAll('.fold')].find((node) => node.textContent.includes('Working'))?.click(); flushSync();
    document.querySelector('.legend-head').click(); flushSync();
    expect(document.querySelector('.legend .key-row')).toBeNull();
  });
});

describe('naming the case colours and icons', () => {
  it('lists what is worn where it opened, keeps the other names of the case, and saves only what has a name', async () => {
    const onclose = vi.fn();
    const before = palette.colours;
    palette.colours = [{ name: 'Side A', colour: '#0072b2' }, { name: 'Side C', colour: '#009e73' }];
    held = mount(LayerPaletteEditor, { target: document.body,
      props: { caseId: 'case', colours: ['#0072B2', '#d55e00'], worn: ['flag', 'badge-explosion'], onclose } }); flushSync();
    // only what the layer wears: blue, named, and orange, not yet
    const colourNames = () => [...document.querySelectorAll('input[aria-label^="Name of colour"]')];
    expect(colourNames().map((input) => [input.getAttribute('aria-label'), input.value])).toEqual([['Name of colour #0072b2', 'Side A'], ['Name of colour #d55e00', '']]);
    expect(document.body.textContent).toContain('1 other name in this case');
    colourNames()[1].value = ' Unknown '; colourNames()[1].dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    [...document.querySelectorAll('button')].find((node) => node.textContent.includes('Add a colour')).click(); flushSync();
    const added = document.querySelector('input[aria-label="Name of colour added 1"]');
    added.value = 'Ours'; added.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    // the icons worn here; the strike's name is cleared
    const icons = [...document.querySelectorAll('input[aria-label^="Name of icon"]')];
    expect(icons.map((input) => [input.getAttribute('aria-label'), input.value])).toEqual([['Name of icon Flag', ''], ['Name of icon Explosion', 'Strike']]);
    icons[0].value = 'Checkpoint'; icons[0].dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    document.querySelector('[aria-label="Clear the name of icon Explosion"]').click(); flushSync();
    [...document.querySelectorAll('button')].find((node) => node.textContent === 'Save names').click(); await settle();
    expect(palette.save).toHaveBeenCalledWith('case',
      [{ name: 'Side A', colour: '#0072b2' }, { name: 'Unknown', colour: '#d55e00' }, { name: 'Side C', colour: '#009e73' }, { name: 'Ours', colour: '#cc79a7' }],
      [{ name: 'Checkpoint', key: 'flag' }]);
    expect(onclose).toHaveBeenCalled();
    palette.colours = before;
  });

  it('shows the other names of the case on a press, to rename or clear them', () => {
    held = mount(LayerPaletteEditor, { target: document.body, props: { caseId: 'case', colours: [], worn: [] } }); flushSync();
    expect(document.querySelector('input[aria-label="Name of colour #0072b2"]')).toBeNull();
    expect(document.body.textContent).toContain('No colour here yet.');
    [...document.querySelectorAll('button')].find((node) => node.textContent.includes('other names in this case')).click(); flushSync();
    expect(document.querySelector('input[aria-label="Name of colour #0072b2"]').value).toBe('Side A');
    expect(document.querySelector('input[aria-label="Name of icon Explosion"]').value).toBe('Strike');
  });
});
