// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorSelection, EditorState } from '@codemirror/state';
import { undo } from '@codemirror/commands';

/**
 * A map in the drawn note: drawn as the page draws it, its settings on its card in five
 * tabs, each choice one line of exact words and one Undo step, a base filed on its press,
 * and an area, a point or a line drawn on the map into the layer the map names.
 */

const server = vi.hoisted(() => ({ asked: [], described: null, ground: null, feature: null, detail: null }));
vi.mock('../../api.js', async (original) => {
  const real = await original();
  return {
    ...real,
    api: {
      ...real.api,
      post: vi.fn(async (path, body) => {
        server.asked.push({ path, body });
        if (path.endsWith('/notes/maps/describe')) return server.described(body);
        if (path.endsWith('/notes/maps/ground')) return server.ground(body);
        if (path.endsWith('/notes/maps/layer')) return { name: 'The front, drawn', title: 'The front, drawn' };
        if (path.endsWith('/notes/maps/features')) return server.feature(body);
        if (path.endsWith('/notes/maps/detail')) return server.detail(body);
        throw new Error(`not stood in: ${path}`);
      }),
      patch: vi.fn(async (path, body) => {
        server.asked.push({ path, body });
        return { key: 'k1' };
      }),
      del: vi.fn(async (path) => {
        server.asked.push({ path });
        return { removed: 'k1' };
      }),
    },
  };
});

const { focusedState, noteExtensions, setNoteCase } = await import('../liveMarkdown.js');
const { projection } = await import('./mapSurface.js');
const { forgetMaps } = await import('../mapSettings.svelte.js');
const { ESRI_TERMS, fitView, viewText } = await import('./mapText.js');

const BLOCK = [
  '::: map', 'title: The front', 'layer: Front line', 'layer: Vehicles', 'proofs: 2026-10-19..2026-11-02', 'ground: e_g1',
  'view: 12.73976, 43.51350, 12.05', ':::',
].join('\n');
const NOTE = `Before.\n\n${BLOCK}\n\nAfter.`;
const SVG = '<svg class="az-map-svg" viewBox="0 0 1600 1000"><g class="az-points"><g class="az-f az-point" data-id="l0f0"></g></g></svg>';
const DESCRIBED = {
  title: 'The front', base: 'satellite', bounds: [43.4, 12.68, 43.6, 12.8], frame: [1600, 1000], extent: [43.45, 12.69, 43.57, 12.79],
  view: { center: [43.5135, 12.73976], zoom: 12.05, bearing: 0 },
  ground: { id: 'e_g1', path: 'media/ground one.png', bounds: [43.4, 12.68, 43.6, 12.8] }, svg: SVG,
  layers: [
    { name: 'Front line', title: 'Front line', from: 'line', on: true, colour: '', colours: ['#1e88e5'], features: 1, editable: true, own: false, missing: false },
    { name: 'Vehicles', title: 'Vehicles', from: 'line', on: true, colour: '', colours: ['#e53935'], features: 54, editable: true, own: false, missing: false },
  ],
  others: [{ name: 'YEMEN', title: 'YEMEN', features: 59 }], drawings: [],
  proofs: { count: 13, first: '2026-10-19', last: '2026-11-15' },
  days: ['2026-10-06', '2026-10-14', '2026-10-19', '2026-10-20', '2026-11-16'], day: '2026-11-16',
  steps: [
    { label: '', day: '2026-10-19', text: 'Seen on the heights.', name: 'Proof 17', proof: 'e_p17', view: [12.7377, 43.50166, 14.05] },
    { label: '', day: '2026-10-20', text: 'Seen again.', name: 'Proof 15', proof: 'e_p15', view: [12.72949, 43.50023, 14.05] },
  ],
  own_steps: false, palette: [{ name: 'Government', colour: '#1e88e5' }], providers: [], warnings: [],
};

let view;
let handlers;
beforeEach(() => {
  server.asked = [];
  server.described = () => DESCRIBED;
  server.ground = () => ({ ground: 'e_osm', details: ['e_osm2'], view: '12.73976, 43.51350, 12.05', filed: ['e_osm', 'e_osm2'], base: 'map' });
  server.feature = (body) => ({ layer: body.layer, key: 'k1' });
  server.detail = () => ({ detail: 'e_view1', details: ['e_view1'], filed: ['e_view1'] });
  forgetMaps();
});
afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function editor(doc = NOTE) {
  const parent = document.createElement('div');
  document.body.append(parent);
  handlers = { tableToast: vi.fn(), open: vi.fn(), noteKey: 'c1:n1', noteId: 'n1' };
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ handlers, mode: 'drawn' }) }) });
  view.setState(focusedState(view.state.update({ selection: EditorSelection.cursor(0) }).state));
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [] }) });
  view.focus = vi.fn();
  return view;
}

const text = () => view.state.doc.toString();
const block = () => text().slice(text().indexOf('::: map'), text().indexOf(':::\n\nAfter') + 3);
const settle = async () => {
  for (let step = 0; step < 6; step += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const press = (node) => {
  node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  node.click();
};
const map = () => view.dom.querySelector('.cm-map-block');
const panel = () => map().querySelector('.cm-map-settings');
const named = (label) => panel().querySelector(`[aria-label="${label}"]`);
const radio = (group, words) => [...named(group).querySelectorAll('[role="radio"]')].find((node) => node.textContent === words);
const tab = (words) => [...panel().querySelectorAll('[role="tab"]')].find((node) => node.textContent === words);
const lines = () => block().split('\n');
async function opened(which = 'Look') {
  editor();
  await settle();
  press(map().querySelector('.cm-map-settings-btn'));
  await settle();
  press(tab(which));
  await settle();
}

describe('a map drawn in the note', () => {
  it('is drawn as the page draws it, over its ground, read once and fetching nothing', async () => {
    editor();
    await settle();
    expect(server.asked).toEqual([{ path: '/api/cases/c1/notes/maps/describe', body: { text: BLOCK } }]);
    const ground = map().querySelector('img.cm-map-ground');
    expect(ground.getAttribute('src')).toBe('/files/c1/media/ground%20one.png');
    expect(ground.style.width).toBe('100%');
    expect(map().querySelector('.cm-map-drawing svg.az-map-svg')).not.toBeNull();
    expect(map().querySelector('.cm-map-said').textContent).toBe('The frontLayers: Front line, VehiclesProofs: 2026-10-19 to 2026-11-02');
    expect([...map().querySelectorAll('.cm-map-bar button')].map((node) => node.getAttribute('aria-label') ?? node.textContent))
      .toEqual(['Draw', 'Settings', 'Edit the source']);
  });

  it('opens its settings in five tabs on its card', async () => {
    await opened();
    expect([...panel().querySelectorAll('[role="tab"]')].map((node) => node.textContent)).toEqual(['Look', 'Layers', 'Draw', 'Time', 'Cards']);
    expect(radio('Base', 'Satellite').getAttribute('aria-checked')).toBe('true');
    expect(radio('Size', 'Wide').getAttribute('aria-checked')).toBe('true');
    expect(radio('Scale', 'Page').getAttribute('aria-checked')).toBe('true');
  });
});

describe('each choice is one line and one Undo step', () => {
  it('writes the size, the legend, a north arrow and the scale in their own words', async () => {
    await opened();
    press(radio('Size', 'Full height'));
    press(radio('Legend', 'Folded'));
    press(radio('North arrow', 'On'));
    press(radio('Scale', 'Page + PDF'));
    expect(lines().slice(-5)).toEqual(['north: on', 'scale: on', 'size: full', 'legend: folded', ':::']);
    undo(view);
    expect(lines().slice(-4)).toEqual(['north: on', 'size: full', 'legend: folded', ':::']);
    undo(view);
    undo(view);
    undo(view);
    expect(block()).toBe(BLOCK);
  });

  it('files a base on its press, then writes it, its ground and its close-ups as one step', async () => {
    await opened();
    press(radio('Base', 'Map'));
    await settle();
    expect(server.asked.find((one) => one.path.endsWith('/ground')).body).toEqual({ text: BLOCK, base: 'map' });
    expect(lines()).toEqual(['::: map', 'title: The front', 'layer: Front line', 'layer: Vehicles', 'proofs: 2026-10-19..2026-11-02',
      'ground: e_osm', 'detail: e_osm2', 'view: 12.73976, 43.51350, 12.05', 'base: map', ':::']);
    undo(view);
    expect(block()).toBe(BLOCK);
  });

  it('files the imagery picked on its press, then writes it with its ground as one step', async () => {
    server.ground = () => ({ ground: 'e_s2', details: [], view: '12.73976, 43.51350, 12.05', filed: ['e_s2'], base: '' });
    await opened();
    expect(named('Imagery').querySelector('[aria-checked="true"]')).toBeNull();
    expect(radio('Imagery', 'Sentinel-2 · free').title).toContain('free with its credit');
    press(radio('Imagery', 'Sentinel-2 · free'));
    await settle();
    expect(server.asked.find((one) => one.path.endsWith('/ground')).body).toEqual({ text: BLOCK.replace('\n:::', '\nimagery: sentinel\n:::'), base: 'satellite' });
    expect(lines()).toEqual(['::: map', 'title: The front', 'layer: Front line', 'layer: Vehicles', 'proofs: 2026-10-19..2026-11-02',
      'ground: e_s2', 'view: 12.73976, 43.51350, 12.05', 'imagery: sentinel', ':::']);
    expect(radio('Imagery', 'Sentinel-2 · free').getAttribute('aria-checked')).toBe('true');
    expect(panel().textContent).not.toContain(ESRI_TERMS);
    undo(view);
    expect(block()).toBe(BLOCK);
  });

  it('says Esri’s terms once Esri is picked, in one line under the choice, and never on a card opened later', async () => {
    server.ground = () => ({ ground: 'e_esri', details: [], view: '12.73976, 43.51350, 12.05', filed: [], base: '' });
    await opened();
    press(radio('Imagery', 'Esri · sharper'));
    await settle();
    expect(lines()).toContain('imagery: esri');
    const said = () => [...named('Imagery').closest('.cm-map-field').querySelectorAll('.cm-map-note')].filter((node) => node.textContent === ESRI_TERMS);
    expect(said()).toHaveLength(1);
    press(radio('Size', 'Half'));
    await settle();
    expect(said()).toHaveLength(1);
    // the card closed and opened again: picked before, Esri says nothing more
    press(map().querySelector('.cm-map-settings-btn'));
    press(map().querySelector('.cm-map-settings-btn'));
    await settle();
    expect(radio('Imagery', 'Esri · sharper').getAttribute('aria-checked')).toBe('true');
    expect(said()).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('shows the imagery a map that names none was filed from, says Sentinel-2 blurs close in, and only under Satellite', async () => {
    server.described = () => ({ ...DESCRIBED, imagery: 'sentinel', bounds: [43.49, 12.74, 43.51, 12.75] });
    await opened();
    expect(radio('Imagery', 'Sentinel-2 · free').getAttribute('aria-checked')).toBe('true');
    expect(named('Imagery').closest('.cm-map-field').textContent).toContain('Sentinel-2 is 10 m: details this close will blur.');
    server.described = () => ({ ...DESCRIBED, imagery: 'esri' });
    forgetMaps();
    view.destroy();
    await opened();
    expect(radio('Imagery', 'Esri · sharper').getAttribute('aria-checked')).toBe('true');
    expect(named('Imagery').closest('.cm-map-field').querySelector('.cm-map-note')).toBeNull();
    view.destroy();
    editor(NOTE.replace(BLOCK, BLOCK.replace('\n:::', '\nbase: map\n:::')));
    await settle();
    press(map().querySelector('.cm-map-settings-btn'));
    await settle();
    expect(named('Imagery')).toBeNull();
  });

  it('keeps a live map’s readers inside its frame on a tick, one line', async () => {
    await opened();
    const keep = named('Keep readers inside the frame');
    expect(keep.closest('label').textContent).toBe('Keep readers inside');
    keep.checked = true;
    keep.dispatchEvent(new Event('change', { bubbles: true }));
    expect(lines().slice(-2)).toEqual(['bounds: ground', ':::']);
    undo(view);
    expect(block()).toBe(BLOCK);
  });

  it('says why a base cannot be filed and keeps the map as it was', async () => {
    server.ground = () => { throw new Error('The street map could not be fetched, so the map keeps its ground. Try again once online.'); };
    await opened();
    press(radio('Base', 'Map'));
    await settle();
    expect(block()).toBe(BLOCK);
    expect(handlers.tableToast).toHaveBeenCalledWith('The street map could not be fetched, so the map keeps its ground. Try again once online.', [], 'warn');
  });

  it('hides a layer, paints one in a colour of the case, adds another and shows only where proofs were filmed', async () => {
    await opened('Layers');
    const hide = named('Show Vehicles');
    hide.checked = false;
    hide.dispatchEvent(new Event('change', { bubbles: true }));
    expect(lines().at(-2)).toBe('hide: Vehicles');
    const colour = named('Colour of Front line');
    colour.value = '#1e88e5';
    colour.dispatchEvent(new Event('change', { bubbles: true }));
    expect(lines().slice(-3, -1)).toEqual(['hide: Vehicles', 'colour: Front line = #1e88e5']);
    const add = named('Add a layer');
    add.value = 'YEMEN';
    add.dispatchEvent(new Event('change', { bubbles: true }));
    expect(lines().filter((line) => line.startsWith('layer: '))).toEqual(['layer: Front line', 'layer: Vehicles', 'layer: YEMEN']);
    press(radio('Proof points', 'Only where it was filmed'));
    press(radio('Crowds past', '20'));
    press(radio('Names', 'None'));
    expect(lines().slice(-6, -1)).toEqual(['hide: Vehicles', 'colour: Front line = #1e88e5', 'proof points: filmed', 'labels: off', 'crowds: 20']);
    for (let step = 0; step < 6; step += 1) undo(view);
    expect(block()).toBe(BLOCK);
  });

  it('makes a layer from a sheet and puts it on this map in one line, only where the note can', async () => {
    await opened('Layers');
    const offered = () => [...panel().querySelectorAll('.cm-map-act')].find((node) => node.textContent.includes('From a sheet'));
    expect(offered(), 'no dialog to open, no press').toBeUndefined();
    view.destroy();
    document.body.replaceChildren();
    editor();
    handlers.sheetMap = vi.fn();
    await settle();
    press(map().querySelector('.cm-map-settings-btn'));
    await settle();
    press(tab('Layers'));
    await settle();
    press(offered());
    expect(handlers.sheetMap).toHaveBeenCalledTimes(1);
    handlers.sheetMap.mock.calls[0][0].onmade({ name: 'Register', title: 'Register', made: { points: 21 } });
    await settle();
    expect(lines().filter((line) => line.startsWith('layer: '))).toEqual(['layer: Front line', 'layer: Vehicles', 'layer: Register']);
    expect(handlers.tableToast).toHaveBeenCalledWith('Layer “Register” made from its sheet: 21 points', [], undefined);
    undo(view);
    expect(block()).toBe(BLOCK);
  });

  it('sets the timeline, the day it opens on and Play’s pace', async () => {
    await opened('Time');
    const day = named('Opens on');
    day.value = '2026-10-21';
    day.dispatchEvent(new Event('change', { bubbles: true }));
    press(radio('Play speed', 'Fast'));
    press(radio('Timeline', 'Off'));
    expect(lines().slice(-4)).toEqual(['timeline: off', 'opens on: 2026-10-21', 'speed: fast', ':::']);
  });

  it('writes the steps its proofs gave it once one is moved, in the new order', async () => {
    await opened('Time');
    expect([...panel().querySelectorAll('.cm-map-step-day')].map((node) => node.textContent)).toEqual(['19 Oct 2026', '20 Oct 2026']);
    press(named('Move step 2 up'));
    expect(lines().slice(-3)).toEqual([
      'step: 2026-10-20 |  | 12.72949, 43.50023, 14.05 | e_p15 | Seen again.',
      'step: 2026-10-19 |  | 12.73770, 43.50166, 14.05 | e_p17 | Seen on the heights.',
      ':::',
    ]);
    undo(view);
    expect(block()).toBe(BLOCK);
  });

  it('says what a card shows by its ticks', async () => {
    await opened('Cards');
    const picture = named('Picture');
    picture.checked = false;
    picture.dispatchEvent(new Event('change', { bubbles: true }));
    expect(lines().at(-2)).toBe('card: sentence, source, verify');
  });
});

describe('drawing on the map', () => {
  /** The map's overlay, as wide as its frame, so a press lands where it says. */
  function overlay() {
    const over = map().querySelector('.cm-map-over');
    over.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1600, height: 1000, right: 1600, bottom: 1000 });
    return over;
  }
  const at = (over, type, x, y) => over.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));

  it('drags the map’s frame, written as its four sides', async () => {
    await opened();
    press([...panel().querySelectorAll('.cm-map-act')].find((node) => node.textContent === 'Draw the frame'));
    const over = overlay();
    expect(map().querySelector('.cm-map-hint').textContent).toBe('Drag a rectangle over the map: it shows that part. Esc cancels.');
    at(over, 'pointerdown', 400, 250);
    at(over, 'pointermove', 1200, 750);
    at(over, 'pointerup', 1200, 750);
    const frame = lines().find((line) => line.startsWith('frame: '));
    expect(frame).toMatch(/^frame: 43\.45000, 12\.71\d{3}, 43\.55000, 12\.77\d{3}$/);
    expect(map().querySelector('.cm-map-hint').hidden).toBe(true);
  });

  it('outlines an area to highlight, in a layer of the map’s own made at the first drawing, its size said', async () => {
    await opened('Draw');
    press([...panel().querySelectorAll('.cm-map-act')].find((node) => node.textContent === 'Area to highlight'));
    const over = overlay();
    for (const [x, y] of [[400, 300], [700, 300], [700, 600], [400, 600]]) at(over, 'pointerdown', x, y);
    view.dom.querySelector('.cm-map-stage').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    // the map names the layer made for it, one step of its own
    expect(lines().filter((line) => line.startsWith('layer: '))).toEqual(['layer: Front line', 'layer: Vehicles', 'layer: The front, drawn']);
    const drawn = server.asked.find((one) => one.path.endsWith('/notes/maps/features')).body;
    expect(drawn).toMatchObject({ layer: 'The front, drawn', kind: 'area', highlight: true, label: true, colour: '#d55e00' });
    expect(drawn.coords).toHaveLength(4);
    expect(drawn.name).toMatch(/^about \d+ km²$/);
    const [said, actions] = handlers.tableToast.mock.calls.at(-1);
    expect(said).toBe('Area highlighted in the layer of this map');
    expect(actions.map((one) => one.label)).toEqual(['Undo']);
  });

  it('puts a point in the map’s own layer, and Escape gives a line up', async () => {
    server.described = () => ({ ...DESCRIBED, layers: [...DESCRIBED.layers, { ...DESCRIBED.layers[0], name: 'Own', title: 'Own', own: true }] });
    await opened('Draw');
    press([...panel().querySelectorAll('.cm-map-act')].find((node) => node.textContent === 'Line'));
    const over = overlay();
    at(over, 'pointerdown', 100, 100);
    at(over, 'pointerdown', 300, 300);
    view.dom.querySelector('.cm-map-stage').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(server.asked.filter((one) => one.path.endsWith('/features'))).toEqual([]);
    press([...panel().querySelectorAll('.cm-map-act')].find((node) => node.textContent === 'Point'));
    at(overlay(), 'pointerdown', 800, 500);
    await settle();
    expect(server.asked.find((one) => one.path.endsWith('/features')).body).toMatchObject({ layer: 'Own', kind: 'point', coords: [expect.closeTo(43.5, 6), expect.any(Number)] });
    expect(server.asked.some((one) => one.path.endsWith('/notes/maps/layer'))).toBe(false);
    expect(block()).toBe(BLOCK);
  });
});

describe('moving the map in Draw', () => {
  /** The map's overlay as wide as its frame, so a press lands where it says and the whole map fills the stage. */
  function overlay() {
    const over = map().querySelector('.cm-map-over');
    over.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1600, height: 1000, right: 1600, bottom: 1000 });
    return over;
  }
  const at = (over, type, x, y, button = 0) => over.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button, clientX: x, clientY: y }));
  /** A turn of the wheel at a point of the stage (happy-dom's WheelEvent keeps no pointer of its own). */
  const wheel = (over, x, y, deltaY) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY });
    Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y } });
    over.dispatchEvent(event);
  };
  const key = (target, type, name) => target.dispatchEvent(new KeyboardEvent(type, { key: name, bubbles: true, cancelable: true }));
  const stage = () => map().querySelector('.cm-map-stage');
  const viewBox = () => map().querySelector('.cm-map-drawing svg').getAttribute('viewBox');
  const tool = (words) => [...panel().querySelectorAll('.cm-map-act')].find((node) => node.textContent === words);
  const hint = () => map().querySelector('.cm-map-hint');
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  /** Longitude and latitude at a point of the frame, as the engine draws the map's bounds. */
  const lonLat = ([x, y]) => projection(DESCRIBED.bounds, DESCRIBED.frame).from([x, y]);

  it('moves only in Draw, with its zoom on the map and how to use it under it, fetching nothing', async () => {
    await opened('Look');
    expect(stage().classList.contains('cm-map-nav')).toBe(false);
    expect(map().querySelector('.cm-map-zoom')).toBeNull();
    press(tab('Draw'));
    await settle();
    expect(stage().classList.contains('cm-map-nav')).toBe(true);
    expect([...map().querySelectorAll('.cm-map-zoom button')].map((node) => node.getAttribute('aria-label') ?? node.textContent))
      .toEqual(['Zoom in', 'Zoom out', 'Whole map']);
    expect(hint().hidden).toBe(false);
    expect(hint().textContent).toBe('Scroll or pinch to zoom, drag to move the map, 0 for the whole map.');
    expect(map().querySelector('.cm-map-file-view'), 'at its own frame there is no view to file').toBeNull();
    expect(server.asked.map((one) => one.path)).toEqual(['/api/cases/c1/notes/maps/describe']);
    press(tab('Time'));
    await settle();
    expect(stage().classList.contains('cm-map-nav')).toBe(false);
    expect(hint().hidden).toBe(true);
  });

  it('zooms about the pointer, and a point pressed at that zoom lands where it was pressed', async () => {
    await opened('Draw');
    const over = overlay();
    for (let turn = 0; turn < 6; turn += 1) wheel(over, 400, 250, -100);
    const k = Math.exp(0.22 * 6);
    expect(Number(stage().dataset.zoom)).toBeCloseTo(k, 2);
    // the window is the frame seen k times closer, the point under the pointer kept
    const [x, y, width, height] = viewBox().split(' ').map(Number);
    expect(width).toBeCloseTo(1600 / k, 2);
    expect(height).toBeCloseTo(1000 / k, 2);
    expect(x + (400 / 1600) * width).toBeCloseTo(400, 2);
    expect(y + (250 / 1000) * height).toBeCloseTo(250, 2);
    // the marks keep their size: drawn k times smaller in the map's units
    press(tool('Point'));
    at(overlay(), 'pointerdown', 400, 250);
    await settle();
    const [lon, lat] = server.asked.find((one) => one.path.endsWith('/features')).body.coords;
    const [wantLon, wantLat] = lonLat([400, 250]);
    expect(lon).toBeCloseTo(wantLon, 9);
    expect(lat).toBeCloseTo(wantLat, 9);
    expect(lon).toBeCloseTo(43.45, 9);
    // drawn again, the map keeps where it looked
    expect(Number(stage().dataset.zoom)).toBeCloseTo(k, 2);
  });

  it('puts a line’s corners where they are pressed after a move, Space+drag and the middle button moving it without a corner', async () => {
    await opened('Draw');
    let over = overlay();
    for (let turn = 0; turn < 5; turn += 1) wheel(over, 800, 500, -100);
    press(tool('Line'));
    over = overlay();
    stage().focus();
    const before = viewBox();
    key(stage(), 'keydown', ' ');
    at(over, 'pointerdown', 900, 600);
    at(over, 'pointermove', 700, 500);
    at(over, 'pointerup', 700, 500);
    key(stage(), 'keyup', ' ');
    expect(viewBox()).not.toBe(before);
    expect(map().querySelectorAll('.cm-map-corner')).toHaveLength(0);
    const moved = viewBox();
    at(over, 'pointerdown', 800, 500, 1);
    at(over, 'pointermove', 860, 520, 1);
    at(over, 'pointerup', 860, 520, 1);
    expect(viewBox()).not.toBe(moved);
    expect(map().querySelectorAll('.cm-map-corner')).toHaveLength(0);
    expect(hint().querySelector('.cm-map-hint-words').textContent).toBe('Press each corner of the line, then press the last one again or Enter. '
      + 'Backspace takes a corner back. Space+drag or the middle button moves the map.');
    // a corner pressed lands on the point of the map shown there (the window read back to a thousandth of a unit)
    const [x, y, width, height] = viewBox().split(' ').map(Number);
    const frameAt = ([px, py]) => [x + (px / 1600) * width, y + (py / 1000) * height];
    at(over, 'pointerdown', 300, 300);
    at(over, 'pointerdown', 1200, 700);
    key(stage(), 'keydown', 'Enter');
    await settle();
    const drawn = server.asked.find((one) => one.path.endsWith('/features')).body;
    expect(drawn.kind).toBe('line');
    [frameAt([300, 300]), frameAt([1200, 700])].forEach((point, index) => {
      expect(drawn.coords[index][0]).toBeCloseTo(lonLat(point)[0], 6);
      expect(drawn.coords[index][1]).toBeCloseTo(lonLat(point)[1], 6);
    });
  });

  it('shows its frame again on Whole map or 0, and leaving Draw shows the block’s own view, no line written', async () => {
    await opened('Draw');
    const over = overlay();
    for (let turn = 0; turn < 4; turn += 1) wheel(over, 300, 300, -100);
    expect(viewBox()).not.toBe('0 0 1600 1000');
    const whole = [...map().querySelectorAll('.cm-map-zoom button')].find((node) => node.textContent === 'Whole map');
    expect(whole.disabled).toBe(false);
    press(whole);
    await wait(400);
    expect(viewBox()).toBe('0 0 1600 1000');
    expect(whole.disabled).toBe(true);
    wheel(over, 300, 300, -100);
    stage().focus();
    key(stage(), 'keydown', '0');
    await wait(400);
    expect(viewBox()).toBe('0 0 1600 1000');
    for (let turn = 0; turn < 4; turn += 1) wheel(over, 300, 300, -100);
    press(tab('Look'));
    await settle();
    expect(stage().classList.contains('cm-map-nav')).toBe(false);
    expect(viewBox()).toBe('0 0 1600 1000');
    expect(block()).toBe(BLOCK);
    expect(server.asked.map((one) => one.path)).toEqual(['/api/cases/c1/notes/maps/describe']);
  });

  it('zooms twice as close a press of +, two presses in a row four times, about its middle', async () => {
    await opened('Draw');
    overlay();
    const [zoomIn, zoomOut] = map().querySelectorAll('.cm-map-zoom button');
    press(zoomIn);
    press(zoomIn);
    await wait(400);
    expect(Number(stage().dataset.zoom)).toBe(4);
    expect(viewBox()).toBe('600 375 400 250');
    stage().focus();
    key(stage(), 'keydown', '-');
    await wait(400);
    expect(Number(stage().dataset.zoom)).toBe(2);
    press(zoomOut);
    press(zoomOut);
    await wait(400);
    expect(Number(stage().dataset.zoom)).toBe(0.5);
    expect(zoomOut.disabled, 'half the whole map is as far out as it goes').toBe(true);
  });

  it('lays the close-ups the block files once the map moves, each from its file in the case', async () => {
    server.described = () => ({ ...DESCRIBED, details: [{ id: 'e_d1', path: 'media/close one.png', bounds: [43.45, 12.7, 43.5, 12.73] }] });
    await opened('Look');
    expect(map().querySelector('img.cm-map-detail')).toBeNull();
    press(tab('Draw'));
    await settle();
    const detail = map().querySelector('img.cm-map-detail');
    expect(detail.getAttribute('src')).toBe('/files/c1/media/close%20one.png');
    expect(Number.parseFloat(detail.style.left)).toBeCloseTo(25, 6);
    expect(Number.parseFloat(detail.style.width)).toBeCloseTo(25, 6);
  });

  it('files the ground for the view it shows as one more close-up, one line and one Undo step', async () => {
    await opened('Draw');
    const over = overlay();
    for (let turn = 0; turn < 6; turn += 1) wheel(over, 400, 250, -100);
    const file = map().querySelector('.cm-map-file-view');
    expect(file.textContent).toBe('File the ground for this view');
    press(file);
    await settle();
    const asked = server.asked.find((one) => one.path.endsWith('/notes/maps/detail')).body;
    const [x, y, width, height] = viewBox().split(' ').map(Number);
    const [west, north] = lonLat([x, y]);
    const [east, south] = lonLat([x + width, y + height]);
    expect(asked).toMatchObject({ text: BLOCK, base: 'satellite' });
    for (const [side, want] of Object.entries({ west, south, east, north })) expect(asked[side]).toBeCloseTo(want, 6);
    expect(lines()).toEqual(['::: map', 'title: The front', 'layer: Front line', 'layer: Vehicles', 'proofs: 2026-10-19..2026-11-02',
      'ground: e_g1', 'detail: e_view1', 'view: 12.73976, 43.51350, 12.05', ':::']);
    expect(handlers.tableToast).toHaveBeenCalledWith('Ground filed for this view', [], undefined);
    undo(view);
    expect(block()).toBe(BLOCK);
  });

  it('opens the page’s map on the view it shows, written as its view line, one Undo step', async () => {
    await opened('Draw');
    const over = overlay();
    expect(map().querySelector('.cm-map-open-here')).toBeNull();
    for (let turn = 0; turn < 6; turn += 1) wheel(over, 400, 250, -100);
    const open = map().querySelector('.cm-map-open-here');
    expect(open.textContent).toBe('Open here');
    press(open);
    const [x, y, width, height] = viewBox().split(' ').map(Number);
    const [west, north] = lonLat([x, y]);
    const [east, south] = lonLat([x + width, y + height]);
    const written = lines().find((line) => line.startsWith('view: '));
    expect(written).toBe(`view: ${viewText(fitView([west, south, east, north]))}`);
    expect(written).not.toBe('view: 12.73976, 43.51350, 12.05');
    expect(lines().filter((line) => line.startsWith('view: '))).toHaveLength(1);
    expect(server.asked.some((one) => one.path.endsWith('/ground') || one.path.endsWith('/detail'))).toBe(false);
    expect(handlers.tableToast).toHaveBeenCalledWith('The page opens the map here', [], undefined);
    undo(view);
    expect(block()).toBe(BLOCK);
  });

  it('says why a view cannot be filed offline, and the map keeps what it has', async () => {
    server.detail = () => { throw new Error('The imagery of this view could not be fetched, so the map keeps what it has. Try again once online.'); };
    await opened('Draw');
    const over = overlay();
    wheel(over, 400, 250, -100);
    press(map().querySelector('.cm-map-file-view'));
    await settle();
    expect(block()).toBe(BLOCK);
    expect(handlers.tableToast).toHaveBeenCalledWith('The imagery of this view could not be fetched, so the map keeps what it has. Try again once online.', [], 'warn');
    expect(map().querySelector('.cm-map-file-view').disabled).toBe(false);
  });
});

describe('the map on the whole screen', () => {
  let screen;
  afterEach(() => screen?.restore());
  const full = () => map().querySelector('.cm-map-full-btn');
  const stage = () => map().querySelector('.cm-map-stage');
  const card = () => map().querySelector('.cm-map-card');
  const viewBox = () => map().querySelector('.cm-map-drawing svg').getAttribute('viewBox').split(' ').map(Number);
  /** The map's overlay laid out at `width` by `height`, as the screen lays it, a press landing where it says. */
  function laid(width, height) {
    const over = map().querySelector('.cm-map-over');
    over.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height });
    return over;
  }
  const at = (over, type, x, y) => over.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
  const escape = (target) => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const tool = (words) => [...panel().querySelectorAll('.cm-map-act')].find((node) => node.textContent === words);

  it('puts the card on the whole screen from the map’s corner and back, its line in the note kept as tall', async () => {
    const { fakeScreen } = await import('../../fullscreen.fixture.js');
    screen = fakeScreen();
    editor();
    await settle();
    expect([full().getAttribute('aria-label'), full().title]).toEqual(['Full screen', 'The map on the whole screen']);
    expect(full().parentNode).toBe(stage());
    Object.defineProperty(map(), 'offsetHeight', { configurable: true, get: () => 466 });
    press(full());
    await settle();
    // the card, its bar and tabs with it
    expect(document.fullscreenElement).toBe(card());
    expect(card().classList.contains('cm-map-full')).toBe(true);
    expect(card().querySelector('.cm-map-bar')).not.toBeNull();
    expect(map().style.minHeight).toBe('466px');
    expect([full().getAttribute('aria-label'), full().title]).toEqual(['Exit full screen', 'Back to the note (Esc)']);
    press(full());
    await settle();
    expect(screen.exit).toHaveBeenCalledTimes(1);
    expect([card().classList.contains('cm-map-full'), map().style.minHeight, full().getAttribute('aria-label')]).toEqual([false, '', 'Full screen']);
    // the browser's own exit says it too
    press(full());
    await settle();
    screen.leave();
    expect(card().classList.contains('cm-map-full')).toBe(false);
  });

  it('gives the screen back on the first Esc, a line being drawn keeping its corners, and gives the line up on the second', async () => {
    const { fakeScreen } = await import('../../fullscreen.fixture.js');
    screen = fakeScreen();
    await opened('Draw');
    press(tool('Line'));
    const over = laid(1600, 1000);
    at(over, 'pointerdown', 300, 300);
    at(over, 'pointerdown', 600, 400);
    press(full());
    await settle();
    expect(document.fullscreenElement).toBe(card());
    escape(stage());
    await settle();
    expect(document.fullscreenElement).toBeNull();
    expect(map().querySelectorAll('.cm-map-corner')).toHaveLength(2);
    expect(stage().dataset.tool).toBe('line');
    expect(panel().hidden).toBe(false);
    escape(stage());
    await settle();
    expect(map().querySelectorAll('.cm-map-corner')).toHaveLength(0);
    expect(stage().dataset.tool).toBeUndefined();
    expect(server.asked.filter((one) => one.path.endsWith('/features'))).toEqual([]);
  });

  it('lays the map again on its new size in Draw: the same middle, more on its sides, a corner landing where it is pressed', async () => {
    const { fakeScreen } = await import('../../fullscreen.fixture.js');
    screen = fakeScreen();
    await opened('Draw');
    let over = laid(1600, 1000);
    press(map().querySelector('.cm-map-zoom-in'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(viewBox()).toEqual([400, 250, 800, 500]);
    // the screen is wider than the map: the same part, as large, more of the map on both sides
    over = laid(2400, 1000);
    press(full());
    await settle();
    expect(viewBox()).toEqual([200, 250, 1200, 500]);
    expect(Number(stage().dataset.zoom)).toBe(2);
    press(tool('Point'));
    at(over, 'pointerdown', 600, 250);
    await settle();
    const [lon, lat] = server.asked.find((one) => one.path.endsWith('/features')).body.coords;
    const [wantLon, wantLat] = projection(DESCRIBED.bounds, DESCRIBED.frame).from([200 + 600 / 2, 250 + 250 / 2]);
    expect(lon).toBeCloseTo(wantLon, 9);
    expect(lat).toBeCloseTo(wantLat, 9);
    // given back, the stage is the map's shape again and the view as it was
    over = laid(1600, 1000);
    press(full());
    await settle();
    expect(viewBox()).toEqual([400, 250, 800, 500]);
  });

  it('covers the window itself where the browser gives the card no full screen, and Esc gives it back', async () => {
    delete HTMLElement.prototype.requestFullscreen;
    editor();
    await settle();
    press(full());
    await settle();
    expect([...card().classList]).toEqual(expect.arrayContaining(['cm-map-full', 'cm-map-covered']));
    escape(document.body);
    expect(card().classList.contains('cm-map-full') || card().classList.contains('cm-map-covered')).toBe(false);
  });
});
