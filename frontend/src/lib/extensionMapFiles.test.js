// @vitest-environment happy-dom
/**
 * Getting a case file into a reference window (extension/mapoverlay.js, `fetchFile`).
 *
 * The panel floats on someone else's map, so a file it wants has to cross the
 * worker boundary as a string — and a message is no place for a video. The
 * worker answers a slice at a time (`background.js`, `mapFile`; `extension.test.js`
 * covers that end) and this side asks again from where the last one stopped.
 *
 * Which makes the loop the thing worth a test: it is the difference between a
 * reference being a photo and a reference being the clip the geolocation is
 * actually of. A loop that stops early hands the window half a file, and one
 * that never stops asks the worker for the same byte for ever.
 */
import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, `../../../extension/${name}`), 'utf8');

/** The files the panel is injected with, in the order the worker injects them. */
const PARTS = ['mapmath.js', 'maptheme.js', 'maptools.js', 'mapdraw.js', 'mapref.js', 'maplink.js'];

const CASE = 'case-1';
/** How often the panel re-reads the address bar — the clock the init is wound
 *  past so its opening errands have all landed. */
const POLL_MS = 300;

const CLIP = {
  path: 'media/walk.mp4',
  filename: 'walk.mp4',
  title: 'The walk',
  kind: 'video',
  thumbnail: '',
};

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
  globalThis.createImageBitmap = async () => ({ width: 1600, height: 1200, close: vi.fn() });
});

/**
 * A panel on a map, with a case holding one video.
 *
 * `chunk` is how much of the file the worker says it is willing to answer with,
 * which stands for `FILE_CHUNK_BYTES` over there.
 */
function open({ bytes, chunk }) {
  window.happyDOM.setViewport({ width: 1400, height: 900 });
  const location = {
    href: 'https://www.openstreetmap.org/#map=17/50.45/30.52',
    host: 'www.openstreetmap.org',
  };
  const app = {
    '/api/ingest/ping': { units: 'metric' },
    '/api/ingest/cases': [{ id: CASE, name: 'Case one' }],
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
    '/api/ingest/saved': [],
    '/api/ingest/grids': [],
    '/api/ingest/media': { items: [CLIP], total: 1 },
  };

  const asked = []; // every map-file message, in order
  const blobs = []; // what the window was handed to play
  globalThis.URL.createObjectURL = vi.fn((blob) => {
    blobs.push(blob);
    return `blob:azimut/${blobs.length}`;
  });
  globalThis.URL.revokeObjectURL = vi.fn();

  const api = {
    storage: { local: { get: vi.fn(async (d) => ({ ...d })), set: vi.fn() } },
    runtime: {
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn(async (message) => {
        if (message.type === 'map-api') return { ok: true, data: app[message.path] ?? null };
        if (message.type !== 'map-file') return { ok: true, data: {} };
        asked.push(message);
        const start = message.offset ?? 0;
        const part = bytes.slice(start, start + chunk);
        const read_ = start + part.length;
        return {
          ok: true,
          file: {
            type: 'video/mp4',
            data: btoa(String.fromCharCode(...part)),
            next: read_ < bytes.length ? read_ : null,
            total: bytes.length,
          },
        };
      }),
      connect: vi.fn(() => ({
        onMessage: { addListener: vi.fn() },
        onDisconnect: { addListener: vi.fn() },
        postMessage: vi.fn(),
        disconnect: vi.fn(),
      })),
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
    root,
    offsets: () => asked.map((m) => m.offset),
    paths: () => asked.map((m) => m.path),
    blobs,
    /** Open the picker and take the one file the case has, the way a press does. */
    pick: async () => {
      root().querySelector('[data-tab="refs"]').click();
      root().querySelector('[data-act="ref-add"]').click();
      await settle();
      root().querySelector('.pick-item').click();
      await settle();
    },
    wait: () => root().querySelector('.rw-wait')?.textContent ?? null,
  };
}

/** Let the panel's errands land. */
const settle = (ms = POLL_MS) => vi.advanceTimersByTimeAsync(ms);

let panel = null;

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  panel?.close();
  panel = null;
  vi.useRealTimers();
  document.documentElement.querySelectorAll('#azimut-map-tools').forEach((node) => node.remove());
});

describe('pulling a reference across', () => {
  it('asks again from where the last slice stopped, and glues them in order', async () => {
    const bytes = [...Array(10).keys()]; // 0..9, so a mis-ordered join is visible
    panel = open({ bytes, chunk: 4 });
    await settle();
    await panel.pick();

    expect(panel.offsets()).toEqual([0, 4, 8]);
    expect(panel.paths()).toEqual(Array(3).fill(CLIP.path));
    // one blob, the whole file, wearing the type the app gave it — what the
    // video element is handed an object URL for
    expect(panel.blobs).toHaveLength(1);
    expect(panel.blobs[0].size).toBe(bytes.length);
    expect(panel.blobs[0].type).toBe('video/mp4');
    expect([...new Uint8Array(await panel.blobs[0].arrayBuffer())]).toEqual(bytes);
  });

  it('stops after one ask when the whole file came in one', async () => {
    // a photo, and every thumbnail in the picker: the loop must cost nothing
    // extra for the files that were never the problem
    panel = open({ bytes: [1, 2, 3], chunk: 64 });
    await settle();
    await panel.pick();

    expect(panel.offsets()).toEqual([0]);
    expect(panel.blobs[0].size).toBe(3);
  });

  it('counts a long file up while it arrives', async () => {
    // "Loading…" for a minute with no sign of movement is the state that gets a
    // window closed and the file attached by hand instead. (The line itself is
    // taken away by the video element, which loads nothing in this environment.)
    panel = open({ bytes: [...Array(10).keys()], chunk: 4 });
    await settle();
    panel.root().querySelector('[data-tab="refs"]').click();
    panel.root().querySelector('[data-act="ref-add"]').click();
    await settle();
    panel.root().querySelector('.pick-item').click();
    // partway in, before the rest of the slices land: a number, and never 100
    await vi.advanceTimersByTimeAsync(0);
    expect(panel.wait()).toMatch(/^Loading… [1-9]\d?%$/);
    await settle();
    expect(panel.wait()).not.toBe('Loading… 100%');
  });

  it('says nothing about a file that came in one piece', async () => {
    // a percentage that appears and is immediately right is noise on a photo
    panel = open({ bytes: [1, 2, 3], chunk: 64 });
    await settle();
    await panel.pick();

    expect(panel.wait()).toBe('Loading…');
  });
});
