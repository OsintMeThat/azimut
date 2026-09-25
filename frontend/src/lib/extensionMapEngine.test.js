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
const PARTS = ['mapmath.js', 'maptheme.js', 'maptools.js', 'mapdraw.js', 'mapref.js', 'maplink.js'];

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
  const sized = ['span', 'height_m', 'distance'].includes(step.scale_source);
  return {
    site: step.site,
    label: step.site,
    lat: view.lat,
    lon: view.lon,
    zoom: sized && view.zoom != null ? view.zoom + Math.log2(height / drawnIn) : view.zoom,
    bearing: view.bearing,
    projection: view.projection,
    view_kind: 'map',
    geometry: true,
    far: false,
    globe_below: null,
    scale_source: step.scale_source,
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
function open({ recording, size, ratio = 1, parse, storage = {}, firefox = false, answers = {} } = {}) {
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
        // A picture route answers with bytes, which the worker hands over as a
        // data URL — one pixel of it is enough to place.
        if (message.type === 'map-image') {
          return { ok: true, src: 'data:image/png;base64,iVBORw0KGgo=' };
        }
        if (message.type !== 'map-api') return { ok: true, data: {} };
        // What the app answers a given route with, when a test cares — the
        // catalogue behind the fire layer is read on open, and whether a key is
        // saved is the whole of what it says.
        if (message.path in answers) return { ok: true, data: answers[message.path] };
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
        : window.__AZIMUT_MAP_TOOLS__.root.querySelector('.status span').textContent,
    canvas: () => window.__AZIMUT_MAP_TOOLS__.root.querySelector('canvas'),
    /** The offset the panel settled on, where the analyst can read it. */
    statusTitle: () =>
      window.__AZIMUT_MAP_TOOLS__.root.querySelector('.status span').getAttribute('title') ?? '',
    /** Pick a tool up, the way the analyst does — nothing is drawn until one
     *  is open, so nothing about the drawing can be asserted until one is. */
    pick: (id) =>
      window.__AZIMUT_MAP_TOOLS__.root.querySelector(`[data-tab="${id}"]`).click(),
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

  it('drops an offset saved before the scale stopped being measured off a drag', async () => {
    // Earth's offsets used to be solved through that scale, and one a few pixels
    // out was averaged into every zoom after it rather than replaced
    const recording = fixture.recordings.find((r) => r.site === 'google-earth');
    const stale = { ...recording.window, x: 14, y: -9 };
    const drawnIn = recording.map_height ?? recording.window.h;
    for (const [stored, framed] of [
      [{ frames: [stale] }, false],
      [{ frames: [stale], framesVersion: 2 }, true],
    ]) {
      panel?.close();
      panel = open({
        recording,
        storage: { 'mapTools:example.invalid': stored },
        parse: (query) => parseOf(recording.steps.at(-1), Number(query.height), drawnIn),
      });
      panel.location.href = recording.steps.at(-1).url;
      await tick();
      expect(panel.state.framed).toBe(framed);
      expect(panel.state.frame).toEqual(framed ? { x: 14, y: -9 } : { x: 0, y: 0 });
    }
  });
});

/**
 * What the drawing is placed with before anybody has gestured at anything.
 *
 * The middle of the window was never a neutral starting point: four of these
 * sites keep a results panel or a header and centre the map in what is left, so
 * an install that starts at the middle starts 210 px out on Yandex and stays
 * there until the analyst happens to zoom. Nothing on screen says so, and at
 * level 3 Bing's 40 px is 450 km of ground.
 *
 * So the app's table hands over what its own calibration run measured and the
 * panel starts there (`engine/mapsites.py`, `_CAMERA_CENTRE`). The numbers come
 * from the fixture rather than from a copy here, and `tests/test_mapsites.py`
 * is what holds them to the recording; what is asserted here is the other half
 * — that a fresh install draws from them, and that they lose to anything
 * measured on the machine in front of the analyst.
 */
describe('the offset a fresh install starts from', () => {
  const hints = fixture.hints ?? {};
  const hinted = fixture.recordings.filter((r) => hints[r.site]);

  /** The panel opened on a recording and then left alone: no wheel, no drag,
   *  which is every install's first minute on a map. */
  async function opened(recording, options = {}) {
    const drawnIn = recording.map_height ?? recording.window.h;
    const live = open({
      recording,
      parse: (query) => {
        const found = recording.steps.find((s) => s.url === query.url);
        return found
          ? parseOf(found, Number(query.height), drawnIn, { centre_hint: hints[recording.site] })
          : null;
      },
      ...options,
    });
    live.location.href = recording.steps[0].url;
    await tick();
    return live;
  }

  it('has an answer for every site whose chrome moves the camera', () => {
    // the drift gate's other end: a site the recording shows off-centre and the
    // table says nothing about is a site that starts wrong
    const unplaced = fixture.recordings
      .filter((r) => !hints[r.site] && Math.hypot(offset(r).x, offset(r).y) >= 4)
      .map((r) => r.site);
    // Apple is the one, and on purpose: its sidebar folds away below a width
    // its URL never states, so its offset is 67 px in a wide window and nothing
    // in a narrow one. That one is measured on the machine or not at all.
    expect([...new Set(unplaced)]).toEqual(['apple-maps']);
  });

  it.each(hinted.map((r) => [r.label, r]))('draws from it on %s, ungestured', async (_l, recording) => {
    panel = await opened(recording);
    expect(panel.state.frame.x).toBeCloseTo(hints[recording.site].x, 6);
    expect(panel.state.frame.y).toBeCloseTo(hints[recording.site].y, 6);
    // and it is a starting point, not an answer: the panel still asks for the
    // zoom that would settle it, and says where the number came from
    expect(panel.state.framed).toBe(false);
    expect(panel.status()).toContain('zoom once to place it');
    expect(panel.statusTitle()).toContain('from the site table');
  });

  it('is replaced by the first zoom that measures one', async () => {
    const recording = fixture.recordings.find((r) => r.site === 'yandex-maps');
    const live = await replay(recording, { extra: { centre_hint: { x: 40, y: 40 } } });
    panel = live;
    const want = offset(recording);
    expect(live.state.framed).toBe(true);
    expect(Math.abs(live.state.frame.x - want.x)).toBeLessThan(1.5);
    expect(live.statusTitle()).not.toContain('site table');
  });

  it('loses to an offset this machine measured for itself', async () => {
    // a table written somewhere else against a browser that is not this one,
    // versus a measurement taken in this window — the measurement wins
    const recording = fixture.recordings.find((r) => r.site === 'yandex-maps');
    const mine = { ...recording.window, x: 188, y: 3 };
    const drawnIn = recording.map_height ?? recording.window.h;
    panel = open({
      recording,
      storage: { 'mapTools:example.invalid': { frames: [mine], framesVersion: 2 } },
      parse: (query) =>
        parseOf(recording.steps[0], Number(query.height), drawnIn, {
          centre_hint: hints['yandex-maps'],
        }),
    });
    panel.location.href = recording.steps[0].url;
    await tick();
    expect(panel.state.frame).toEqual({ x: mine.x, y: mine.y });
    expect(panel.state.framed).toBe(true);
    expect(panel.statusTitle()).not.toContain('site table');
  });

  it('keeps the header and drops the panel in a window narrower than one measured', async () => {
    // A header takes height and is the same height in any window. A side panel
    // takes width, and a side panel is the thing that folds away — which is the
    // whole of Apple's 67 px becoming nothing at 1200. So the sideways half is
    // claimed only at or above a width the site was recorded in.
    const recording = fixture.recordings.find((r) => r.site === 'yandex-maps');
    panel = await opened(recording, { size: { w: 1100, h: 900 } });
    expect(panel.state.frame).toEqual({ x: 0, y: hints['yandex-maps'].y });
    expect(panel.state.framed).toBe(false);
  });

  it('drops the panel half when the window is dragged below a measured width', async () => {
    const recording = fixture.recordings.find((r) => r.site === 'yandex-maps');
    panel = await opened(recording, { size: { w: 1600, h: 1000 } });
    expect(panel.state.frame.x).toBeCloseTo(hints['yandex-maps'].x, 6);
    window.happyDOM.setViewport({ width: 1100, height: 1000 });
    window.dispatchEvent(new window.Event('resize'));
    await tick();
    expect(panel.state.frame).toEqual({ x: 0, y: hints['yandex-maps'].y });
  });

  it('is refused outright when it could not fit the window it opened in', async () => {
    // the same rule a remembered offset is held to: a header taller than half
    // the window is not a header, it is a layout that is gone
    const recording = fixture.recordings.find((r) => r.site === 'bing-maps');
    panel = await opened(recording, { size: { w: 1600, h: 70 } });
    expect(panel.state.frame).toEqual({ x: 0, y: 0 });
    expect(panel.statusTitle()).toBe('');
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
      'mapTools:example.invalid': {
        frames: [{ x: 210, y: 10, w: 380, h: 700 }],
        framesVersion: 2,
        panel: null,
      },
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

/**
 * The other globe, and not the one above.
 *
 * A flat map drawn far out still has a centre this arithmetic is right about,
 * and edges that drift away from it — so it draws, dimmed, and says so. A
 * perspective camera on a sphere has nothing Mercator is right about: Earth past
 * its ceiling, and Google's Earth mode with it. Dimming a drawing that is simply
 * wrong asks the analyst to judge how wrong it is, and nothing on screen tells
 * them — so out there the panel refuses and says what to do instead.
 */
describe('a globe camera, which is not a map', () => {
  const root = () => window.__AZIMUT_MAP_TOOLS__.root;
  const google = () => fixture.recordings.find((r) => r.site === 'google-maps');
  const keyed = {
    '/api/ingest/firms/sensors': { keyed: true, sensors: [{ id: 'viirs', label: 'VIIRS' }] },
  };
  const globe = { extra: { view_kind: 'globe', geometry: false, far: true }, answers: keyed };

  it('says what to do instead of drawing', async () => {
    panel = await replay(google(), globe);
    expect(panel.status()).toBe('The camera is on a globe this far out, so zoom in');
    expect(panel.canvas().style.opacity).toBe('');
  });

  it('puts no fire picture on the ground, and asks NASA for none', async () => {
    panel = await replay(google(), globe);
    panel.pick('fires');
    root().querySelector('[data-act="fires-toggle"]')?.click();
    await tick();
    expect(panel.asks('/api/ingest/firms')).toEqual([]);
    expect(root().querySelector('img').style.display).toBe('none');
  });

  it('picks the drawing back up as soon as the camera comes down', async () => {
    // which is the whole point of saying "zoom in" rather than "not a map"
    const recording = google();
    const drawnIn = recording.map_height ?? recording.window.h;
    let kind = 'globe';
    panel = open({
      recording,
      answers: keyed,
      parse: (query) => {
        const found = recording.steps.find((s) => s.url === query.url);
        return found
          ? parseOf(found, Number(query.height), drawnIn, {
              view_kind: kind,
              geometry: kind === 'map',
              far: kind === 'globe',
            })
          : null;
      },
    });
    panel.location.href = recording.steps[0].url;
    await tick();
    expect(panel.status()).toContain('zoom in');

    kind = 'map';
    panel.location.href = recording.steps[1].url;
    await tick();
    expect(panel.status()).not.toContain('zoom in');
    expect(panel.status()).toContain('google-maps');
  });
});

// --- Google Earth --------------------------------------------------------------

/**
 * Earth, which states its scale as a camera distance.
 *
 * The panel used to think Earth stated none, and measured one off a drag
 * instead. A drag loses pixels to Earth's threshold and gains them to its
 * glide; the first reading was taken on trust, every later one that disagreed
 * was thrown away as a fling, and each zoom carried the error along with it. On
 * a real case that drew the marks four times too close together until the tab
 * was closed. The app now reads the scale out of `d` and `y`
 * (`engine/mapsites.py`), and a gesture moves the drawing and teaches it
 * nothing.
 */
describe('Google Earth', () => {
  const HOME = { lat: 10.4806, lon: -66.9036 };
  const SETTLE_QUIET_MS = 400;

  const url = ({ lat = HOME.lat, lon = HOME.lon, a = '903.25', d = 1000, h = 0 } = {}) =>
    `https://earth.google.com/web/@${lat},${lon},${a}a,${d}d,35y,${h}h,0t,0r`;

  /**
   * The app's reading, in the shape `engine/mapsites.py` gives it: Web
   * Mercator, a zoom one level in for every halving of the distance and a
   * little further out in a shorter window — or no scale at all for a link
   * typed as `0a`, which Earth has not placed on the ground yet.
   */
  function earthParse(query) {
    const at = /@([\d.-]+),([\d.-]+),([\d.-]+)a,([\d.-]+)d,35y,([\d.-]+)h/.exec(query.url);
    if (!at) return { site: null };
    const placed = at[3] !== '0';
    return {
      site: 'google-earth',
      label: 'Google Earth',
      lat: Number(at[1]),
      lon: Number(at[2]),
      zoom: placed
        ? 15 + Math.log2(1000 / Number(at[4])) + Math.log2(Number(query.height) / 1000)
        : null,
      bearing: Number(at[5]),
      projection: 'webmercator',
      view_kind: 'map',
      geometry: true,
      far: false,
      globe_below: null,
      scale_source: placed ? 'distance' : null,
    };
  }

  async function onEarth(first = url()) {
    panel = open({ parse: earthParse });
    panel.location.href = first;
    await tick();
    return panel;
  }

  it('draws from the first address it reads, with no drag asked for', async () => {
    const live = await onEarth();
    expect(live.state.view.zoom).toBe(15);
    expect(live.status()).toContain('google-earth · z15.00 · webmercator (distance from the URL)');
  });

  it('waits on a typed link until Earth has put its camera on the ground', async () => {
    // `0a` is how a link is written, and over land 200 m up Earth draws it 7%
    // nearer than its `d` says; the first gesture writes the ground in
    const live = await onEarth(url({ a: '0' }));
    expect(live.status()).toBe('Move the map once so its address bar gives the scale');
    live.location.href = url({ d: 1000.25 });
    await tick();
    expect(live.status()).toContain('google-earth · z');
  });

  it('learns nothing from a drag, however far the map glided on after it', async () => {
    const live = await onEarth();
    const send = (type, x, y) =>
      window.dispatchEvent(new window.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 }));
    send('pointerdown', 800, 500);
    send('pointermove', 1000, 350);
    // the canvas goes where the pointer went while the finger is down…
    expect(live.canvas().style.transform).toBe('translate(200px, -150px) scale(1)');
    send('pointerup', 1000, 350);
    // …and Earth lands four drags further on, over a hill that moved `d`
    live.location.href = url({ lat: HOME.lat + 0.02, lon: HOME.lon - 0.04, a: '1210.5', d: 693.6 });
    await tick();
    expect(live.canvas().style.transform).toBe('');
    expect(live.state.view.zoom).toBeCloseTo(15 + Math.log2(1000 / 693.6), 9);
    expect(live.state).not.toHaveProperty('calibration');
  });

  it('keeps the drawing dimmed until Earth stops rewriting a zoom', async () => {
    // Earth writes its address several times during one zoom. Ending the wait on
    // the first of them drew the marks at a scale the map was passing through.
    const live = await onEarth();
    wheel(1200, 300);
    live.location.href = url({ d: 780 });
    await tick(SETTLE_MS + 50);
    live.location.href = url({ d: 500 });
    await tick(POLL_MS);
    expect(live.canvas().style.opacity).toBe('0.25');
    expect(live.state.view.zoom).toBeCloseTo(16, 9);
    await tick(SETTLE_QUIET_MS + 2 * POLL_MS);
    expect(live.canvas().style.opacity).toBe('');
    expect(live.state.view.zoom).toBeCloseTo(16, 9);
  });

  it('places its camera from a zoom, since a distance is exact at any fraction', async () => {
    // A fractional level is only a rounding on a site that writes levels. Earth
    // writes a distance to the hundredth of a millimetre, so a zoom of 1.4
    // levels about one pixel says where it draws its centre as well as a whole
    // one does. Synthesised here; `tests/fixtures/map-sites.json` carries Earth
    // driven in a browser, which the recordings suite replays.
    const FRAME = { x: 60, y: -20 };
    const live = await onEarth();
    const M = window.AzimutMapMath;
    const middle = { x: window.innerWidth / 2 + FRAME.x, y: window.innerHeight / 2 + FRAME.y };
    const at = { x: 1240, y: 290 };
    const z0 = 15;
    const d1 = 380;
    const z1 = 15 + Math.log2(1000 / d1);
    const c0 = M.project(HOME.lat, HOME.lon, z0);
    const held = M.unproject(c0.x + at.x - middle.x, c0.y + at.y - middle.y, z0);
    const p1 = M.project(held.lat, held.lon, z1);
    const after = M.unproject(p1.x - (at.x - middle.x), p1.y - (at.y - middle.y), z1);

    wheel(at.x, at.y);
    live.location.href = url({ lat: after.lat, lon: after.lon, d: d1 });
    await tick();
    await tick(FRAME_QUIET_MS);
    expect(live.state.framed).toBe(true);
    expect(live.state.frame.x).toBeCloseTo(FRAME.x, 1);
    expect(live.state.frame.y).toBeCloseTo(FRAME.y, 1);
    expect(live.status()).not.toContain('zoom once to place it');
  });

  it('keeps its scale when the compass turns', async () => {
    const live = await onEarth();
    live.location.href = url({ h: 45 });
    await tick();
    expect(live.state.view).toMatchObject({ zoom: 15, bearing: 45 });
    expect(live.status()).toContain('distance from the URL');
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
  const root = () => window.__AZIMUT_MAP_TOOLS__.root;

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
  const root = () => window.__AZIMUT_MAP_TOOLS__.root;

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
 * The fire layer's seat, with and without the key behind it.
 *
 * The app greys its Active fires row when no FIRMS key is saved and says why on
 * the row itself. The panel owes the same answer: a seat that opens on a
 * paragraph about a missing key is a click spent learning there was nothing to
 * click.
 */
describe('the fire layer in the panel', () => {
  const root = () => window.__AZIMUT_MAP_TOOLS__.root;
  const seat = () => root().querySelector('[data-tab="fires"]');
  const google = () => fixture.recordings.find((r) => r.site === 'google-maps');

  it('is greyed until a key is saved, and carries the reason', async () => {
    await replay(google(), { answers: { '/api/ingest/firms/sensors': { keyed: false, sensors: [] } } });
    expect(seat().disabled).toBe(true);
    expect(seat().getAttribute('title')).toContain('FIRMS key');
  });

  const keyed = {
    '/api/ingest/firms/sensors': {
      keyed: true,
      sensors: [{ id: 'viirs', label: 'VIIRS (S-NPP + NOAA-20)' }],
    },
  };

  it('asks for nothing past the zoom where one mark stops meaning one detection', async () => {
    // the recording ends at z17, which is deeper than the app's own map asks
    // FIRMS at — it caps its tile source at z14 and scales what it has
    const live = await replay(google(), { answers: keyed });
    live.pick('fires');
    root().querySelector('[data-act="fires-toggle"]').click();
    await tick();
    expect(live.asks('/api/ingest/firms')).toEqual([]);
    expect(root().textContent).toContain('Zoom out to z14');
  });

  it('asks once the view is one it can answer for', async () => {
    const live = await replay(google(), { answers: keyed, extra: { zoom: 10 } });
    live.pick('fires');
    root().querySelector('[data-act="fires-toggle"]').click();
    await tick();
    const asked = live.asks('/api/ingest/firms');
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ sensor: 'viirs', window: '24h' });
    expect(asked[0].north).toBeGreaterThan(asked[0].south);
  });

  /**
   * Where the picture lands, zoomed out and away from the equator.
   *
   * FIRMS answers with one picture of a rectangle of ground, and that rectangle
   * is drawn in Web Mercator — where the coordinate halfway between two
   * latitudes is *not* the pixel halfway between them. Centred on the mean
   * latitude, the picture rode low: nothing over a town, a tenth of the window
   * over a continent, which is exactly the complaint about a zoomed-out map.
   */
  it('lands on its own ground, where Mercator stretches the north', async () => {
    const live = await replay(google(), {
      answers: keyed,
      extra: { zoom: 4, lat: 55, lon: 10 },
    });
    live.pick('fires');
    root().querySelector('[data-act="fires-toggle"]').click();
    await tick();

    const asked = live.asks('/api/ingest/firms')[0];
    const M = window.AzimutMapMath;
    const view = live.state.view;
    const area = { ...live.state.frame, w: window.innerWidth, h: window.innerHeight };
    const nw = M.toScreen({ lat: asked.north, lon: asked.west }, view, area);
    const se = M.toScreen({ lat: asked.south, lon: asked.east }, view, area);

    const img = window.__AZIMUT_MAP_TOOLS__.root.querySelector('img');
    const px = (name) => Number.parseFloat(img.style[name]);
    // the box is centred and pulled back by half itself, so its north edge is
    // the top of the ground it was drawn for
    expect(px('top') - px('height') / 2).toBeCloseTo(nw.y, 1);
    expect(px('left') - px('width') / 2).toBeCloseTo(nw.x, 1);
    expect(px('top') + px('height') / 2).toBeCloseTo(se.y, 1);

    // …and the placement it replaced is wrong by enough to see: the mean of the
    // two latitudes is a different pixel from the middle of the two corners
    const mean = M.toScreen({ lat: (asked.north + asked.south) / 2, lon: (asked.west + asked.east) / 2 }, view, area);
    expect(Math.abs(mean.y - (nw.y + se.y) / 2)).toBeGreaterThan(5);
  });

  it('dims out where the site draws a globe, as the drawing beside it does', async () => {
    const live = await replay(google(), {
      answers: keyed,
      extra: { zoom: 4, lat: 55, lon: 10, far: true },
    });
    live.pick('fires');
    root().querySelector('[data-act="fires-toggle"]').click();
    await tick();
    const img = root().querySelector('img');
    // a flat rectangle of ground laid over a curve, covering the whole window:
    // the picture drifts further out there than any mark does
    expect(img.parentElement.style.opacity).toBe('0.55');
    expect(live.canvas().style.opacity).toBe('0.55');
  });

  it('asks a date with a calendar drawn in the panel, never over it', async () => {
    const live = await replay(google(), {
      answers: {
        '/api/ingest/firms/sensors': {
          keyed: true,
          sensors: [{ id: 'viirs', label: 'VIIRS (S-NPP + NOAA-20)' }],
        },
      },
    });
    live.pick('fires');
    root().querySelector('[data-act="fires-toggle"]').click();
    root().querySelector('[data-window="dates"]').click();

    // the browser's own picker is what this replaced: it opened over the page,
    // at the browser's size, in the browser's locale
    expect(root().querySelector('input[type="date"]')).toBe(null);
    expect(root().querySelector('.cal')).toBe(null);

    root().querySelector('[data-act="cal-open"][data-field="first"]').click();
    expect(root().querySelector('.cal')).not.toBe(null);
    root().querySelector('[data-act="cal-step"][data-by="-1"]').click();

    const day = [...root().querySelectorAll('.cal-day')].find(
      (b) => !b.disabled && !b.classList.contains('out')
    );
    const picked = day.dataset.day;
    day.click();
    expect(live.tools.fires.state.first).toBe(picked);
    expect(root().querySelector('.cal')).toBe(null); // picked, so it is done
    expect(root().querySelector('[data-act="cal-open"][data-field="first"]').textContent).toContain(
      picked
    );
  });

  it('opens once one is, and none of the other seats was greyed with it', async () => {
    const live = await replay(google(), {
      answers: {
        '/api/ingest/firms/sensors': {
          keyed: true,
          sensors: [{ id: 'viirs', label: 'VIIRS (S-NPP + NOAA-20)' }],
        },
      },
    });
    expect(seat().disabled).toBe(false);
    expect([...root().querySelectorAll('.tabs button')].filter((b) => b.disabled)).toEqual([]);
    live.pick('fires');
    expect(live.state.tool).toBe('fires');
  });
});

// --- the page the panel is drawn over ----------------------------------------

/**
 * The panel lives in someone else's page, and that page's scripts share the DOM.
 * Neither what it shows (case names, points, pictures) nor its buttons may be
 * reachable from them.
 */
describe('the site under the panel', () => {
  const untrusted = (type) => {
    const event = new window.MouseEvent(type, { bubbles: true, composed: true });
    Object.defineProperty(event, 'isTrusted', { value: false });
    return event;
  };

  it('reads no shadow root off the panel', async () => {
    panel = open({ parse: () => null });
    await tick();

    expect(document.getElementById('azimut-map-tools').shadowRoot).toBeNull();
    expect(window.__AZIMUT_MAP_TOOLS__.root.querySelector('[data-tab="measure"]')).not.toBeNull();
  });

  it('cannot press a button for the analyst', async () => {
    panel = open({ parse: () => null });
    await tick();
    const tab = window.__AZIMUT_MAP_TOOLS__.root.querySelector('[data-tab="pins"]');

    tab.dispatchEvent(untrusted('click'));
    await tick();
    expect(panel.state.tool).not.toBe('pins');

    tab.click();
    await tick();
    expect(panel.state.tool).toBe('pins');
  });

  it('cannot click the map through the panel either', async () => {
    panel = open({ parse: () => null });
    await tick();
    const asked = panel.api.runtime.sendMessage.mock.calls.length;

    for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick']) {
      window.dispatchEvent(untrusted(type));
    }
    await tick();

    expect(panel.api.runtime.sendMessage.mock.calls.length).toBe(asked);
  });
});
