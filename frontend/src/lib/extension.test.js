// Tests for the capture extension's background worker (extension/background.js).
//
// The worker is a classic MV3 script — no exports — so the suite evaluates its
// source with a stubbed `chrome` global and exercises the internals it returns.
// This keeps the extension test-covered from the existing frontend harness
// instead of a second npm project inside extension/.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../../../extension/background.js'), 'utf8');

function makeChrome(overrides = {}) {
  return {
    storage: {
      local: {
        get: vi.fn(async (defaults) => ({
          ...defaults,
          backendUrl: 'http://127.0.0.1:8477/',
          token: 'tok-123',
        })),
        set: vi.fn(),
      },
      session: { get: vi.fn(async () => ({})), set: vi.fn(), remove: vi.fn() },
    },
    tabs: { captureVisibleTab: vi.fn(async () => 'data:image/png;base64,xyz') },
    scripting: { executeScript: vi.fn() },
    notifications: { create: vi.fn() },
    runtime: {
      getManifest: () => ({ version: '9.9.9' }),
      getURL: (p) => `chrome-extension://id/${p}`,
      onMessage: { addListener: vi.fn() },
    },
    ...overrides,
  };
}

/** Evaluate background.js with stubs; returns its internal functions. */
function load({ chrome = makeChrome(), fetchImpl, imageBitmap, canvasLog } = {}) {
  const OffscreenCanvasStub = class {
    constructor(w, h) {
      canvasLog?.push({ canvas: [w, h] });
    }
    getContext() {
      return {
        drawImage: (...args) => canvasLog?.push({ drawImage: args.slice(1) }),
      };
    }
    convertToBlob({ type }) {
      return Promise.resolve({ type });
    }
  };
  const factory = new Function(
    'chrome',
    'browser',
    'fetch',
    'createImageBitmap',
    'OffscreenCanvas',
    `${source}\n;return { cropDataUrl, ingest, handle, settings };`
  );
  return factory(
    chrome,
    undefined,
    fetchImpl ?? vi.fn(),
    async () => imageBitmap ?? { width: 2000, height: 1200 },
    OffscreenCanvasStub
  );
}

describe('cropDataUrl', () => {
  let canvasLog;
  const fetchImpl = vi.fn(async () => ({ blob: async () => 'BLOB' }));
  beforeEach(() => {
    canvasLog = [];
    fetchImpl.mockClear();
  });

  it('scales the CSS-px rect by the measured image/viewport ratio', async () => {
    const { cropDataUrl } = load({ fetchImpl, canvasLog });
    // image 2000 px wide over a 1000 px viewport → scale 2
    const blob = await cropDataUrl('data:x', { x: 10, y: 20, w: 100, h: 50 }, 1000);
    expect(blob.type).toBe('image/png');
    expect(canvasLog).toContainEqual({ canvas: [200, 100] });
    expect(canvasLog).toContainEqual({ drawImage: [20, 40, 200, 100, 0, 0, 200, 100] });
  });

  it('clamps the crop to the captured frame', async () => {
    const { cropDataUrl } = load({ fetchImpl, canvasLog });
    // rect runs past the right edge: sw shrinks to what the image has left
    await cropDataUrl('data:x', { x: 950, y: 0, w: 100, h: 50 }, 1000);
    expect(canvasLog).toContainEqual({ drawImage: [1900, 0, 100, 100, 0, 0, 100, 100] });
  });

  it('refuses a selection smaller than 8 px on either side', async () => {
    const { cropDataUrl } = load({ fetchImpl, canvasLog });
    await expect(cropDataUrl('data:x', { x: 0, y: 0, w: 2, h: 50 }, 1000)).rejects.toThrow(
      /selection too small/
    );
  });
});

describe('ingest', () => {
  const meta = { url: 'https://www.google.com/maps/@48.85,2.29,17z', caseId: '' };
  const blob = new Blob(['\x89PNG'], { type: 'image/png' }); // a real Blob: FormData.append rejects a bare string

  it('posts the form the API expects and remembers the filed case', async () => {
    const chrome = makeChrome();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ case_id: 'scratch_fresh1', title: 'T', path: 'media/x.png' }),
    }));
    const { ingest } = load({ chrome, fetchImpl });

    await ingest(blob, { ...meta, title: 'Spot', lat: 48.85, lon: 2.29 });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:8477/api/ingest/screenshot'); // trailing slash trimmed
    expect(options.headers['X-Azimut-Token']).toBe('tok-123');
    const form = options.body;
    expect(form.get('url')).toBe(meta.url);
    expect(form.get('case_id')).toBe('');
    expect(form.get('title')).toBe('Spot');
    expect(form.get('lat')).toBe('48.85');
    expect(form.get('extension')).toBe('9.9.9');
    expect(form.has('site')).toBe(false); // the URL is the source of truth

    // a capture into "new scratch" must reuse that scratch next time
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ lastCaseId: 'scratch_fresh1' });
  });

  it('fails up front when unpaired', async () => {
    const chrome = makeChrome();
    chrome.storage.local.get = vi.fn(async (d) => ({ ...d, token: '' }));
    const { ingest } = load({ chrome });
    await expect(ingest(blob, meta)).rejects.toThrow(/not paired/);
  });

  it('maps a 401 to a re-pair message', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401 }));
    const { ingest } = load({ fetchImpl });
    await expect(ingest(blob, meta)).rejects.toThrow(/pairing token rejected/);
  });
});

describe('handle: capture-tab (the app relay)', () => {
  it('refuses a page that is not the local app', async () => {
    const { handle } = load({});
    const res = await handle(
      { type: 'capture-tab' },
      { tab: { url: 'https://evil.example/', windowId: 1 } }
    );
    expect(res.ok).toBe(false);
  });

  it('captures for the localhost app tab', async () => {
    const chrome = makeChrome();
    const { handle } = load({ chrome });
    const res = await handle(
      { type: 'capture-tab' },
      { tab: { url: 'http://127.0.0.1:8477/', windowId: 7 } }
    );
    expect(res).toEqual({ ok: true, dataUrl: 'data:image/png;base64,xyz' });
    expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledWith(7, { format: 'png' });
  });

  it('rejects unknown message types', async () => {
    const { handle } = load({});
    const res = await handle({ type: 'nope' }, { tab: null });
    expect(res.ok).toBe(false);
  });
});
