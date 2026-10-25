// @vitest-environment happy-dom
/**
 * The analyst's own icons in a layer's palette: the layer's own first (the ones
 * the library lacks), then the library group by group, then the app's. What can
 * go wrong in front of the analyst is an icon offered twice, a pick that leaves
 * the old icon on, and a colour pick read as recolouring an icon that keeps its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const answers = { icons: LIBRARY, palette: { colours: [] } };
vi.mock('../../lib/api.js', () => ({ api: { get: vi.fn(async (path) => {
  if (path === '/api/icons') return { icons: answers.icons, max: 1000 };
  if (path.endsWith('/icons')) return HELD;
  return answers.palette;
}), put: vi.fn(async (path, body) => ({ colours: body.colours, icons: body.icons ?? answers.palette.icons ?? [] })) } }));

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

it('offers a chip per group of icons, gone while a search answers', async () => {
  await show({});
  const chips = () => [...document.querySelectorAll('.themes .theme-chip')].map((node) => node.textContent);
  expect(chips().slice(0, 4)).toEqual(["This layer's icons", 'Armour', 'My icons', choices[0].group]);
  expect(chips()).toEqual(themes());
  const find = document.querySelector('[aria-label="Marker find icon"]');
  find.value = 'armour'; find.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
  expect(chips()).toEqual([]);
});

it("offers none of the analyst's icons where a symbol is the app's only", async () => {
  const onpick = vi.fn();
  await show({ own: false, onpick });
  expect(themes()).not.toContain('Armour');
  pick(`Marker ${choices[0].label} icon`);
  expect(onpick).toHaveBeenLastCalledWith({ symbol: choices[0].id });
});

describe('the colours', () => {
  beforeEach(async () => {
    localStorage.clear();
    const { recentColours } = await import('../../lib/recentColours.svelte.js');
    while (recentColours.list.length) recentColours.list.pop();
  });

  it('offers the colours the layer wears and those picked lately, beyond the palette, once each', async () => {
    const { recentColours } = await import('../../lib/recentColours.svelte.js');
    recentColours.keep('#123456');
    recentColours.keep('#0072b2');
    const onpick = vi.fn();
    await show({ onpick, used: [{ symbol: 'pin', colour: '#ABCDEF' }, { symbol: 'star', colour: '#d55e00' }, { symbol: 'flag', colour: '#123456' }] });
    const extra = [...document.querySelectorAll('.palette .swatch')].map((node) => node.title).filter((title) => /^(In this layer|Picked lately)/.test(title));
    // the palette's own blue and orange are not offered twice
    expect(extra).toEqual(['In this layer, #abcdef', 'In this layer, #123456']);
    pick('Marker #abcdef');
    expect(onpick).toHaveBeenLastCalledWith({ colour: '#abcdef' });
    expect(recentColours.list[0]).toBe('#abcdef');
    // a colour of the palette is one press already, so it is not kept as picked lately
    pick('Marker orange');
    expect(recentColours.list[0]).toBe('#abcdef');
    // in another layer, the colours made here are one press away
    unmount(held); held = null; document.body.innerHTML = '';
    await show({ onpick, used: [] });
    expect([...document.querySelectorAll('.palette .swatch')].map((node) => node.title).slice(5)).toEqual(['Picked lately, #abcdef', 'Picked lately, #123456']);
  });

  it('takes a colour code typed or pasted, and shows the one worn to copy out', async () => {
    const onpick = vi.fn();
    await show({ onpick, colour: '#D55E00' });
    pick('More colours');
    const code = document.querySelector('[aria-label="Marker colour code"]');
    expect(code.value).toBe('#d55e00');
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    paste.clipboardData = { getData: () => 'rgb(0, 114, 178)' };
    code.dispatchEvent(paste); flushSync();
    expect(onpick).toHaveBeenLastCalledWith({ colour: '#0072b2' });
    code.value = '009E73'; code.dispatchEvent(new Event('input', { bubbles: true }));
    code.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); flushSync();
    expect(onpick).toHaveBeenLastCalledWith({ colour: '#009e73' });
    code.value = 'reddish'; code.dispatchEvent(new Event('input', { bubbles: true }));
    code.dispatchEvent(new Event('blur')); flushSync();
    expect(code.getAttribute('aria-invalid')).toBe('true');
    expect(onpick).toHaveBeenCalledTimes(2);
    code.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); flushSync();
    expect(code.value).toBe('#d55e00');
    expect(code.getAttribute('aria-invalid')).toBe('false');
  });

  it('offers no colour where the group paints its markers itself', async () => {
    await show({ colours: false });
    expect(document.querySelector('[aria-label="Marker palette"]')).toBeNull();
    expect(document.querySelector('[aria-label="Marker colour code"]')).toBeNull();
    expect(document.querySelector('[aria-label="Marker icon palette"]')).not.toBeNull();
  });
});

describe('what is offered at once', () => {
  afterEach(() => { answers.palette = { colours: [] }; });

  it('offers the named colours by name and the layer’s own, the rest behind "+"', async () => {
    answers.palette = { colours: [{ name: 'Side A', colour: '#0072b2' }], icons: [{ name: 'Strike', key: 'badge-explosion' }] };
    const onpick = vi.fn();
    await show({ onpick, caseId: 'named', colour: '#ff0000', symbol: 'badge-explosion', used: [{ symbol: 'pin', colour: '#ff0000' }, { symbol: 'flag', colour: '#0000ff' }] });
    const offered = () => [...document.querySelectorAll('.palette button')].map((node) => node.getAttribute('aria-label'));
    expect(offered()).toEqual(['Marker Side A', 'Marker #ff0000', 'Marker #0000ff', 'More colours']);
    expect(document.querySelector('[aria-label="Marker colour code"]')).toBeNull();
    pick('Marker Side A');
    expect(onpick).toHaveBeenLastCalledWith({ colour: '#0072b2' });
    pick('More colours');
    // the plain colours unfold, blue once since it is Side A here, and the code to type
    expect(offered()).toContain('Marker orange');
    expect(offered()).not.toContain('Marker blue');
    expect(document.querySelector('[aria-label="Marker colour code"]')).toBeTruthy();
    // the icon worn says what the case says it means, and the tag says itself in words
    expect([...document.querySelectorAll('.fm-head')].map((node) => node.textContent)).toContain('Icon · Strike');
    expect(document.querySelector('[aria-label="Edit names"]')).toBeTruthy();
  });

  it('offers the plain colours at once in a layer with none yet', async () => {
    await show({ caseId: 'bare' });
    const offered = [...document.querySelectorAll('.palette .swatch')].map((node) => node.getAttribute('aria-label'));
    expect(offered).toEqual(['Marker blue', 'Marker orange', 'Marker green', 'Marker purple', 'Marker yellow']);
  });

  it('fills one row with the layer’s styles, "+" showing the rest', async () => {
    const used = Array.from({ length: 10 }, (_, index) => ({ symbol: 'pin', colour: `#0000${String(index).padStart(2, '0')}` }));
    await show({ used });
    expect(document.querySelectorAll('.used button')).toHaveLength(7);
    pick('Show all 10 styles of this layer');
    expect(document.querySelectorAll('.used button')).toHaveLength(10);
  });

  it('names what is worn where it opened, from its tag', async () => {
    await show({ caseId: 'worn', colour: '#ff0000', symbol: 'flag', used: [{ symbol: 'pin', colour: '#0000ff' }] });
    pick('Name colours and icons');
    const editor = document.querySelector('[aria-label="Named colours and icons"]');
    expect([...editor.querySelectorAll('input[aria-label^="Name of colour"]')].map((input) => input.getAttribute('aria-label')))
      .toEqual(['Name of colour #0000ff', 'Name of colour #ff0000']);
    expect([...editor.querySelectorAll('input[aria-label^="Name of icon"]')].map((input) => input.getAttribute('aria-label')))
      .toEqual(['Name of icon Pin', 'Name of icon Flag']);
  });
});
