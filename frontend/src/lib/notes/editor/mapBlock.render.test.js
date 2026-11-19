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

const server = vi.hoisted(() => ({ asked: [], described: null, ground: null, feature: null }));
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
const { forgetMaps } = await import('../mapSettings.svelte.js');

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
