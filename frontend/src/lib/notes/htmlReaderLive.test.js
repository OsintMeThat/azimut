import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { geojson, layers, onDay, start } from '../../../../src/azimut/engine/notes_html_assets/reader.live.js';

/**
 * A web folder's map, live (`notes_html_assets/reader.live.js`): the reader's map (`reader.map.js`)
 * around the figure the engine writes (`mapFigure.fixture.html`), handed to a live map whose
 * MapLibre is stood in for here by one that records what it is asked. The live map is the same
 * map: its features as GeoJSON layers, the day the timeline shows as a filter, a step flying its
 * camera, a press on a feature opening the reader's own card. When MapLibre cannot be had, the
 * drawing keeps the page.
 */

const ASSETS = new URL('../../../../src/azimut/engine/notes_html_assets/', import.meta.url);
const READER = readFileSync(new URL('reader.js', ASSETS), 'utf8').replace('  /* az:map */\n', readFileSync(new URL('reader.map.js', ASSETS), 'utf8'));
const CSS = readFileSync(new URL('reader.css', ASSETS), 'utf8') + readFileSync(new URL('reader.map.css', ASSETS), 'utf8')
  + readFileSync(new URL('reader.live.css', ASSETS), 'utf8');
const FIGURE = readFileSync(new URL('./mapFigure.fixture.html', import.meta.url), 'utf8');
const SAID = { module: 'assets/1234abcd-reader-live.js', maplibre: 'assets/maplibre-6.8.0/maplibre-gl.js', css: 'assets/maplibre-6.8.0/maplibre-gl.css', style: 'https://tiles.openfreemap.org/styles/liberty' };

let window;
afterEach(async () => {
  await window?.happyDOM.close();
  window = null;
});

async function report({ reduced = false, url = 'https://desk.github.io/articles/front/', said = false } = {}) {
  window = new Window({
    url, width: 1440, height: 900,
    settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true },
  });
  window.matchMedia = (query) => ({ matches: (reduced && query.includes('reduce')) || query.includes('min-width'), addEventListener() {}, removeEventListener() {} });
  for (const [name, value] of [['clientWidth', 800], ['clientHeight', 574]]) {
    Object.defineProperty(window.HTMLElement.prototype, name, {
      configurable: true, get() { return this.classList?.contains('az-map-stage') || this.classList?.contains('az-gl-map') ? value : 0; },
    });
  }
  const config = said ? `<script type="application/json" id="az-gl">${JSON.stringify(SAID)}</script>` : '';
  window.document.write(`<!doctype html><html lang="en" data-look="report"><head>${config}<style>${CSS}</style></head>`
    + `<body><main class="az-body">${FIGURE}<figure class="az-figure" data-kind="proof" id="fig-1"></figure></main><script>${READER}</script></body></html>`);
  await window.happyDOM.waitUntilComplete();
  return window.document;
}

/** MapLibre as a recorder: it says it has loaded and drawn on the next turn, and keeps every call. */
function fakeMapLibre({ fails = false, styleError = false, sources = { base: { type: 'vector' } } } = {}) {
  const made = [];
  class Map {
    constructor(options) {
      if (fails) throw new Error('WebGL is not supported');
      made.push(this);
      this.options = options;
      this.handlers = {};
      this.sources = {};
      this.layers = [];
      this.filters = {};
      this.layout = {};
      this.images = {};
      this.states = {};
      this.moves = [];
      this.camera = { center: [43.5, 12.75], zoom: 10 };
      this.picks = [];
      this.cooperativeGestures = { on: true, enable() { this.on = true; }, disable() { this.on = false; } };
      const doc = options.container.ownerDocument;
      this.canvasContainer = doc.createElement('div');
      this.canvas = doc.createElement('canvas');
      this.canvasContainer.append(this.canvas);
      options.container.append(this.canvasContainer);
      setTimeout(() => {
        if (styleError) { this.fire('error', { error: new Error('style') }); return; }
        this.fire('data', { dataType: 'source', sourceId: 'base', tile: {} });
        this.fire('load');
      }, 0);
    }

    on(type, ...rest) { (this.handlers[type] ||= []).push(rest.at(-1)); return this; }
    once(type, handler) {
      if (type === 'idle') { setTimeout(() => handler(), 0); return this; }
      const wrapped = (event) => { this.handlers[type] = this.handlers[type].filter((one) => one !== wrapped); handler(event); };
      return this.on(type, wrapped);
    }
    fire(type, event = {}) { for (const handler of [...(this.handlers[type] || [])]) handler(event); }
    getStyle() { return { sources, layers: [{ id: 'water', type: 'fill' }, { id: 'place-names', type: 'symbol' }] }; }
    addSource(id, spec) { this.sources[id] = spec; }
    addLayer(layer, before) { this.layers.push({ ...layer, before }); this.filters[layer.id] = layer.filter; }
    getLayer(id) { return this.layers.find((layer) => layer.id === id); }
    setFilter(id, filter) { this.filters[id] = filter; }
    setLayoutProperty(id, name, value) { this.layout[`${id}.${name}`] = value; }
    addImage(name, image, options) { this.images[name] = options; }
    hasImage(name) { return Boolean(this.images[name]); }
    setFeatureState({ id }, values) { this.states[id] = { ...this.states[id], ...values }; }
    queryRenderedFeatures() { return this.picks.map((id) => ({ properties: { id } })); }
    project([lon, lat]) { return { x: (lon - 43.4) * 4000, y: (12.82 - lat) * 4000 }; }
    getZoom() { return this.camera.zoom; }
    getCenter() { return { lng: this.camera.center[0], lat: this.camera.center[1] }; }
    flyTo(options) { this.moves.push(['fly', options]); }
    jumpTo(options) { this.moves.push(['jump', options]); Object.assign(this.camera, options.center ? { center: [options.center.lng ?? options.center[0], options.center.lat ?? options.center[1]] } : {}, 'zoom' in options ? { zoom: options.zoom } : {}); }
    easeTo(options) { this.moves.push(['ease', options]); }
    fitBounds(bounds, options) { this.moves.push(['fit', bounds, options]); }
    cameraForBounds() { return { center: [43.495, 12.745], zoom: 15 }; }
    zoomIn() { this.moves.push(['in']); }
    zoomOut() { this.moves.push(['out']); }
    getCanvas() { return this.canvas; }
    getCanvasContainer() { return this.canvasContainer; }
    resize() { this.resizes = (this.resizes || 0) + 1; this.fire('resize'); }
    remove() { this.removed = true; }
  }
  Map.prototype.cooperativeGestures = null;
  return { library: { Map }, made };
}

async function live(options = {}) {
  const doc = await report(options);
  const figure = doc.querySelector('figure.az-map');
  const { library, made } = fakeMapLibre(options);
  const [mounted] = await start([figure], SAID, { maplibre: library, now: true });
  const controls = await mounted;
  return { doc, figure, controls, map: made[0] };
}

const input = (slider, value) => {
  slider.value = value;
  slider.dispatchEvent(new window.Event('input', { bubbles: true }));
};

describe('a map in a web folder, read online', () => {
  it('draws the same features as GeoJSON layers over its base, the ground as filed under the base map’s names', async () => {
    const { doc, figure, controls, map } = await live();
    expect(controls).not.toBeNull();
    expect(map.options.style).toBe(SAID.style);
    expect(map.options.bounds).toEqual([43.4, 12.68, 43.6, 12.82]);
    expect(map.options.attributionControl).toBe(false);
    expect(map.options.cooperativeGestures).toBe(true);
    const features = map.sources['az-features'].data.features;
    expect(features.map((one) => [one.properties.id, one.geometry.type])).toEqual([
      ['l0f0', 'MultiLineString'], ['l0f0s1', 'MultiLineString'], ['l1f0', 'Point'], ['l1f1', 'Point'], ['p0', 'Point']]);
    expect(features[2].geometry.coordinates).toEqual([43.495, 12.745]);
    expect(features[2].properties).toMatchObject({ icon: 's-badge-tank-e53935-destroyed', color: '#e53935', from: '2026-11-15', s: 1 });
    expect(features[4].properties.icon).toBe('proof');
    expect(map.sources['az-features'].promoteId).toBe('id');
    // the ground as filed: the figure's own picture at its bounds, under the base map's names, shown first
    expect(map.sources['az-ground']).toMatchObject({ type: 'image', coordinates: [[43.4, 12.82], [43.6, 12.82], [43.6, 12.68], [43.4, 12.68]] });
    expect(map.sources['az-ground'].url).toBe(doc.getElementById('map-1-ground').getAttribute('src'));
    const ground = map.layers.find((layer) => layer.id === 'az-ground');
    expect([ground.before, ground.layout.visibility]).toEqual(['place-names', 'visible']);
    expect(map.layers.map((layer) => layer.id).slice(1)).toEqual(layers().map((layer) => layer.id));
    // shown in the drawing's place, which it keeps out of reach under it
    expect(figure.querySelector('.az-gl').classList.contains('az-on')).toBe(true);
    expect(figure.classList.contains('az-gl-on')).toBe(true);
    expect(figure.querySelector('.az-map-stage').inert).toBe(true);
    expect([...figure.querySelectorAll('.az-gl .az-map-tools button')].map((button) => button.getAttribute('aria-label'))).toEqual(['Zoom in', 'Zoom out', 'The whole map', 'Full screen']);
    expect(figure.querySelector('.az-gl-credit').textContent).toBe('Imagery: Esri, test · OpenFreeMap · © OpenMapTiles · Data from OpenStreetMap');
  });

  it('shows each day the timeline stops on by the features’ first and last days, a moved line faint where it stood', async () => {
    const { doc, map } = await live();
    // on the map's own day, as the drawing was
    expect(map.filters['az-line']).toEqual(['all', ['all', ['==', ['get', 'kind'], 'line'], ['!', ['has', 'dash']]], onDay('2026-11-16')]);
    expect(map.filters['az-past-line'][2]).toEqual(['in', ['get', 'id'], ['literal', ['l0f0s1']]]);
    input(doc.querySelector('.az-map-time input[type="range"]'), '1');
    expect(map.filters['az-points'][2]).toEqual(onDay('2026-10-14'));
    expect(map.filters['az-past-line'][2]).toEqual(['in', ['get', 'id'], ['literal', ['l0f0']]]);
    expect(doc.querySelector('.az-map-now-day').textContent).toBe('14 Oct 2026');
    // the keyboard reaches what that day shows, in the drawing's order
    expect([...doc.querySelectorAll('.az-gl-key')].map((key) => key.dataset.for)).toEqual(['l0f0s1']);
  });

  it('reads a day as MapLibre does: from its first day to its last, both kept', () => {
    expect(onDay('')).toBe(true);
    const [, from, until] = onDay('2026-10-14');
    expect(from).toEqual(['any', ['!', ['has', 'from']], ['<=', ['string', ['get', 'from']], '2026-10-14']]);
    expect(until).toEqual(['any', ['!', ['has', 'until']], ['<=', '2026-10-14', ['string', ['get', 'until']]]]);
  });

  it('flies its camera where a step looks, on the step’s day, its card open', async () => {
    const { doc, map } = await live();
    doc.querySelector('.az-map-steps button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const [kind, camera] = map.moves.at(-1);
    expect(kind).toBe('fly');
    expect(camera).toMatchObject({ center: [43.52, 12.72], zoom: 12, bearing: 0, pitch: 0, duration: 1300 });
    expect(doc.querySelector('.az-map-now-day').textContent).toBe('20 Oct 2026');
    expect(doc.querySelector('.az-map-card .az-map-card-title').textContent).toBe('Heights');
    expect(map.states.p0).toMatchObject({ picked: true, new: true });
    // a story's card of words shows it whole
    doc.querySelector('figure.az-map').azMap.story('');
    expect(map.moves.at(-1)[0]).toBe('fit');
  });

  it('opens the reader’s own card for a press on a feature, lit while open, and a press beside closes it', async () => {
    const { doc, map } = await live();
    map.picks = ['p0'];
    map.fire('click', { point: { x: 480, y: 400 } });
    const card = doc.querySelector('.az-map-card');
    expect(card.hidden).toBe(false);
    expect(card.querySelector('.az-map-card-title').textContent).toBe('Heights');
    expect(map.states.p0.picked).toBe(true);
    map.picks = [];
    map.fire('click', { point: { x: 10, y: 10 } });
    expect(card.hidden).toBe(true);
    expect(map.states.p0.picked).toBe(false);
    // a mark spread away from its spot is pressed where it is drawn, never at the spot it left
    map.picks = ['l1f0'];
    map.fire('click', { point: { x: 380, y: 300 } });
    expect(card.hidden).toBe(true);
  });

  it('spreads marks that would cover one another as the drawing does, the true spot never moved', async () => {
    const { doc, map } = await live();
    // #1 and #2 stand a few metres apart: drawn spread over the map, each with a leader, hidden from the map's own layer
    const spread = [...doc.querySelectorAll('.az-gl-over .az-f')].map((mark) => mark.dataset.id).sort();
    expect(spread).toEqual(['l1f0', 'l1f1']);
    expect(doc.querySelectorAll('.az-gl-over .az-leader').length).toBe(2);
    expect(map.states.l1f0.away).toBe(true);
    expect(map.sources['az-features'].data.features[2].geometry.coordinates).toEqual([43.495, 12.745]);
    // a spread mark takes a press as the drawing's does
    doc.querySelector('.az-gl-over .az-f[data-id="l1f1"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(doc.querySelector('.az-map-card .az-map-card-title').textContent).toBe('#2');
  });

  it('takes the whole screen from its own button: sized again as much closer, every gesture its own, and back to its view unmoved', async () => {
    const { doc, figure, map } = await live();
    let holder = null;
    Object.defineProperty(doc, 'fullscreenElement', { configurable: true, get: () => holder });
    window.HTMLElement.prototype.requestFullscreen = async function requestFullscreen() { holder = this; doc.dispatchEvent(new window.Event('fullscreenchange')); };
    doc.exitFullscreen = async () => { holder = null; doc.dispatchEvent(new window.Event('fullscreenchange')); };
    const box = figure.querySelector('.az-gl-map');
    const button = figure.querySelector('.az-gl .az-map-screen button');
    expect(button.getAttribute('aria-label')).toBe('Full screen');
    // the screen twice as large as the page's map: the same middle, one zoom closer
    Object.defineProperty(box, 'clientWidth', { configurable: true, get: () => 1600 });
    Object.defineProperty(box, 'clientHeight', { configurable: true, get: () => 1300 });
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(holder).toBe(figure);
    expect(map.resizes).toBe(1);
    expect(map.getZoom()).toBeCloseTo(11, 6);
    expect(map.cooperativeGestures.on).toBe(false);
    // both of its buttons say how to come back: the drawing's under it, and its own
    expect([...figure.querySelectorAll('[data-act="full"]')].map((one) => one.getAttribute('aria-label'))).toEqual(['Exit full screen', 'Exit full screen']);
    // given back unmoved, it shows the view it had
    Object.defineProperty(box, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(box, 'clientHeight', { configurable: true, get: () => 574 });
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect([holder, map.resizes, map.getZoom(), map.cooperativeGestures.on]).toEqual([null, 2, 10, true]);
    // moved on the whole screen, it keeps what it shows, as much farther
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    map.camera.zoom = 12;
    Object.defineProperty(box, 'clientWidth', { configurable: true, get: () => 400 });
    Object.defineProperty(box, 'clientHeight', { configurable: true, get: () => 287 });
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    for (let turn = 0; turn < 4; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(holder).toBeNull();
    expect(map.getZoom()).toBeCloseTo(11, 6);
  });

  it('switches its base between the ground as filed and the map, crediting the imagery while it shows', async () => {
    const { figure, map } = await live();
    const [plain, satellite] = figure.querySelectorAll('.az-gl-base button');
    expect([plain.textContent, satellite.textContent, satellite.getAttribute('aria-pressed')]).toEqual(['Map', 'Satellite (as filed)', 'true']);
    plain.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(map.layout['az-ground.visibility']).toBe('none');
    expect([plain.getAttribute('aria-pressed'), satellite.getAttribute('aria-pressed')]).toEqual(['true', 'false']);
    expect(figure.querySelector('.az-gl-credit').textContent).toBe('OpenFreeMap · © OpenMapTiles · Data from OpenStreetMap');
    satellite.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(map.layout['az-ground.visibility']).toBe('visible');
  });

  it('opens on the map alone when it has no ground to show', async () => {
    const doc = await report();
    const figure = doc.querySelector('figure.az-map');
    const script = figure.querySelector('script.az-map-data');
    script.textContent = JSON.stringify({ ...JSON.parse(script.textContent), ground: null });
    const { library, made } = fakeMapLibre();
    const [mounted] = await start([figure], SAID, { maplibre: library, now: true });
    expect(await mounted).not.toBeNull();
    expect(made[0].sources['az-ground']).toBeUndefined();
    expect(figure.querySelector('.az-gl-base')).toBeNull();
    expect(figure.querySelector('.az-gl-credit').textContent).toBe('OpenFreeMap · © OpenMapTiles · Data from OpenStreetMap');
  });

  /** The fixture's map, its data changed by `change`, made live. */
  async function liveWith(change) {
    const doc = await report();
    const figure = doc.querySelector('figure.az-map');
    const script = figure.querySelector('script.az-map-data');
    script.textContent = JSON.stringify(change(JSON.parse(script.textContent)));
    const { library, made } = fakeMapLibre();
    const [mounted] = await start([figure], SAID, { maplibre: library, now: true });
    return { figure, controls: await mounted, map: made[0] };
  }
  const SENTINEL = {
    tiles: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg', native: 14,
    name: 'Sentinel-2, a year’s mosaic, not a day', link: 'https://cloudless.eox.at',
    credit: 'Imagery: EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2025) · CC BY-NC-SA 4.0, non-commercial use, a year’s mosaic, not a day',
  };

  it('streams the imagery its block names under its marks in place of the ground filed, credited and linked while it shows', async () => {
    const { figure, controls, map } = await liveWith((data) => ({ ...data, imagery: SENTINEL }));
    expect(controls).not.toBeNull();
    expect(map.sources['az-imagery']).toEqual({ type: 'raster', tiles: [SENTINEL.tiles], tileSize: 256, maxzoom: 14 });
    expect(map.sources['az-ground']).toBeUndefined();
    const imagery = map.layers.find((layer) => layer.id === 'az-imagery');
    expect([imagery.before, imagery.layout.visibility]).toEqual(['place-names', 'visible']);
    expect(map.layers.findIndex((layer) => layer.id === 'az-imagery')).toBeLessThan(map.layers.findIndex((layer) => layer.id === 'az-points'));
    const [plain, satellite] = figure.querySelectorAll('.az-gl-base button');
    expect([satellite.textContent, satellite.title]).toEqual(['Satellite', SENTINEL.name]);
    const credit = figure.querySelector('.az-gl-credit .az-gl-imagery');
    expect([credit.tagName, credit.getAttribute('href'), credit.textContent]).toEqual(['A', 'https://cloudless.eox.at', SENTINEL.credit]);
    plain.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(map.layout['az-imagery.visibility']).toBe('none');
    expect(figure.querySelector('.az-gl-imagery')).toBeNull();
  });

  it('streams its imagery with no ground filed, and keeps the ground as filed when its block names none', async () => {
    const streamed = await liveWith((data) => ({ ...data, ground: null, imagery: { ...SENTINEL, link: 'javascript:alert(1)' } }));
    expect(streamed.map.sources['az-imagery']).toBeTruthy();
    expect(streamed.figure.querySelector('.az-gl-base')).not.toBeNull();
    expect(streamed.figure.querySelector('.az-gl-imagery').tagName).toBe('SPAN');
    await window.happyDOM.close();
    const filed = await liveWith((data) => data);
    expect(filed.map.sources['az-imagery']).toBeUndefined();
    expect(filed.map.sources['az-ground'].type).toBe('image');
    expect(filed.map.options.maxBounds).toBeUndefined();
  });

  it('keeps its reader inside its frame when its block says so, and opens where its block opens it', async () => {
    const { map } = await liveWith((data) => ({ ...data, inside: true, opens: [43.45, 12.7, 43.52, 12.75] }));
    expect(map.options.maxBounds).toEqual([[43.4, 12.68], [43.6, 12.82]]);
    expect(map.options.bounds).toEqual([43.45, 12.7, 43.52, 12.75]);
  });

  it('with motion turned down, jumps rather than flies and lights nothing', async () => {
    const { doc, map } = await live({ reduced: true });
    doc.querySelectorAll('.az-map-steps button')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(map.moves.at(-1)).toEqual(['jump', { center: [43.495, 12.745], zoom: 13, bearing: 0, pitch: 0 }]);
    expect(map.moves.some(([kind]) => kind === 'fly')).toBe(false);
    expect(map.options.fadeDuration).toBe(0);
  });
});

describe('when the live map cannot be had', () => {
  it('keeps the drawing when MapLibre throws, as when WebGL is off', async () => {
    const { figure, controls } = await live({ fails: true });
    expect(controls).toBeNull();
    expect(figure.querySelector('.az-gl')).toBeNull();
    expect(figure.querySelector('.az-map-stage').inert).toBeFalsy();
    expect(figure.azLive).toBeUndefined();
    // the drawing still answers its timeline
    input(figure.querySelector('.az-map-time input[type="range"]'), '1');
    expect(figure.querySelector('.az-f[data-id="l0f0s1"]').classList.contains('az-off')).toBe(false);
  });

  it('keeps the drawing when the base map’s style cannot be read', async () => {
    const { figure, controls, map } = await live({ styleError: true });
    expect(controls).toBeNull();
    expect(map.removed).toBe(true);
    expect(figure.querySelector('.az-gl')).toBeNull();
    expect(figure.classList.contains('az-gl-on')).toBe(false);
  });

  it('keeps the drawing when the page is a file opened from the disk, whatever it names', async () => {
    const doc = await report({ url: 'file:///home/desk/front/index.html', said: true });
    expect(doc.querySelector('.az-gl')).toBeNull();
    expect(doc.querySelector('figure.az-map').azMap).toBeTruthy();
  });

  it('keeps the drawing when the reader asks to spare data', async () => {
    const doc = await report();
    Object.defineProperty(window.navigator, 'connection', { configurable: true, value: { saveData: true } });
    const { library, made } = fakeMapLibre();
    expect(await start([doc.querySelector('figure.az-map')], SAID, { maplibre: library, now: true })).toEqual([]);
    expect(made).toEqual([]);
  });
});

describe('what the live map is made of', () => {
  it('turns a line’s arrow the way it runs, and fills an area as the drawing does', () => {
    const data = {
      features: [
        { id: 'a', kind: 'line', coords: [[[0, 0], [0, 1]]], style: { color: '#123456', arrow: 'end', width: 3 } },
        { id: 'b', kind: 'line', coords: [[[0, 0], [1, 0]]], style: { color: '#123456', arrow: 'both', confidence: 'claimed' } },
        { id: 'c', kind: 'area', coords: [[[[0, 0], [1, 0], [1, 1], [0, 0]]]], style: { color: '#ABCDEF', fill: 'hatch', alpha: 0.5 } },
      ],
    };
    const { features, arrows } = geojson(data);
    expect(arrows.features.map((one) => [one.properties.id, one.properties.turn])).toEqual([['a', 0], ['b', 90], ['b', -90]]);
    expect(features.features[1].properties.dash).toBe('claimed');
    expect(features.features[2].properties).toMatchObject({ fill: 'hatch', opacity: 0.22, alpha: 0.5, color: '#abcdef' });
  });
});
