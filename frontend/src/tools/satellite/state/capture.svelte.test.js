// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCaptureState, PRESETS, RATIOS } from './capture.svelte.js';

/**
 * What a capture records, and what it refuses to record.
 *
 * The sizing arithmetic (lib/captureSize.js) and the crop registration
 * (lib/screenCrop.js) have their own tests. What is asserted here is the part
 * that makes a capture evidence: which provider the pixels are filed under,
 * which road they came down, and every case where the answer is "no" rather
 * than a picture that overstates itself.
 */

const TILES = { id: 'esri-world-imagery', label: 'Esri', max_zoom: 19 };
const WIDGET = { id: 'gmaps-satellite', label: 'Google', widget: true, capturable: false };
const VIEW_ONLY = { id: 'osm', label: 'OSM', capturable: false };

const HERE = { lat: 48.85, lon: 2.35, zoom: 16 };

let api;
let notify;
let reloadCase;
let engine;
let element;
let basemap;
let pin;
let pixels;
let rects;
let armedOff;
let extension;

vi.mock('../../../lib/extBridge.js', () => ({
  extensionVersion: () => extension,
  captureTab: () => Promise.reject(new Error('no extension here')),
}));

function store(overrides = {}) {
  return createCaptureState({
    api,
    notify,
    ensureCase: async () => ({ id: 'case-1' }),
    reloadCase,
    engine: () => engine,
    element: () => element,
    view: () => HERE,
    bearing: () => 30,
    marker: () => pin,
    basemap: () => basemap,
    maxZoom: () => basemap?.max_zoom ?? 19,
    provenance: () => pixels,
    onRect: (rect) => rects.push(rect),
    onArm: () => (armedOff += 1),
    ...overrides,
  });
}

beforeEach(() => {
  api = { post: vi.fn(async () => ({})) };
  notify = vi.fn();
  reloadCase = vi.fn(async () => {});
  engine = {
    camera: () => HERE,
    latLngToContainerPoint: ({ lat, lon }) => ({ x: lon * 100, y: lat * 100 }),
    containerPointToLatLng: ({ x, y }) => ({ lat: y / 100, lon: x / 100 }),
  };
  element = { getBoundingClientRect: () => ({ x: 0, y: 0, width: 1600, height: 900 }) };
  basemap = TILES;
  pin = { style: 'crosshair', at: null };
  pixels = { provider: 'esri-world-imagery', imageryDate: '2024-05-01' };
  rects = [];
  armedOff = 0;
  extension = '1.0.0';
});

describe('the output shape', () => {
  it('starts on a preset, and reads its size off the catalogue', () => {
    const capture = store();
    const chosen = PRESETS.find((entry) => entry.id === capture.preset);
    expect(capture.size).toEqual([chosen.w, chosen.h]);
  });

  it('clamps a custom size to what the backend will take', () => {
    const capture = store();
    capture.preset = 'custom';
    capture.customW = 99999;
    capture.customH = 4;
    const [w, h] = capture.size;
    expect(w).toBeLessThanOrEqual(4096);
    expect(h).toBeGreaterThanOrEqual(256);
  });

  it('drags free-form until a ratio is locked', () => {
    const capture = store();
    expect(capture.lock).toBe(null);
    capture.ratio = '16:9';
    expect(capture.lock).toBeCloseTo(16 / 9);
    expect(RATIOS.find((entry) => entry.id === '1:1').r).toBe(1);
  });
});

describe('which road the pixels come down', () => {
  it('stitches tiles for an ordinary basemap', async () => {
    const capture = store();
    capture.run();
    await vi.waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0][0]).toBe('/api/cases/case-1/satellite/capture');
  });

  it('refuses outright on a view-only basemap', () => {
    basemap = VIEW_ONLY;
    const capture = store();
    expect(capture.blocked).toBe(true);
    capture.run();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('treats a widget basemap as capturable, just down the other road', () => {
    basemap = WIDGET;
    const capture = store();
    // capturable=false on the catalogue entry, but the button still works
    expect(capture.widget).toBe(true);
    expect(capture.blocked).toBe(false);
  });

  it('explains the missing extension before drawing any frame', () => {
    basemap = WIDGET;
    extension = null;
    const capture = store();
    capture.run();
    expect(capture.extGate).toBe(true);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('never files a tile capture for a widget basemap', async () => {
    basemap = WIDGET;
    const capture = store();
    capture.run();
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    // the grab fails in this harness; what matters is which route it took
    expect(api.post).not.toHaveBeenCalled();
  });
});

describe('what a capture records', () => {
  it('files the provider that drew the pixels, not the one that was chosen', async () => {
    // the analyst picked a billed basemap; eco swapped in free imagery
    basemap = { id: 'bing-aerial', label: 'Bing', max_zoom: 19 };
    pixels = { provider: 'esri-world-imagery', imageryDate: '2023-01-01' };
    const capture = store();
    capture.run();
    await vi.waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0][1].provider).toBe('esri-world-imagery');
  });

  it('carries the imagery acquisition date beside the capture date', async () => {
    const capture = store();
    capture.run();
    await vi.waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0][1].imagery_date).toBe('2024-05-01');
  });

  it('records the frame centre when no pin was moved', async () => {
    const capture = store();
    capture.run();
    await vi.waitFor(() => expect(api.post).toHaveBeenCalled());
    const body = api.post.mock.calls[0][1];
    expect([body.marker_lat, body.marker_lon]).toEqual([HERE.lat, HERE.lon]);
    expect([body.marker_x, body.marker_y]).toEqual([0, 0]);
  });

  it('records the moved pin, and where it sits inside the crop', async () => {
    pin = { style: 'pin', at: { lat: 48.9, lon: 2.4 } };
    const capture = store();
    capture.run();
    await vi.waitFor(() => expect(api.post).toHaveBeenCalled());
    const body = api.post.mock.calls[0][1];
    expect(body.marker_lat).toBe(48.9);
    expect(body.marker_style).toBe('pin');
    // the pin is north-east of centre, so it is offset from it
    expect(body.marker_x).not.toBe(0);
  });

  it('keeps the bearing, so a turned map is filed turned', async () => {
    const capture = store();
    capture.run();
    await vi.waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(api.post.mock.calls[0][1].bearing).toBe(30);
  });

  it('re-reads the case, so the panel shows what was just filed', async () => {
    const capture = store();
    capture.run();
    await vi.waitFor(() => expect(reloadCase).toHaveBeenCalled());
  });
});

describe('when a capture is imperfect', () => {
  it('says how many tiles were missing rather than filing quietly', async () => {
    api.post = vi.fn(async () => ({ tiles_missing: 3 }));
    const capture = store();
    capture.run();
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    expect(notify.mock.calls[0][0]).toContain('3 missing tile');
    expect(notify.mock.calls[0][1]).toBe('warn');
  });

  it('says when tiles were upscaled, since that is in the provenance too', async () => {
    api.post = vi.fn(async () => ({ tiles_upscaled: 2 }));
    const capture = store();
    capture.run();
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    expect(notify.mock.calls[0][0]).toContain('upscaled');
    expect(notify.mock.calls[0][1]).toBe('warn');
  });

  it('names the failure and files nothing', async () => {
    api.post = vi.fn(async () => {
      throw new Error('disk full');
    });
    const capture = store();
    capture.run();
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    expect(notify.mock.calls[0][0]).toContain('disk full');
    expect(notify.mock.calls[0][1]).toBe('danger');
    expect(capture.busy).toBe(false);
  });

  it('takes one capture at a time, so a double press files one crop', async () => {
    let release;
    api.post = vi.fn(() => new Promise((resolve) => (release = () => resolve({}))));
    const capture = store();
    capture.run();
    await vi.waitFor(() => expect(capture.busy).toBe(true));
    capture.run();
    expect(api.post).toHaveBeenCalledTimes(1);
    release();
  });
});

describe('the marquee', () => {
  it('arming it turns off whatever else owns the left button', () => {
    const capture = store();
    expect(capture.toggleSelect()).toBe(true);
    expect(armedOff).toBe(1);
  });

  it('arming it shuts the settings popover, which would cover the map', () => {
    const capture = store();
    capture.menuOpen = true;
    capture.toggleSelect();
    expect(capture.menuOpen).toBe(false);
  });

  it('disarming clears the outline it left on the map', () => {
    const capture = store();
    capture.toggleSelect();
    capture.toggleSelect();
    expect(capture.armed).toBe(false);
    expect(rects.at(-1)).toBe(null);
  });

  it('stands down for another mode without claiming anything back', () => {
    const capture = store();
    capture.toggleSelect();
    armedOff = 0;
    capture.disarm();
    expect(capture.armed).toBe(false);
    expect(armedOff).toBe(0); // it is the arriving mode that says what it turns off
  });

  it('ignores a drag while it is not armed', () => {
    const capture = store();
    capture.startSelect({ button: 0 });
    expect(rects).toEqual([]);
  });

  it('ignores anything but the left button', () => {
    const capture = store();
    capture.toggleSelect();
    capture.startSelect({ button: 1 });
    expect(rects).toEqual([]);
  });

  it('runs the marquee, not the centred frame, when that is the mode', () => {
    const capture = store();
    capture.mode = 'select';
    capture.run();
    expect(capture.armed).toBe(true);
    expect(api.post).not.toHaveBeenCalled(); // the box has still to be drawn
  });
});

describe('the paste fallback', () => {
  it('says why the screen grab is unavailable and leaves the paste path open', async () => {
    const capture = store();
    expect(await capture.grabView()).toBe(null);
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Paste a screenshot instead'),
      'warn',
      6000
    );
  });

  it('files a pasted image at the map view, marked as unframed', async () => {
    const capture = store();
    expect(await capture.fileBlob(new Blob(['x']))).toBe(true);
    const [path, form] = api.post.mock.calls[0];
    expect(path).toBe('/api/cases/case-1/satellite/screenshot');
    expect(form.get('framed')).toBe('false');
    expect(form.get('lat')).toBe(String(HERE.lat));
  });

  it('reports a filing failure rather than pretending it landed', async () => {
    api.post = vi.fn(async () => {
      throw new Error('refused');
    });
    const capture = store();
    expect(await capture.fileBlob(new Blob(['x']))).toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('refused'), 'danger', 6000);
  });
});
