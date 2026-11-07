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
const BRIDGE = row('sc_2', 238, 252, 'bridge?', { state: 'progress', captures: ['media/c1.png', 'media/c2.png'] });
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
});

let panel = null;

afterEach(() => {
  panel?.close();
  panel = null;
  document.documentElement.querySelectorAll('#azimut-map-tools').forEach((node) => node.remove());
});

/** A panel over OpenStreetMap, with the app answering `answers` (a value, or a
 *  function of the message for a route whose answer depends on what was sent). */
function open(answers = {}) {
  window.happyDOM.setViewport({ width: 1400, height: 900 });
  const location = { href: 'https://www.openstreetmap.org/#map=17/50.45/30.52', host: 'www.openstreetmap.org' };
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
  const ports = [];
  const handed = []; // what Make the proof handed the worker
  let proof = { ok: true };
  const api = {
    storage: { local: { get: vi.fn(async (defaults) => ({ ...defaults })), set: vi.fn() } },
    runtime: {
      onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
      sendMessage: vi.fn(async (message) => {
        if (message.type === 'map-file') return { ok: true, file: { type: 'video/mp4', data: '', next: null, total: 0 } };
        if (message.type === 'scene-proof') {
          handed.push(message);
          return typeof proof === 'function' ? proof(message) : proof;
        }
        if (message.type !== 'map-api') return { ok: true, data: {} };
        asked.push(message);
        const answer = app[message.path];
        if (answer instanceof Error) return { ok: false, error: answer.message };
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
    $,
    $$: (selector) => [...root.querySelectorAll(selector)],
    calls: (path) => asked.filter((m) => m.path === path),
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
  it('reads the case’s queue when the case is picked, and folds it to one line', async () => {
    panel = open();
    await settle();
    expect(panel.calls('/api/ingest/scenes').map((m) => m.query)).toEqual([{ case_id: CASE }]);
    const fold = panel.$('[data-act="geo-fold"]');
    // the abandoned stay in the app's To-do; here only what is left to geolocate
    expect(fold.textContent).toBe('To geolocate2');
    expect(fold.getAttribute('aria-expanded')).toBe('false');
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

  it('unfolds by file, each scene with its time, name and state, read afresh', async () => {
    panel = open();
    await settle();
    panel.forget();
    panel.press('geo-fold');
    await settle();
    expect(panel.calls('/api/ingest/scenes')).toHaveLength(1);
    expect(panel.$('.geo-file').textContent).toBe('Market walk');
    const rows = panel.$$('.geo-row').map((el) => [el.querySelector('.geo-name').textContent, el.querySelector('.geo-meta').textContent]);
    expect(rows).toEqual([
      ['Whole video', 'To geolocate'],
      ['bridge?', '3:58–4:12 · In progress · 2 captures'],
    ]);
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
    panel.press('geo-fold');
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
    panel.press('geo-fold');
    await settle();
  }

  it('reads as a picture: Whole picture, and no mark', async () => {
    await unfolded();
    const rows = panel.$$('.geo-row').map((el) => [el.querySelector('.geo-name').textContent, el.querySelector('.geo-meta').textContent]);
    expect(rows).toEqual([
      ['Harbour wall', 'Whole picture · To geolocate'],
      ['Whole picture', 'To geolocate'],
    ]);
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
    panel.press('geo-fold');
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
    // the choice is made: the list folds away behind the pill
    expect(panel.$('[data-act="geo-fold"]').getAttribute('aria-expanded')).toBe('false');
  });

  it('shows a pill with the scene, its captures and a way to stop', async () => {
    await geolocateBridge();
    const pill = panel.$('.geo-pill');
    expect(pill.querySelector('.geo-what').textContent).toBe('Geolocating · 3:58–4:12 · bridge?');
    expect(pill.querySelector('.geo-count').textContent).toBe('2');
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
    expect(live.querySelector('.geo-meta').textContent).toBe('3:58–4:12 · Geolocating · 2 captures');
  });

  it('says why when the app refuses, and reads the queue again', async () => {
    panel = open({ '/api/ingest/geolocating': new Error('a proof already geolocates that scene') });
    await settle();
    panel.press('geo-fold');
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

describe('in step with the app', () => {
  it('reads the queue again when the app says the scene being geolocated changed', async () => {
    panel = open();
    await settle();
    panel.forget();
    panel.app['/api/ingest/scenes'] = { ...structuredClone(QUEUE), geolocating: { ...BRIDGE, captures: ['a', 'b', 'c'] } };
    panel.nudge({ type: 'geolocating', case_id: CASE, video: VIDEO, draft: 'sc_2' });
    await settle();
    expect(panel.calls('/api/ingest/scenes')).toHaveLength(1);
    expect(panel.$('.geo-pill .geo-count').textContent).toBe('3');
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
  const count = () => panel.$('.geo-pill .geo-count');
  const captured = (n) => Array.from({ length: n }, (_, i) => `media/c${i + 1}.png`);

  it('counts the capture attached at once, with a pulse, before the queue answers', async () => {
    const later = await heldBack();
    expect(count().textContent).toBe('2');
    expect(count().classList.contains('bump')).toBe(false);
    panel.nudge({ type: 'geolocating', case_id: CASE, video: VIDEO, draft: 'sc_2', capture: 'media/c3.png', captures: 3 });
    expect(count().textContent).toBe('3');
    expect(count().classList.contains('bump')).toBe(true);
    expect(count().getAttribute('aria-label')).toBe('3 captures');
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
    expect(panel.$('.geo-row.live .geo-meta').textContent).toBe('3:58–4:12 · Geolocating · 3 captures');
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
