// @vitest-environment happy-dom
/**
 * Linked views over someone else's map (extension/maplink.js, and the panel's
 * link button in extension/mapoverlay.js).
 *
 * The app puts two of its own tabs on one camera with `setView`. A site's map
 * has nothing like it the extension may call, so a panel follows by writing the
 * camera into the site's address bar, and only ever leads after the analyst
 * moved its own map. Three things here are easy to get wrong and quiet when
 * wrong:
 *
 * - **The written address has to read back as the view.** The tools take their
 *   scale from it. `tests/fixtures/map-link-writes.json` is checked from both
 *   sides: here the writer produces those URLs, and `test_map_link_writes.py`
 *   has the app's parser read them.
 * - **A map that arrived because it was sent is silent.** Otherwise two linked
 *   maps push one camera back and forth for ever, and a map stopped at its own
 *   ceiling pulls the one it follows back out to it.
 * - **The camera comparison is `link.js`'s.** The panel and the app decide
 *   "same view" on each side of the hub, and a disagreement is an echo.
 */
import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { sameView } from './map/link.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, `../../../extension/${name}`), 'utf8');
const WRITES = JSON.parse(
  readFileSync(join(here, '../../../tests/fixtures/map-link-writes.json'), 'utf8')
).writes;

let L;

beforeAll(() => {
  const scope = {};
  new Function('window', read('maplink.js'))(scope);
  L = scope.AzimutMapLink;
});

// --- the writer ------------------------------------------------------------------

describe('a view written into a site’s address', () => {
  it.each(WRITES.map((w) => [`${w.site}: ${w.name}`, w]))('%s', (_, w) => {
    expect(L.writeView({ site: w.site }, w.from, w.view, w.height)).toBe(w.url);
  });

  it('holds a site that keeps a level it cannot draw to the level it draws', () => {
    const deep = { lat: 48.85837, lon: 2.294481, zoom: 23, bearing: 0 };
    const google = L.writeView({ site: 'google-maps' }, 'https://www.google.com/maps/@1,2,15z', deep, 1000);
    expect(google).toContain(',21z');
    const osm = L.writeView({ site: 'openstreetmap' }, 'https://www.openstreetmap.org/#map=15/1/2', deep, 1000);
    expect(osm).toContain('map=19/');
  });

  it('leaves a site that corrects itself to do so', () => {
    // Zoom Earth rewrites an 11-level ceiling into its own address, and Bing its
    // 22: writing their ceiling here would be a second, staler copy of it
    const deep = { lat: 48.85837, lon: 2.294481, zoom: 20, bearing: 0 };
    const zoomEarth = L.writeView(
      { site: 'zoom-earth' },
      'https://zoom.earth/maps/satellite/#view=1,2,11z',
      deep,
      1000
    );
    expect(zoomEarth).toContain(',20z');
    expect(L.writeView({ site: 'bing-maps' }, 'https://www.bing.com/maps?cp=1~2&lvl=15', deep, 1000)).toContain(
      'lvl=20'
    );
  });

  it('refuses what it cannot write rather than guessing', () => {
    const view = { lat: 1, lon: 2, zoom: 15, bearing: 0 };
    // a site it does not know, a Street View camera, a view with no number in it
    expect(L.writeView({ site: 'somewhere' }, 'https://example.com/', view, 1000)).toBeNull();
    expect(
      L.writeView({ site: 'google-maps' }, 'https://www.google.com/maps/@1,2,3a,75y,90h/data=!3m1', view, 1000)
    ).toBeNull();
    expect(L.writeView({ site: 'bing-maps' }, 'https://www.bing.com/maps', { lat: NaN, lon: 2, zoom: 3 }, 1000)).toBeNull();
    // Earth's distance only means a level next to the height it is drawn in
    expect(
      L.writeView({ site: 'google-earth' }, 'https://earth.google.com/web/@1,2,10a,500d,35y,0h,0t,0r', view, 0)
    ).toBeNull();
  });

  it('holds Apple to the latitude it opens, so its address is true when it lands', () => {
    // written past the limit, Apple moves back to it and the address says the
    // pole for as long as it takes the site to rewrite it — which is the address
    // the tools take their ground from
    const far = { lat: 78.223, lon: 15.6, zoom: 12, bearing: 0 };
    const href = 'https://maps.apple.com/frame?center=70.1,15.6&z=12';
    expect(L.writeView({ site: 'apple-maps' }, href, far, 1000)).toContain('center=70.495574%2C15.6');
    expect(L.writeView({ site: 'apple-maps' }, href, { ...far, lat: -78.223 }, 1000)).toContain('-70.495574');
    // and nowhere else: only Apple was measured refusing to open one
    expect(L.writeView({ site: 'bing-maps' }, 'https://www.bing.com/maps?cp=1~2&lvl=15', far, 1000)).toContain(
      'cp=78.223%7E15.6'
    );
  });

  it('writes nothing where the address already says it', () => {
    const href = 'https://satellites.pro/#1,2,15';
    expect(L.writeView({ site: 'satellites-pro' }, href, { lat: 1, lon: 2, zoom: 15 }, 1000)).toBeNull();
  });
});

describe('where a site will not go, or will not say', () => {
  it('names an Apple place card, which hides the camera until it is closed', () => {
    expect(L.hiddenBy('https://maps.apple.com/place?map=satellite&coordinate=47.38,2.35&name=x')).toContain(
      'Close the card'
    );
    expect(L.hiddenBy('https://maps.apple.com/frame?center=47.38,2.35&z=16')).toBeNull();
    expect(L.hiddenBy('not a url')).toBeNull();
  });

  it('says Apple stopped at the latitude it opens no view past', () => {
    // opened past ±70.4956° Apple lands on it, and dragging goes the rest
    const asked = { lat: 78.22, lon: 15.6, zoom: 12 };
    expect(L.poleLimit('apple-maps', asked, { lat: 70.495574, lon: 15.6, zoom: 12 })).toBeCloseTo(70.4956, 3);
    expect(L.poleLimit('apple-maps', { ...asked, lat: -78 }, { lat: -70.495574, lon: 15.6, zoom: 12 })).not.toBeNull();
    expect(L.poleLimit('apple-maps', { ...asked, lat: 69 }, { lat: 69, lon: 15.6, zoom: 12 })).toBeNull();
    expect(L.poleLimit('bing-maps', asked, { lat: 70.495574, lon: 15.6, zoom: 12 })).toBeNull();
  });
});

describe('which views may lead or follow', () => {
  const map = {
    site: 'openstreetmap',
    lat: 50.45,
    lon: 30.52,
    zoom: 17,
    view_kind: 'map',
    geometry: true,
    scale_source: 'zoom',
  };

  it('takes a flat map whose address states a scale', () => {
    expect(L.followable(map)).toBe(true);
  });

  it('leaves Street View, a pitched camera and an unscaled view where they are', () => {
    expect(L.followable({ ...map, view_kind: 'streetview' })).toBe(false);
    expect(L.followable({ ...map, view_kind: 'tilted' })).toBe(false);
    expect(L.followable({ ...map, scale_source: null, zoom: null })).toBe(false);
    expect(L.followable(null)).toBe(false);
  });
});

describe('saying how close a map came', () => {
  const asked = { lat: 1, lon: 2, zoom: 21 };

  it('names the level a map stopped at', () => {
    expect(L.shortOf(asked, { lat: 1, lon: 2, zoom: 11 })).toBe(11);
  });

  it('says nothing while a map is still on its way', () => {
    // Earth flies in from space on every load, and its first address is not short
    expect(L.shortOf(asked, { lat: 0, lon: -0.25, zoom: 3.3 })).toBeNull();
  });

  it('says nothing about half a level of rounding', () => {
    expect(L.shortOf({ ...asked, zoom: 16.4 }, { lat: 1, lon: 2, zoom: 16 })).toBeNull();
    expect(L.shortOf(asked, { lat: 1, lon: 2, zoom: 21 })).toBeNull();
    expect(L.shortOf(null, { lat: 1, lon: 2, zoom: 21 })).toBeNull();
  });
});

describe('the two copies of "the same camera" agree', () => {
  const base = { lat: 48.8566, lon: 2.3522, zoom: 17, bearing: 0 };
  const pairs = [
    [base, base],
    [base, { ...base, lat: base.lat + 0.0000001 }],
    [base, { ...base, lat: 48.86 }],
    [base, { ...base, zoom: 16 }],
    [base, { ...base, zoom: 17.4 }],
    [base, { ...base, bearing: 90 }],
    [{ lat: 1, lon: 2, zoom: 5 }, { lat: 1, lon: 2, zoom: 5, bearing: 0 }],
    [base, null],
  ];

  it('on every pair', () => {
    for (const [a, b] of pairs) expect(L.sameCamera(a, b), JSON.stringify([a, b])).toBe(sameView(a, b));
  });
});

// --- the panel ---------------------------------------------------------------------

/** The files the panel is injected with, in the order the worker injects them. */
const PARTS = ['mapmath.js', 'maptheme.js', 'maptools.js', 'mapdraw.js', 'mapref.js', 'maplink.js'];
const POLL_MS = 300;

beforeAll(() => {
  globalThis.Path2D = class {
    constructor(d) {
      this.d = d;
    }
  };
  window.HTMLCanvasElement.prototype.getContext = () => {
    const noop = () => {};
    return new Proxy({ measureText: () => ({ width: 20 }) }, { get: (t, n) => t[n] ?? noop });
  };
});

/** The app's reading of an OpenStreetMap address: `#map=z/lat/lon`. A stand-in
 *  for the parser, which `test_map_link_writes.py` holds to the writer. */
function osmParse(url, extra = {}) {
  const m = /map=([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)/.exec(url);
  return {
    site: 'openstreetmap',
    label: 'OpenStreetMap',
    lat: Number(m[2]),
    lon: Number(m[3]),
    zoom: Number(m[1]),
    bearing: 0,
    projection: 'webmercator',
    view_kind: 'map',
    geometry: true,
    far: false,
    scale_source: 'zoom',
    ...extra,
  };
}

/**
 * A panel on OpenStreetMap, the port it opens to the hub, and an address bar
 * that takes a new hash the way that site does: in place, without a reload.
 */
function open({ extra = {}, href = 'https://www.openstreetmap.org/#map=17/50.45/30.52', parse = osmParse } = {}) {
  window.happyDOM.setViewport({ width: 1400, height: 900 });
  const location = {
    href,
    host: new URL(href).host,
    assign: vi.fn((url) => {
      location.href = url;
    }),
  };
  const links = [];
  const api = {
    storage: { local: { get: vi.fn(async (d) => ({ ...d })), set: vi.fn() } },
    runtime: {
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn(async (message) => {
        if (message.type !== 'map-api') return { ok: true, data: {} };
        if (message.path === '/api/ingest/parse') return { ok: true, data: parse(message.query.url, extra) };
        if (message.path === '/api/ingest/ping') return { ok: true, data: { units: 'metric' } };
        if (message.path === '/api/ingest/cases') return { ok: true, data: [{ id: 'c', name: 'Case' }] };
        return { ok: true, data: [] };
      }),
      connect: vi.fn((info) => {
        const port = {
          name: info.name,
          heard: [],
          listeners: [],
          onMessage: { addListener: (cb) => port.listeners.push(cb) },
          onDisconnect: { addListener: () => {} },
          postMessage: vi.fn((msg) => port.heard.push(msg)),
          disconnect: vi.fn(),
        };
        if (info.name === 'map-link') links.push(port);
        return port;
      }),
    },
  };
  for (const part of PARTS) new Function('window', read(part))(window);
  new Function('window', 'document', 'location', 'chrome', 'browser', read('mapoverlay.js'))(
    window,
    document,
    location,
    api,
    undefined
  );
  const panel = window.__AZIMUT_MAP_TOOLS__;
  const root = () => window.__AZIMUT_MAP_TOOLS__.root;
  const link = () => links.at(-1);
  return {
    ...panel,
    location,
    link,
    /** The hub, saying something to this panel. */
    hub: (msg) => {
      for (const cb of link().listeners) cb(msg);
    },
    said: (type) => link().heard.filter((m) => m.type === type),
    button: () => root().querySelector('[data-act="link"]'),
    /** This tab going behind another, and being come back to. */
    hide: () => showTab(false),
    show: () => showTab(true),
    status: () => root().querySelector('.status')?.textContent ?? '',
    note: () => root().querySelector('.note')?.textContent ?? '',
  };
}

/** Whether this tab is the one being looked at, which is what the panel reads to
 *  decide between following a view now and keeping it for later. */
function showTab(on) {
  Object.defineProperty(document, 'hidden', { value: !on, configurable: true });
  document.dispatchEvent(new window.Event('visibilitychange'));
}

const tick = (ms = POLL_MS) => vi.advanceTimersByTimeAsync(ms);
const at = (type, x, y) =>
  window.dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 }));

let panel = null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  panel?.close();
  panel = null;
  showTab(true);
  vi.useRealTimers();
  document.documentElement.querySelectorAll('#azimut-map-tools').forEach((node) => node.remove());
});

/** A panel that has read its address and been told it is linked with one peer. */
async function linked(options) {
  const live = open(options);
  await tick();
  live.hub({ type: 'link-peers', count: 1 });
  live.hub({ type: 'link-state', linked: true, asked: null });
  return live;
}

describe('the link button', () => {
  it('opens the port the hub counts it by', async () => {
    panel = open();
    await tick();
    expect(panel.link().name).toBe('map-link');
  });

  it('is greyed while there is no other map to link to', async () => {
    panel = open();
    await tick();
    expect(panel.button().disabled).toBe(true);
    expect(panel.button().title).toBe('Open another map, here or in Azimut, to link the views');
    panel.hub({ type: 'link-peers', count: 1 });
    expect(panel.button().disabled).toBe(false);
  });

  it('links, and brings the other maps to this one', async () => {
    panel = open();
    await tick();
    panel.hub({ type: 'link-peers', count: 1 });
    panel.button().click();
    expect(panel.said('link')).toEqual([{ type: 'link', on: true }]);
    expect(panel.said('view')).toEqual([{ type: 'view', view: { lat: 50.45, lon: 30.52, zoom: 17, bearing: 0 } }]);
    expect(panel.button().dataset.on).toBe('1');
  });

  it('stays lit while a linked tab it follows is away reloading', async () => {
    // the hub counts a tab on its way to a view, but a panel told nobody is left
    // must not switch its own link off: that is the worker's to decide
    panel = await linked();
    panel.hub({ type: 'link-peers', count: 0 });
    expect(panel.button().disabled).toBe(false);
    expect(panel.button().dataset.on).toBe('1');
  });

  it('leaves the link when the tools are closed', async () => {
    panel = await linked();
    const port = panel.link();
    panel.close();
    panel = null;
    expect(port.heard).toContainEqual({ type: 'link', on: false });
  });
});

describe('following a view', () => {
  const there = { lat: 50.47, lon: 30.6, zoom: 15, bearing: 0 };

  it('writes it into the address bar, having told the hub it is on its way', async () => {
    panel = await linked();
    panel.hub({ type: 'view', view: there });
    expect(panel.said('follow')).toEqual([{ type: 'follow', view: there }]);
    expect(panel.location.assign).toHaveBeenCalledWith('https://www.openstreetmap.org/#map=15/50.47/30.6');
  });

  it('holds a view that arrives before the panel has read its own address', async () => {
    // a panel put back after a reload hears what it missed straight away
    panel = open();
    panel.hub({ type: 'link-state', linked: true, asked: null });
    panel.hub({ type: 'view', view: there });
    expect(panel.location.assign).not.toHaveBeenCalled();
    await tick();
    expect(panel.location.assign).toHaveBeenCalledWith('https://www.openstreetmap.org/#map=15/50.47/30.6');
    expect(panel.note()).toBe('');
  });

  it('ignores views while it is not linked', async () => {
    panel = open();
    await tick();
    panel.hub({ type: 'view', view: there });
    expect(panel.location.assign).not.toHaveBeenCalled();
  });

  it('does not move a map that is already there', async () => {
    panel = await linked();
    panel.hub({ type: 'view', view: { lat: 50.45, lon: 30.52, zoom: 17, bearing: 0 } });
    expect(panel.location.assign).not.toHaveBeenCalled();
  });

  it('stays on a view that is not a flat map, and says so', async () => {
    panel = await linked({ extra: { view_kind: 'streetview' } });
    panel.hub({ type: 'view', view: there });
    expect(panel.location.assign).not.toHaveBeenCalled();
    expect(panel.note()).toBe('Linked view not followed: this is not a flat map');
  });

  it('lands in silence, so the map it follows is not sent back its own view', async () => {
    panel = await linked();
    panel.hub({ type: 'view', view: there });
    await tick();
    expect(panel.state.view.zoom).toBe(15);
    // the site took it in its hash: the panel never left, and says it arrived
    expect(panel.said('landed')).toHaveLength(1);
    await tick(3000);
    expect(panel.said('view')).toEqual([]);
  });

  it('says it went as close as this map goes', async () => {
    // Zoom Earth stops at 11 while the map it follows is at 21: said here, never
    // corrected, because nothing is wrong with either
    panel = open();
    await tick();
    panel.hub({ type: 'link-state', linked: true, asked: { lat: 50.45, lon: 30.52, zoom: 21, bearing: 0 } });
    expect(panel.status()).toContain('as close as this map goes (linked view z21.0)');
  });

  it('follows from an Apple place card, which hides the camera, and says what to do meanwhile', async () => {
    const place =
      'https://maps.apple.com/place?map=satellite&z=16&address=2+Route&coordinate=47.387736,2.353482&name=2+Route';
    const appleNoView = () => ({ site: 'apple-maps', label: 'Apple Maps', lat: null, lon: null, zoom: null });
    panel = await linked({ href: place, parse: appleNoView });
    expect(panel.status()).toContain('Close the card to go on');
    panel.hub({ type: 'view', view: there });
    expect(panel.location.assign).toHaveBeenCalledWith(
      'https://maps.apple.com/frame?map=satellite&center=50.47%2C30.6&z=15'
    );
  });

  it('says Apple stopped at the latitude it will open, and to drag the rest', async () => {
    const frame = 'https://maps.apple.com/frame?map=satellite&center=70.495574,15.6&z=12';
    const apple = () => ({
      site: 'apple-maps',
      label: 'Apple Maps',
      lat: 70.495574,
      lon: 15.6,
      zoom: 12,
      bearing: 0,
      projection: 'webmercator',
      view_kind: 'map',
      geometry: true,
      far: false,
      scale_source: 'span',
    });
    panel = open({ href: frame, parse: apple });
    await tick();
    panel.hub({ type: 'link-state', linked: true, asked: { lat: 78.22, lon: 15.6, zoom: 12, bearing: 0 } });
    expect(panel.status()).toContain('opens no nearer the pole than 70.5°, drag the rest of the way');
  });

  it('keeps a view for a tab in the background, and takes it when it is looked at', async () => {
    panel = await linked();
    panel.hide();
    panel.hub({ type: 'view', view: there });
    expect(panel.location.assign).not.toHaveBeenCalled();
    // and the hub is not told a tab is on its way anywhere, because none is
    expect(panel.said('follow')).toEqual([]);
    panel.show();
    expect(panel.location.assign).toHaveBeenCalledWith('https://www.openstreetmap.org/#map=15/50.47/30.6');
    expect(panel.said('follow')).toEqual([{ type: 'follow', view: there }]);
  });

  it('keeps only the last of the views it missed, not the way the other map went', async () => {
    panel = await linked();
    panel.hide();
    for (const zoom of [16, 14, 12]) panel.hub({ type: 'view', view: { ...there, zoom } });
    panel.show();
    expect(panel.location.assign).toHaveBeenCalledTimes(1);
    expect(panel.location.assign).toHaveBeenCalledWith('https://www.openstreetmap.org/#map=12/50.47/30.6');
  });

  it('goes on following a tab that is only unfocused, which is still one being read', async () => {
    // two maps side by side on two screens: neither is hidden, and a view held
    // back until one of them is clicked would read as the link having dropped
    panel = await linked();
    panel.show();
    panel.hub({ type: 'view', view: there });
    expect(panel.location.assign).toHaveBeenCalledWith('https://www.openstreetmap.org/#map=15/50.47/30.6');
  });

  it('drops a view kept for a background tab that the analyst moves on arriving', async () => {
    // coming back to a map and dragging it makes this one the map that leads:
    // the view it missed would pull it off the ground the analyst just chose
    panel = await linked();
    panel.hide();
    panel.hub({ type: 'view', view: there });
    at('pointerdown', 700, 450);
    panel.show();
    expect(panel.location.assign).not.toHaveBeenCalled();
    at('pointerup', 700, 450);
    await tick(3000);
    expect(panel.location.assign).not.toHaveBeenCalled();
  });

  it('leaves a map stopped at Apple’s pole where it is, gesture after gesture', async () => {
    // it is already as far north as it opens, so every view past the limit asks
    // for the ground it is on: reloading for each of them puts it back where it
    // was, on top of the drag the panel had just asked for
    const stopped = { lat: 70.495574, lon: 15.6, zoom: 12, bearing: 0 };
    const apple = () => ({
      site: 'apple-maps',
      label: 'Apple Maps',
      ...stopped,
      projection: 'webmercator',
      view_kind: 'map',
      geometry: true,
      far: false,
      scale_source: 'span',
    });
    panel = await linked({ href: 'https://maps.apple.com/frame?center=70.495574,15.6&z=12', parse: apple });
    for (const lat of [78.2, 79.1, 80]) panel.hub({ type: 'view', view: { ...stopped, lat } });
    expect(panel.location.assign).not.toHaveBeenCalled();
    // and it still goes where it can: the limit is on the latitude, not the view
    panel.hub({ type: 'view', view: { lat: 79.1, lon: 20, zoom: 12, bearing: 0 } });
    expect(panel.location.assign).toHaveBeenCalledWith('https://maps.apple.com/frame?center=70.495574%2C20&z=12');
  });

  it('passes on what the hub could not do', async () => {
    panel = await linked();
    panel.hub({ type: 'link-note', note: 'A linked tab reloaded and the browser kept its tools off. Open them there again' });
    expect(panel.note()).toContain('kept its tools off');
  });
});

describe('leading', () => {
  it('sends the view once the analyst has moved this map and it has settled', async () => {
    panel = await linked();
    at('pointerdown', 700, 450);
    at('pointermove', 600, 450);
    at('pointerup', 600, 450);
    panel.location.href = 'https://www.openstreetmap.org/#map=17/50.45/30.6';
    await tick(1500);
    expect(panel.said('view')).toEqual([{ type: 'view', view: { lat: 50.45, lon: 30.6, zoom: 17, bearing: 0 } }]);
  });

  it('sends nothing for a gesture that left the map where it was', async () => {
    // Copernicus does not rewrite its address on a pan: there is no new view to
    // hand over, and the old one would move the others back
    panel = await linked();
    at('pointerdown', 700, 450);
    at('pointermove', 600, 450);
    at('pointerup', 600, 450);
    await tick(3000);
    expect(panel.said('view')).toEqual([]);
  });

  it('sends what a slow site writes down after the settle gave up waiting', async () => {
    // Earth writes a drag seconds after the pointer let go, and again as it
    // glides: the lead is the view it stops on, not the first nor none
    panel = await linked();
    at('pointerdown', 700, 450);
    at('pointermove', 600, 450);
    at('pointerup', 600, 450);
    await tick(3000); // the settle gives up with the address bar unchanged
    expect(panel.said('view')).toEqual([]);
    panel.location.href = 'https://www.openstreetmap.org/#map=17/50.45/30.55';
    await tick(300);
    panel.location.href = 'https://www.openstreetmap.org/#map=17/50.45/30.6';
    await tick(1200);
    expect(panel.said('view')).toEqual([{ type: 'view', view: { lat: 50.45, lon: 30.6, zoom: 17, bearing: 0 } }]);
  });

  it('stops counting the address bar as the analyst’s long after the gesture', async () => {
    panel = await linked();
    at('pointerdown', 700, 450);
    at('pointermove', 600, 450);
    at('pointerup', 600, 450);
    await tick(25000);
    panel.location.href = 'https://www.openstreetmap.org/#map=17/50.45/30.6';
    await tick(1500);
    expect(panel.said('view')).toEqual([]);
  });

  it('sends nothing while it is not linked', async () => {
    panel = open();
    await tick();
    at('pointerdown', 700, 450);
    at('pointermove', 600, 450);
    at('pointerup', 600, 450);
    panel.location.href = 'https://www.openstreetmap.org/#map=17/50.45/30.6';
    await tick(1500);
    expect(panel.said('view')).toEqual([]);
  });

  it('stops saying how close it came once the analyst takes this map somewhere', async () => {
    panel = open();
    await tick();
    panel.hub({ type: 'link-state', linked: true, asked: { lat: 50.45, lon: 30.52, zoom: 21, bearing: 0 } });
    at('pointerdown', 700, 450);
    at('pointermove', 600, 450);
    at('pointerup', 600, 450);
    panel.location.href = 'https://www.openstreetmap.org/#map=17/50.45/30.6';
    await tick(1500);
    expect(panel.status()).not.toContain('as close as this map goes');
  });
});
