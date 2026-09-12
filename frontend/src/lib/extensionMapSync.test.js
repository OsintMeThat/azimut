// @vitest-environment happy-dom
/**
 * The map tools panel, told about a case it is not the only one working on
 * (extension/mapoverlay.js, the map-sync port).
 *
 * Everything else about this panel is about what it *writes*: a point filed, a
 * cell marked, a grid saved. This is the other direction, and it is the half
 * that used to need a page reload — a point saved in the app, a cell swept from
 * another tab, a sweep discarded by someone who is also the analyst, one screen
 * over. The nudges are the app's own (`api/events.py`), read by the worker and
 * handed over a port (`background.js`, `extension.test.js` covers that end).
 *
 * What is asserted here is what the panel *asks the app for* after a nudge, and
 * what it draws once the answer lands. The two rules worth the test are that a
 * nudge about the case's points is always worth a read, and that a nudge
 * carrying a revision the panel already holds is not — that one is its own write
 * coming back, and re-reading the file for it would be a request per marked
 * cell.
 */
import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, `../../../extension/${name}`), 'utf8');

/** The files the panel is injected with, in the order the worker injects them. */
const PARTS = ['mapmath.js', 'maptheme.js', 'maptools.js', 'mapdraw.js', 'mapref.js'];

const CASE = 'case-1';
const OTHER = 'case-2';
/** How often the panel re-reads the address bar — the clock the init is wound
 *  past so its opening errands have all landed. */
const POLL_MS = 300;

/** A saved grid, as the app hands one back. */
const spec = (statuses = {}, revision = 3) => ({
  azimut_grid: 1,
  cell_m: 500,
  anchor: { lat: 50.44, lon: 30.51 },
  lat_step: 0.0045,
  lon_step: 0.007,
  aoi: { type: 'rect', bounds: { south: 50.44, north: 50.46, west: 30.51, east: 30.54 } },
  statuses,
  revision,
});

const POINT = { id: 'p1', kind: 'place', title: 'The quay', lat: 50.45, lon: 30.52 };

beforeAll(() => {
  globalThis.Path2D = class {
    constructor(d) {
      this.d = d;
    }
  };
  window.HTMLCanvasElement.prototype.getContext = () => {
    const noop = () => {};
    return new Proxy(
      { measureText: () => ({ width: 20 }) },
      { get: (target, name) => target[name] ?? noop }
    );
  };
});

/**
 * A panel, loaded the way the worker loads it, with the port it listens on.
 *
 * `answers` is the app: one entry per route the panel may ask for, replaced
 * mid-test to stand for someone else having written the file.
 */
function open({ answers } = {}) {
  window.happyDOM.setViewport({ width: 1400, height: 900 });
  const location = {
    href: 'https://www.openstreetmap.org/#map=17/50.45/30.52',
    host: 'www.openstreetmap.org',
  };
  const asked = [];
  const app = {
    '/api/ingest/ping': { units: 'metric' },
    '/api/ingest/cases': [{ id: CASE, name: 'Case one' }, { id: OTHER, name: 'Case two' }],
    '/api/ingest/parse': {
      site: 'openstreetmap',
      label: 'OpenStreetMap',
      lat: 50.45,
      lon: 30.52,
      zoom: 17,
      bearing: 0,
      projection: 'webmercator',
      view_kind: 'map',
      geometry: true,
      scale_source: 'zoom',
    },
    '/api/ingest/saved': [POINT],
    '/api/ingest/grids': [{ name: 'sweep', title: 'Quay sweep' }],
    '/api/ingest/grid': spec(),
    ...answers,
  };

  const ports = [];
  const api = {
    storage: {
      local: { get: vi.fn(async (defaults) => ({ ...defaults })), set: vi.fn() },
    },
    runtime: {
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn(async (message) => {
        if (message.type !== 'map-api') return { ok: true, data: {} };
        asked.push(message);
        return { ok: true, data: app[message.path] ?? null };
      }),
      connect: vi.fn((info) => {
        const port = {
          name: info.name,
          heard: [],
          gone: false,
          messages: [],
          disconnects: [],
          onMessage: { addListener: (cb) => port.messages.push(cb) },
          onDisconnect: { addListener: (cb) => port.disconnects.push(cb) },
          postMessage: vi.fn((msg) => port.heard.push(msg)),
          disconnect: vi.fn(() => (port.gone = true)),
        };
        ports.push(port);
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
  const root = () => document.getElementById('azimut-map-tools').shadowRoot;
  return {
    ...panel,
    app,
    api,
    ports,
    /** Which routes the panel has asked for since the last `forget`. */
    asks: () => asked.map((m) => m.path),
    queries: (path) => asked.filter((m) => m.path === path).map((m) => m.query),
    forget: () => (asked.length = 0),
    /** One nudge, as the worker hands it over. */
    nudge: (event) => {
      for (const cb of ports.at(-1).messages) cb({ type: 'app-event', event });
    },
    /** The worker went away, taking the port with it. */
    evict: () => {
      for (const cb of ports.at(-1).disconnects) cb();
    },
    pick: (id) => root().querySelector(`[data-tab="${id}"]`).click(),
    /** Open a saved sweep the way the picker does. */
    openSweep: (name = 'sweep') => {
      const select = root().querySelector('[data-act="grid-open"]');
      select.value = name;
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    },
    note: () => root().querySelector('.note')?.textContent ?? '',
  };
}

/** Let the panel's opening errands land. */
const settle = (ms = POLL_MS) => vi.advanceTimersByTimeAsync(ms);

let panel = null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  panel?.close();
  panel = null;
  vi.useRealTimers();
  document.documentElement.querySelectorAll('#azimut-map-tools').forEach((node) => node.remove());
});

describe('listening at all', () => {
  it('opens one port, named so the worker knows what it is', async () => {
    panel = open();
    await settle();
    expect(panel.ports).toHaveLength(1);
    expect(panel.ports[0].name).toBe('map-sync');
  });

  it('speaks on it, so the worker is not evicted mid-sweep', async () => {
    panel = open();
    await settle();
    await vi.advanceTimersByTimeAsync(21000);
    expect(panel.ports[0].postMessage).toHaveBeenCalled();
  });

  it('opens another when the worker takes the first one with it', async () => {
    panel = open();
    await settle();
    panel.evict();
    await vi.advanceTimersByTimeAsync(2500);
    expect(panel.ports).toHaveLength(2);
  });

  it('lets go of the port when the panel closes', async () => {
    panel = open();
    await settle();
    const port = panel.ports[0];
    panel.close();
    panel = null;
    expect(port.disconnect).toHaveBeenCalled();
  });
});

describe('the case’s points', () => {
  it('re-reads them when one is filed elsewhere', async () => {
    panel = open();
    await settle();
    panel.forget();
    panel.app['/api/ingest/saved'] = [POINT, { ...POINT, id: 'p2', title: 'The bridge' }];
    panel.nudge({ type: 'place', case_id: CASE, title: 'The bridge' });
    await vi.waitFor(() => expect(panel.tools.pins.rows).toHaveLength(2));
    expect(panel.queries('/api/ingest/saved').at(-1)).toEqual({ case_id: CASE });
  });

  it('re-reads them when the app moves its own saved work', async () => {
    panel = open();
    await settle();
    panel.forget();
    panel.app['/api/ingest/saved'] = [];
    panel.nudge({ type: 'saved', case_id: CASE });
    await vi.waitFor(() => expect(panel.tools.pins.rows).toHaveLength(0));
  });

  it('leaves another case’s points where they are', async () => {
    panel = open();
    await settle();
    panel.forget();
    panel.nudge({ type: 'saved', case_id: OTHER });
    await settle(50);
    expect(panel.asks()).not.toContain('/api/ingest/saved');
  });
});

describe('an open sweep', () => {
  /** A panel with the saved sweep open, as the picker opens it. */
  async function sweeping(options) {
    const p = open(options);
    await settle();
    p.pick('grid');
    await settle(50);
    p.openSweep();
    await settle(50);
    p.forget();
    return p;
  }

  it('takes a cell marked elsewhere', async () => {
    panel = await sweeping();
    panel.app['/api/ingest/grid'] = spec({ '0:0': 'flagged' }, 4);
    panel.nudge({ type: 'grid-marks', case_id: CASE, name: 'sweep', revision: 4 });
    await vi.waitFor(() => expect(panel.tools.grid.grid.statuses).toEqual({ '0:0': 'flagged' }));
  });

  it('ignores the revision it is already holding — its own write, heard back', async () => {
    panel = await sweeping();
    panel.nudge({ type: 'grid-marks', case_id: CASE, name: 'sweep', revision: 3 });
    await settle(50);
    expect(panel.asks()).not.toContain('/api/ingest/grid');
  });

  it('ignores a nudge about a sweep it does not have open', async () => {
    panel = await sweeping();
    panel.nudge({ type: 'grid-marks', case_id: CASE, name: 'another', revision: 9 });
    await settle(50);
    expect(panel.asks()).not.toContain('/api/ingest/grid');
  });

  it('takes an area reshaped elsewhere whole', async () => {
    panel = await sweeping();
    const wider = { south: 50.4, north: 50.5, west: 30.5, east: 30.6 };
    panel.app['/api/ingest/grid'] = { ...spec({}, 5), aoi: { type: 'rect', bounds: wider } };
    panel.nudge({ type: 'grid', case_id: CASE, name: 'sweep', revision: 5 });
    await vi.waitFor(() => expect(panel.tools.grid.grid.aoi.bounds.north).toBe(wider.north));
  });

  it('closes a sweep discarded elsewhere, and says so', async () => {
    panel = await sweeping();
    panel.nudge({ type: 'grid-removed', case_id: CASE, name: 'sweep' });
    await settle(50);
    expect(panel.tools.grid.grid).toBe(null);
    expect(panel.note()).toContain('discarded elsewhere');
  });

  it('adds a grid drawn elsewhere to the picker', async () => {
    panel = await sweeping();
    panel.app['/api/ingest/grids'] = [
      { name: 'sweep', title: 'Quay sweep' },
      { name: 'hillside', title: 'Hillside sweep' },
    ];
    panel.nudge({ type: 'grid', case_id: CASE, name: 'hillside', revision: 1 });
    await vi.waitFor(() => expect(panel.state.grids).toHaveLength(2));
  });

  it('does not read a picker it has never opened', async () => {
    // a panel measuring distances has no grid list to keep current, and a nudge
    // is not a reason to fetch one
    panel = open();
    await settle();
    panel.forget();
    panel.nudge({ type: 'grid', case_id: CASE, name: 'hillside', revision: 1 });
    await settle(50);
    expect(panel.asks()).not.toContain('/api/ingest/grids');
  });
});
