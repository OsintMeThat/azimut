// @vitest-environment happy-dom
/**
 * A chart's icons set from its card: a glyph is read and written as the engine reads it,
 * `icons:` and `flags:` keep a value's own commas, One per category gives each value the
 * icon named like it and says so, the picker lists the library and the app's badges and
 * finds them, and Import SVG… picks what it filed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BADGES, chartIcons, closeGlyphPicker, glyphWord, matchByName, matchedSaid, namedChoices, openGlyphPicker, perCategory,
  pickerGroups, readGlyph, readPairs, searchGroups, withPair, writePairs,
} from './chartIcons.js';
import { readChart } from './chartText.js';

const COUGAR = 'aaaaaaaaaaaaaaaa';
const MATV = 'bbbbbbbbbbbbbbbb';
const UAE = 'cccccccccccccccc';
const USA = 'dddddddddddddddd';

function fakeLibrary(icons = [
  { key: COUGAR, name: 'Cougar', group: 'Vehicles', mode: 'disc' },
  { key: MATV, name: 'M-ATV', group: 'Vehicles', mode: 'disc' },
  { key: UAE, name: 'UAE', group: 'Flags', mode: 'image' },
  { key: USA, name: 'USA', group: 'Flags', mode: 'image' },
]) {
  return {
    icons,
    load: vi.fn(async () => icons),
    find(key) { return this.icons.find((icon) => icon.key === key) ?? null; },
    importFiles: vi.fn(),
  };
}

afterEach(() => {
  closeGlyphPicker();
  document.body.replaceChildren();
});

describe('a glyph in a block', () => {
  it('reads a badge by its name however it is spelt, an icon by its key, and a plain shape', () => {
    expect(readGlyph('armoured vehicle')).toEqual({ kind: 'badge', id: 'badge-armoured-vehicle' });
    expect(readGlyph('Armored  Vehicle')).toEqual({ kind: 'badge', id: 'badge-armoured-vehicle' });
    expect(readGlyph('badge-pickup')).toEqual({ kind: 'badge', id: 'badge-pickup' });
    expect(readGlyph('own:0123456789ABCDEF')).toEqual({ kind: 'own', id: '0123456789abcdef' });
    expect(readGlyph('circle')).toEqual({ kind: 'shape', id: 'dot' });
    expect(readGlyph('unicorn')).toBeNull();
    expect(readGlyph('')).toBeNull();
  });

  it('writes every badge as a word that reads back to it', () => {
    for (const entry of BADGES) expect(readGlyph(glyphWord({ kind: 'badge', id: entry.id }))).toEqual({ kind: 'badge', id: entry.id });
    expect(glyphWord({ kind: 'badge', id: 'badge-armoured-vehicle' })).toBe('armoured vehicle');
    expect(glyphWord({ kind: 'own', id: COUGAR })).toBe(`own:${COUGAR}`);
    expect(glyphWord({ kind: 'shape', id: 'star' })).toBe('star');
  });
});

describe('icons: and flags:', () => {
  it('keeps a value’s own commas, and leaves out one that holds =', () => {
    expect(readPairs('Streit Group, UAE = own:aaaaaaaaaaaaaaaa, Oshkosh = armoured vehicle'))
      .toEqual([['Streit Group, UAE', 'own:aaaaaaaaaaaaaaaa'], ['Oshkosh', 'armoured vehicle']]);
    expect(writePairs([['Streit Group, UAE', 'truck'], ['a=b', 'tank'], ['Empty', '']])).toBe('Streit Group, UAE = truck');
  });

  it('sets a value in its place, puts a new one in the chart’s order, and takes one out', () => {
    const pairs = [['A', 'tank'], ['C', 'truck']];
    expect(withPair(pairs, 'c', 'pickup')).toEqual([['A', 'tank'], ['C', 'pickup']]);
    expect(withPair(pairs, 'B', 'star', ['A', 'B', 'C'])).toEqual([['A', 'tank'], ['B', 'star'], ['C', 'truck']]);
    expect(withPair(pairs, 'A', '')).toEqual([['C', 'truck']]);
  });
});

describe('one per category', () => {
  const choices = namedChoices(fakeLibrary());

  it('takes the icon whose name names the value, whole words only, and none when two do', () => {
    expect(matchByName('Streit Cougar', choices)).toEqual({ kind: 'own', id: COUGAR });
    expect(matchByName('Oshkosh M-ATV', choices)).toEqual({ kind: 'own', id: MATV });
    expect(matchByName('uae', choices)).toEqual({ kind: 'own', id: UAE });
    expect(matchByName('USA / UAE', choices)).toBeNull();
    expect(matchByName('Carrier', choices)).toBeNull();
    expect(matchByName('Pickup', choices)).toEqual({ kind: 'badge', id: 'badge-pickup' });
  });

  it('gives the others the chart’s icon, and says which took a name', () => {
    const made = perCategory(['Streit Cougar', 'Al-Wahsh'], 'armoured vehicle', choices);
    expect(made).toEqual({ pairs: [['Streit Cougar', `own:${COUGAR}`], ['Al-Wahsh', 'armoured vehicle']], matched: ['Streit Cougar'] });
    expect(matchedSaid(made.matched, 2)).toBe('Streit Cougar took the icon named like it; the others keep the chart’s icon.');
    expect(matchedSaid(['UAE', 'USA'], 2, { flags: true })).toBe('Each took the flag named like it.');
    expect(matchedSaid([], 3, { flags: true })).toBe('No icon of your library is named like these: pick each flag.');
  });
});

describe('the picker', () => {
  it('lists the library by group, then the app’s badges, then the shapes, and finds them by name', () => {
    const groups = pickerGroups(fakeLibrary());
    expect(groups.map((section) => `${section.from}:${section.group}`).slice(0, 4)).toEqual(['library:Vehicles', 'library:Flags', 'app:Vehicles', 'app:Forces']);
    expect(groups.at(-1).group).toBe('Shapes');
    const forces = groups.find((section) => section.from === 'app' && section.group === 'Forces').items.map((item) => item.label);
    expect(forces).toEqual(expect.arrayContaining(['Tank', 'Armoured vehicle']));
    expect(searchGroups(groups, 'pick').flatMap((section) => section.items.map((item) => item.label))).toEqual(['Pickup']);
    expect(searchGroups(groups, 'flags').flatMap((section) => section.items.map((item) => item.label))).toEqual(['UAE', 'USA']);
  });

  it('picks an icon, marks the one now, and gives the keyboard back to its button', () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const onPick = vi.fn();
    openGlyphPicker(anchor, { current: { kind: 'own', id: UAE }, library: fakeLibrary(), onPick });
    const picker = document.querySelector('.cm-glyph-picker');
    expect(picker.querySelector('[aria-pressed="true"]').getAttribute('aria-label')).toBe('UAE');
    expect([...picker.querySelectorAll('.cm-glyph-from')].map((node) => node.textContent)).toEqual(['Your icons', 'The app’s']);
    const search = picker.querySelector('.cm-glyph-search');
    search.value = 'armoured';
    search.dispatchEvent(new Event('input'));
    picker.querySelector('[aria-label="Armoured vehicle"]').click();
    expect(onPick).toHaveBeenCalledWith({ kind: 'badge', id: 'badge-armoured-vehicle' });
    expect(document.querySelector('.cm-glyph-picker')).toBeNull();
    expect(document.activeElement).toBe(anchor);
  });

  it('imports an SVG through the library’s own import and picks what it filed', async () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const library = fakeLibrary();
    library.importFiles.mockResolvedValue({ added: [], already: 1, skipped: [], filed: [{ name: 'Cougar', key: COUGAR }] });
    const onPick = vi.fn();
    openGlyphPicker(anchor, { library, onPick });
    const input = document.querySelector('.cm-glyph-picker input[type="file"]');
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 1"><path d="M0 0h2v1z"/></svg>'], 'cougar.svg', { type: 'image/svg+xml' });
    Object.defineProperty(input, 'files', { value: [svg], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(onPick).toHaveBeenCalledWith({ kind: 'own', id: COUGAR }));
    expect(library.importFiles).toHaveBeenCalledWith([svg]);
  });

  it('says why an SVG was not taken, and stays open', async () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const library = fakeLibrary();
    library.importFiles.mockResolvedValue({ added: [], already: 0, skipped: [{ name: 'bad.svg', reason: 'this SVG could not be drawn' }], filed: [] });
    const onPick = vi.fn();
    openGlyphPicker(anchor, { library, onPick });
    const input = document.querySelector('.cm-glyph-picker input[type="file"]');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'bad.svg')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(document.querySelector('.cm-glyph-status').textContent).toBe('Not imported: this SVG could not be drawn.'));
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe('the card’s rows', () => {
  const PICTOGRAMS = { name: 'pictograms', parts: true, keys: ['icon', 'icons', 'per glyph'], values: ['Streit Cougar', 'Oshkosh M-ATV', 'Al-Wahsh'] };
  const ROWS = { name: 'silhouette rows', parts: false, keys: ['icon', 'icons', 'flag', 'flags', 'per glyph'], values: ['UAE', 'USA', 'Jordan'] };
  const block = (lines) => ['::: chart', ...lines, '| Model | At least |', '| --- | ---: |', '| Streit Cougar | 8 |', ':::'].join('\n');

  function rows({ lines = ['kind: pictograms'], kind = PICTOGRAMS, library = fakeLibrary() } = {}) {
    const host = document.createElement('div');
    document.body.append(host);
    const write = vi.fn();
    const made = chartIcons(host, { state: () => ({ chart: readChart(block(lines)), drawn: { kind } }), write, library });
    made.refresh();
    return { host, write, made };
  }
  const seg = (host, group, label) => [...host.querySelector(`[aria-label="${group}"]`).querySelectorAll('button')].find((node) => node.textContent === label);

  it('closes the picker it opened as its card closes', () => {
    const { host, made } = rows({ lines: ['kind: pictograms'] });
    host.querySelector('[data-key="Icon"]').click();
    expect(document.querySelector('.cm-glyph-picker')).not.toBeNull();
    made.destroy();
    expect(document.querySelector('.cm-glyph-picker')).toBeNull();
  });

  it('is not there for a kind that draws no glyph', () => {
    const { host } = rows({ kind: { name: 'bars', keys: [] } });
    expect(host.hidden).toBe(true);
    expect(host.childElementCount).toBe(0);
  });

  it('shows the chart’s icon and writes the one picked as its icon line', () => {
    const { host, write } = rows({ lines: ['kind: pictograms', 'icon: armoured vehicle'] });
    const button = host.querySelector('[data-key="Icon"]');
    expect(button.getAttribute('aria-label')).toBe('Icon: Armoured vehicle');
    expect(seg(host, 'Icon', 'One for all').getAttribute('aria-checked')).toBe('true');
    expect(host.querySelector('[aria-label="Flag"]')).toBeNull();
    button.click();
    document.querySelector('.cm-glyph-picker [aria-label="Cougar"]').click();
    expect(write).toHaveBeenCalledWith({ icon: `own:${COUGAR}` });
  });

  it('gives each category the icon named like it, else the chart’s, in one write', () => {
    const { host, write } = rows({ lines: ['kind: pictograms', 'icon: armoured vehicle'] });
    seg(host, 'Icon', 'One per category').click();
    expect(write).toHaveBeenCalledWith({ icons: `Streit Cougar = own:${COUGAR}, Oshkosh M-ATV = own:${MATV}, Al-Wahsh = armoured vehicle` });
  });

  it('lists the categories with their own icons, sets one, and goes back to one for all', () => {
    const { host, write } = rows({ lines: ['kind: pictograms', 'icon: armoured vehicle', `icons: Streit Cougar = own:${COUGAR}`] });
    expect([...host.querySelectorAll('.cm-glyph-value')].map((item) => item.querySelector('button').getAttribute('aria-label')))
      .toEqual(['Icon of Streit Cougar: Cougar', 'Icon of Oshkosh M-ATV: Armoured vehicle', 'Icon of Al-Wahsh: Armoured vehicle']);
    host.querySelector('[data-key="Icon of Al-Wahsh"]').click();
    document.querySelector('.cm-glyph-picker [aria-label="Pickup"]').click();
    expect(write).toHaveBeenLastCalledWith({ icons: `Streit Cougar = own:${COUGAR}, Al-Wahsh = pickup` });
    seg(host, 'Icon', 'One for all').click();
    expect(write).toHaveBeenLastCalledWith({ icons: '' });
  });

  it('gives silhouette rows a flag each, matched by name, and none again', () => {
    const { host, write } = rows({ lines: ['kind: silhouette rows'], kind: ROWS });
    expect(seg(host, 'Flag', 'None').getAttribute('aria-checked')).toBe('true');
    seg(host, 'Flag', 'One per category').click();
    expect(write).toHaveBeenCalledWith({ flags: `UAE = own:${UAE}, USA = own:${USA}` });
  });

  it('opens an empty list of flags when no icon is named like the rows, and writes the first one picked', () => {
    const { host, write } = rows({ lines: ['kind: silhouette rows'], kind: { ...ROWS, values: ['Jordan', 'Türkiye'] } });
    seg(host, 'Flag', 'One per category').click();
    expect(write).not.toHaveBeenCalled();
    expect(host.querySelector('.cm-glyph-said').textContent).toBe('No icon of your library is named like these: pick each flag.');
    const slot = host.querySelector('[data-key="Flag of Türkiye"]');
    expect(slot.getAttribute('aria-label')).toBe('Flag of Türkiye: No flag');
    slot.click();
    document.querySelector('.cm-glyph-picker [aria-label="UAE"]').click();
    expect(write).toHaveBeenCalledWith({ flags: `Türkiye = own:${UAE}` });
  });

  it('takes a flag off with No flag, and the whole line with None', () => {
    const { host, write } = rows({ lines: ['kind: silhouette rows', `flags: UAE = own:${UAE}, USA = own:${USA}`], kind: ROWS });
    host.querySelector('[data-key="Flag of USA"]').click();
    document.querySelector('.cm-glyph-picker .cm-glyph-none').click();
    expect(write).toHaveBeenLastCalledWith({ flags: `UAE = own:${UAE}` });
    seg(host, 'Flag', 'None').click();
    expect(write).toHaveBeenLastCalledWith({ flags: '' });
  });

  it('says when each row names its own icon in a column, and leaves the column for one per category', () => {
    const { host, write } = rows({ lines: ['kind: pictograms', 'icon: Model'] });
    expect(host.querySelector('.cm-glyph-said').textContent).toBe('Each row’s icon is named in its “Model” column.');
    seg(host, 'Icon', 'One per category').click();
    expect(write).toHaveBeenCalledWith({ icons: `Streit Cougar = own:${COUGAR}, Oshkosh M-ATV = own:${MATV}, Al-Wahsh = dot`, icon: '' });
  });
});
