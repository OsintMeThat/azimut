// @vitest-environment happy-dom
/**
 * The scenes to geolocate, in the map panel over another site's map
 * (extension/mapoverlay.js, `GET /api/ingest/scenes`, `POST /api/ingest/geolocating`).
 *
 * The app's To-do lists the same scenes. Here the analyst picks one to look for over
 * Google Maps or Earth: the app is told which, so it attaches every capture filed
 * meanwhile to it, and the scene's video is held over the map with the scene marked
 * on its bar. What is asserted is what the panel asks the app, and what it shows.
 */
import { describe, expect, it, vi, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, `../../../extension/${name}`), 'utf8');
const PARTS = ['mapmath.js', 'maptheme.js', 'maptools.js', 'mapdraw.js', 'mapref.js', 'maplink.js'];

const CASE = 'case-1';
const OTHER = 'case-2';
const VIDEO = 'media/market.mp4';
const row = (id, start, end, label = '', extra = {}) => ({
  kind: 'draft', video: VIDEO, id, start, end, label, state: 'todo', captures: [], abandoned: null, ...extra,
});
const BRIDGE = row('sc_2', 238, 252, 'bridge?', { state: 'progress', captures: ['media/c1.png', 'media/c2.png'], footage: 5 });

/** What a row of the list says: its name, its time, its two counts, and those in words. */
function said(el) {
  const meta = el.querySelector('.geo-meta');
  const counts = meta.querySelector('.geo-counts');
  const [map, video] = [...counts.querySelectorAll('.geo-n')];
  return [
    el.querySelector('.geo-name').textContent,
    [...meta.children].filter((part) => part !== counts).map((part) => part.textContent).join(''),
    map.textContent, video.textContent, counts.getAttribute('title'),
  ];
}
const QUEUE = {
  files: [
    {
      video: VIDEO,
      title: 'Market walk',
      scenes: [row('sc_1', null, null), BRIDGE, row('sc_3', 300, null, 'Old', { state: 'abandoned', abandoned: { reason: '', at: 'x' } })],
    },
  ],
  geolocating: null,
};

beforeAll(() => {
  globalThis.Path2D = class {};
  window.HTMLCanvasElement.prototype.getContext = () =>
    new Proxy({ measureText: () => ({ width: 20 }) }, { get: (target, name) => target[name] ?? (() => {}) });
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:azimut/1');
  globalThis.URL.revokeObjectURL = vi.fn();
  // a thumbnail is decoded and painted, never linked
  globalThis.createImageBitmap = vi.fn(async () => ({ width: 160, height: 90, close: () => {} }));
});

let panel = null;

afterEach(() => {
  panel?.close();
  panel = null;
  document.documentElement.querySelectorAll('#azimut-map-tools').forEach((node) => node.remove());
});

/** A panel over OpenStreetMap, with the app answering `answers` (a value, or a
 *  function of the message for a route whose answer depends on what was sent). */
function open(answers = {}, { images = () => ({ ok: true, src: 'data:image/png;base64,AAAA' }) } = {}) {
  window.happyDOM.setViewport({ width: 1400, height: 900 });
  const location = {
    href: 'https://www.openstreetmap.org/#map=17/50.45/30.52',
    host: 'www.openstreetmap.org',
    assign: vi.fn(),
  };
  const app = {
    '/api/ingest/ping': { units: 'metric' },
    '/api/ingest/cases': [{ id: CASE, name: 'Case one' }, { id: OTHER, name: 'Case two' }],
    '/api/ingest/parse': {
      site: 'openstreetmap', label: 'OpenStreetMap', lat: 50.45, lon: 30.52, zoom: 17, bearing: 0,
      projection: 'webmercator', view_kind: 'map', geometry: true, scale_source: 'zoom',
    },
    '/api/ingest/saved': [],
    '/api/ingest/grids': [],
    '/api/ingest/scenes': structuredClone(QUEUE),
    '/api/ingest/geolocating': (message) =>
      message.body.video ? { geolocating: { ...BRIDGE, since: 'now' } } : { geolocating: null },
    ...answers,
  };
  const asked = [];
  const sent = [];
  const ports = [];
  const links = []; // the linked-views port, which also hears a move onto a lead
  const pictures = []; // the thumbnails asked for
  const handed = []; // what Make the proof handed the worker
  let proof = { ok: true };
  const api = {
    storage: { local: { get: vi.fn(async (defaults) => ({ ...defaults })), set: vi.fn() } },
    runtime: {
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn(async (message) => {
        sent.push(message);
        if (message.type === 'map-file') return { ok: true, file: { type: 'video/mp4', data: '', next: null, total: 0 } };
        if (message.type === 'map-image') {
          pictures.push(message);
          return images(message);
        }
        if (message.type === 'scene-proof') {
          handed.push(message);
          return typeof proof === 'function' ? proof(message) : proof;
        }
        if (message.type !== 'map-api') return { ok: true, data: {} };
        asked.push(message);
        const answer = app[message.path];
        if (answer instanceof Error) return { ok: false, error: answer.message, ...(answer.code ? { code: answer.code } : {}) };
        return { ok: true, data: typeof answer === 'function' ? answer(message) : (answer ?? null) };
      }),
      connect: vi.fn((info) => {
        const port = {
          name: info.name,
          messages: [],
          onMessage: { addListener: (cb) => port.messages.push(cb) },
          onDisconnect: { addListener: () => {} },
          postMessage: vi.fn(),
          disconnect: vi.fn(),
        };
        if (info.name === 'map-sync') ports.push(port);
        if (info.name === 'map-link') links.push(port);
        return port;
      }),
    },
  };
  for (const part of PARTS) new Function('window', read(part))(window);
  new Function('window', 'document', 'location', 'chrome', 'browser', read('mapoverlay.js'))(window, document, location, api, undefined);
  const handle = window.__AZIMUT_MAP_TOOLS__;
  const root = handle.root;
  const $ = (selector) => root.querySelector(selector);
  return {
    ...handle,
    app,
    location,
    links,
    pictures,
    $,
    $$: (selector) => [...root.querySelectorAll(selector)],
    calls: (path) => asked.filter((m) => m.path === path),
    sent: () => sent,
    handed,
    /** What the worker answers Make the proof with: a value, or a function of the message. */
    proveWith: (answer) => {
      proof = answer;
    },
    forget: () => (asked.length = 0),
    nudge: (event) => {
      for (const cb of ports.at(-1).messages) cb({ type: 'app-event', event });
    },
    press: (act, data = {}) => {
      const where = Object.entries(data).map(([key, value]) => `[data-${key}="${value}"]`).join('');
      $(`[data-act="${act}"]${where}`).click();
    },
    panes: () => [...root.querySelectorAll('.rw')],
  };
}

/** Let the panel's errands land. */
const settle = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('the list', () => {
  it('reads the case’s queue when the case is picked, and lists it while nothing is in hand', async () => {
    panel = open();
    await settle();
    expect(panel.calls('/api/ingest/scenes').map((m) => m.query)).toEqual([{ case_id: CASE }]);
    const fold = panel.$('[data-act="geo-fold"]');
    // the abandoned stay in the app's To-do; here only what is left to geolocate
    expect(fold.textContent).toBe('To geolocate2');
    // a scene is picked from the list, so the list is out until one is
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(panel.$$('.geo-row')).toHaveLength(2);
    expect(panel.$('[data-act="geo-go"][data-draft="sc_1"]')).not.toBe(null);
  });

  it('folds to one row by hand, and reads the queue afresh when unfolded', async () => {
    panel = open();
    await settle();
    panel.press('geo-fold');
    expect(panel.$('.geo-row')).toBe(null);
    expect(panel.$('[data-act="geo-fold"]').getAttribute('aria-expanded')).toBe('false');
    panel.forget();
    panel.press('geo-fold');
    await settle();
    expect(panel.calls('/api/ingest/scenes')).toHaveLength(1);
    expect(panel.$$('.geo-row')).toHaveLength(2);
  });

  it('folds to one row while a tool is picked up, and comes back when it is put down', async () => {
    panel = open();
    await settle();
    panel.$('[data-tab="measure"]').click();
    await settle();
    expect(panel.$('.geo-row')).toBe(null);
    expect(panel.$('[data-act="geo-fold"]').textContent).toBe('To geolocate2');
    panel.$('[data-tab="measure"]').click();
    await settle();
    expect(panel.$$('.geo-row')).toHaveLength(2);
  });

  it('keeps a fold made by hand when the queue is read again', async () => {
    panel = open();
    await settle();
    panel.press('geo-fold');
    panel.nudge({ type: 'scenes', case_id: CASE, video: VIDEO });
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();
    expect(panel.$('.geo-row')).toBe(null);
  });

  it('is not there at all for a case with no scene to geolocate', async () => {
    panel = open({ '/api/ingest/scenes': { files: [], geolocating: null } });
    await settle();
    expect(panel.$('.geo')).toBe(null);
  });

  it('stays out of the way of an app from before scenes', async () => {
    panel = open({ '/api/ingest/scenes': new Error('Not Found') });
    await settle();
    expect(panel.$('.geo')).toBe(null);
    expect(panel.$('.note')).toBe(null);
  });

  it('lists by file, each scene with its time, name and two counts, as the app shows them', async () => {
    panel = open();
    await settle();
    expect(panel.$('.geo-file').textContent).toBe('Market walk');
    expect(panel.$$('.geo-row').map(said)).toEqual([
      ['Whole video', '', '0', '0', 'To geolocate: no map capture yet, nothing from the video yet'],
      ['bridge?', '3:58–4:12', '2', '5', 'In progress: 2 map captures, 5 pictures from the video'],
    ]);
    const [whole, bridge] = panel.$$('.geo-row');
    // a count at 0 is greyed, and the pip says where the scene stands
    expect([...whole.querySelectorAll('.geo-n')].map((n) => n.classList.contains('none'))).toEqual([true, true]);
    expect([...bridge.querySelectorAll('.geo-n')].map((n) => n.classList.contains('none'))).toEqual([false, false]);
    expect([whole.classList.contains('todo'), bridge.classList.contains('progress')]).toEqual([true, true]);
    // the map's icon, then the video's
    expect([...bridge.querySelectorAll('.geo-n svg path')].map((p) => p.getAttribute('d')))
      .toEqual([window.AzimutMapTheme.ICONS.satellite, window.AzimutMapTheme.ICONS.video]);
    // and nothing says the state in words but the hover
    expect(bridge.querySelector('.geo-meta').textContent).not.toContain('In progress');
    expect(panel.$$('.geo-name').every((el) => el.getAttribute('dir') === 'auto')).toBe(true);
  });

  it('marks each scene as its bar does, in the colour Inspect gives it', async () => {
    panel = open({
      '/api/ingest/scenes': {
        files: [{ video: VIDEO, title: 'Market walk', scenes: [
          row('sc_1', null, null, '', { order: 0 }),
          row('sc_2', 238, 252, 'bridge?', { order: 1 }),
          row('sc_4', 301, null, '', { order: 2 }),
        ] }],
        geolocating: null,
      },
    });
    await settle();
    const [whole, passage, instant] = panel.$$('.geo-row');
    expect(whole.querySelector('.geo-mark')).toBe(null);
    const band = passage.querySelector('.geo-meta .geo-mark');
    expect(band.classList.contains('at')).toBe(false);
    expect(band.style.background).toBe(window.AzimutMapTheme.SCENE_COLORS[1]);
    // named by its time, the scene is marked beside its name
    const pin = instant.querySelector('.geo-name .geo-mark');
    expect(pin.classList.contains('at')).toBe(true);
    expect(pin.style.background).toBe(window.AzimutMapTheme.SCENE_COLORS[2]);
  });
});

describe('a picture marked to geolocate', () => {
  const PHOTO = 'media/harbour.png';
  const WALL = { ...row('sc_p', null, null, 'Harbour wall'), video: PHOTO, file_kind: 'image' };
  const PICTURES = {
    '/api/ingest/scenes': {
      files: [{ video: PHOTO, title: 'Harbour photo', kind: 'image', scenes: [WALL, { ...row('sc_q', null, null), video: PHOTO, file_kind: 'image' }] }],
      geolocating: null,
    },
    '/api/ingest/geolocating': (message) => (message.body.video ? { geolocating: { ...WALL, since: 'now' } } : { geolocating: null }),
  };

  async function unfolded() {
    panel = open(PICTURES);
    await settle();
  }

  it('reads as a picture: Whole picture, and no mark', async () => {
    await unfolded();
    expect(panel.$$('.geo-row').map(said)).toEqual([
      ['Harbour wall', 'Whole picture', '0', '1', 'To geolocate: no map capture yet, the picture itself'],
      ['Whole picture', '', '0', '1', 'To geolocate: no map capture yet, the picture itself'],
    ]);
    // a picture gives itself, by the picture's icon
    expect(panel.$('.geo-row .geo-n:last-child svg path').getAttribute('d')).toBe(window.AzimutMapTheme.ICONS.image);
    expect(panel.$('.geo-mark')).toBe(null);
    expect(panel.$('.geo-file svg path').getAttribute('d')).toBe(window.AzimutMapTheme.ICONS.image);
    expect(panel.$('[data-act="geo-go"]').title).toBe('Find it on this map, its picture beside it');
  });

  it('is held over the map as a picture, its scene dotted and nothing on a bar', async () => {
    await unfolded();
    panel.press('geo-go', { draft: 'sc_p' });
    await settle();
    await settle();
    const [pane] = panel.panes();
    expect(pane.querySelector('.rw-title').textContent).toBe('Harbour wall · Harbour photo');
    expect(pane.querySelector('.rw-dot')).not.toBe(null);
    expect(pane.querySelector('canvas')).not.toBe(null);
    expect(pane.querySelector('video')).toBe(null);
    expect(pane.querySelector('.rw-scene')).toBe(null);
    expect(pane.querySelector('.rw-rest')).toBe(null);
    expect(panel.$('[data-act="geo-show"]').textContent).toBe('Geolocating · Whole picture · Harbour wall');
    expect(panel.$('[data-act="geo-show"]').title).toBe('Show its picture over the map');
  });
});

describe('geolocating a scene from over this map', () => {
  async function geolocateBridge() {
    panel = open();
    await settle();
    panel.press('geo-go', { draft: 'sc_2' });
    await settle();
  }

  it('tells the app which scene, and holds its video over the map with the scene marked', async () => {
    await geolocateBridge();
    expect(panel.calls('/api/ingest/geolocating').map((m) => [m.method, m.body])).toEqual([
      ['POST', { case_id: CASE, video: VIDEO, draft: 'sc_2' }],
    ]);
    expect(panel.tools.refs.open).toHaveLength(1);
    expect(panel.tools.refs.open[0]).toMatchObject({ path: VIDEO, kind: 'video', title: 'bridge? · Market walk' });
    expect(panel.tools.refs.open[0].scene).toMatchObject({ id: 'sc_2', start: 238, end: 252 });
    expect(panel.panes()).toHaveLength(1);
    expect(panel.panes()[0].querySelector('.rw-scene')).not.toBe(null);
    // the choice is made: the list folds away behind the pill, counting what is left
    const fold = panel.$('[data-act="geo-fold"]');
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(fold.textContent).toBe('More to geolocate1');
  });

  it('opens the list again when the scene in hand stops, to pick the next', async () => {
    await geolocateBridge();
    panel.press('geo-stop');
    await settle();
    expect(panel.$('[data-act="geo-fold"]').getAttribute('aria-expanded')).toBe('true');
    expect(panel.$$('.geo-row')).toHaveLength(2);
  });

  it('shows no row behind the pill when the scene in hand was the last one', async () => {
    const LAST = { files: [{ video: VIDEO, title: 'Market walk', scenes: [BRIDGE] }], geolocating: BRIDGE };
    panel = open({ '/api/ingest/scenes': LAST });
    await settle();
    expect(panel.$('.geo-pill')).not.toBe(null);
    expect(panel.$('[data-act="geo-fold"]')).toBe(null);
  });

  it('shows a pill with the scene, its captures and a way to stop', async () => {
    await geolocateBridge();
    const pill = panel.$('.geo-pill');
    expect(pill.querySelector('.geo-what').textContent).toBe('Geolocating · 3:58–4:12 · bridge?');
    expect([...pill.querySelectorAll('.geo-count .geo-n')].map((n) => n.textContent)).toEqual(['2', '5']);
    expect(pill.querySelector('.geo-counts').getAttribute('title')).toBe('Geolocating: 2 map captures, 5 pictures from the video');
    panel.press('geo-stop');
    await settle();
    expect(panel.calls('/api/ingest/geolocating').at(-1).body).toEqual({ case_id: CASE });
    expect(panel.$('.geo-pill')).toBe(null);
    // the window stays: stopping is about where captures go, not what is on screen
    expect(panel.panes()).toHaveLength(1);
  });

  it('stops from the list too: the scene in hand’s Geolocate reads Stop, pressed', async () => {
    await geolocateBridge();
    // the app now answers with the scene it holds, as it does once geolocating starts
    panel.app['/api/ingest/scenes'] = { ...structuredClone(QUEUE), geolocating: BRIDGE };
    panel.press('geo-fold');
    await settle();
    const live = panel.$('.geo-list .geo-row.live button[data-act="geo-stop"]');
    expect(live.textContent).toBe('Stop');
    expect(live.getAttribute('aria-pressed')).toBe('true');
    expect(panel.$('.geo-list [data-act="geo-go"][data-draft="sc_2"]')).toBe(null);
    panel.app['/api/ingest/scenes'] = structuredClone(QUEUE);
    live.click();
    await settle();
    expect(panel.calls('/api/ingest/geolocating').at(-1).body).toEqual({ case_id: CASE });
    expect(panel.$('.geo-list [data-act="geo-go"][data-draft="sc_2"]').getAttribute('aria-pressed')).toBe('false');
  });

  it('brings the video back from the pill, in the window already holding it', async () => {
    await geolocateBridge();
    panel.tools.refs.fold(panel.tools.refs.open[0].id);
    panel.press('geo-show');
    expect(panel.tools.refs.open).toHaveLength(1);
    expect(panel.tools.refs.open[0].collapsed).toBe(false);
    panel.tools.refs.clear();
    panel.press('geo-show');
    expect(panel.tools.refs.open).toHaveLength(1);
  });

  it('marks the scene being geolocated in the list', async () => {
    await geolocateBridge();
    panel.app['/api/ingest/scenes'] = { ...structuredClone(QUEUE), geolocating: BRIDGE };
    panel.press('geo-fold');
    await settle();
    const live = panel.$('.geo-row.live');
    expect(live.querySelector('.geo-name').textContent).toBe('bridge?');
    expect(said(live)).toEqual(['bridge?', '3:58–4:12', '2', '5', 'Geolocating: 2 map captures, 5 pictures from the video']);
  });

  it('says why when the app refuses, and reads the queue again', async () => {
    panel = open({ '/api/ingest/geolocating': new Error('a proof already geolocates that scene') });
    await settle();
    panel.forget();
    panel.press('geo-go', { draft: 'sc_2' });
    await settle();
    expect(panel.$('.note').textContent).toBe('a proof already geolocates that scene');
    expect(panel.tools.refs.open).toHaveLength(0);
    expect(panel.calls('/api/ingest/scenes')).toHaveLength(1);
  });

  it('still says a scene is being geolocated on a folded panel', async () => {
    await geolocateBridge();
    panel.press('collapse');
    expect(panel.$('header .geo-dot').title).toBe('Geolocating bridge?');
  });
});

describe('a panel that cannot reach the app', () => {
  const fail = (message, code) => Object.assign(new Error(message), { code });

  it('says nothing answers, in place of its body, and comes back on Try again', async () => {
    panel = open({ '/api/ingest/ping': fail('Azimut is not answering. Is the app running?', 'down') });
    await settle();
    expect(panel.$('.trouble p').textContent).toBe('Azimut is not answering. Start it, then try again.');
    expect(panel.$('[data-act="capture"]')).toBe(null);
    expect(panel.$('.tabs')).toBe(null);
    expect(panel.$('.sound').classList.contains('off')).toBe(true);
    panel.app['/api/ingest/ping'] = { units: 'metric' };
    panel.press('retry');
    await settle();
    expect(panel.$('.trouble')).toBe(null);
    expect(panel.$('select.case').value).toBe(CASE);
    expect(panel.$$('.geo-row')).toHaveLength(2);
  });

  it('offers the pairing when there is no token, or one the app turned down', async () => {
    for (const [code, said] of [['unpaired', 'Not paired with Azimut yet.'], ['rejected', 'Azimut turned this pairing down. Paste the token again.']]) {
      panel = open({ '/api/ingest/ping': fail('no', code) });
      await settle();
      expect(panel.$('.trouble p').textContent).toBe(said);
      panel.press('pair');
      expect(panel.sent()).toContainEqual({ type: 'open-options' });
      panel.close();
      panel = null;
    }
  });

  it('keeps the case in the header and the tools in the body otherwise', async () => {
    panel = open();
    await settle();
    expect(panel.$('header select.case').value).toBe(CASE);
    expect(panel.$('.trouble')).toBe(null);
    expect(panel.$('[data-act="capture"]').disabled).toBe(false);
  });
});

describe('in step with the app', () => {
  it('reads the queue again when the app says the scene being geolocated changed', async () => {
    panel = open();
    await settle();
    panel.forget();
    panel.app['/api/ingest/scenes'] = { ...structuredClone(QUEUE), geolocating: { ...BRIDGE, captures: ['a', 'b', 'c'] } };
    panel.nudge({ type: 'geolocating', case_id: CASE, video: VIDEO, draft: 'sc_2' });
    await settle();
    expect(panel.calls('/api/ingest/scenes')).toHaveLength(1);
    expect(panel.$('.geo-pill .geo-count .geo-n').textContent).toBe('3');
    // started in the app, it is offered here without opening anything on its own
    expect(panel.tools.refs.open).toHaveLength(0);
  });

  it('reads the queue again, once, after a burst of scenes moved or saved nudges', async () => {
    panel = open();
    await settle();
    panel.forget();
    panel.nudge({ type: 'scenes', case_id: CASE, video: VIDEO });
    panel.nudge({ type: 'saved', case_id: CASE });
    panel.nudge({ type: 'scenes', case_id: OTHER, video: VIDEO });
    expect(panel.calls('/api/ingest/scenes')).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();
    expect(panel.calls('/api/ingest/scenes')).toHaveLength(1);
  });

  it('leaves another case’s scene alone', async () => {
    panel = open();
    await settle();
    panel.forget();
    panel.nudge({ type: 'geolocating', case_id: OTHER, video: VIDEO, draft: 'sc_2' });
    await settle();
    expect(panel.calls('/api/ingest/scenes')).toHaveLength(0);
  });

  it('drops the pill and the list with the case, and reads the next one’s', async () => {
    panel = open({ '/api/ingest/scenes': { ...structuredClone(QUEUE), geolocating: BRIDGE } });
    await settle();
    expect(panel.$('.geo-pill')).not.toBe(null);
    panel.app['/api/ingest/scenes'] = { files: [], geolocating: null };
    panel.forget();
    const select = panel.$('[data-act="case"]');
    select.value = OTHER;
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle();
    expect(panel.calls('/api/ingest/scenes').map((m) => m.query)).toEqual([{ case_id: OTHER }]);
    expect(panel.$('.geo')).toBe(null);
  });
});

describe('a nudge, shown before the queue is read again', () => {
  /** The panel geolocating the bridge, the queue's next answers held back by hand. */
  async function heldBack() {
    panel = open({ '/api/ingest/scenes': { ...structuredClone(QUEUE), geolocating: BRIDGE } });
    await settle();
    const later = [];
    panel.app['/api/ingest/scenes'] = () => new Promise((resolve) => later.push(resolve));
    panel.forget();
    return later;
  }
  // the map's count, in the pill's chip, which pulses as a capture lands
  const count = () => panel.$('.geo-pill .geo-count .geo-n');
  const chip = () => panel.$('.geo-pill .geo-count');
  const captured = (n) => Array.from({ length: n }, (_, i) => `media/c${i + 1}.png`);

  it('counts the capture attached at once, with a pulse, before the queue answers', async () => {
    const later = await heldBack();
    expect(count().textContent).toBe('2');
    expect(chip().classList.contains('bump')).toBe(false);
    panel.nudge({ type: 'geolocating', case_id: CASE, video: VIDEO, draft: 'sc_2', capture: 'media/c3.png', captures: 3 });
    expect(count().textContent).toBe('3');
    expect(chip().classList.contains('bump')).toBe(true);
    expect(panel.$('.geo-pill .geo-counts').getAttribute('aria-label')).toBe('Geolocating: 3 map captures, 5 pictures from the video');
    await settle();
    expect(later).toHaveLength(1);
    later[0]({ ...structuredClone(QUEUE), geolocating: { ...BRIDGE, captures: captured(3) } });
    await settle();
    expect(count().textContent).toBe('3');
  });

  it('tells the list’s row too', async () => {
    const later = await heldBack();
    panel.press('geo-fold');
    later.shift()({ ...structuredClone(QUEUE), geolocating: BRIDGE });
    await settle();
    panel.nudge({ type: 'geolocating', case_id: CASE, video: VIDEO, draft: 'sc_2', capture: 'media/c3.png', captures: 3 });
    expect(said(panel.$('.geo-row.live'))).toEqual(['bridge?', '3:58–4:12', '3', '5', 'Geolocating: 3 map captures, 5 pictures from the video']);
  });

  it('drops an answer asked before the nudge, and reads once more after a burst', async () => {
    const later = await heldBack();
    panel.press('geo-fold'); // a read out, as unfolding asks
    panel.nudge({ type: 'geolocating', case_id: CASE, video: VIDEO, draft: 'sc_2', capture: 'media/c3.png', captures: 3 });
    panel.nudge({ type: 'geolocating', case_id: CASE, video: VIDEO, draft: 'sc_2', capture: 'media/c4.png', captures: 4 });
    expect(count().textContent).toBe('4');
    await settle();
    // the fold's read and the first nudge's; the second waits for that one
    expect(later).toHaveLength(2);
    later[0]({ ...structuredClone(QUEUE), geolocating: BRIDGE });
    later[1]({ ...structuredClone(QUEUE), geolocating: { ...BRIDGE, captures: captured(3) } });
    await settle();
    expect(count().textContent).toBe('4');
    expect(later).toHaveLength(3);
    later[2]({ ...structuredClone(QUEUE), geolocating: { ...BRIDGE, captures: captured(4) } });
    await settle();
    expect(count().textContent).toBe('4');
    expect(later).toHaveLength(3);
  });

  it('drops the pill at once when the scene ends, and a read asked before cannot bring it back', async () => {
    const later = await heldBack();
    panel.press('geo-fold');
    panel.nudge({ type: 'geolocating', case_id: CASE, video: null, draft: null });
    expect(panel.$('.geo-pill')).toBe(null);
    await settle();
    later[0]({ ...structuredClone(QUEUE), geolocating: BRIDGE });
    await settle();
    expect(panel.$('.geo-pill')).toBe(null);
  });

  it('shows a scene started elsewhere from its row, before the queue answers', async () => {
    panel = open();
    await settle();
    panel.app['/api/ingest/scenes'] = () => new Promise(() => {});
    panel.nudge({ type: 'geolocating', case_id: CASE, video: VIDEO, draft: 'sc_2' });
    expect(panel.$('.geo-pill .geo-what').textContent).toBe('Geolocating · 3:58–4:12 · bridge?');
    expect(count().textContent).toBe('2');
  });
});

describe('making the proof from over this map', () => {
  async function geolocating() {
    panel = open({ '/api/ingest/scenes': { ...structuredClone(QUEUE), geolocating: BRIDGE } });
    await settle();
  }
  const proof = () => panel.$('.geo-pill [data-act="geo-proof"]');

  it('dots the pill in the scene’s colour, as the list marks it, folded panel included', async () => {
    panel = open({ '/api/ingest/scenes': { ...structuredClone(QUEUE), geolocating: { ...BRIDGE, order: 1 } } });
    await settle();
    const red = window.AzimutMapTheme.SCENE_COLORS[1];
    expect(panel.$('.geo-pill .geo-dot').style.getPropertyValue('--scene')).toBe(red);
    panel.press('collapse');
    expect(panel.$('header .geo-dot').style.getPropertyValue('--scene')).toBe(red);
  });

  it('sits on the pill beside the count, worded and explained', async () => {
    await geolocating();
    expect(proof().textContent).toBe('Make the proof');
    expect(proof().title).toBe('Make the proof in Azimut, from its frames and captures');
    expect(panel.$('.geo-pill [data-act="geo-stop"]').getAttribute('aria-label')).toBe('Stop geolocating');
  });

  it('hands the scene held to the app, case and all, and writes nothing to it', async () => {
    await geolocating();
    panel.forget();
    proof().click();
    await settle();
    expect(panel.handed).toEqual([{ type: 'scene-proof', scene: { caseId: CASE, video: VIDEO, draft: 'sc_2' } }]);
    expect(panel.calls('/api/ingest/geolocating')).toHaveLength(0);
    expect(panel.$('.note')).toBe(null);
    expect(proof().disabled).toBe(false);
  });

  it('is pressed once while the app is being reached', async () => {
    await geolocating();
    let answer;
    panel.proveWith(() => new Promise((resolve) => (answer = resolve)));
    proof().click();
    await settle();
    expect(proof().disabled).toBe(true);
    proof().click();
    answer({ ok: true });
    await settle();
    expect(panel.handed).toHaveLength(1);
    expect(proof().disabled).toBe(false);
  });

  it('says why when the app could not be reached', async () => {
    await geolocating();
    panel.proveWith({ ok: false, error: 'Azimut did not answer' });
    proof().click();
    await settle();
    expect(panel.$('.note').textContent).toBe('Azimut did not answer');
  });

  it('speaks of the picture for a picture', async () => {
    const picture = { ...BRIDGE, video: 'media/harbour.png', file_kind: 'image', start: null, end: null };
    panel = open({ '/api/ingest/scenes': { ...structuredClone(QUEUE), geolocating: picture } });
    await settle();
    expect(proof().title).toBe('Make the proof in Azimut, from the picture and its captures');
  });
});

/** Where a lead is, as the app gives it on the scene's row and in what it gathered. */
const lead = (id, n, lat, lon) => ({ id, n, lat, lon });
const LEADS = [lead('ld_1', 1, 50.45, 30.52), lead('ld_2', 3, 50.4504, 30.5208)];

/** The pixel a coordinate is drawn at, and back, in the panel's own frame. */
function project(panel, point) {
  const area = { x: panel.state.frame.x, y: panel.state.frame.y, w: 1400, h: 900 };
  return window.AzimutMapMath.toScreen(point, panel.state.view, area);
}
function unproject(panel, at) {
  const area = { x: panel.state.frame.x, y: panel.state.frame.y, w: 1400, h: 900 };
  return window.AzimutMapMath.toLatLon(at, panel.state.view, area);
}

/** A click on the map, which is the drawing surface over it while a tool is armed. */
const clickMap = (panel, at) =>
  panel.root.querySelector('canvas').dispatchEvent(new window.PointerEvent('pointerdown', { clientX: at.x, clientY: at.y }));

/** The pointer down on a lead's mark, moved by `by` and let go over the window. */
function dragLead(panel, id, by) {
  const el = panel.$(`.lead[data-lead="${id}"]`);
  const at = { x: parseFloat(el.style.left), y: parseFloat(el.style.top) - 14 };
  el.querySelector('.lead-pin').dispatchEvent(
    new window.PointerEvent('pointerdown', { clientX: at.x, clientY: at.y, button: 0, bubbles: true, composed: true }),
  );
  const to = { x: at.x + by.x, y: at.y + by.y };
  if (by.x || by.y) window.dispatchEvent(new window.PointerEvent('pointermove', { clientX: to.x, clientY: to.y, bubbles: true }));
  window.dispatchEvent(new window.PointerEvent('pointerup', { clientX: to.x, clientY: to.y, bubbles: true }));
}

describe('leads, dropped while a scene is geolocated', () => {
  /** The bridge being geolocated, the app keeping each lead dropped on it. */
  function geolocatingBridge(extra = {}) {
    const kept = [];
    panel = open({
      '/api/ingest/scenes': { ...structuredClone(QUEUE), geolocating: { ...BRIDGE, order: 1 } },
      '/api/ingest/leads': (message) => {
        const made = lead(`ld_${kept.length + 1}`, kept.length + 1, message.body.lat, message.body.lon);
        kept.push(made);
        return { lead: made, geolocating: { ...BRIDGE, order: 1, leads: [...kept] } };
      },
      ...extra,
    });
  }

  it('files a lead at each click, unnamed and at once, and stays armed for the next', async () => {
    geolocatingBridge();
    await settle();
    panel.$('[data-tab="pins"]').click();
    const drop = panel.$('[data-act="pin-drop"]');
    expect(drop.textContent).toBe('Drop a lead');
    expect(drop.title).toBe('Mark spots the scene may be, kept with it');
    drop.click();
    expect(panel.$('[data-act="pin-drop"]').textContent).toBe('Click the map');
    expect(panel.$('.readout').textContent).toBe('Each click drops a lead, Esc stops');
    clickMap(panel, { x: 760, y: 400 });
    await settle();
    clickMap(panel, { x: 640, y: 520 });
    await settle();
    const bodies = panel.calls('/api/ingest/leads').map((m) => [m.method, m.body]);
    expect(bodies).toHaveLength(2);
    const first = unproject(panel, { x: 760, y: 400 });
    expect(bodies[0][0]).toBe('POST');
    expect(Object.keys(bodies[0][1]).sort()).toEqual(['case_id', 'lat', 'lon']);
    expect(bodies[0][1].case_id).toBe(CASE);
    expect(bodies[0][1].lat).toBeCloseTo(first.lat, 9);
    expect(bodies[0][1].lon).toBeCloseTo(first.lon, 9);
    // no place is filed and nothing asks for a name
    expect(panel.calls('/api/ingest/place')).toHaveLength(0);
    expect(panel.tools.pins.draft).toBe(null);
    expect(panel.$('[data-act="pin-title"]')).toBe(null);
    expect(panel.tools.pins.dropping).toBe(true);
    expect(panel.root.querySelector('canvas').style.pointerEvents).toBe('auto');
    // both drawn, numbered, the moment the app answered
    expect(panel.$$('.lead b').map((b) => b.textContent)).toEqual(['1', '2']);
    expect(panel.$('.geo-pill .geo-leads').textContent).toBe('2');
    expect(panel.$('.geo-pill .geo-leads').title).toBe('2 leads');
  });

  it('puts the drop down on Esc, as its button pressed again does', async () => {
    geolocatingBridge();
    await settle();
    panel.$('[data-tab="pins"]').click();
    panel.press('pin-drop');
    expect(panel.$('[data-act="pin-drop"]').title).toBe('Press again or Esc to stop');
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.tools.pins.dropping).toBe(false);
    expect(panel.root.querySelector('canvas').style.pointerEvents).toBe('none');
    expect(panel.$('[data-act="pin-drop"]').textContent).toBe('Drop a lead');
    panel.press('pin-drop');
    panel.press('pin-drop');
    expect(panel.tools.pins.dropping).toBe(false);
  });

  it('says why the app refused one, and stays armed', async () => {
    geolocatingBridge({ '/api/ingest/leads': new Error('a scene keeps at most 50 leads') });
    await settle();
    panel.$('[data-tab="pins"]').click();
    panel.press('pin-drop');
    clickMap(panel, { x: 760, y: 400 });
    await settle();
    expect(panel.$('.note').textContent).toBe('a scene keeps at most 50 leads');
    expect(panel.tools.pins.dropping).toBe(true);
  });

  it('files a named place outside a geolocate, File it waiting for the name', async () => {
    panel = open({ '/api/ingest/place': { ok: true } });
    await settle();
    panel.$('[data-tab="pins"]').click();
    expect(panel.$('[data-act="pin-drop"]').textContent).toBe('Place a point');
    panel.press('pin-drop');
    clickMap(panel, { x: 760, y: 400 });
    await settle();
    expect(panel.calls('/api/ingest/leads')).toHaveLength(0);
    const save = () => panel.$('[data-act="pin-save"]');
    expect(save().disabled).toBe(true);
    expect(save().title).toBe('Name the point to file it');
    const title = panel.$('[data-act="pin-title"]');
    title.value = '   ';
    title.dispatchEvent(new window.Event('input', { bubbles: true }));
    expect(save().disabled).toBe(true);
    title.value = 'The quay';
    title.dispatchEvent(new window.Event('input', { bubbles: true }));
    // the same field, still under the cursor: only the button followed
    expect(panel.$('[data-act="pin-title"]')).toBe(title);
    expect(save().disabled).toBe(false);
    expect(save().hasAttribute('title')).toBe(false);
    save().click();
    await settle();
    const [filed] = panel.calls('/api/ingest/place');
    expect(filed.form).toBe(true);
    expect(filed.body).toMatchObject({ case_id: CASE, title: 'The quay' });
  });
});

describe('the leads on the map', () => {
  async function withLeads(extra = {}) {
    panel = open({
      '/api/ingest/scenes': { ...structuredClone(QUEUE), geolocating: { ...BRIDGE, order: 1, leads: LEADS } },
      '/api/ingest/leads/move': (message) => ({
        lead: lead(message.body.lead, 1, message.body.lat, message.body.lon),
        geolocating: { ...BRIDGE, order: 1, leads: [lead('ld_1', 1, message.body.lat, message.body.lon), LEADS[1]] },
      }),
      ...extra,
    });
    await settle();
  }

  it('draws each lead of the scene held, numbered in its colour, with no tool picked up', async () => {
    await withLeads();
    expect(panel.state.tool).toBe(null);
    const drawn = panel.$$('.lead');
    expect(drawn.map((el) => el.querySelector('b').textContent)).toEqual(['1', '3']);
    const red = window.AzimutMapTheme.SCENE_COLORS[1];
    expect(drawn.every((el) => el.style.getPropertyValue('--scene') === red)).toBe(true);
    // the tip on the spot
    const at = project(panel, LEADS[1]);
    expect(parseFloat(drawn[1].style.left)).toBeCloseTo(at.x, 6);
    expect(parseFloat(drawn[1].style.top)).toBeCloseTo(at.y, 6);
    expect(drawn[1].querySelector('.lead-pin').title).toBe('Lead 3');
    // a lead takes the pointer, to be dragged; the map under the rest of the layer keeps it
    expect(window.getComputedStyle(drawn[1].querySelector('.lead-pin')).pointerEvents).toBe('auto');
    // and counted in the pill, by the scene's two counts, as the app's pill shows them
    expect(panel.$('.geo-pill .geo-leads').textContent).toBe('2');
  });

  it('goes with the scene', async () => {
    await withLeads();
    panel.nudge({ type: 'geolocating', case_id: CASE, video: null, draft: null });
    expect(panel.$$('.lead')).toHaveLength(0);
  });

  it('is drawn afresh when the app says the scene’s leads moved', async () => {
    panel = open({ '/api/ingest/scenes': { ...structuredClone(QUEUE), geolocating: BRIDGE } });
    await settle();
    expect(panel.$$('.lead')).toHaveLength(0);
    panel.app['/api/ingest/scenes'] = { ...structuredClone(QUEUE), geolocating: { ...BRIDGE, leads: LEADS } };
    panel.nudge({ type: 'geolocating', case_id: CASE, video: VIDEO, draft: 'sc_2' });
    await settle();
    expect(panel.$$('.lead b').map((b) => b.textContent)).toEqual(['1', '3']);
  });

  it('moves one dragged, and tells the app where its tip was let go', async () => {
    await withLeads();
    const tipBefore = project(panel, LEADS[0]);
    dragLead(panel, 'ld_1', { x: 40, y: 30 });
    await settle();
    const [moved] = panel.calls('/api/ingest/leads/move');
    const there = unproject(panel, { x: tipBefore.x + 40, y: tipBefore.y + 30 });
    expect(moved.body).toMatchObject({ case_id: CASE, lead: 'ld_1' });
    expect(moved.body.lat).toBeCloseTo(there.lat, 9);
    expect(moved.body.lon).toBeCloseTo(there.lon, 9);
    // south and east of where it was, as the pointer went
    expect(moved.body.lat).toBeLessThan(LEADS[0].lat);
    expect(moved.body.lon).toBeGreaterThan(LEADS[0].lon);
    const el = panel.$('.lead[data-lead="ld_1"]');
    expect(parseFloat(el.style.left)).toBeCloseTo(tipBefore.x + 40, 6);
    expect(parseFloat(el.style.top)).toBeCloseTo(tipBefore.y + 30, 6);
  });

  it('names one clicked, and puts the name away on the next click, moving nothing', async () => {
    await withLeads();
    dragLead(panel, 'ld_2', { x: 0, y: 0 });
    const el = panel.$('.lead[data-lead="ld_2"]');
    expect(el.classList.contains('lit')).toBe(true);
    expect(el.querySelector('.lead-name').textContent).toBe('Lead 3');
    dragLead(panel, 'ld_2', { x: 1, y: 1 });
    expect(el.classList.contains('lit')).toBe(false);
    await settle();
    expect(panel.calls('/api/ingest/leads/move')).toHaveLength(0);
  });

  it('puts one back where the app has it when the app refuses the move', async () => {
    await withLeads({ '/api/ingest/leads/move': new Error('that lead is no longer there') });
    const tipBefore = project(panel, LEADS[0]);
    dragLead(panel, 'ld_1', { x: 40, y: 30 });
    await settle();
    expect(panel.$('.note').textContent).toBe('that lead is no longer there');
    expect(parseFloat(panel.$('.lead[data-lead="ld_1"]').style.left)).toBeCloseTo(tipBefore.x, 6);
  });
});

describe('what the scene gathered, from the pill’s counts', () => {
  const GATHERED = {
    geolocating: { ...BRIDGE, order: 1, leads: LEADS },
    leads: LEADS,
    captures: [
      { path: 'media/c1.png', title: 'Roof line', thumb: 'media/.thumbs/c1.jpg' },
      { path: 'media/c2.png', title: 'Quay', thumb: null },
    ],
    frames: [
      { id: 'fr_1', time: 240.4, path: 'media/frame-1.png', thumb: 'media/.thumbs/f1.jpg' },
      { id: 'fr_2', time: 245, path: null, thumb: null },
    ],
    collages: [
      { name: 'co_1', title: 'Bridge strip', path: 'media/collage.png', thumb: 'media/.thumbs/co.jpg' },
      { name: 'co_2', title: 'Unexported', path: null, thumb: null },
    ],
  };
  const IMPACT = {
    blocking: [], cascade: [], tombstone: [],
    touched: [{ id: 'e1', type: 'proof', label: 'Bridge proof', path: null, how: ['uses it as a panel'] }],
    counts: { blocking: 0, cascade: 0, tombstone: 0, touched: 1 },
  };

  async function opened(extra = {}, options) {
    panel = open({
      '/api/ingest/scenes': { ...structuredClone(QUEUE), geolocating: { ...BRIDGE, order: 1, leads: LEADS } },
      '/api/ingest/geolocating/gathered': structuredClone(GATHERED),
      '/api/ingest/geolocating/impact': IMPACT,
      '/api/ingest/geolocating/remove': { geolocating: { ...BRIDGE, order: 1, leads: LEADS } },
      '/api/ingest/leads/remove': { geolocating: { ...BRIDGE, order: 1, leads: [LEADS[1]] } },
      ...extra,
    }, options);
    await settle();
    panel.press('geo-gathered');
    await settle();
  }
  const heads = () => panel.$$('.gth-head').map((el) => el.textContent);
  /** The rows under one heading of the list. */
  const rows = (head) => {
    const out = [];
    let at = panel.$$('.gth-head').find((el) => el.textContent === head)?.nextElementSibling;
    while (at && !at.classList.contains('gth-head')) {
      if (at.classList.contains('gth-row')) out.push(at);
      at = at.nextElementSibling;
    }
    return out;
  };

  it('opens under the pill and lists the leads, the captures, the frames and the collages', async () => {
    await opened();
    expect(panel.calls('/api/ingest/geolocating/gathered').map((m) => m.query)).toEqual([{ case_id: CASE }]);
    expect(panel.$('[data-act="geo-gathered"]').getAttribute('aria-expanded')).toBe('true');
    expect(panel.$('[data-act="geo-gathered"]').getAttribute('aria-label')).toBe('What this scene gathered');
    expect(heads()).toEqual(['Leads', 'Map captures', 'Frames', 'Collages']);
    const [first, second] = rows('Leads');
    expect(first.querySelector('.gth-n').textContent).toBe('1');
    expect(first.querySelector('.gth-n').style.getPropertyValue('--scene')).toBe(window.AzimutMapTheme.SCENE_COLORS[1]);
    expect(first.querySelector('.gth-words').textContent).toBe('50.45000, 30.52000');
    expect(second.querySelector('[data-act="lead-remove"]').title).toBe('Delete this lead');
    expect(rows('Map captures').map((row) => row.querySelector('.gth-words').textContent)).toEqual(['Roof line', 'Quay']);
    expect(rows('Map captures')[0].querySelector('[data-act="gth-delete"]').title).toBe('Move this capture to the Trash');
    const [saved, unsaved] = rows('Frames');
    expect(saved.querySelector('.gth-words').textContent).toBe('4:00.400');
    expect(saved.querySelector('[data-act="gth-delete"]').title).toBe("Take it off Inspect's strip, its picture stays in Media");
    // a frame never saved is a time chip, and only leaves the strip
    expect(unsaved.querySelector('.gth-clock').textContent).toBe('4:05');
    expect(unsaved.querySelector('.gth-clock').title).toBe('Not saved to the case yet');
    expect(unsaved.querySelector('[data-act="gth-delete"]').title).toBe("Take it off Inspect's strip");
    // a collage is deleted in Collage, so nothing here deletes one
    expect(rows('Collages').map((row) => row.querySelector('.gth-words').textContent)).toEqual(['Bridge strip', 'Unexported']);
    expect(rows('Collages').some((row) => row.querySelector('button'))).toBe(false);
    expect(panel.$$('.gth-head').at(-1).title).toBe('Deleted in Collage');
    // pressed again, it folds away
    panel.press('geo-gathered');
    expect(panel.$('.gth')).toBe(null);
  });

  it('asks the app for the thumbnails it keeps, and paints them rather than linking them', async () => {
    await opened({}, {
      images: (message) => (message.query.path === 'media/frame-1.png'
        ? { ok: false, error: 'no thumbnail for that file' }
        : { ok: true, src: 'data:image/png;base64,AAAA' }),
    });
    await settle();
    expect(panel.pictures.map((m) => [m.path, m.query])).toEqual([
      ['/api/ingest/geolocating/thumb', { case_id: CASE, path: 'media/c1.png' }],
      ['/api/ingest/geolocating/thumb', { case_id: CASE, path: 'media/frame-1.png' }],
      ['/api/ingest/geolocating/thumb', { case_id: CASE, path: 'media/collage.png' }],
    ]);
    const [roof, quay] = rows('Map captures');
    expect(roof.querySelector('.gth-pic canvas')).not.toBe(null);
    expect(panel.$('.gth img')).toBe(null);
    // none kept, or none sent: the slot says what kind of file it is
    expect(quay.querySelector('.gth-pic canvas')).toBe(null);
    expect(quay.querySelector('.gth-pic svg')).not.toBe(null);
    expect(rows('Frames')[0].querySelector('.gth-pic canvas')).toBe(null);
    expect(rows('Collages')[0].querySelector('.gth-pic canvas')).not.toBe(null);
    // painted again from what is kept, not asked twice
    panel.press('geo-gathered');
    panel.press('geo-gathered');
    await settle();
    expect(panel.pictures).toHaveLength(3);
    expect(rows('Map captures')[0].querySelector('.gth-pic canvas')).not.toBe(null);
  });

  it('lists the picture of a picture scene, which is not deleted from here', async () => {
    const PHOTO = { ...BRIDGE, video: 'media/harbour.png', file_kind: 'image', start: null, end: null };
    await opened({
      '/api/ingest/scenes': { ...structuredClone(QUEUE), geolocating: PHOTO },
      '/api/ingest/geolocating/gathered': {
        geolocating: PHOTO, leads: [], captures: [], frames: [], collages: [],
        picture: { path: 'media/harbour.png', title: 'Harbour photo', thumb: 'media/.thumbs/h.jpg' },
      },
    });
    expect(heads()).toEqual(['Picture']);
    const [picture] = rows('Picture');
    expect(picture.querySelector('.gth-words').textContent).toBe('Harbour photo');
    expect(picture.querySelector('button')).toBe(null);
  });

  it('says so when the scene has gathered nothing yet', async () => {
    await opened({
      '/api/ingest/geolocating/gathered': { geolocating: BRIDGE, leads: [], captures: [], frames: [], collages: [] },
    });
    expect(panel.$('.gth .hint').textContent).toBe('Nothing gathered yet. Drop a lead or capture the map.');
  });

  it('deletes a lead in one press', async () => {
    await opened();
    panel.forget();
    panel.app['/api/ingest/geolocating/gathered'] = { ...structuredClone(GATHERED), leads: [LEADS[1]] };
    panel.$('[data-act="lead-remove"][data-lead="ld_1"]').click();
    await settle();
    expect(panel.calls('/api/ingest/leads/remove').map((m) => [m.method, m.body])).toEqual([
      ['POST', { case_id: CASE, lead: 'ld_1' }],
    ]);
    expect(panel.$$('.lead b').map((b) => b.textContent)).toEqual(['3']);
    expect(rows('Leads')).toHaveLength(1);
  });

  it('moves this map onto a lead, at the level it is at, and has the worker bring the tools back', async () => {
    await opened();
    expect(panel.$('[data-act="lead-go"]').title).toBe('Move this map to it');
    panel.$('[data-act="lead-go"][data-lead="ld_2"]').click();
    expect(panel.location.assign).toHaveBeenCalledWith('https://www.openstreetmap.org/#map=17/50.4504/30.5208');
    expect(panel.links.at(-1).postMessage).toHaveBeenCalledWith({
      type: 'follow', view: { lat: 50.4504, lon: 30.5208, zoom: 17, bearing: 0 },
    });
  });

  it('asks before a capture goes to the Trash, saying what else it touches', async () => {
    await opened();
    panel.forget();
    panel.$('[data-act="gth-delete"][data-key="media/c1.png"]').click();
    await settle();
    expect(panel.calls('/api/ingest/geolocating/impact').map((m) => [m.method, m.body])).toEqual([
      ['POST', { case_id: CASE, path: 'media/c1.png' }],
    ]);
    const ask = panel.$('.gth-ask');
    // under its own row
    expect(ask.previousElementSibling.querySelector('[data-key="media/c1.png"]')).not.toBe(null);
    expect(ask.querySelector('.gth-ask-q').textContent).toBe('Delete this capture?');
    expect([...ask.querySelectorAll('.hint')].map((el) => el.textContent)).toEqual([
      'It goes to the case Trash with its image.',
      'Linked to 1 other item in the case.',
    ]);
    expect(ask.querySelector('.gth-impact-head').textContent).toBe('Kept, losing their link to it');
    expect(ask.querySelector('.gth-impact-item').textContent).toBe('Bridge proof uses it as a panel');
    // no other delete while this one is asked
    expect(panel.$$('[data-act="gth-delete"]').every((b) => b.disabled)).toBe(true);
    expect(panel.calls('/api/ingest/geolocating/remove')).toHaveLength(0);
    panel.app['/api/ingest/geolocating/gathered'] = { ...structuredClone(GATHERED), captures: [GATHERED.captures[1]] };
    panel.press('gth-confirm');
    await settle();
    expect(panel.calls('/api/ingest/geolocating/remove').map((m) => [m.method, m.body])).toEqual([
      ['POST', { case_id: CASE, kind: 'capture', target: 'media/c1.png' }],
    ]);
    expect(panel.$('.gth-ask')).toBe(null);
    expect(rows('Map captures').map((row) => row.querySelector('.gth-words').textContent)).toEqual(['Quay']);
  });

  it('keeps the capture on Keep', async () => {
    await opened();
    panel.$('[data-act="gth-delete"][data-key="media/c1.png"]').click();
    await settle();
    panel.press('gth-cancel');
    await settle();
    expect(panel.$('.gth-ask')).toBe(null);
    expect(panel.calls('/api/ingest/geolocating/remove')).toHaveLength(0);
  });

  it('still lets a capture go when the check did not come back, and says so', async () => {
    await opened({ '/api/ingest/geolocating/impact': new Error('the app did not answer') });
    panel.$('[data-act="gth-delete"][data-key="media/c1.png"]').click();
    await settle();
    expect(panel.$('.gth-ask').textContent).toContain('Could not check what else it touches.');
    expect(panel.$('[data-act="gth-confirm"]').disabled).toBe(false);
  });

  it('holds the delete back where the app would refuse it, and says what to do first', async () => {
    await opened({
      '/api/ingest/geolocating/impact': {
        ...IMPACT,
        blocking: [{ id: 'r1', type: 'routine', label: 'Night watch', how: ['watches it'] }],
        counts: { ...IMPACT.counts, blocking: 1 },
      },
    });
    panel.$('[data-act="gth-delete"][data-key="media/c1.png"]').click();
    await settle();
    const confirm = panel.$('[data-act="gth-confirm"]');
    expect(confirm.disabled).toBe(true);
    expect(confirm.title).toBe('Take it out of these first');
  });

  it('takes a frame off the strip after a word, its picture staying in Media', async () => {
    await opened();
    panel.$('[data-act="gth-delete"][data-key="fr_1"]').click();
    await settle();
    const ask = panel.$('.gth-ask');
    expect(ask.querySelector('.gth-ask-q').textContent).toBe('Take this frame off the strip?');
    expect(ask.querySelector('.hint').textContent).toBe('Its picture saved to the case stays in Media.');
    expect(panel.calls('/api/ingest/geolocating/impact')).toHaveLength(0);
    expect(panel.$('[data-act="gth-confirm"]').textContent).toBe('Remove');
    panel.press('gth-confirm');
    await settle();
    expect(panel.calls('/api/ingest/geolocating/remove').at(-1).body).toEqual({ case_id: CASE, kind: 'frame', target: 'fr_1' });
  });

  it('reads the list again, once, when the app says what the scene gathered moved', async () => {
    await opened();
    panel.forget();
    panel.nudge({ type: 'geolocating', case_id: CASE, video: VIDEO, draft: 'sc_2', capture: 'media/c3.png', captures: 3 });
    panel.nudge({ type: 'scenes', case_id: CASE, video: VIDEO, frame_removed: 'fr_2' });
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle();
    expect(panel.calls('/api/ingest/geolocating/gathered')).toHaveLength(1);
  });

  it('closes when the scene ends', async () => {
    await opened();
    panel.nudge({ type: 'geolocating', case_id: CASE, video: null, draft: null });
    expect(panel.$('.gth')).toBe(null);
  });
});

describe('the pill’s quick links', () => {
  async function geolocating(extra = {}) {
    panel = open({ '/api/ingest/scenes': { ...structuredClone(QUEUE), geolocating: BRIDGE }, ...extra });
    await settle();
  }

  it('sit by the scene’s name, each saying where it goes', async () => {
    await geolocating();
    expect(panel.$$('.geo-pill .geo-link').map((b) => [b.dataset.to, b.title])).toEqual([
      ['inspect', 'Open the scene in Inspect'],
      ['satellite', 'Open Satellite on the spot this map shows'],
      ['horizon', 'Open Horizon on the spot this map shows'],
    ]);
  });

  it('hand the scene over with where it goes, and the spot this map shows for Satellite and Horizon', async () => {
    await geolocating();
    for (const to of ['inspect', 'satellite', 'horizon']) {
      panel.press('geo-to', { to });
      await settle();
    }
    const scene = { caseId: CASE, video: VIDEO, draft: 'sc_2' };
    expect(panel.handed).toEqual([
      { type: 'scene-proof', scene: { ...scene, to: 'inspect' } },
      { type: 'scene-proof', scene: { ...scene, to: 'satellite', view: { lat: 50.45, lon: 30.52, zoom: 17 } } },
      { type: 'scene-proof', scene: { ...scene, to: 'horizon', view: { lat: 50.45, lon: 30.52, zoom: 17 } } },
    ]);
    // Make the proof names no place to go: it goes where it always went
    panel.press('geo-proof');
    await settle();
    expect(panel.handed.at(-1)).toEqual({ type: 'scene-proof', scene });
  });

  it('cannot open Satellite or Horizon on a page that states no spot', async () => {
    await geolocating({ '/api/ingest/parse': { site: null } });
    const [inspect, satellite, horizon] = panel.$$('.geo-pill .geo-link');
    expect(inspect.disabled).toBe(false);
    expect([satellite.disabled, horizon.disabled]).toEqual([true, true]);
    expect(satellite.title).toBe('This page gives no spot to open there');
  });

  it('are held while a hand-off is on its way', async () => {
    await geolocating();
    let answer;
    panel.proveWith(() => new Promise((resolve) => (answer = resolve)));
    panel.press('geo-to', { to: 'inspect' });
    await settle();
    expect(panel.$$('.geo-pill .geo-link, .geo-pill [data-act="geo-proof"]').every((b) => b.disabled)).toBe(true);
    answer({ ok: true });
    await settle();
    expect(panel.$$('.geo-pill .geo-link').every((b) => !b.disabled)).toBe(true);
  });
});

describe('where the next click lands', () => {
  const ghost = () => panel.$('.ghost');
  const hover = (at) =>
    panel.root.querySelector('canvas').dispatchEvent(new window.PointerEvent('pointermove', { clientX: at.x, clientY: at.y }));
  const leave = () => panel.root.querySelector('canvas').dispatchEvent(new window.PointerEvent('pointerleave', {}));

  it('rides under the pointer as a place once the drop is armed, and never takes the click', async () => {
    panel = open();
    await settle();
    panel.$('[data-tab="pins"]').click();
    hover({ x: 500, y: 300 });
    expect(ghost().style.display).toBe('none');
    panel.press('pin-drop');
    hover({ x: 500, y: 300 });
    expect(ghost().style.display).toBe('');
    expect([ghost().style.left, ghost().style.top]).toEqual(['500px', '300px']);
    expect(ghost().classList.contains('place')).toBe(true);
    expect(ghost().querySelector('b svg path').getAttribute('d')).toBe(window.AzimutMapTheme.ICONS.pin);
    hover({ x: 520, y: 310 });
    expect([ghost().style.left, ghost().style.top]).toEqual(['520px', '310px']);
    // faint, and the pointer goes through it to the map
    expect(window.getComputedStyle(ghost().querySelector('.lead-pin')).pointerEvents).toBe('none');
    // off the map, onto the panel or a window: nothing says where a click lands
    leave();
    expect(ghost().style.display).toBe('none');
  });

  it('goes while the point waits for its name, and with the drop, which Esc ends', async () => {
    panel = open();
    await settle();
    panel.$('[data-tab="pins"]').click();
    panel.press('pin-drop');
    hover({ x: 500, y: 300 });
    clickMap(panel, { x: 500, y: 300 });
    await settle();
    hover({ x: 510, y: 300 });
    expect(ghost().style.display).toBe('none');
    // a place is one click: Esc puts the drop down with the point half placed
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.tools.pins.dropping).toBe(false);
    expect(panel.tools.pins.draft).toBe(null);
    expect(panel.$('[data-act="pin-drop"]').textContent).toBe('Place a point');
    panel.press('pin-drop');
    expect(ghost().style.display).toBe('none'); // the pointer is on the panel, not the map
  });

  it('is the next lead while a scene is geolocated, numbered after the last, in its colour', async () => {
    const kept = [...LEADS];
    panel = open({
      '/api/ingest/scenes': { ...structuredClone(QUEUE), geolocating: { ...BRIDGE, order: 1, leads: LEADS } },
      '/api/ingest/leads': (message) => {
        const made = lead('ld_9', 4, message.body.lat, message.body.lon);
        kept.push(made);
        return { lead: made, geolocating: { ...BRIDGE, order: 1, leads: [...kept] } };
      },
    });
    await settle();
    panel.$('[data-tab="pins"]').click();
    panel.press('pin-drop');
    hover({ x: 500, y: 300 });
    expect(ghost().classList.contains('place')).toBe(false);
    // the leads are 1 and 3: the next is 4, as the app numbers it
    expect(ghost().querySelector('b').textContent).toBe('4');
    expect(ghost().style.getPropertyValue('--scene')).toBe(window.AzimutMapTheme.SCENE_COLORS[1]);
    clickMap(panel, { x: 500, y: 300 });
    await settle();
    // armed for the next one, which is 5
    hover({ x: 540, y: 330 });
    expect(ghost().style.display).toBe('');
    expect(ghost().querySelector('b').textContent).toBe('5');
  });

  it('shows nowhere on a view whose click files the address’s own point', async () => {
    panel = open({
      '/api/ingest/parse': {
        site: 'google-maps', label: 'Google Maps', lat: 50.45, lon: 30.52, zoom: null, bearing: 0,
        projection: 'webmercator', view_kind: 'street', geometry: false, scale_source: null,
      },
    });
    await settle();
    panel.$('[data-tab="pins"]').click();
    panel.press('pin-drop');
    hover({ x: 500, y: 300 });
    expect(ghost().style.display).toBe('none');
  });
});
