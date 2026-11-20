// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorSelection, EditorState } from '@codemirror/state';
import { undo } from '@codemirror/commands';

/**
 * An infographic's map panel worked on in the builder: the map's own settings card, each
 * choice written in the panel's lines inside the `:::: infographic` block as one Undo step of
 * exact words (through the editor's `replaceBlock`, as the builder writes), a base filed on its
 * press, a point drawn into a personal layer the panel names, Size left to the page, and the
 * page drawn in the note again when what a map draws changes.
 */

const server = vi.hoisted(() => ({ asked: [], described: null, ground: null, feature: null, page: null }));
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
        if (path.endsWith('/notes/maps/layer')) return { name: 'Where they lie, drawn', title: 'Where they lie, drawn' };
        if (path.endsWith('/notes/maps/features')) return server.feature(body);
        if (path.endsWith('/notes/infographic')) return server.page(body);
        if (path.endsWith('/notes/figure/rows')) return { found: false };
        throw new Error(`not stood in: ${path}`);
      }),
      get: vi.fn(async () => ({ colours: [] })),
    },
  };
});

const { focusedState, noteExtensions, setNoteCase } = await import('../liveMarkdown.js');
const { forgetMaps, touchMaps } = await import('../mapSettings.svelte.js');
const { replaceBlock } = await import('./infographicBlock.js');
const { infographicsIn, panelText, withPanelText } = await import('./infographicText.js');
const { SIZED_BY, mapPanel } = await import('./infographicMap.js');
const { mapSettings } = await import('./mapCard.js');
const { readMap } = await import('./mapText.js');

const FIGURES = '::: chart\nkind: key figures\n| Figure | Words |\n| --- | --- |\n| 51 of 54 | placed |\n:::';
const MAP = ['::: map', 'title: Where they lie', 'layer: Front line', 'layer: Vehicles', 'ground: e_g1', 'frame: 43.45, 12.68, 43.56, 12.77',
  'north: on', ':::'].join('\n');
const BLOCK = `:::: infographic\ntitle: At least 60 vehicles lost\n\n${FIGURES}\n\n${MAP}\n::::`;
const NOTE = `# Losses\n\n${BLOCK}\n\nAfter.\n`;
const SVG = '<svg class="az-map-svg" viewBox="0 0 1600 1000"><g class="az-points"><g class="az-f az-point" data-id="l0f0"></g></g></svg>';
const DESCRIBED = {
  title: 'Where they lie', base: 'satellite', bounds: [43.45, 12.68, 43.56, 12.77], frame: [1600, 1000], extent: [43.46, 12.69, 43.55, 12.76],
  view: { center: [43.5, 12.73], zoom: 12, bearing: 0 },
  ground: { id: 'e_g1', path: 'media/ground.png', bounds: [43.4, 12.6, 43.6, 12.8] }, svg: SVG,
  layers: [
    { name: 'Front line', title: 'Front line', from: 'line', on: true, colour: '', colours: ['#1e88e5'], features: 1, editable: true, own: false, missing: false },
    { name: 'Vehicles', title: 'Vehicles', from: 'line', on: true, colour: '', colours: ['#e53935'], features: 54, editable: true, own: false, missing: false },
  ],
  others: [], drawings: [], proofs: { count: 0, first: '', last: '' }, days: ['2026-11-16'], day: '2026-11-16',
  steps: [], own_steps: false, palette: [], providers: [], warnings: [],
};

let view;
let card;
let said;
let closed;
beforeEach(() => {
  server.asked = [];
  server.described = () => DESCRIBED;
  server.ground = () => ({ ground: 'e_osm', details: ['e_osm2'], view: '12.72500, 43.50500, 12.4', filed: ['e_osm', 'e_osm2'], base: 'map' });
  server.feature = (body) => ({ layer: body.layer, key: 'k1' });
  server.page = () => ({ svg: '<svg viewBox="0 0 10 10"></svg>', width: 10, height: 10, panels: [], legend: { values: [] }, warnings: [] });
  said = vi.fn();
  closed = vi.fn();
  forgetMaps();
  // the pages drawn of blocks with a map, kept from a test before, forgotten
  touchMaps();
});
afterEach(() => {
  card?.destroy();
  card = null;
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

function editor(doc = NOTE) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const handlers = { tableToast: vi.fn(), open: vi.fn(), noteKey: 'c1:n1', noteId: 'n1', infographic: vi.fn(), pickData: vi.fn() };
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ handlers, mode: 'drawn' }) }) });
  view.setState(focusedState(view.state.update({ selection: EditorSelection.cursor(0) }).state));
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [] }) });
  view.focus = vi.fn();
  return view;
}

const text = () => view.state.doc.toString();
const graphic = () => infographicsIn(text())[0].source;
const panelNow = () => panelText(graphic(), 1);

/** The builder's own write: the infographic replaced as one change, when it still reads what it read. */
function builderEdit(transform) {
  const one = infographicsIn(text())[0];
  const next = transform(one.source);
  return next !== one.source && replaceBlock(view, one.from, one.to, next, one.source);
}

/** The map panel's card opened as the builder opens it, under its row. */
function opened(options = {}) {
  editor();
  const host = document.createElement('div');
  document.body.append(host);
  card = mapPanel(host, {
    caseId: 'c1',
    source: panelNow(),
    text: () => panelNow(),
    edit: (change) => builderEdit((source) => withPanelText(source, 1, change(panelText(source, 1)))),
    say: said,
    themes: view.themeClasses,
    onclose: closed,
    ...options,
  });
  return host;
}

const settle = async () => {
  for (let step = 0; step < 8; step += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const press = (node) => {
  node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
  node.click();
};
const tab = (host, words) => [...host.querySelectorAll('[role="tab"]')].find((node) => node.textContent === words);
const named = (host, label) => host.querySelector(`[aria-label="${label}"]`);
const radio = (host, group, words) => [...named(host, group).querySelectorAll('[role="radio"]')].find((node) => node.textContent === words);
/** What the builder keeps in sight: the panel's lines as the note holds them now. */
const follow = () => card.update(panelNow());

describe('a map panel of an infographic, in the builder', () => {
  it('draws its map from its own lines, under the editor’s looks, with the map’s five tabs', async () => {
    const host = opened();
    await settle();
    expect(server.asked.find((one) => one.path.endsWith('/notes/maps/describe')).body).toEqual({ text: MAP });
    const box = host.querySelector('.ib-map');
    for (const name of view.themeClasses.split(' ')) expect(box.classList.contains(name)).toBe(true);
    expect(host.querySelector('.cm-map-stage .cm-map-drawing svg')).toBeTruthy();
    expect([...host.querySelectorAll('[role="tab"]')].map((node) => node.textContent)).toEqual(['Look', 'Layers', 'Draw', 'Time', 'Cards']);
    expect(tab(host, 'Look').getAttribute('aria-selected')).toBe('true');
  });

  it('says its width is the page’s in place of Size, every other look its own', async () => {
    const host = opened();
    await settle();
    expect(named(host, 'Size')).toBeNull();
    expect(host.querySelector('.cm-map-sized').textContent).toBe(`Size${SIZED_BY}`);
    for (const group of ['Base', 'Legend', 'North arrow', 'Scale']) expect(named(host, group), group).toBeTruthy();
  });

  it('writes a layer hidden in the panel’s own lines, inside the page, as one Undo step', async () => {
    const host = opened();
    await settle();
    press(tab(host, 'Layers'));
    await settle();
    const toggle = named(host, 'Show Front line');
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    expect(panelNow()).toBe(MAP.replace('ground: e_g1', 'ground: e_g1\nhide: Front line'));
    expect(text()).toBe(NOTE.replace(MAP, panelNow()));
    follow();
    await settle();
    expect(readMap(card.panel.source).hidden).toEqual(['Front line']);
    undo(view);
    expect(text()).toBe(NOTE);
  });

  it('files another base on its press and writes it, its ground and close-ups, as one step', async () => {
    const host = opened();
    await settle();
    press(radio(host, 'Base', 'Map'));
    await settle();
    expect(server.asked.find((one) => one.path.endsWith('/notes/maps/ground')).body).toEqual({ text: MAP, base: 'map' });
    // a ground filed for a map with no view of its own looks where it was filed
    expect(panelNow()).toBe(MAP.replace('ground: e_g1', 'ground: e_osm\ndetail: e_osm2\nview: 12.72500, 43.50500, 12.4\nbase: map'));
    undo(view);
    expect(text()).toBe(NOTE);
  });

  it('leaves a template’s size out, the rest of its look written', async () => {
    editor();
    const panel = document.createElement('div');
    document.body.append(panel);
    const write = vi.fn();
    const settings = mapSettings(panel, { state: () => ({ map: readMap(MAP), described: DESCRIBED, busy: '' }), write, base: vi.fn(), sizedBy: SIZED_BY });
    expect(panel.querySelector('[aria-label="Size"]')).toBeNull();
    settings.destroy();
    const plain = document.createElement('div');
    mapSettings(plain, { state: () => ({ map: readMap(MAP), described: DESCRIBED, busy: '' }), write, base: vi.fn() });
    expect(plain.querySelector('[aria-label="Size"]')).toBeTruthy();
  });

  it('puts a point drawn on its map into a personal layer the panel names, its toast offering Undo', async () => {
    const host = opened();
    await settle();
    press(tab(host, 'Draw'));
    await settle();
    expect(host.textContent).toContain('Kept in a new layer of the case, “Where they lie, drawn”, made at the first drawing.');
    press(host.querySelector('[data-tool="point"]'));
    const over = host.querySelector('.cm-map-over');
    over.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1600, height: 1000, right: 1600, bottom: 1000 });
    over.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: 800, clientY: 500 }));
    await settle();
    expect(server.asked.find((one) => one.path.endsWith('/notes/maps/layer')).body).toEqual({ title: 'Where they lie, drawn' });
    const feature = server.asked.find((one) => one.path.endsWith('/notes/maps/features')).body;
    expect(feature).toMatchObject({ layer: 'Where they lie, drawn', kind: 'point' });
    expect(panelNow()).toBe(MAP.replace('layer: Vehicles', 'layer: Vehicles\nlayer: Where they lie, drawn'));
    expect(said).toHaveBeenCalledWith('Point put in the layer of this map', [expect.objectContaining({ label: 'Undo' })], 'info');
  });

  it('keeps the tab picked for the next card, and Escape closes it', async () => {
    const onTab = vi.fn();
    const host = opened({ onTab });
    await settle();
    press(tab(host, 'Time'));
    expect(onTab).toHaveBeenLastCalledWith('time');
    card.destroy();
    const again = document.createElement('div');
    document.body.append(again);
    card = mapPanel(again, { caseId: 'c1', source: panelNow(), edit: () => true, tab: 'time', onclose: closed });
    await settle();
    expect(tab(again, 'Time').getAttribute('aria-selected')).toBe('true');
    again.querySelector('.cm-map-settings').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('puts the panel on the whole screen from its map’s corner, its settings beside the map, Esc giving it back before the card closes', async () => {
    const { fakeScreen } = await import('../../fullscreen.fixture.js');
    const screen = fakeScreen();
    try {
      const host = opened();
      await settle();
      const box = host.querySelector('.ib-map');
      const button = box.querySelector('.cm-map-stage .cm-map-full-btn');
      expect(button.getAttribute('aria-label')).toBe('Full screen');
      press(button);
      await settle();
      expect(document.fullscreenElement).toBe(box);
      expect(box.classList.contains('cm-map-full')).toBe(true);
      expect(box.querySelector('.cm-map-settings').hidden).toBe(false);
      expect(button.title).toBe('Back to the infographic (Esc)');
      box.querySelector('.cm-map-settings').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await settle();
      expect([document.fullscreenElement, box.classList.contains('cm-map-full')]).toEqual([null, false]);
      expect(closed).not.toHaveBeenCalled();
    } finally {
      screen.restore();
    }
  });

  it('reads its lines again when the page changes them, and draws again', async () => {
    opened();
    await settle();
    const before = server.asked.filter((one) => one.path.endsWith('/notes/maps/describe')).length;
    builderEdit((source) => withPanelText(source, 1, MAP.replace('north: on', 'north: on\nlegend: folded')));
    follow();
    await settle();
    expect(card.panel.map.legend).toBe('folded');
    expect(server.asked.filter((one) => one.path.endsWith('/notes/maps/describe')).length).toBe(before + 1);
  });
});

describe('an infographic drawn in the note', () => {
  it('draws its page again when what a map draws changes, keeping the page it had till then', async () => {
    editor();
    await settle();
    const pages = () => server.asked.filter((one) => one.path.endsWith('/notes/infographic'));
    expect(pages()).toHaveLength(1);
    const frame = view.dom.querySelector('.cm-block-infographic .cm-ig-frame');
    expect(frame).toBeTruthy();
    let answer;
    server.page = () => new Promise((resolve) => { answer = resolve; });
    touchMaps();
    expect(pages()).toHaveLength(2);
    expect(pages()[1].body.text).toBe(BLOCK);
    expect(view.dom.querySelector('.cm-block-infographic .cm-ig-frame')).toBe(frame);
    answer({ svg: '<svg viewBox="0 0 10 10"><title>again</title></svg>', width: 10, height: 10, panels: [], legend: {}, warnings: [] });
    await settle();
    expect(view.dom.querySelector('.cm-block-infographic .cm-ig-frame title').textContent).toBe('again');
  });

  it('leaves a page with no map alone', async () => {
    editor(`# Losses\n\n:::: infographic\n\n${FIGURES}\n::::\n`);
    await settle();
    const pages = () => server.asked.filter((one) => one.path.endsWith('/notes/infographic'));
    touchMaps();
    await settle();
    expect(pages()).toHaveLength(1);
  });
});
