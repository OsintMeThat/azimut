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
    tabs: {
      captureVisibleTab: vi.fn(async () => 'data:image/png;base64,xyz'),
      create: vi.fn(async () => ({ id: 7 })),
      // the worker waits for "complete"; the stub says so on the next tick
      onUpdated: {
        addListener: vi.fn((cb) => setTimeout(() => cb(7, { status: 'complete' }), 0)),
        removeListener: vi.fn(),
      },
    },
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
    'btoa',
    `${source}\n;return { cropDataUrl, ingest, handle, settings, handOff };`
  );
  return factory(
    chrome,
    undefined,
    fetchImpl ?? vi.fn(),
    async () => imageBitmap ?? { width: 2000, height: 1200 },
    OffscreenCanvasStub,
    btoa // the real one: what a handed-over file carries is the assertion
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

/** The fill runs after the answer, so the assertions on it wait for the effect. */
async function settle(fn, tries = 50) {
  for (let i = 0; i < tries; i += 1) {
    try {
      return fn();
    } catch {
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  return fn();
}

describe('handOff: filling a composer the app prepared', () => {
  const payload = {
    url: 'https://x.com/compose/post?text=Geolocated',
    caseId: 'case-1',
    posts: [{ text: 'Geolocated', files: ['proofs/strike.png'] }, { text: 'Context', files: [] }],
  };

  /** A paired chrome. */
  function fillingChrome() {
    const chrome = makeChrome();
    chrome.storage.local.get = vi.fn(async (d) => ({
      ...d, backendUrl: 'http://127.0.0.1:8477', token: 'tok-123',
    }));
    return chrome;
  }

  const attachment = () => ({
    ok: true,
    blob: async () => ({ type: 'image/png', arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }),
  });

  it('reads each attachment with the pairing token, then fills the tab it opened', async () => {
    const chrome = fillingChrome();
    const fetchImpl = vi.fn(async () => attachment());
    const { handOff } = load({ chrome, fetchImpl });
    chrome.scripting.executeScript = vi.fn(async () => [{ result: { filled: 2 } }]);

    const res = await handOff(payload);

    // answered on three cheap checks, while the click is still fresh enough for
    // the app to open a tab if the answer had been no
    expect(res).toEqual({ ok: true, accepted: true });
    await settle(() => expect(chrome.scripting.executeScript).toHaveBeenCalled());
    // paths become one token-bearing read each, against the app, not the page
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:8477/api/ingest/file?case_id=case-1&path=proofs%2Fstrike.png',
      { headers: { 'X-Azimut-Token': 'tok-123' } }
    );
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: payload.url, active: true });
    // Both injections in the page's own world: an editor ignores what an
    // extension's world makes, and there is no extension API on that side — so
    // the thread goes in on a global and the report comes back as a return value.
    const [setter, filler] = chrome.scripting.executeScript.mock.calls.map(([one]) => one);
    expect(setter.world).toBe('MAIN');
    // The file crosses as plain base64, never as a `data:` URL: the page rebuilds
    // it with atob, because a fetch on that side answers to the site's own CSP —
    // and X allows no connection to `data:`, so every attachment came back
    // "Failed to fetch" and took the rest of the thread with it.
    const [{ posts }] = setter.args;
    expect(posts).toHaveLength(2);
    expect(posts[0].files).toEqual([
      { name: 'strike.png', type: 'image/png', data: btoa('\x01\x02\x03') },
    ]);
    expect(filler).toEqual({ target: { tabId: 7 }, world: 'MAIN', files: ['handoff.js'] });
  });

  it('refuses an unpaired extension, which cannot read the files anyway', async () => {
    const chrome = makeChrome();
    chrome.storage.local.get = vi.fn(async (d) => ({ ...d, token: '' }));
    const { handOff } = load({ chrome });
    await expect(handOff(payload)).rejects.toThrow(/not paired/);
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  it('keeps no switch of its own: the one in Azimut is the whole answer', () => {
    // Two boxes for one question is a pair that can disagree, and the one that
    // says no is the one nobody thinks to look at.
    expect(source).not.toContain('handoff: false');
    expect(source).not.toContain('permissions.contains');
  });

  it('skips a file the app will not hand over instead of losing the thread', async () => {
    const chrome = fillingChrome();
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 413 }));
    const { handOff } = load({ chrome, fetchImpl });
    chrome.scripting.executeScript = vi.fn(async () => [{ result: { filled: 2 } }]);

    await expect(handOff(payload)).resolves.toEqual({ ok: true, accepted: true });
    // and it says so, because a picture missing from a published thread is not
    // something to discover after posting
    await settle(() => expect(chrome.notifications.create).toHaveBeenCalled());
  });

  it('says what the fill could not do, since the app was answered long before', async () => {
    const chrome = fillingChrome();
    const { handOff } = load({ chrome, fetchImpl: vi.fn(async () => attachment()) });
    chrome.scripting.executeScript = vi.fn(async () => [
      { result: { filled: 1, error: 'Post 2 stayed empty.' } },
    ]);

    await handOff(payload);

    await settle(() =>
      expect(chrome.notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Post 2 stayed empty.') })
      )
    );
  });

  it('refuses a hand-off asked for by anything but the local app', async () => {
    const { handle } = load({ chrome: fillingChrome() });
    const res = await handle(
      { type: 'post-handoff', payload },
      { tab: { url: 'https://evil.example/' } }
    );
    expect(res.ok).toBe(false);
  });
});
