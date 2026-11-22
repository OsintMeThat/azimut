// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const get = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: { get: (...args) => get(...args), post: vi.fn(), put: vi.fn(), del: vi.fn() } }));
const { default: NewPlateDialog } = await import('./NewPlateDialog.svelte');
const { ASKS, GALLERY } = await import('../../lib/plate/gallery.js');

let held = null;
// the case holds no comparison unless a test says otherwise
beforeEach(() => { get.mockImplementation(async () => []); });
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; get.mockReset(); });

const FRONT = { name: 'front', title: 'Front', bbox: [30, 44, 34, 46] };
function show(props = {}) {
  const made = [];
  held = mount(NewPlateDialog, { target: document.body, props: { rows: [FRONT, { name: 'empty', title: 'Empty' }],
    layers: ['front'], templates: [{ id: 't1', name: 'Mine', data: { page: { paper: 'a4', orientation: 'landscape' }, theme: {}, elements: [] } }],
    caseId: 'c1', onmake: (choice) => made.push(choice), onclose: () => {}, ...props } });
  flushSync();
  return made;
}
const button = (text) => [...document.body.querySelectorAll('button')].find((node) => node.textContent.trim() === text);
const tile = (name) => [...document.body.querySelectorAll('.tile')].find((node) => node.querySelector('.name')?.textContent === name);
const tiles = () => [...document.body.querySelectorAll('.tile .name')].map((node) => node.textContent);
const chip = (words) => [...document.body.querySelectorAll('.ask')].find((node) => node.textContent.trim() === words);
const picked = () => document.body.querySelector('.tile[aria-selected="true"] .name')?.textContent;
const press = (node) => { node.click(); flushSync(); };
const settle = async () => { for (let i = 0; i < 4; i += 1) await tick(); flushSync(); };
const said = () => [...document.body.querySelectorAll('.layouts .under')].map((node) => node.textContent.trim());

describe('a new plate on one screen', () => {
  it('creates the house layout over the Map\'s ground at once', () => {
    const made = show();
    press(button('Create plate'));
    expect(made).toEqual([{ from: { kind: 'house', id: '' }, where: 'map', layers: ['front'], format: '', look: '', comparison: '' }]);
  });

  it('shows the layouts, the map, the paper and the look together, with no steps to walk', () => {
    show();
    // the house layout, the ready plates, the blank page and the analyst's own
    expect(document.body.querySelectorAll('.tile')).toHaveLength(1 + GALLERY.length + 1 + 1);
    expect(document.body.querySelectorAll('.tile svg.sketch')).toHaveLength(1 + GALLERY.length + 1 + 1);
    // each ready plate shows the Azimut logo it carries, the analyst's own templates only what they hold
    expect(document.body.querySelectorAll('.tile svg.sketch .logo-mark')).toHaveLength(GALLERY.length);
    expect(tiles().slice(-2)).toEqual(['Blank page', 'Mine']);
    expect([...document.body.querySelectorAll('h4')].map((node) => node.textContent)).toEqual(['Layout', 'Map', 'Paper', 'Look']);
    expect(document.body.querySelector('[role="tab"]')).toBeNull();
    expect(button('Next')).toBeUndefined();
  });

  it('takes a ready plate, the ground round the layers picked, a paper and a look', () => {
    const made = show();
    press(tile('Before and after'));
    press(button('Round the layers picked'));
    press([...document.body.querySelectorAll('.layers input')][1]);
    press(button('Story, 9:16'));
    press([...document.body.querySelectorAll('.look')].find((node) => node.textContent.includes('Tactical')));
    press(button('Create plate'));
    expect(made.at(-1)).toEqual({ from: { kind: 'ready', id: 'before-after' }, where: 'layers', layers: ['front', 'empty'], format: 'story', look: 'tactical', comparison: '' });
  });

  it('frames round no layer that holds nothing to frame', () => {
    const made = show({ layers: [] });
    expect(button('Round the layers picked').disabled).toBe(true);
    press(tile('Post'));
    press(button('Create plate'));
    expect(made.at(-1)).toMatchObject({ from: { kind: 'ready', id: 'post' }, where: 'map', layers: [] });
  });

  it('a ready plate goes back to its own paper, and Cancel makes nothing', () => {
    let closed = 0;
    const made = show({ onclose: () => { closed += 1; } });
    press(button('Square'));
    press(tile('Post'));
    expect(button('As laid out').getAttribute('aria-pressed')).toBe('true');
    press(button('Cancel'));
    expect(closed).toBe(1);
    expect(made).toEqual([]);
  });
});

describe('what the plate shows, asked first', () => {
  it('offers every layout under All, and keeps those that answer a chip', () => {
    show();
    expect([...document.body.querySelectorAll('.ask')].map((node) => node.textContent.trim())).toEqual(['All', ...ASKS.map(([, words]) => words)]);
    expect(chip('All').getAttribute('aria-pressed')).toBe('true');
    press(chip('A change between two dates'));
    expect(chip('All').getAttribute('aria-pressed')).toBe('false');
    // the analyst's own templates and the house layout wait under All; the blank page stays in reach
    expect(tiles()).toEqual(['Before and after', 'Blank page']);
    press(chip('A geolocation'));
    expect(tiles()).toEqual(['Geolocation card', 'Line of sight', 'Locator', 'Blank page']);
    press(chip('A situation'));
    expect(tiles()).toEqual(['House layout', ...GALLERY.filter((entry) => entry.asks.includes('situation')).map((entry) => entry.name), 'Blank page']);
    press(chip('All'));
    expect(tiles()).toHaveLength(1 + GALLERY.length + 1 + 1);
  });

  it('picks the first layout a chip keeps when it hides the one picked, and keeps the one picked when it answers', () => {
    const made = show();
    expect(picked()).toBe('House layout');
    press(chip('A post'));
    expect(picked()).toBe('Geolocation card');
    press(tile('Post'));
    press(chip('All'));
    expect(picked()).toBe('Post');
    press(chip('A situation'));
    expect(picked()).toBe('House layout');
    press(tile('Blank page'));
    press(chip('A geolocation'));
    expect(picked()).toBe('Blank page');
    press(button('Create plate'));
    expect(made.at(-1).from).toEqual({ kind: 'empty', id: '' });
  });

  it('says a dated layer is needed for an evolution while the case has none, and how angles are told', () => {
    show();
    press(chip('An evolution over time'));
    expect(said()).toEqual(['Needs a dated layer: in the Map, open one of My layers and turn on Track over time in its ⋯ menu.']);
    press(chip('One event, several angles'));
    expect(tiles()).toEqual(['Geolocation card', 'Incidents', 'Blank page']);
    expect(said()).toEqual(['No ready plate for it yet: each angle gets a slide from + Slide under the page, and its footage from Add › Video.']);
    press(chip('A situation'));
    expect(said()).toEqual([]);
    unmount(held); document.body.innerHTML = '';
    held = null;
    show({ rows: [{ ...FRONT, editable: true, track: { on: true } }] });
    press(chip('An evolution over time'));
    expect(said()).toEqual([]);
    expect(tiles()).toEqual(['House layout', 'Situation map', 'Incidents', 'Route or track', 'Blank page']);
  });
});

describe('a blank page', () => {
  it('takes the paper and the look picked, and says its map comes later', () => {
    const made = show();
    press(tile('Blank page'));
    expect(document.body.querySelector('.layers')).toBeNull();
    expect(button('Where the Map is looking')).toBeUndefined();
    expect(document.body.querySelector('.options .note').textContent).toBe('A blank page has no map yet. The first one added looks where the Map is looking, with its layers.');
    expect(button('A4, wide').getAttribute('aria-pressed')).toBe('true');
    press(button('Feed post, 4:5'));
    press([...document.body.querySelectorAll('.look')].find((node) => node.textContent.includes('Night')));
    press(button('Create plate'));
    expect(made.at(-1)).toMatchObject({ from: { kind: 'empty', id: '' }, format: 'feed', look: 'night', comparison: '' });
  });
});

describe('Before and after from a comparison of the case', () => {
  const INDEX = [
    { id: 'p1', kind: 'place', title: 'A place' },
    { id: 'c1', kind: 'comparison', session: 'energodar', title: 'Energodar' },
    { id: 'c2', kind: 'comparison', session: 'port', title: '' },
    { id: 'c3', kind: 'comparison', title: 'No session' },
  ];
  const select = () => document.body.querySelector('select[aria-label="From a comparison"]');

  it('reads the case\'s comparisons only once Before and after is picked, and offers them there alone', async () => {
    get.mockImplementation(async () => INDEX);
    show();
    await settle();
    expect(get).not.toHaveBeenCalled();
    press(tile('Geolocation card'));
    await settle();
    expect(get).not.toHaveBeenCalled();
    expect(select()).toBeNull();
    press(tile('Before and after'));
    await settle();
    expect(get).toHaveBeenCalledWith('/api/cases/c1/satellite/index');
    expect([...select().options].map((option) => [option.value, option.textContent])).toEqual([['', 'None'], ['energodar', 'Energodar'], ['port', 'port']]);
    press(tile('Post'));
    expect(select()).toBeNull();
    press(tile('Before and after'));
    await settle();
    // read once, however often the layout is picked
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('starts from the comparison picked, the maps looking where it does', async () => {
    get.mockImplementation(async () => INDEX);
    const made = show();
    press(chip('A change between two dates'));
    await settle();
    expect(picked()).toBe('Before and after');
    select().value = 'energodar';
    select().dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(button('Where the Map is looking').disabled).toBe(true);
    expect(document.body.querySelector('.from-pair + .note').textContent).toBe('Both maps look where it does, each on its side\'s ground and day.');
    press(button('Create plate'));
    expect(made.at(-1)).toMatchObject({ from: { kind: 'ready', id: 'before-after' }, comparison: 'energodar' });
    // another layout leaves the comparison out
    press(chip('All'));
    press(tile('Situation map'));
    press(button('Create plate'));
    expect(made.at(-1).comparison).toBe('');
  });

  it('offers nothing when the case holds no comparison, or cannot be read', async () => {
    get.mockImplementation(async () => [INDEX[0]]);
    show();
    press(tile('Before and after'));
    await settle();
    expect(select()).toBeNull();
    unmount(held); held = null; document.body.innerHTML = '';
    get.mockImplementation(async () => { throw new Error('offline'); });
    show();
    press(tile('Before and after'));
    await settle();
    expect(select()).toBeNull();
    // no case, nothing to read
    unmount(held); held = null; document.body.innerHTML = '';
    get.mockReset();
    show({ caseId: '' });
    press(tile('Before and after'));
    await settle();
    expect(get).not.toHaveBeenCalled();
  });
});
