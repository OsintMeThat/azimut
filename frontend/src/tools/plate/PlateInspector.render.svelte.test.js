// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PlateInspector from './PlateInspector.svelte';
import { createPlateSentinel } from './plateSentinel.svelte.js';
import { api } from '../../lib/api.js';
import { houseLayout } from '../../lib/plate/page.js';

let held = null;
/** The effect roots the plate's Sentinel-2 choices live in, as MapPlate's would. */
let roots = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-20T12:00:00Z')); });
afterEach(() => { if (held) unmount(held); held = null; roots.forEach((stop) => stop()); roots = []; document.body.innerHTML = ''; vi.useRealTimers(); });

function show({ element = {}, at = '2026-10-05', moments = ['2026-10-03', '2026-10-05'], kind = 'text' } = {}) {
  const spec = $state(houseLayout());
  spec.elements.push({ id: 'note', kind, box: [10, 10, 40, 10], text: 'Depot', ...element });
  held = mount(PlateInspector, { target: document.body, props: { spec, selection: ['note'], at, moments } });
  flushSync();
  return spec.elements.at(-1);
}
const end = (name) => document.body.querySelector(`button[aria-label="${name}"]`);
const press = (button) => { button.click(); flushSync(); };
const act = (text) => [...document.body.querySelectorAll('.days button')].find((button) => button.textContent.trim() === text);

describe('the days an annotation is shown on', () => {
  it('says its first and last day, and stretches them to the plate\'s day', () => {
    const note = show({ element: { onward: '2026-10-03', until: '2026-10-03' } });
    expect(end('First day shown').textContent).toContain('3 Oct 2026');
    expect(end('Last day shown').textContent).toContain('3 Oct 2026');
    expect(document.body.querySelector('.days').classList.contains('off')).toBe(true);
    press(act('Show it on 5 Oct 2026'));
    expect([note.onward, note.until]).toEqual(['2026-10-03', '2026-10-05']);
    expect(document.body.querySelector('.days').classList.contains('off')).toBe(false);
  });

  it('takes either end from a calendar of any day, or opens it to the start or to the end', () => {
    const note = show({ element: { onward: '2026-10-03', until: '2026-10-05' } });
    press(end('Last day shown'));
    press(document.body.querySelector('button[title="2026-10-12"]'));
    expect(note.until).toBe('2026-10-12');
    expect(document.body.querySelector('button[title="2026-10-12"]')).toBeNull();
    press(end('First day shown'));
    press(act('The start'));
    expect(note.onward).toBeNull();
    expect(end('First day shown').textContent).toContain('The start');
    press(end('Last day shown'));
    press(act('The end'));
    expect(note.until).toBeNull();
    expect(end('Last day shown').textContent).toContain('The end');
  });

  it('pulls the other end along rather than crossing it', () => {
    const note = show({ element: { onward: '2026-10-03', until: '2026-10-05' } });
    press(end('First day shown'));
    press(document.body.querySelector('button[title="2026-10-09"]'));
    expect([note.onward, note.until]).toEqual(['2026-10-09', '2026-10-09']);
    press(end('Last day shown'));
    press(act('This day'));
    expect([note.onward, note.until]).toEqual(['2026-10-05', '2026-10-05']);
  });

  it('is offered only for what stands on a played plate', () => {
    show({ kind: 'legend' });
    expect(end('First day shown')).toBeNull();
    unmount(held); held = null; document.body.innerHTML = '';
    show({ moments: [] });
    expect(end('First day shown')).toBeNull();
  });
});

describe('what belongs to a step', () => {
  function onStep(element) {
    const spec = $state(houseLayout());
    spec.steps = { '2026-10-05': [{ id: 's1', duration: 3 }] };
    spec.elements.push({ id: 'note', box: [10, 10, 40, 10], text: 'Depot', ...element });
    held = mount(PlateInspector, { target: document.body, props: { spec, selection: ['note'], at: '2026-10-05', moments: ['2026-10-05'],
      place: { steps: ['s1'], index: 0 }, step: { id: 's1', name: 'Strike' }, caseId: 'c1' } });
    flushSync();
    return spec.elements.at(-1);
  }

  it('is shown on its step, or carried to the steps after it, or put back on the whole day', () => {
    const note = onStep({ kind: 'text', step: 's1' });
    press(act('And the next ones'));
    expect(note.carry).toBe(true);
    press([...document.body.querySelectorAll('.days button')].find((button) => button.textContent === 'Put it on the whole day'));
    expect([note.step, note.onward, note.until]).toEqual([null, '2026-10-05', '2026-10-05']);
    // back on the day, it can be sent to the step shown
    press([...document.body.querySelectorAll('button')].find((button) => button.textContent === 'Only on Strike'));
    expect([note.step, note.carry, note.onward]).toEqual(['s1', false, null]);
  });

  it('sets a video\'s clip by its times, its sound and its source line', () => {
    const video = onStep({ kind: 'video', step: 's1', src: 'media/strike.mp4', clip: [0, 10], caption: true, text: 'GeoWatch · x.com', sound: false });
    expect(document.body.textContent).toContain('which runs as long as the clip');
    const start = document.body.querySelector('input[aria-label="Clip start"]');
    start.value = '1:05'; start.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    // an end that came before the new start is moved after it
    expect(video.clip).toEqual([65, 75]);
    const end = document.body.querySelector('input[aria-label="Clip end"]');
    end.value = 'later'; end.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    expect(video.clip).toEqual([65, 75]);
    expect(end.value).toBe('1:15');
    expect(document.body.querySelector('input[aria-label="Volume"]')).toBeNull();
    const sound = [...document.body.querySelectorAll('label.check')].find((label) => label.textContent.includes('In the video')).querySelector('input');
    sound.click(); flushSync();
    expect(video.sound).toBe(true);
    expect(document.body.querySelector('input[aria-label="Volume"]')).not.toBeNull();
    expect(document.body.querySelector('input[aria-label="Source line"]').value).toBe('GeoWatch · x.com');
    // a video stays upright: the clip is laid in its box as it is
    expect(document.body.querySelector('input[aria-label="Rotation"]')).toBeNull();
  });

  it('says a video went off the page, and brings it back by a press', () => {
    const video = onStep({ kind: 'video', step: 's1', src: 'media/strike.mp4', clip: [0, 10], box: [-420, 260, 80, 45] });
    const back = [...document.body.querySelectorAll('.warn button')].find((button) => button.textContent === 'Bring it back');
    expect(back.closest('.warn').textContent).toContain('Off the page.');
    press(back);
    expect(video.box).toEqual([0, 165, 80, 45]);
    expect(document.body.textContent).not.toContain('Off the page.');
  });
});

describe('a symbol on the map', () => {
  it('offers the states a layer\'s marker offers, worded alike, nothing said first', () => {
    const symbol = show({ kind: 'symbol', element: { symbol: 'pin', status: '' } });
    const states = [...document.body.querySelectorAll('[aria-label="Symbol state"] button')];
    expect(states.map((button) => [button.textContent, button.title])).toEqual([
      ['–', 'No damage said, drawn plain'], ['Damaged', 'Drawn with a stroke across it'], ['Destroyed', 'Drawn with a cross over it']]);
    expect(states[0].getAttribute('aria-pressed')).toBe('true');
    press(states[2]);
    expect(symbol.status).toBe('destroyed');
    expect([...document.body.querySelectorAll('.rows .key')].filter((key) => ['Symbol', 'Size', 'State'].includes(key.textContent))
      .every((key) => key.title)).toBe(true);
  });
});

describe('hover help on every setting', () => {
  // what the pointer can rest on: every field, every chooser, every row's key and every button
  const settings = () => [...document.body.querySelectorAll('.inspector :is(select, input:not([type="file"]), textarea, [role="group"], .key, button.btn)')];
  const bare = () => settings().filter((node) => !node.closest('[title]')?.getAttribute('title'))
    .map((node) => node.getAttribute('aria-label') || node.textContent.trim() || node.outerHTML.slice(0, 60));
  const settle = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); flushSync(); };

  it.each([
    'text', 'label', 'credits', 'key', 'table', 'qr', 'timeline', 'legend', 'scale', 'north', 'signature', 'brand', 'image', 'shape',
  ])('says what each setting of a %s does', async (kind) => {
    const of = kind === 'legend' || kind === 'scale' || kind === 'north' || kind === 'credits' ? { of: 'map' } : {};
    show({ kind, element: { ...of, border: true, style: 'bubble', at: kind === 'label' ? [2.3, 48.8] : undefined, ...(kind === 'label' ? { of: 'map' } : {}) } });
    await settle();
    expect(settings().length).toBeGreaterThan(3);
    expect(bare()).toEqual([]);
  });

  it('says what each setting of a video does', async () => {
    show({ kind: 'video', element: { step: 's1', src: 'media/strike.mp4', clip: [0, 8], sound: true, caption: true } });
    await settle();
    expect(settings().length).toBeGreaterThan(8);
    expect(bare()).toEqual([]);
  });

  it('finds a setting left without its words', async () => {
    show({ kind: 'text' });
    await settle();
    const stray = document.createElement('select');
    document.body.querySelector('.inspector .flow').append(stray);
    await settle();
    expect(bare()).toHaveLength(1);
  });

  it.each(['arrow', 'measure', 'ring', 'cone', 'zone', 'line', 'symbol'])('says what each setting of a %s on the map does', async (kind) => {
    show({ kind, element: { of: 'map', at: [2.3, 48.8], to: [2.4, 48.9], points: [[2.3, 48.8], [2.4, 48.9], [2.35, 48.95]], heads: 'end', mask: { on: true } } });
    await settle();
    expect(bare()).toEqual([]);
  });

  it('says what each setting of a map, its ground, imagery and layers does, and of the page', async () => {
    const spec = $state(houseLayout());
    const map = spec.elements.find((element) => element.kind === 'map');
    map.grid = 'latlon';
    map.terrain = 1.5;
    const rows = [{ name: 'front', title: 'Front', categories: [{ name: 'Lines' }] }];
    map.layers = [{ name: 'front', hidden: [], stroke: 1, icons: 1 }];
    held = mount(PlateInspector, { target: document.body, props: { spec, selection: [map.id], rows, grounds: [['plain', 'Plain'], ['esri-world-imagery', 'Imagery']] } });
    flushSync(); await settle();
    expect(bare()).toEqual([]);
    map.basemap = 'esri-world-imagery'; flushSync(); await settle();
    expect(bare()).toEqual([]);
    unmount(held); held = null; document.body.innerHTML = '';
    spec.transitions = { on: true };
    held = mount(PlateInspector, { target: document.body, props: { spec, selection: [], plays: true } });
    flushSync(); await settle();
    expect(bare()).toEqual([]);
    unmount(held); held = null; document.body.innerHTML = '';
    held = mount(PlateInspector, { target: document.body, props: { spec, selection: spec.elements.slice(-3).map((element) => element.id) } });
    flushSync(); await settle();
    expect(bare()).toEqual([]);
  });

  it('lists a map\'s layers a line each, saying what the map does to each, its page opened by a press', async () => {
    const spec = $state(houseLayout());
    const map = spec.elements.find((element) => element.kind === 'map');
    map.layers = [{ name: 'front', hidden: ['Rumoured'], stroke: 1, icons: 1, role: 'claimed', fill: 'hatch' }, { name: 'roads', hidden: [], stroke: 1, icons: 1 }];
    const rows = [{ name: 'front', title: 'Front', categories: [] }, { name: 'roads', title: 'Roads', categories: [] }, { name: 'ports', title: 'Ports', categories: [] }];
    const opened = [];
    held = mount(PlateInspector, { target: document.body, props: { spec, selection: [map.id], rows, onlayer: (on, row) => opened.push([on.id, row.name]) } });
    flushSync(); await settle();
    // what the map shows comes first: its ground and its layers, before how it is drawn
    expect([...document.body.querySelectorAll('.part .title')].map((node) => node.textContent)).toEqual(['Ground', 'Layers', '3D', 'Grid', 'The plain ground']);
    // the settings a layer had under it are on its page now: none of them stands in the list
    expect(document.body.querySelector('[aria-label="Front stands for"]')).toBeNull();
    expect([...document.body.querySelectorAll('.layer-said')].map((node) => node.textContent)).toEqual(['Claimed · hatched · 1 group left out', 'Its own look']);
    press(document.body.querySelector('.layer-said'));
    press(document.body.querySelector('[aria-label="Roads on this map"]'));
    expect(opened).toEqual([[map.id, 'front'], [map.id, 'roads']]);
    // a layer the map does not draw has no page to open
    expect(document.body.querySelector('[aria-label="Ports on this map"]')).toBeNull();
    expect(bare()).toEqual([]);
  });

  it('sets a country focus: the rest darkened or faded, how far, and its days like any annotation', async () => {
    const focus = show({ kind: 'focus', element: { of: 'map', name: 'Ukraine', spotlight: { country: 'Ukraine', dim: 0.55, mode: 'dark' } } });
    [...document.body.querySelectorAll('[aria-label="The rest of the world"] button')].find((node) => node.textContent === 'Faded').click(); flushSync();
    expect(focus.spotlight).toEqual({ country: 'Ukraine', dim: 0.55, mode: 'fade' });
    const strength = document.body.querySelector('[aria-label="Focus strength"]');
    strength.value = '0.3'; strength.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    expect(focus.spotlight.dim).toBe(0.3);
    expect(document.body.querySelector('[aria-label="Country lit"]').value).toBe('Ukraine');
    // on a played plate it is shown from a first to a last day, as the other annotations are
    expect(end('First day shown')).not.toBeNull();
    expect(document.body.textContent).toContain('faded in by the video');
  });

  it('says it in the words kept for it, and follows a setting whose name changes', async () => {
    show({ kind: 'text' });
    await settle();
    expect(document.body.querySelector('[aria-label="Letter spacing"]').getAttribute('title')).toBe('Space between the letters');
    // a key says what the control beside it does
    const key = [...document.body.querySelectorAll('.key')].find((node) => node.textContent === 'Spacing');
    expect(key.getAttribute('title')).toBe('Space between the letters');
  });
});

describe('the ground, the type and the layers of a plate', () => {
  const settings = () => [...document.body.querySelectorAll('.inspector :is(select, input:not([type="file"]), textarea, [role="group"], [role="radiogroup"], .key, button.btn)')];
  const bare = () => settings().filter((node) => !node.closest('[title]')?.getAttribute('title'))
    .map((node) => node.getAttribute('aria-label') || node.textContent.trim() || node.outerHTML.slice(0, 60));
  const settle = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); flushSync(); };
  const grounds = [['plain', 'Plain'], ['plain-relief', 'Shaded relief'], ['s2cloudless', "Sentinel-2 cloudless, a year's mosaic"]];
  const years = [{ year: 2025, licence: 'CC BY-NC-SA 4.0, non-commercial use', free: false }, { year: 2016, licence: 'CC BY 4.0', free: true }];

  function showMap(props = {}) {
    const spec = $state(houseLayout());
    const map = spec.elements.find((element) => element.kind === 'map');
    // the plate's one Sentinel-2 state, bound to the map picked alone, as MapPlate keeps it
    let sentinel = null;
    roots.push($effect.root(() => {
      sentinel = createPlateSentinel({ target: () => map, place: (picked) => ({ lat: picked.view.lat, lon: picked.view.lon }), notify: () => {}, api });
    }));
    held = mount(PlateInspector, { target: document.body, props: { spec, selection: [map.id], grounds, years, sentinel, ...props } });
    flushSync();
    return { spec, map };
  }

  it('picks a ground from its tiles, and a year of Sentinel-2 cloudless with its licence', async () => {
    const { map } = showMap();
    const tile = (label) => [...document.body.querySelectorAll('.ground-tile')].find((node) => node.textContent.trim() === label);
    expect(tile('Plain').getAttribute('aria-checked')).toBe('true');
    tile('Shaded relief').click(); flushSync();
    expect(map.basemap).toBe('plain-relief');
    // a ground that shades its own relief has its strength, and no shading to ask for
    expect(document.body.querySelector('[aria-label="Relief strength"]')).not.toBeNull();
    expect([...document.body.querySelectorAll('.checks label')].some((node) => node.textContent.trim() === 'Relief shading')).toBe(false);
    expect([...document.body.querySelectorAll('.checks label')].some((node) => node.textContent.trim() === 'Heights in colour')).toBe(true);
    await settle();
    expect(bare()).toEqual([]);
    tile("Sentinel-2 cloudless, a year's mosaic").click(); flushSync();
    expect(document.body.textContent).toContain('Free for non-commercial use only');
    const year = document.body.querySelector('[aria-label="Cloudless year"]');
    year.value = '2016'; year.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    expect(map.year).toBe(2016);
    expect(document.body.textContent).toContain('Free for any use, with its credit.');
    await settle();
    expect(bare()).toEqual([]);
  });

  /** Copernicus as a fake: the passes of any month, and the layers the configuration serves. */
  function copernicus(dates) {
    const asked = [];
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      asked.push(String(url));
      const body = String(url).includes('/sentinel/layers')
        ? { layers: [{ id: 'TRUE_COLOR', label: 'True colour' }, { id: 'SWIR', label: 'Short-wave infrared' }], source: 'instance' }
        : { dates };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    return { asked, restore: () => fetch.mockRestore() };
  }
  const passes = [{ date: '2026-10-18', cloud: 76 }, { date: '2026-10-13', cloud: 8.2 }, { date: '2026-10-08', cloud: 0 }];

  it('draws Sentinel-2 on one pass, the newest under 30% cloud, picked on Satellite\'s own calendar and layers', async () => {
    const copernicus$ = copernicus(passes);
    try {
      const { map } = showMap({ grounds: [...grounds, ['sentinel2', 'Sentinel-2, one dated pass']] });
      await settle();
      expect(copernicus$.asked).toEqual([]);
      const tile = (label) => [...document.body.querySelectorAll('.ground-tile')].find((node) => node.textContent.trim() === label);
      tile('Sentinel-2, one dated pass').click(); flushSync();
      await vi.waitFor(() => expect(map.acquired).toBe('2026-10-13'));
      flushSync();
      expect(copernicus$.asked[0]).toContain('/api/satellite/sentinel/dates?');
      expect(map).toMatchObject({ basemap: 'sentinel2', maxcc: 30 });
      expect(map.product ?? '').toBe('');
      expect(document.body.textContent).toContain('the pass of 2026-10-13, the newest under 30% cloud.');
      // the calendar and the layers are Satellite's: another layer is the map's
      document.body.querySelector('[aria-label="Sentinel-2 layer and date"]').click(); flushSync();
      await settle();
      const layer = document.body.querySelector('.s2-menu select');
      await vi.waitFor(() => expect([...layer.options].map((option) => option.value)).toContain('SWIR'));
      expect(document.body.querySelectorAll('.cal-day.has').length).toBeGreaterThan(0);
      // a ceiling of any cloud: the newest pass is the map's, cloudy as it is
      const ceiling = document.body.querySelector('[aria-label="Maximum cloud cover"]');
      ceiling.value = '100'; ceiling.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
      await vi.waitFor(() => expect(map.acquired).toBe('2026-10-18'));
      expect(map.maxcc).toBe(100);
      expect(bare()).toEqual([]);
    } finally { copernicus$.restore(); }
  });

  it('looks for the newest pass of a map set on Sentinel-2 from its bar too, and not for one already on a pass', async () => {
    const copernicus$ = copernicus(passes);
    try {
      const { map } = showMap({ grounds: [...grounds, ['sentinel2', 'Sentinel-2, one dated pass']] });
      map.basemap = 'sentinel2'; flushSync();
      await vi.waitFor(() => expect(map.acquired).toBe('2026-10-13'));
      const asked = copernicus$.asked.length;
      map.basemap = 'plain'; flushSync();
      map.basemap = 'sentinel2'; flushSync();
      await settle();
      expect(copernicus$.asked.length).toBe(asked);
      expect(map.acquired).toBe('2026-10-13');
    } finally { copernicus$.restore(); }
  });

  it('sets the Wayback release and the layers as they stood that day under the ground, where the bar sets them too', async () => {
    const releases = [{ release: 900, date: '2025-02-20' }, { release: 41, date: '2024-03-12' }];
    const wayback = [...grounds, ['esri-wayback', 'World Imagery Wayback, dated']];
    const { map } = showMap({ grounds: wayback, releases });
    map.basemap = 'esri-wayback'; flushSync();
    const release = document.body.querySelector('[aria-label="Wayback release"]');
    release.value = '41'; release.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    expect(map.release).toBe(41);
    const layered = () => [...document.body.querySelectorAll('.inspector label')].find((node) => node.textContent.trim() === 'Layers as they stood that day');
    // under the ground's day, not at the foot of the layers
    expect(layered().closest('section')?.textContent).toContain('Release');
    layered().querySelector('input').click(); flushSync();
    expect(map.layers_on).toBe('imagery');
    await settle();
    expect(bare()).toEqual([]);
    unmount(held); held = null; document.body.innerHTML = '';
    // a template keeps no layers
    const { map: kept } = showMap({ grounds: wayback, releases, template: true });
    kept.basemap = 'esri-wayback'; flushSync();
    expect(document.body.querySelector('[aria-label="Wayback release"]')).not.toBeNull();
    expect(layered()).toBeUndefined();
  });

  it('keeps Sentinel-2 in sight, locked, with the steps to a free account, while Copernicus is not set up', () => {
    showMap();
    const locked = document.body.querySelector('.ground-tile.locked');
    expect(locked.textContent).toContain('Sentinel-2, one dated pass');
    expect(document.body.querySelector('.setup')).toBeNull();
    locked.click(); flushSync();
    expect(document.body.querySelector('.setup').textContent).toContain('dataspace.copernicus.eu');
    expect(document.body.textContent).toContain('free and with no card');
  });

  it('sets a plain ground\'s detail, presence and borders, its colours folded until asked', async () => {
    const { map } = showMap();
    expect(document.body.querySelector('[aria-label="Land colour"]')).toBeNull();
    [...document.body.querySelectorAll('[aria-label="Ground detail"] button')].find((node) => node.textContent === 'Less').click(); flushSync();
    expect(map.plain.density).toBe('low');
    const presence = document.body.querySelector('[aria-label="Ground presence"]');
    presence.value = '0.5'; presence.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    expect(map.plain.presence).toBe(0.5);
    [...document.body.querySelectorAll('[aria-label="Borders drawn"] button')].find((node) => node.textContent === 'Districts').click(); flushSync();
    expect(map.plain.admin).toBe('districts');
    [...document.body.querySelectorAll('button')].find((node) => node.textContent.startsWith('Change the colours')).click(); flushSync();
    expect(document.body.querySelector('[aria-label="Land colour"]')).not.toBeNull();
    await settle();
    expect(bare()).toEqual([]);
  });

  it('sets a map to the edges of the page, its frame off, or to the margins its guides draw, unless it is locked', () => {
    const { spec, map } = showMap();
    const button = (text) => [...document.body.querySelectorAll('.inspector button')].find((node) => node.textContent.trim() === text);
    const before = spec.elements.filter((element) => element.id !== map.id).map((element) => element.box);
    button('To the margins').click(); flushSync();
    expect(map.box).toEqual([9, 9, 279, 192]);
    expect(map.border).not.toBe(false);
    button('To the edges').click(); flushSync();
    expect(map.box).toEqual([0, 0, 297, 210]);
    expect(map.border).toBe(false);
    // the rest of the page stays where it was
    expect(spec.elements.filter((element) => element.id !== map.id).map((element) => element.box)).toEqual(before);
    map.locked = true; flushSync();
    expect(button('To the edges').disabled).toBe(true);
    expect(button('To the margins').disabled).toBe(true);
  });

  it('offers a new layer here, and a layer of what was drawn on the map once something is', () => {
    const made = [];
    const spec = $state(houseLayout());
    const map = spec.elements.find((element) => element.kind === 'map');
    spec.elements.push({ id: 'z', kind: 'zone', of: map.id, box: [0, 0, 1, 1], points: [[2, 48], [2.1, 48], [2.1, 48.1]] });
    held = mount(PlateInspector, { target: document.body, props: { spec, selection: [map.id], grounds,
      onnewlayer: (element) => made.push(['new', element.id]), onkeepdrawn: (element) => made.push(['keep', element.id]) } });
    flushSync();
    const button = (start) => [...document.body.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(start));
    button('New layer here').click();
    button('Make a layer of the 1 drawn here').click();
    expect(made).toEqual([['new', map.id], ['keep', map.id]]);
  });

  it('sets a text in a style of the page, and draws an inset as a globe', async () => {
    const note = show({ kind: 'text' });
    const style = document.body.querySelector('[aria-label="Text role"]');
    style.value = 'kicker'; style.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    expect(note).toMatchObject({ role: 'kicker', upper: true, weight: 700 });
    unmount(held); held = null; document.body.innerHTML = '';
    const inset = show({ kind: 'inset', element: { of: 'map' } });
    const globe = [...document.body.querySelectorAll('label')].find((node) => node.textContent.trim() === 'Drawn as a globe').querySelector('input');
    globe.click(); flushSync();
    expect(inset.globe).toBe(true);
    // a globe is never zoomed, and its rim is its frame
    expect(document.body.querySelector('[aria-label="Inset zoom"]')).toBeNull();
    expect(document.body.querySelector('[aria-label="Inset frame"]')).toBeNull();
    await settle();
    expect(bare()).toEqual([]);
  });

  it('keeps a globe a globe where laying it flat would make a ninth map', () => {
    // the house layout's map and inset, and six more
    const maps = Array.from({ length: 6 }, (_, index) => ({ id: `m${index}`, kind: 'map', box: [0, 0, 10, 10], view: { lat: 0, lon: 0, zoom: 3, bearing: 0 } }));
    const spec = $state(houseLayout());
    spec.elements = [...spec.elements.filter((element) => element.kind !== 'map' || element.id === 'map'), ...maps];
    spec.elements.push({ id: 'note', kind: 'inset', of: 'map', box: [10, 10, 40, 30], globe: true });
    held = mount(PlateInspector, { target: document.body, props: { spec, selection: ['note'], at: '2026-10-05', moments: [] } });
    flushSync();
    const before = spec.elements.filter((element) => ['map', 'inset'].includes(element.kind) && !element.globe).length;
    expect(before).toBe(8);
    const globe = [...document.body.querySelectorAll('label')].find((node) => node.textContent.trim() === 'Drawn as a globe').querySelector('input');
    globe.click(); flushSync();
    expect(spec.elements.at(-1).globe).toBe(true);
    expect(globe.checked).toBe(true);
  });
});

describe('the words a text fills in', () => {
  it('are put in by a press, where the cursor stands, each saying what it writes', () => {
    const note = show({ kind: 'text', element: { text: 'As of ' } });
    const chip = (token) => [...document.body.querySelectorAll('.token')].find((node) => node.textContent === token);
    expect(chip('{coords}').title).toMatch(/^The main map's middle/);
    chip('{date}').click(); flushSync();
    expect(note.text).toBe('As of {date}');
    const field = document.body.querySelector('[aria-label="Text"]');
    field.focus(); field.setSelectionRange(0, 0);
    chip('{case}').click(); flushSync();
    expect(note.text).toBe('{case}As of {date}');
  });
});

describe('the credits box', () => {
  it('takes a layer\'s credit off and puts it back, and keeps what a ground\'s terms ask for', () => {
    const spec = $state(houseLayout());
    const credits = spec.elements.find((element) => element.kind === 'credits');
    const creditList = [{ text: 'Esri', owed: true }, { text: 'GeoConfirmed — geoconfirmed.org', owed: false }];
    held = mount(PlateInspector, { target: document.body, props: { spec, selection: [credits.id], creditList } });
    flushSync();
    const boxes = [...document.body.querySelectorAll('.credit-list input')];
    expect(boxes.map((box) => [box.checked, box.disabled])).toEqual([[true, true], [true, false]]);
    boxes[1].click(); flushSync();
    expect(credits.dropped).toEqual(['GeoConfirmed — geoconfirmed.org']);
    boxes[1].click(); flushSync();
    expect(credits.dropped).toEqual([]);
  });
});

describe('a GIF on a step', () => {
  it('plays as a video does, its run time set rather than trimmed, and holds its step that long', () => {
    const note = show({ kind: 'video', element: { src: 'media/loop.gif', clip: [0, 3], step: 's1', text: '' } });
    expect(document.body.querySelector('img.trim')).not.toBeNull();
    expect(document.body.querySelector('video.trim')).toBeNull();
    const runs = document.body.querySelector('[aria-label="GIF runs"]');
    runs.value = '0:07'; runs.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    expect(note.clip).toEqual([0, 7]);
    expect(document.body.textContent).toContain('A GIF plays round and round');
  });
});
