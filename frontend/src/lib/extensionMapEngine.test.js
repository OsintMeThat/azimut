// @vitest-environment happy-dom
/**
 * The map tools' view engine (extension/mapoverlay.js), driven end to end.
 *
 * `extensionMapFrame.test.js` replays the recordings through the arithmetic.
 * This replays them through the *panel*: the address bar changes, the wheel
 * turns, the window is resized, and what is asserted is what the analyst would
 * see — where the drawing is placed, what the status line says, and what the
 * app is asked for.
 *
 * It exists because everything that makes this tool portable lives here rather
 * than in the maths. The arithmetic is a pure function of CSS pixels and
 * coordinates and cannot tell one machine from another; the engine is what
 * decides *which* pixels it gets — the window's or the map's, this window's or
 * the one the offset was measured in, the browser's own or the device's.
 *
 * Two stand-ins, and no more. The app's parse (`engine/mapsites.py`) answers
 * from the recording, which `tests/test_mapsites.py` pins to the real parser
 * URL by URL; and the canvas records the calls made on it, because happy-dom
 * has no 2D context. Everything else is the file itself.
 */
import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const read = (name) => readFileSync(join(root, `extension/${name}`), 'utf8');
const fixture = JSON.parse(readFileSync(join(root, 'tests/fixtures/map-sites.json'), 'utf8'));

/** The files the panel is injected with, in the order the worker injects them. */
const PARTS = ['mapmath.js', 'maptheme.js', 'maptools.js', 'mapdraw.js', 'mapref.js'];

/** How often the panel re-reads the address bar, how long it waits for a
 *  gesture to land, and how long an offset is held before it counts — all three
 *  stated in `mapoverlay.js`, and what the clock below is wound past. */
const POLL_MS = 300;
const SETTLE_MS = 200;
const FRAME_QUIET_MS = 400;

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

// --- the app, and the browser around it ---------------------------------------

/**
 * The app's reading of one recorded URL.
 *
 * The views are the recording's own, so nothing here re-implements a parser.
 * What it does implement is the one thing a different window really changes: a
 * scale stated as a *size* — Apple's span, Google satellite's metres — is a
 * different zoom when the map is drawn in fewer pixels. That is the property
 * the resize tests below are about, so it has to be in the stand-in rather than
 * assumed away.
 */
function parseOf(step, height, drawnIn, extra = {}) {
  const view = step.view;
  const sized = step.scale_source === 'span' || step.scale_source === 'height_m';
  const metres = /,(\d+(?:\.\d+)?)m(?:$|[,/?])/.exec(step.url);
  return {
    site: step.site,
    label: step.site,
    lat: view.lat,
    lon: view.lon,
    zoom: sized ? view.zoom + Math.log2(height / drawnIn) : view.zoom,
    bearing: view.bearing,
    projection: view.projection,
    view_kind: 'map',
    geometry: true,
    far: false,
    globe_below: null,
    scale_source: step.scale_source,
    camera_m: metres ? Number(metres[1]) : null,
    camera_kind: metres ? 'height_m' : null,
    imagery_mode: null,
    title: null,
    imagery_date: null,
    ...extra,
  };
}

/**
 * A panel, loaded the way the worker loads it: five classic scripts sharing one
 * window, then the overlay itself.
 *
 * `location` is handed in rather than navigated to, because the whole engine
 * turns on an address bar that the site rewrites under it — which is a string
 * changing, and never a page load.
 */
function open({ recording, size, ratio = 1, parse, storage = {}, firefox = false } = {}) {
  const win = size ?? recording?.window ?? { w: 1600, h: 1000 };
  window.happyDOM.setViewport({ width: win.w, height: win.h });
  window.devicePixelRatio = ratio;

  const location = { href: 'https://example.invalid/', host: 'example.invalid' };
  const sent = [];
  const saved = { ...storage };
  const api = {
    storage: {
      local: {
        get: vi.fn(async (defaults) => ({ ...defaults, ...saved })),
        set: vi.fn(async (patch) => Object.assign(saved, patch)),
      },
    },
    runtime: {
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn(async (message) => {
        sent.push(message);
        if (message.type !== 'map-api') return { ok: true, data: {} };
        if (message.path === '/api/ingest/parse') {
          return { ok: true, data: parse(message.query) };
        }
        if (message.path === '/api/ingest/ping') return { ok: true, data: { units: 'metric' } };
        if (message.path === '/api/ingest/cases') {
          return { ok: true, data: [{ id: 'case-1', name: 'Case' }] };
        }
        return { ok: true, data: [] };
      }),
    },
  };

  for (const part of PARTS) new Function('window', read(part))(window);
  new Function('window', 'document', 'location', 'chrome', 'browser', read('mapoverlay.js'))(
    window,
    document,
    location,
    firefox ? undefined : api,
    firefox ? api : undefined
  );
  const panel = window.__AZIMUT_MAP_TOOLS__;
  return {
    ...panel,
    location,
    api,
    saved,
    /** What the app was asked, in order. */
    asks: (path) => sent.filter((m) => m.path === path).map((m) => m.query),
    /** The status line the analyst reads, stripped of its markup. */
    status: () =>
      panel.state.collapsed
        ? ''
        : document
            .getElementById('azimut-map-tools')
            .shadowRoot.querySelector('.status span').textContent,
    canvas: () => document.getElementById('azimut-map-tools').shadowRoot.querySelector('canvas'),
    /** The offset the panel settled on, where the analyst can read it. */
    statusTitle: () =>
      document
        .getElementById('azimut-map-tools')
        .shadowRoot.querySelector('.status span')
        .getAttribute('title') ?? '',
    /** Pick a tool up, the way the analyst does — nothing is drawn until one
     *  is open, so nothing about the drawing can be asserted until one is. */
    pick: (id) =>
      document
        .getElementById('azimut-map-tools')
        .shadowRoot.querySelector(`[data-tab="${id}"]`)
        .click(),
  };
}

/** Let the panel's own clock run: the URL poll, the settle wait, and every
 *  promise they are waiting on. */
const tick = (ms = POLL_MS + SETTLE_MS + FRAME_QUIET_MS) => vi.advanceTimersByTimeAsync(ms);

const at = (type, x, y, init = {}) =>
  window.dispatchEvent(
    new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0, ...init })
  );

/** One wheel notch over a pixel, which every one of these maps zooms about.
 *  happy-dom's `WheelEvent` drops the pointer position out of its init, and the
 *  pixel the notch was over is the whole measurement — so it is put back. */
const wheel = (x, y, init = { deltaY: -120 }) => {
  const event = new window.WheelEvent('wheel', { bubbles: true, ...init });
  Object.defineProperty(event, 'clientX', { value: x });
  Object.defineProperty(event, 'clientY', { value: y });
  return window.dispatchEvent(event);
};

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

/**
 * Walk a recording: each zoom is the address bar before it, a notch over the
 * pixel the browser was driven at, and the address bar after.
 *
 * This is the panel's whole loop — poll, parse, anchor, solve — with nothing
 * standing in for it but the app's answer.
 */
async function replay(recording, options = {}) {
  // the height the recording's own views were read at, which is the map's and
  // not the window's wherever the site keeps a header
  const drawnIn = recording.map_height ?? recording.window.h;
  const step = (index) => recording.steps[index];
  panel = open({
    recording,
    parse: (query) => {
      const found = recording.steps.find((s) => s.url === query.url);
      // the panel opens on a page that is not a map, as it does in life
      return found ? parseOf(found, Number(query.height), drawnIn, options.extra) : null;
    },
    ...options,
  });
  panel.location.href = step(0).url;
  await tick();
  for (const zoom of recording.zooms) {
    panel.location.href = step(zoom.from).url;
    await tick();
    wheel(zoom.at.x, zoom.at.y);
    panel.location.href = step(zoom.to).url;
    await tick();
  }
  return panel;
}

const offset = (recording) => ({
  x: recording.centre.x - recording.window.w / 2,
  y: recording.centre.y - recording.window.h / 2,
});

const withZooms = fixture.recordings.filter((r) => r.zooms.length >= 1);

// --- what the engine is for ----------------------------------------------------

describe('measuring where a site draws its centre', () => {
  it.each(withZooms.map((r) => [r.label, r]))(
    'lands on the pixel the browser drew it at, on %s',
    async (_label, recording) => {
      const live = await replay(recording);
      const want = offset(recording);
      expect(live.state.framed).toBe(true);
      expect(Math.abs(live.state.frame.x - want.x)).toBeLessThan(1.5);
      expect(Math.abs(live.state.frame.y - want.y)).toBeLessThan(1.5);
    }
  );

  it('says so until it knows, and stops saying so once it does', async () => {
    const recording = fixture.recordings.find((r) => r.site === 'yandex-maps');
    const live = await replay(recording);
    expect(live.status()).not.toContain('zoom once to place it');
    expect(live.state.frame.x).toBeGreaterThan(200);
  });

  it('remembers it for the next visit, so the first mark is placed', async () => {
    const recording = fixture.recordings.find((r) => r.site === 'yandex-maps');
    const live = await replay(recording);
    const [key] = Object.keys(live.saved);
    const [kept] = live.saved[key].frames;
    expect(kept.x).toBeCloseTo(live.state.frame.x, 6);
    // filed under the window it was measured in, which is what makes it an
    // answer rather than a number
    expect(kept.w).toBe(recording.window.w);
    expect(kept.h).toBe(recording.window.h);
  });
});

/**
 * A zoom is one gesture and, on these sites, two or three readings: the level is
 * written as soon as the wheel turns and the centre catches up when the camera
 * stops moving. Solved from the first of them, the site's centre comes out
 * wherever the camera happened to be passing.
 *
 * Nothing downstream catches it. The reading that corrects the centre carries
 * the same level, so it reads as a pan — and a pan cannot see the frame, which
 * slides with the map and cancels. So the wrong offset used to be adopted whole,
 * saved for the next visit, and drawn from with no dimming and nothing said.
 */
describe('a zoom the address bar is still writing', () => {
  const yandex = () => fixture.recordings.find((r) => r.site === 'yandex-maps');

  /** Long enough for the panel to read the address bar again, and short enough
   *  that the reading lands inside the same easing zoom rather than after it. */
  const DURING = POLL_MS;

  /**
   * The recording's own zoom, published in instalments.
   *
   * `between` is the centre the address bar carries on the way — the recording's
   * own coordinates in every case, so nothing here invents a position. The level
   * is the one the zoom lands on, because that is the half the site writes first.
   */
  async function easedZoom(between) {
    const recording = yandex();
    const drawnIn = recording.map_height ?? recording.window.h;
    const [gesture] = recording.zooms;
    const from = recording.steps[gesture.from];
    const to = recording.steps[gesture.to];
    const midway = {
      site: to.site,
      scale_source: to.scale_source,
      url: `${to.url}&mid`,
      view: { ...to.view, ...between(from.view, to.view) },
    };
    const table = [from, to, midway];
    panel = open({
      recording,
      parse: (query) => {
        const found = table.find((s) => s.url === query.url);
        return found ? parseOf(found, Number(query.height), drawnIn) : null;
      },
    });
    panel.location.href = from.url;
    await tick();
    wheel(gesture.at.x, gesture.at.y);
    panel.location.href = midway.url;
    await tick(DURING);
    panel.location.href = to.url;
    await tick();
    return panel;
  }

  const want = () => offset(yandex());

  it('takes the offset from the reading the address bar stopped on', async () => {
    // the level arrives first and the centre has not moved at all yet
    const live = await easedZoom((from) => ({ lat: from.lat, lon: from.lon }));
    expect(live.state.framed).toBe(true);
    expect(Math.abs(live.state.frame.x - want().x)).toBeLessThan(1.5);
    expect(Math.abs(live.state.frame.y - want().y)).toBeLessThan(1.5);
  });

  it('and from the last one, not the first, half way through the ease', async () => {
    const live = await easedZoom((from, to) => ({
      lat: (from.lat + to.lat) / 2,
      lon: (from.lon + to.lon) / 2,
    }));
    expect(Math.abs(live.state.frame.x - want().x)).toBeLessThan(1.5);
    expect(Math.abs(live.state.frame.y - want().y)).toBeLessThan(1.5);
  });

  it('never remembers one it has not finished solving', async () => {
    const live = await easedZoom((from) => ({ lat: from.lat, lon: from.lon }));
    const [key] = Object.keys(live.saved);
    for (const kept of live.saved[key].frames) {
      expect(Math.abs(kept.x - want().x)).toBeLessThan(1.5);
    }
  });
});

describe('a gesture the address bar has not caught up with', () => {
  /**
   * A pan moves the map by exactly the pixels the pointer travelled, so the
   * canvas is moved by those pixels rather than redrawn. Nothing is projected
   * again while the map is under a finger, which is what stops a drawing from
   * sliding against the ground it was placed on — on any screen, at any size,
   * because a translation in CSS pixels is the one thing every browser agrees
   * about.
   */
  const pan = async (from, to) => {
    at('pointerdown', from.x, from.y);
    at('pointermove', to.x, to.y);
  };

  it('moves the drawing by the pixels the pointer moved', async () => {
    const recording = fixture.recordings.find((r) => r.site === 'google-maps');
    const live = await replay(recording);
    await pan({ x: 800, y: 500 }, { x: 700, y: 620 });
    expect(live.canvas().style.transform).toBe('translate(-100px, 120px) scale(1)');
  });

  it('hands it back to the map the moment the address bar says where it landed', async () => {
    const recording = fixture.recordings.find((r) => r.site === 'google-maps');
    const live = await replay(recording);
    await pan({ x: 800, y: 500 }, { x: 700, y: 620 });
    at('pointerup', 700, 620);
    // dimmed while the map glides on and says nothing about it
    expect(live.canvas().style.opacity).toBe('0.25');
    live.location.href = recording.steps[recording.pan.to].url;
    await tick();
    expect(live.canvas().style.transform).toBe('');
    expect(live.canvas().style.opacity).toBe('');
  });
});

// --- the window, and how much of it the map is --------------------------------

describe('how tall the map is, which is not how tall the window is', () => {
  /**
   * Two of these views state their scale as a *size* rather than as a level —
   * Apple's span in degrees, Google satellite's viewport height in metres — and
   * a size is only a scale next to the number of pixels it was drawn in. Hand
   * the app the window's height where the site drew the map in less of it and
   * every distance comes back out by the ratio: Bing's header is 81 px of a
   * 1000 px window, which is eight percent.
   *
   * Nothing is looked up to avoid that. The same measurement that says where
   * the centre is says how much of the window the map got: a map centred in
   * what its chrome leaves is centred by exactly half of what the chrome took.
   */
  it('asks the app for the map’s height once it has measured a header', async () => {
    const recording = fixture.recordings.find((r) => r.site === 'bing-maps');
    const live = await replay(recording);
    const header = 2 * Math.abs(live.state.frame.y);
    expect(header).toBeGreaterThan(75); // Bing's own, measured: 81 px
    const heights = live.asks('/api/ingest/parse').map((q) => q.height);
    expect(heights[0]).toBe(recording.window.h); // nothing measured yet
    // a pixel count, in whole pixels, which is how the site drew it
    expect(heights.at(-1)).toBe(Math.round(recording.window.h - header));
  });

  it('leaves the window’s own height alone on a site that fills it', async () => {
    const recording = fixture.recordings.find((r) => r.label === 'google-maps satellite');
    const live = await replay(recording);
    const heights = new Set(live.asks('/api/ingest/parse').map((q) => q.height));
    expect([...heights]).toEqual([recording.window.h]);
  });

  it('reads the scale again when the window changes height', async () => {
    // A shorter window is fewer pixels for the same metres, which is a lower
    // zoom — and the URL never said so, because the URL did not change. Left
    // unread, the drawing would go on at the scale of a window that is gone.
    const recording = fixture.recordings.find((r) => r.label === 'google-maps satellite');
    const live = await replay(recording);
    const before = live.state.view.zoom;
    window.happyDOM.setViewport({ width: recording.window.w, height: 760 });
    window.dispatchEvent(new window.Event('resize'));
    await tick();
    expect(live.asks('/api/ingest/parse').at(-1).height).toBe(760);
    expect(live.state.view.zoom).toBeCloseTo(before + Math.log2(760 / recording.window.h), 6);
  });

  it('stops standing behind an offset measured in a window that is gone', async () => {
    const recording = fixture.recordings.find((r) => r.site === 'yandex-maps');
    const live = await replay(recording);
    const measured = { ...live.state.frame };
    window.happyDOM.setViewport({ width: 1100, height: 800 });
    window.dispatchEvent(new window.Event('resize'));
    await tick();
    // kept, because it is still the best answer there is — and no longer
    // claimed, because a panel sized in percentages would have moved
    expect(live.state.frame).toEqual(measured);
    expect(live.state.framed).toBe(false);
    expect(live.status()).toContain('zoom once to place it');
  });

  it('drops a remembered offset that cannot fit the window it opened in', async () => {
    const recording = fixture.recordings.find((r) => r.site === 'yandex-maps');
    const store = {
      'mapTools:example.invalid': { frames: [{ x: 210, y: 10, w: 380, h: 700 }], panel: null },
    };
    // the same 420 px panel, in a window narrower than the offset it implies
    panel = open({
      recording,
      size: { w: 380, h: 700 },
      storage: store,
      parse: (query) =>
        parseOf(recording.steps[0], Number(query.height), recording.window.h),
    });
    panel.location.href = recording.steps[0].url;
    await tick();
    expect(panel.state.framed).toBe(false);
    expect(panel.state.frame).toEqual({ x: 0, y: 0 });
  });
});

/**
 * A pan is followed exactly while the pointer is down, because the map goes
 * where the pointer goes. What the panel cannot follow is a pan the site never
 * reports: the map has moved and the address bar still describes where it was,
 * so the canvas goes on carrying the difference with nothing to hand it back to.
 */
describe('a pan the address bar never reports', () => {
  const pan = (from, to) => {
    at('pointerdown', from.x, from.y);
    at('pointermove', to.x, to.y);
    at('pointerup', to.x, to.y);
  };

  /**
   * A zoom taken in that state measures nothing, and must not pretend to.
   *
   * The pixel the wheel turns about is on the screen; the view it would be
   * solved against is the one from before the pan. Read together they put the
   * site's centre out by the whole pan — and that answer would be adopted,
   * saved, and carried into every drawing afterwards.
   */
  it('leaves the offset alone rather than solving a zoom across it', async () => {
    const recording = fixture.recordings.find((r) => r.site === 'yandex-maps');
    const live = await replay(recording);
    const measured = { ...live.state.frame };
    pan({ x: 800, y: 500 }, { x: 700, y: 620 });
    await tick(3000); // past the give-up: the site is never going to say
    wheel(1248, 720);
    live.location.href = recording.steps[recording.zooms[0].from].url;
    await tick();
    expect(live.state.frame).toEqual(measured);
  });
});

// --- how sure the drawing looks -----------------------------------------------

/**
 * Only one thing dims the drawing, and not being placed yet is not it.
 *
 * It was, briefly. A wheel notch is a third of a level on some of these sites,
 * so the wait for the zoom that measures the offset can be several gestures
 * long — and a drawing that stays translucent through all of them reads as a
 * broken tool rather than a careful one. The doubt is said in words instead.
 */
describe('what the drawing dims for', () => {
  const unplaced = async () => {
    const recording = fixture.recordings.find((r) => r.site === 'yandex-maps');
    const drawnIn = recording.map_height ?? recording.window.h;
    panel = open({
      recording,
      parse: (query) => parseOf(recording.steps[0], Number(query.height), drawnIn),
    });
    panel.location.href = recording.steps[0].url;
    await tick();
    panel.pick('measure');
    return panel;
  };

  it('draws at full strength before a zoom has placed it', async () => {
    const live = await unplaced();
    expect(live.state.framed).toBe(false);
    expect(live.canvas().style.opacity).toBe('');
  });

  it('says so in the status line instead', async () => {
    const live = await unplaced();
    expect(live.status()).toContain('zoom once to place it');
    expect(live.statusTitle()).toBe('');
  });

  it('and puts the offset it settled on in that line’s tooltip', async () => {
    const live = await replay(fixture.recordings.find((r) => r.site === 'yandex-maps'));
    expect(live.status()).not.toContain('zoom once to place it');
    // the number to read out when a drawing lands where the ground is not
    expect(live.statusTitle()).toMatch(/centre at 210, 10 from the middle of a 1600×1000 window/);
  });

  it('and stays at full strength once it is placed', async () => {
    const live = await replay(fixture.recordings.find((r) => r.site === 'yandex-maps'));
    live.pick('measure');
    expect(live.state.framed).toBe(true);
    expect(live.canvas().style.opacity).toBe('');
  });
});

// --- one site, more than one window -------------------------------------------

/**
 * These sites fold a results panel away below a width and open it again above
 * one, so the same site draws its centre in two or three places depending on how
 * wide the window is. Keeping only the last of them meant an offset measured in
 * a wide window was reused, silently and at full confidence, in a narrow one —
 * Yandex's panel is 420 px, which is a hundred metres of error at zoom 18.
 */
describe('an offset belongs to the window it was measured in', () => {
  const store = (live) => live.saved[Object.keys(live.saved)[0]];

  it('is not claimed as measured in a window of another shape', async () => {
    const recording = fixture.recordings.find((r) => r.site === 'yandex-maps');
    const live = await replay(recording);
    const kept = store(live);
    live.close();
    panel = null;
    document.documentElement.querySelectorAll('#azimut-map-tools').forEach((n) => n.remove());

    const drawnIn = recording.map_height ?? recording.window.h;
    panel = open({
      recording,
      size: { w: 1040, h: 900 },
      storage: { 'mapTools:example.invalid': kept },
      parse: (query) => parseOf(recording.steps[0], Number(query.height), drawnIn),
    });
    panel.location.href = recording.steps[0].url;
    await tick();
    // kept, because it is still the best guess there is — and not claimed
    expect(panel.state.frame.x).toBeCloseTo(kept.frames[0].x, 6);
    expect(panel.state.framed).toBe(false);
    expect(panel.status()).toContain('zoom once to place it');
  });

  it('is picked up again when the window comes back to that shape', async () => {
    const recording = fixture.recordings.find((r) => r.site === 'yandex-maps');
    const live = await replay(recording);
    const measured = { ...live.state.frame };
    window.happyDOM.setViewport({ width: 1040, height: 900 });
    window.dispatchEvent(new window.Event('resize'));
    await tick();
    expect(live.state.framed).toBe(false);
    window.happyDOM.setViewport({ width: recording.window.w, height: recording.window.h });
    window.dispatchEvent(new window.Event('resize'));
    await tick();
    // no second zoom asked for: this window has been measured before
    expect(live.state.framed).toBe(true);
    expect(live.state.frame).toEqual(measured);
  });
});

// --- the same map on another machine ------------------------------------------

describe('what a pixel is, and what it is not', () => {
  /**
   * Every number the geometry touches is a CSS pixel: the window's own size,
   * the pointer's position, the offset a site's chrome imposes. A device's
   * pixel ratio changes none of them — it changes how many dots the canvas is
   * rasterised into, and that is the drawing layer's business alone.
   *
   * Which is also what makes the browser's own zoom free: at 125% the layout
   * viewport is simply smaller in CSS pixels, so it is a resize, and the panel
   * already knows what to do with one.
   */
  it('measures the same site the same way on a screen with three dots to the pixel', async () => {
    const recording = fixture.recordings.find((r) => r.site === 'yandex-maps');
    const plain = await replay(recording);
    const flat = { ...plain.state.frame };
    plain.close();
    panel = null;
    const dense = await replay(recording, { ratio: 3 });
    expect(dense.state.frame.x).toBeCloseTo(flat.x, 9);
    expect(dense.state.frame.y).toBeCloseTo(flat.y, 9);
    expect(dense.asks('/api/ingest/parse').at(-1).height).toBe(
      plain.asks('/api/ingest/parse').at(-1).height
    );
  });

  it('rasterises into the dots the screen has, and lays out in the pixels CSS has', async () => {
    const recording = fixture.recordings.find((r) => r.site === 'google-maps');
    const live = await replay(recording, { ratio: 3 });
    const canvas = live.canvas();
    expect(canvas.width).toBe(recording.window.w * 3);
    expect(canvas.style.width).toBe('100%');
  });

  it('keeps the ratio out of every file that decides where a mark lands', () => {
    // The guard for the version of this that would pass the tests above and
    // still be wrong: a ratio multiplied in somewhere along the geometry path
    // is invisible on a screen with one dot to the pixel, which is the screen
    // most of these tests run on.
    for (const file of ['mapmath.js', 'maptools.js']) {
      expect(read(file)).not.toMatch(/devicePixelRatio|screen\.(width|height)/);
    }
    // …and the one that reads it uses it for the backing store, never for a
    // coordinate: what it scales is the context, at the point of drawing.
    expect(read('mapdraw.js')).toMatch(/ctx\.setTransform\(ratio/);
  });

  it('reads a trackpad’s own idea of a notch, and leaves a sideways scroll alone', async () => {
    // A wheel on Windows steps ±120 and a trackpad on macOS sends whatever the
    // finger did, fractions included. Both are the same gesture to a map, and
    // both have to dim the drawing: what follows is a zoom nobody can predict.
    // A sideways scroll is not a zoom on any of them.
    const recording = fixture.recordings.find((r) => r.site === 'google-maps');
    const live = await replay(recording);
    wheel(1200, 300, { deltaY: -3.4, ctrlKey: true }); // a pinch on a trackpad
    expect(live.canvas().style.opacity).toBe('0.25');
    live.location.href = recording.steps[1].url; // the map reports where it landed
    await tick();
    expect(live.canvas().style.opacity).toBe('');
    wheel(1200, 300, { deltaY: 0, deltaX: -80 });
    expect(live.canvas().style.opacity).toBe('');
  });

  it('runs on a browser that calls the extension API by its other name', async () => {
    // Firefox hands a content script `browser`; Chrome hands it `chrome`. The
    // panel takes whichever is there, and the map tools are the one part of the
    // extension an analyst runs on someone else's page.
    const recording = fixture.recordings.find((r) => r.site === 'openstreetmap');
    const live = await replay(recording, { firefox: true });
    expect(live.state.framed).toBe(true);
    expect(Math.abs(live.state.frame.y - offset(recording).y)).toBeLessThan(1.5);
  });
});

// --- out where the map stops being flat ---------------------------------------

describe('zoomed out', () => {
  const far = { extra: { far: true } };

  it('keeps drawing, dimmed, and says the edges drift', async () => {
    const recording = fixture.recordings.find((r) => r.site === 'google-maps');
    const live = await replay(recording, far);
    expect(live.canvas().style.opacity).toBe('0.55');
    expect(live.status()).toContain('drifts at the edges');
  });

  it('never measures the site’s layout from out there', async () => {
    // A globe and a Mercator part company away from the point they are anchored
    // on, so a zoom taken out there would solve for a centre that is not this
    // site's — and then keep it, for every visit after.
    const recording = fixture.recordings.find((r) => r.site === 'yandex-maps');
    const live = await replay(recording, far);
    expect(live.state.framed).toBe(false);
    expect(live.state.frame).toEqual({ x: 0, y: 0 });
  });
});

// --- the compass ---------------------------------------------------------------

/**
 * A free camera that has been turned.
 *
 * Google Earth is the one view whose address bar states no scale at all, so its
 * drawing rests entirely on a pan this panel measured — and it is also the one
 * whose compass can be dragged. Turning it threw that measurement away and the
 * panel went back to asking for a pan it had already been given, on every nudge
 * of the compass. Which reads as a tool that does not work on Earth.
 *
 * The measurement is handed over rather than performed: what is under test here
 * is what a *turn* does to one, and `extensionMapMath.test.js` is where a turned
 * drag is measured.
 */
describe('a map that has been turned', () => {
  const HOME = { lat: 48.8584, lon: 2.2945 };
  const PX_PER_LON = 1000;
  const PX_PER_LAT = 1500;

  const url = ({ h = 0, lat = HOME.lat, lon = HOME.lon } = {}) =>
    `https://earth.google.com/web/@${lat},${lon},146a,666d,35y,${h}h,0t,0r`;

  /** Earth's own reading: a position, a heading, and no scale of any kind. */
  function earthParse(query) {
    const at = /@([\d.-]+),([\d.-]+),[^/]*?([\d.-]+)h/.exec(query.url);
    if (!at) return { site: null };
    return {
      site: 'google-earth',
      label: 'Google Earth',
      lat: Number(at[1]),
      lon: Number(at[2]),
      zoom: null,
      bearing: Number(at[3]),
      projection: null,
      view_kind: 'map',
      geometry: false,
      scale_source: null,
      far: false,
    };
  }

  /** Two drags on a map held at `bearing`, as the calibration would have read
   *  them: the world moves along its own axes, so the pointer's travel is turned
   *  into them to work out where the centre went. */
  function survey(live, bearing) {
    const from = { ...HOME, bearing, zoom: 15, projection: 'webmercator' };
    for (const [dx, dy] of [[200, 0], [0, -150]]) {
      const world = window.AzimutMapMath.unturn(dx, dy, from);
      const after = {
        ...from,
        lon: from.lon - world.dx / PX_PER_LON,
        lat: from.lat - world.dy / PX_PER_LAT,
      };
      live.state.calibration.observe(from, after, dx, dy);
    }
  }

  async function onEarth({ h = 0 } = {}) {
    const live = open({ parse: earthParse });
    live.location.href = url({ h });
    await tick();
    return live;
  }

  it('asks for a pan before it will draw, like any view with no scale in its URL', async () => {
    const live = await onEarth();
    panel = live;
    expect(live.status()).toContain('Drag the map across and down');
  });

  it('keeps the scale it measured when the compass moves', async () => {
    const live = await onEarth();
    panel = live;
    survey(live, 0);
    expect(live.state.calibration.scale.pxPerLon).toBeCloseTo(PX_PER_LON, 0);

    live.location.href = url({ h: 45 }); // the same view, turned
    await tick();

    expect(live.state.calibration.scale).not.toBe(null);
    expect(live.state.calibration.scale.pxPerLon).toBeCloseTo(PX_PER_LON, 0);
    expect(live.status()).toContain('measured off the map');
    expect(live.status()).not.toContain('Drag the map across and down');
  });

  it('draws through it on the turned view', async () => {
    const live = await onEarth({ h: 90 });
    panel = live;
    survey(live, 90);
    live.pick('measure');
    // A bearing is the direction the map has *up*, so with east up a point east
    // of the centre is straight above it — 0.01° at 1000 px per degree is ten
    // pixels, and none of them sideways.
    const east = { lat: HOME.lat, lon: HOME.lon + 0.01 };
    const at = window.AzimutMapMath.toScreenMeasured(
      east,
      { ...HOME, bearing: 90, projection: 'webmercator' },
      { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
      live.state.calibration.scale
    );
    expect(at.y).toBeCloseTo(window.innerHeight / 2 - 10, 6);
    expect(at.x).toBeCloseTo(window.innerWidth / 2, 6);
  });

  it('still throws it away when the turn came with a zoom', async () => {
    // Two things moved at once and only one of them is a rotation, so nothing
    // here can say what the other did to the scale. Asking for a pan is the
    // honest answer to that, and it is the answer this used to give to a turn.
    const live = await onEarth();
    panel = live;
    survey(live, 0);
    live.api.runtime.sendMessage.mockImplementation(async (message) => {
      if (message.type !== 'map-api') return { ok: true, data: {} };
      if (message.path === '/api/ingest/parse') {
        return { ok: true, data: { ...earthParse(message.query), zoom: 9 } };
      }
      if (message.path === '/api/ingest/ping') return { ok: true, data: { units: 'metric' } };
      return { ok: true, data: [] };
    });
    live.location.href = url({ h: 45 });
    await tick();
    expect(live.state.calibration.scale).toBe(null);
  });
});

// --- the panel's own width -----------------------------------------------------

/**
 * A name the case chose, in a panel 284 px wide.
 *
 * The reference rows carry whatever a video or an image is called, and a case
 * calls things what the source called them — which is sometimes a sentence. Long
 * enough, it used to size the panel's grid: the tab strip and the buttons were
 * pushed out past the panel's own width and whatever sat beyond it was clipped
 * away, so two tools became unreachable because of a file's name.
 *
 * The layout itself cannot be asserted here — happy-dom measures nothing — so
 * what is pinned is the two things that hold it: the rule that lets every box
 * shrink, and the name being readable somewhere other than the row it no longer
 * fits in.
 */
describe('a reference whose name does not fit', () => {
  const LONG = 'Long clip - 10. Mykhailivka railway bridge battles, 05 September, drone footage';
  const root = () => document.getElementById('azimut-map-tools').shadowRoot;

  it('keeps the name reachable, and lets every box round it shrink', async () => {
    const recording = fixture.recordings.find((r) => r.site === 'google-maps');
    const live = await replay(recording);
    live.tools.refs.add({ path: 'media/clip.mp4', kind: 'video', title: LONG });
    live.pick('refs');

    const row = root().querySelector('.ref-name');
    // the row shows what it can and the tooltip carries the rest, rather than
    // naming an action the analyst can see for themselves
    expect(row.getAttribute('title')).toBe(LONG);
    expect(row.querySelector('span').textContent).toBe(LONG);

    const css = root().querySelector('style').textContent;
    // the tab strip and the body column, each told it may go narrower than what
    // is in it — `1fr` alone will not
    const tabs = root().querySelectorAll('.tabs button').length;
    expect(css).toContain(`repeat(${tabs}, minmax(0, 1fr))`);
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
  });
});

/**
 * Sun & moon out where the map is a globe.
 *
 * It is the tool with the least to lose there: what it answers is which way the
 * light came from, and a bearing off the anchor is right in the middle of the
 * screen whatever the edges are doing. So it stays available — dimmed and
 * labelled, like everything else drawn out there, but never switched off.
 */
describe('the sky tool, zoomed out', () => {
  const root = () => document.getElementById('azimut-map-tools').shadowRoot;

  it('stays available on a globe, where only the distances are doubtful', async () => {
    const recording = fixture.recordings.find((r) => r.site === 'google-maps');
    const live = await replay(recording, { extra: { far: true } });
    live.pick('sky');
    const plant = root().querySelector('[data-act="sky-place"]');
    expect(plant.disabled).toBe(false);
    expect(live.status()).toContain('drifts at the edges');
    plant.click();
    expect(live.tools.sky.placing).toBe(true);
  });

  it('draws at full strength out there, unlike the tools that place marks', async () => {
    // Dimming says "this is somewhere the ground is not", which is true of a
    // mark and not of a bearing read at its own anchor. Said of the sun path, it
    // only had the analyst zooming in until the picture looked solid — for an
    // answer that was already right. The status line still says where this is.
    const recording = fixture.recordings.find((r) => r.site === 'google-maps');
    const live = await replay(recording, { extra: { far: true } });
    live.pick('sky');
    expect(live.canvas().style.opacity).toBe('');
    live.pick('measure');
    expect(live.canvas().style.opacity).toBe('0.55');
  });
});

/**
 * The first measurement on Google Earth, over ground that is not flat.
 *
 * Earth is the one view with no scale in its address bar, so a drag is the only
 * way to learn one — and the one view whose camera distance moves on its own,
 * because `d` is measured to the ground and the ground has hills in it. Pan over
 * one and `d` changes by more than the threshold that means "this zoomed".
 *
 * The panel then looked for a scale to carry through that zoom, had none — it
 * was trying to take its first — reset, and threw away the drag that had just
 * measured it. Every time. Which is a tool that asks for a pan it has already
 * been given, on the only site where a pan is the whole answer.
 */
describe('measuring a view whose camera moves with the ground', () => {
  const HOME = { lat: 48.8584, lon: 2.2945 };
  const PX_PER_LON = 1000;
  const PX_PER_LAT = 1500;

  const url = ({ lat = HOME.lat, lon = HOME.lon, d = 666 } = {}) =>
    `https://earth.google.com/web/@${lat},${lon},146a,${d}d,35y,0h,0t,0r`;

  /** Earth's reading: a position, a camera distance, and no scale of any kind. */
  function earthParse(query) {
    const at = /@([\d.-]+),([\d.-]+),[\d.-]+a,([\d.-]+)d/.exec(query.url);
    if (!at) return { site: null };
    return {
      site: 'google-earth',
      label: 'Google Earth',
      lat: Number(at[1]),
      lon: Number(at[2]),
      zoom: null,
      bearing: 0,
      projection: null,
      view_kind: 'map',
      geometry: false,
      scale_source: null,
      camera_m: Number(at[3]),
      camera_kind: 'camera_d',
      far: false,
    };
  }

  /**
   * A drag the panel will accept as a measurement: far enough on both axes, and
   * let go of after the map has stopped. The timestamps are set by hand because
   * that pause is the whole difference between a pan and a fling, and happy-dom
   * hands out no clock of its own.
   */
  function drag(from, to, pause = 200) {
    const send = (type, x, y, stamp) => {
      const event = new window.MouseEvent(type, {
        clientX: x,
        clientY: y,
        bubbles: true,
        button: 0,
      });
      Object.defineProperty(event, 'timeStamp', { value: stamp });
      window.dispatchEvent(event);
    };
    send('pointerdown', from.x, from.y, 0);
    send('pointermove', to.x, to.y, 10);
    send('pointerup', to.x, to.y, 10 + pause);
  }

  /** Where that drag leaves the centre, on a map drawn at the scale above. */
  const landed = (dx, dy, d) =>
    url({ lon: HOME.lon - dx / PX_PER_LON, lat: HOME.lat - dy / PX_PER_LAT, d });

  async function onEarth() {
    const live = open({ parse: earthParse });
    live.location.href = url();
    await tick();
    return live;
  }

  it('takes the measurement even when the pan moved the camera distance', async () => {
    const live = await onEarth();
    panel = live;
    expect(live.status()).toContain('Drag the map across and down');

    drag({ x: 800, y: 500 }, { x: 1000, y: 350 });
    // the drag crossed a hill: Earth re-writes `d` as well as the centre
    live.location.href = landed(200, -150, 720);
    await tick();

    expect(live.state.calibration.scale).not.toBe(null);
    expect(live.state.calibration.scale.pxPerLon).toBeCloseTo(PX_PER_LON, 0);
    expect(live.state.calibration.scale.pxPerLat).toBeCloseTo(PX_PER_LAT, 0);
    expect(live.status()).toContain('measured off the map');
  });

  it('still carries a scale it already had through a real change of distance', async () => {
    // The other half of the rule: once something is known, a camera that moved
    // out is a view drawn smaller, and the ratio of the two distances says by
    // how much — that is the reading, and the drag is not asked for again.
    const live = await onEarth();
    panel = live;
    drag({ x: 800, y: 500 }, { x: 1000, y: 350 });
    live.location.href = landed(200, -150, 666);
    await tick();
    const measured = live.state.calibration.scale.pxPerLon;

    live.location.href = url({ d: 1332 }); // twice as far out, nothing else moved
    await tick();
    expect(live.state.calibration.scale.pxPerLon).toBeCloseTo(measured / 2, 0);
    expect(live.status()).toContain('measured off the map');
  });

  it('says what makes a drag count, since a fling looks the same', async () => {
    const live = await onEarth();
    panel = live;
    drag({ x: 800, y: 500 }, { x: 1000, y: 350 }, 10); // let go mid-flight
    live.location.href = landed(200, -150, 666);
    await tick();
    expect(live.state.calibration.scale).toBe(null);
    expect(live.status()).toContain('pausing before you let go');
  });
});
