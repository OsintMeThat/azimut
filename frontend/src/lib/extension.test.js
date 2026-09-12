// Tests for the capture extension's background worker (extension/background.js).
//
// The worker is a classic MV3 script — no exports — so the suite evaluates its
// source with a stubbed `chrome` global and exercises the internals it returns.
// This keeps the extension test-covered from the existing frontend harness
// instead of a second npm project inside extension/.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
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
      // the map tools panel, when one is open on that tab
      sendMessage: vi.fn(async () => ({ ok: true })),
      create: vi.fn(async () => ({ id: 7 })),
      query: vi.fn(async () => [{ id: 11 }, { id: 12 }]),
      // the worker waits for "complete"; the stub says so on the next tick
      onUpdated: {
        addListener: vi.fn((cb) => setTimeout(() => cb(7, { status: 'complete' }), 0)),
        removeListener: vi.fn(),
      },
    },
    scripting: { executeScript: vi.fn() },
    notifications: { create: vi.fn() },
    // How the browser installed this copy. Needs no permission, and separates a
    // folder the app rewrites from a signed package it cannot touch.
    management: { getSelf: vi.fn(async () => ({ installType: 'development' })) },
    runtime: {
      getManifest: () => ({ version: '9.9.9' }),
      getURL: (p) => `chrome-extension://id/${p}`,
      onMessage: { addListener: vi.fn() },
      // the panels' end of the nudge stream: one port per open panel
      onConnect: { addListener: vi.fn() },
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
    `${source}\n;return { cropDataUrl, ingest, handle, settings, handOff, handOffReverse, loadedStamp, reattachBridge, frameEvent, panels, pumpEvents, stopEvents };`
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
      { tab: { id: 3, url: 'http://127.0.0.1:8477/', windowId: 7 } }
    );
    expect(res).toEqual({ ok: true, dataUrl: 'data:image/png;base64,xyz' });
    expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledWith(7, { format: 'png' });
  });

  it('takes the map tools panel out of the frame, and puts it back', async () => {
    // captureVisibleTab photographs the page as composited, injected chrome
    // included — a reference photograph floating over the map would land in the
    // case looking like part of the ground
    const order = [];
    const chrome = makeChrome();
    chrome.tabs.sendMessage = vi.fn(async (id, msg) => order.push(['tell', id, msg.hide]));
    chrome.tabs.captureVisibleTab = vi.fn(async () => {
      order.push(['grab']);
      return 'data:image/png;base64,xyz';
    });
    const { handle } = load({ chrome });

    await handle({ type: 'capture-tab' }, { tab: { id: 3, url: 'http://127.0.0.1:8477/', windowId: 7 } });
    expect(order).toEqual([['tell', 3, true], ['grab'], ['tell', 3, false]]);
  });

  it('captures a tab with no panel on it all the same', async () => {
    const chrome = makeChrome();
    // no listener on that tab: the browser rejects, and that is not an error
    chrome.tabs.sendMessage = vi.fn(async () => {
      throw new Error('Could not establish connection');
    });
    const { handle } = load({ chrome });
    const res = await handle(
      { type: 'capture-tab' },
      { tab: { id: 3, url: 'http://127.0.0.1:8477/', windowId: 7 } }
    );
    expect(res.ok).toBe(true);
  });

  it('rejects unknown message types', async () => {
    const { handle } = load({});
    const res = await handle({ type: 'nope' }, { tab: null });
    expect(res.ok).toBe(false);
  });
});

describe('the map tools panel’s own scripts', () => {
  it('injects files that exist, with the panel last', () => {
    // they are flat classic scripts sharing one scope: each reads the globals
    // the ones before it left, and a name that is not on disk fails as a panel
    // that simply never appears
    const listed = /const MAP_FILES = \[([\s\S]*?)\];/.exec(source)[1];
    const files = [...listed.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(files.at(-1)).toBe('mapoverlay.js');
    for (const name of files) {
      expect(existsSync(join(here, '../../../extension/', name)), name).toBe(true);
    }
  });
});

describe('handle: map-file (a picture for a reference window)', () => {
  const png = () => ({
    type: 'image/png',
    arrayBuffer: async () => new Uint8Array([0xff, 0x00, 0x10]).buffer,
  });

  it('reads one case file with the pairing token and carries it as base64', async () => {
    // a message carries a string, never a blob: the panel decodes it back into a
    // bitmap and paints it, which is what gets a picture past a map site's CSP
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, blob: async () => png() }));
    const { handle } = load({ fetchImpl });

    const res = await handle({ type: 'map-file', caseId: 'case-1', path: 'media/roof.png' }, {});
    expect(res).toEqual({ ok: true, file: { type: 'image/png', data: btoa('\xff\x00\x10') } });
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'http://127.0.0.1:8477/api/ingest/file?case_id=case-1&path=media%2Froof.png'
    );
    expect(fetchImpl.mock.calls[0][1].headers['X-Azimut-Token']).toBe('tok-123');
  });

  it('says which refusal it was, rather than leaving an empty window', async () => {
    // the app states the size ceiling itself, so its own sentence is passed
    // through rather than a second copy of the number kept over here
    for (const [status, body, message] of [
      [401, '', /pairing token rejected/],
      [413, '{"detail":"a handed-over file must be under 24 MB"}', /under 24 MB/],
      [404, 'not json at all', /refused that file \(404\)/],
    ]) {
      const fetchImpl = vi.fn(async () => ({ ok: false, status, text: async () => body }));
      const { handle } = load({ fetchImpl });
      const res = await handle({ type: 'map-file', caseId: 'case-1', path: 'media/roof.png' }, {});
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(message);
    }
  });

  it('refuses to ask for a file with no case open', async () => {
    const fetchImpl = vi.fn();
    const { handle } = load({ fetchImpl });
    const res = await handle({ type: 'map-file', caseId: '', path: 'media/roof.png' }, {});
    expect(res).toEqual({ ok: false, error: 'no case open' });
    expect(fetchImpl).not.toHaveBeenCalled();
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
    // Wait for the *filler* specifically. The worker also re-injects bridge.js
    // into the app's tabs when it starts, so "executeScript was called" is no
    // longer the same question as "the composer was filled".
    await settle(() =>
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
        expect.objectContaining({ world: 'MAIN', files: ['handoff.js'] })
      )
    );
    // paths become one token-bearing read each, against the app, not the page
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://127.0.0.1:8477/api/ingest/file?case_id=case-1&path=proofs%2Fstrike.png',
      { headers: { 'X-Azimut-Token': 'tok-123' } }
    );
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: payload.url, active: true });
    // Both injections in the page's own world: an editor ignores what an
    // extension's world makes, and there is no extension API on that side — so
    // the thread goes in on a global and the report comes back as a return value.
    const [setter, filler] = chrome.scripting.executeScript.mock.calls
      .map(([one]) => one)
      .filter((call) => call.world === 'MAIN');
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

describe('handOffReverse: opening an engine with the image', () => {
  const image = { name: 'reverse-bridge.png', type: 'image/png', data: btoa('\x89PNG') };
  const payload = { url: 'https://lens.google.com/', image };

  it('answers at once, then opens the engine and gives the page the image', async () => {
    const chrome = makeChrome();
    const { handOffReverse } = load({ chrome });
    chrome.scripting.executeScript = vi.fn(async () => [{ result: { handed: true } }]);

    // answered while the click is still fresh enough for the app to open the tab
    // itself if the answer had been no
    expect(await handOffReverse(payload)).toEqual({ ok: true, accepted: true });

    await settle(() =>
      expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
        expect.objectContaining({ world: 'MAIN', files: ['reverse.js'] })
      )
    );
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: payload.url, active: true });
    const [setter, filler] = chrome.scripting.executeScript.mock.calls
      .map(([one]) => one)
      .filter((call) => call.world === 'MAIN');
    // The image travels as base64 on a global, for the same two reasons the
    // thread does: an uploader ignores what an extension's world makes, and
    // nothing on that side can call an extension API.
    expect(setter.args).toEqual([{ image }]);
    expect(filler).toEqual({ target: { tabId: 7 }, world: 'MAIN', files: ['reverse.js'] });
  });

  it('needs no pairing, since the app sent the bytes rather than a path', async () => {
    const chrome = makeChrome();
    chrome.storage.local.get = vi.fn(async (d) => ({ ...d, token: '' }));
    const { handOffReverse } = load({ chrome });

    await expect(handOffReverse(payload)).resolves.toEqual({ ok: true, accepted: true });
  });

  it('refuses an image too large to carry into a page', async () => {
    const { handOffReverse } = load();
    const huge = { ...image, data: 'A'.repeat(29 * 1024 * 1024) };

    await expect(handOffReverse({ ...payload, image: huge })).rejects.toThrow(/too large/);
  });

  it('refuses a hand-off with nothing in it', async () => {
    const { handOffReverse } = load();

    await expect(handOffReverse({ url: payload.url })).rejects.toThrow(/no image/);
    await expect(handOffReverse({ image })).rejects.toThrow(/no engine/);
  });

  it('says what the engine would not take, since the app was answered long before', async () => {
    const chrome = makeChrome();
    const { handOffReverse } = load({ chrome });
    chrome.scripting.executeScript = vi.fn(async () => [
      { result: { handed: false, error: 'Could not give the image to this engine.' } },
    ]);

    await handOffReverse(payload);

    await settle(() =>
      expect(chrome.notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Could not give the image to this engine.'),
        })
      )
    );
  });

  it('tells the analyst to reload a copy loaded before it knew these engines', async () => {
    // A browser grants the manifest's hosts when it loads the copy, and an
    // extension cannot ask for one later — so the refusal is about a reload,
    // whatever wording the browser put on it.
    const chrome = makeChrome();
    const { handOffReverse } = load({ chrome });
    chrome.scripting.executeScript = vi.fn(async () => {
      throw new Error(
        'Cannot access contents of the page. Extension manifest must request permission to access the respective host.'
      );
    });

    await handOffReverse(payload);

    await settle(() =>
      expect(chrome.notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Reload it in your browser') })
      )
    );
  });

  it('refuses a hand-off asked for by anything but the local app', async () => {
    const { handle } = load();
    const res = await handle(
      { type: 'reverse-handoff', payload },
      { tab: { url: 'https://evil.example/' } }
    );
    expect(res.ok).toBe(false);
  });
});

// --- the update routes ---------------------------------------------------------
//
// What these pin is the difference between two claims the app must not confuse:
// the folder on disk (which the app has already rewritten by the time it asks)
// and the folder the *running* code was loaded from. Only the second one proves
// an update landed, and storage.session is what separates them.

const APP_TAB = { tab: { url: 'http://127.0.0.1:8477/', windowId: 1 } };
const STAMP = { install_id: 'abc123', version: '0.3.0', payload: 'digest-new' };

/** A chrome stub whose session storage behaves like the real one: it remembers. */
function stampChrome({ session = {}, stampOnDisk = STAMP, ok = true, management } = {}) {
  const store = { ...session };
  const chrome = makeChrome({
    ...(management === undefined ? {} : { management }),
    storage: {
      local: { get: vi.fn(async (d) => ({ ...d })), set: vi.fn() },
      session: {
        get: vi.fn(async (key) => (key in store ? { [key]: store[key] } : {})),
        set: vi.fn(async (patch) => Object.assign(store, patch)),
        remove: vi.fn(),
      },
    },
    runtime: {
      getManifest: () => ({ version: '0.3.0' }),
      getURL: (p) => `chrome-extension://theid/${p}`,
      id: 'theid',
      onMessage: { addListener: vi.fn() },
      onConnect: { addListener: vi.fn() },
      reload: vi.fn(),
    },
  });
  const fetchImpl = vi.fn(async () => ({ ok, json: async () => stampOnDisk }));
  return { chrome, fetchImpl, store };
}

describe('handle: ext-state', () => {
  it('refuses a page that is not the local app', async () => {
    const { chrome, fetchImpl } = stampChrome();
    const { handle } = load({ chrome, fetchImpl });
    const res = await handle({ type: 'ext-state' }, { tab: { url: 'https://evil.example/' } });
    expect(res.ok).toBe(false);
  });

  it('reports the running version, the extension id and the stamp it loaded from', async () => {
    const { chrome, fetchImpl } = stampChrome();
    const { handle } = load({ chrome, fetchImpl });
    const res = await handle({ type: 'ext-state' }, APP_TAB);
    expect(res).toEqual({
      ok: true,
      version: '0.3.0',
      extensionId: 'theid',
      loaded: STAMP,
      installType: 'development',
    });
    // Not `id`: the bridge spreads this answer next to the message's correlation
    // id, and a collision there would silently break every reply pairing.
    expect(res.id).toBeUndefined();
  });

  it('names a packaged copy as one the browser manages', async () => {
    // Firefox's permanent install is a signed XPI: no install.json to read, and
    // sealed. Without this the app would read it as a stale unzip and offer to
    // replace it with a folder Firefox forgets on the way out.
    const { chrome, fetchImpl } = stampChrome({
      ok: false,
      management: { getSelf: async () => ({ installType: 'normal' }) },
    });
    const { handle } = load({ chrome, fetchImpl });
    const res = await handle({ type: 'ext-state' }, APP_TAB);
    expect(res.installType).toBe('normal');
    expect(res.loaded).toBeNull();
  });

  it('answers null where the browser will not say', async () => {
    const { chrome, fetchImpl } = stampChrome({ management: {} });
    const { handle } = load({ chrome, fetchImpl });
    expect((await handle({ type: 'ext-state' }, APP_TAB)).installType).toBeNull();
  });

  it('answers from storage.session once seeded, so a rewritten folder cannot fake an update', async () => {
    // The stamp on disk is what the app just wrote; the session holds what this
    // code was loaded from. Reporting the former would always say "up to date".
    const { chrome, fetchImpl } = stampChrome({
      session: { loadedStamp: { install_id: 'abc123', payload: 'digest-old' } },
    });
    const { handle } = load({ chrome, fetchImpl });
    const res = await handle({ type: 'ext-state' }, APP_TAB);
    expect(res.loaded.payload).toBe('digest-old');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads install.json once per load and remembers a missing one', async () => {
    const { chrome, fetchImpl } = stampChrome({ ok: false });
    const { handle } = load({ chrome, fetchImpl });
    expect((await handle({ type: 'ext-state' }, APP_TAB)).loaded).toBeNull();
    expect((await handle({ type: 'ext-state' }, APP_TAB)).loaded).toBeNull();
    // `null` is a real answer and is stored as one, or every call re-reads a
    // file that is not there.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(chrome.storage.session.set).toHaveBeenCalledWith({ loadedStamp: null });
  });

  it('treats an unreadable install.json as no stamp', async () => {
    const { chrome } = stampChrome();
    const fetchImpl = vi.fn(async () => {
      throw new Error('nope');
    });
    const { handle } = load({ chrome, fetchImpl });
    expect((await handle({ type: 'ext-state' }, APP_TAB)).loaded).toBeNull();
  });
});

describe('handle: ext-reload', () => {
  it('answers before restarting, because the restart kills the reply', async () => {
    const { chrome, fetchImpl } = stampChrome();
    const { handle } = load({ chrome, fetchImpl });
    const res = await handle({ type: 'ext-reload', installId: 'abc123' }, APP_TAB);
    expect(res).toEqual({ ok: true, reloading: true });
    expect(chrome.runtime.reload).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 80));
    expect(chrome.runtime.reload).toHaveBeenCalled();
  });

  it('leaves another copy alone when the app names a different install', async () => {
    // Chrome derives the extension id from the folder path, so two copies can
    // be loaded at once. Restarting the wrong one looks exactly like a failed
    // update, and says nothing.
    const { chrome, fetchImpl } = stampChrome();
    const { handle } = load({ chrome, fetchImpl });
    const res = await handle({ type: 'ext-reload', installId: 'someone-else' }, APP_TAB);
    expect(res.ok).toBe(false);
    await new Promise((r) => setTimeout(r, 80));
    expect(chrome.runtime.reload).not.toHaveBeenCalled();
  });

  it('refuses a page that is not the local app', async () => {
    const { chrome, fetchImpl } = stampChrome();
    const { handle } = load({ chrome, fetchImpl });
    const res = await handle({ type: 'ext-reload' }, { tab: { url: 'https://evil.example/' } });
    expect(res.ok).toBe(false);
    expect(chrome.runtime.reload).not.toHaveBeenCalled();
  });
});

describe('reattachBridge', () => {
  it('re-injects the bridge into the app tabs, so an update needs no page reload', async () => {
    const { chrome, fetchImpl } = stampChrome();
    const { reattachBridge } = load({ chrome, fetchImpl });
    chrome.scripting.executeScript.mockResolvedValue([]);
    await reattachBridge();
    expect(chrome.tabs.query).toHaveBeenCalledWith({
      url: ['http://127.0.0.1/*', 'http://localhost/*'],
    });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 11 },
      files: ['bridge.js'],
    });
  });

  it('shrugs off a tab it may not inject', async () => {
    const { chrome, fetchImpl } = stampChrome();
    const { reattachBridge } = load({ chrome, fetchImpl });
    chrome.scripting.executeScript.mockRejectedValue(new Error('cannot access'));
    await expect(reattachBridge()).resolves.toBeUndefined();
  });
});

/**
 * The nudge stream, and the panels it is held open for.
 *
 * A panel drawn over someone else's map is working a case the app is also
 * writing to, and it cannot read the app's own channel: its fetch would carry
 * the map site's origin, which the app refuses. So this worker holds one stream
 * for every open panel (`api/events.py`, `/api/ingest/events`) and hands each
 * event over the port the panel opened.
 *
 * The stream stands in for the real one exactly where it matters: it never ends.
 * A reader parked on a `read()` that does not resolve is what the live one looks
 * like between two events, and it is the state the worker spends its life in.
 */
describe('the nudge stream', () => {
  /** A response whose body yields these frames and then holds, as the app's does. */
  function streaming(frames, { ok = true, status = 200 } = {}) {
    let at = 0;
    const encoder = new TextEncoder();
    return {
      ok,
      status,
      body: {
        getReader: () => ({
          read: () =>
            at < frames.length
              ? Promise.resolve({ value: encoder.encode(frames[at++]), done: false })
              : new Promise(() => {}), // open, waiting for the next event
        }),
      },
    };
  }

  /** One panel's end of the port. */
  function panel(name = 'map-sync') {
    const port = {
      name,
      heard: [],
      messages: [],
      disconnects: [],
      onMessage: { addListener: (cb) => port.messages.push(cb) },
      onDisconnect: { addListener: (cb) => port.disconnects.push(cb) },
      postMessage: vi.fn((msg) => port.heard.push(msg)),
    };
    return port;
  }

  /** The worker, with the listener the panels connect through. */
  function worker(fetchImpl, chrome = makeChrome()) {
    const loaded = load({ chrome, fetchImpl });
    return {
      ...loaded,
      connect: chrome.runtime.onConnect.addListener.mock.calls[0][0],
      /** A panel gone: its tab closed, or it was folded away. */
      leave: (port) => {
        for (const cb of port.disconnects) cb();
      },
    };
  }

  it('reads one event per frame and ignores the keepalive comments', () => {
    const { frameEvent } = load({});
    expect(frameEvent('data: {"type":"saved","case_id":"c1"}')).toEqual({
      type: 'saved',
      case_id: 'c1',
    });
    expect(frameEvent(': ping')).toBe(null);
    expect(frameEvent('data: not json at all')).toBe(null);
    expect(frameEvent('')).toBe(null);
  });

  it('hands every event to every panel, over one stream', async () => {
    const fetchImpl = vi.fn(async () =>
      streaming([': connected\n\n', 'data: {"type":"saved","case_id":"c1"}\n\n'])
    );
    const w = worker(fetchImpl);
    const a = panel();
    const b = panel();
    w.connect(a);
    w.connect(b);
    await vi.waitFor(() => expect(a.heard).toHaveLength(1));
    await vi.waitFor(() => expect(b.heard).toHaveLength(1));
    expect(a.heard[0]).toEqual({
      type: 'app-event',
      event: { type: 'saved', case_id: 'c1' },
    });
    // one bus, one request: ten tabs on one map are not ten streams
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:8477/api/ingest/events');
    expect(fetchImpl.mock.calls[0][1].headers['X-Azimut-Token']).toBe('tok-123');
    w.leave(a);
    w.leave(b);
  });

  it('reassembles an event split across two chunks', async () => {
    const fetchImpl = vi.fn(async () =>
      streaming(['data: {"type":"grid-marks","case', '_id":"c1","revision":4}\n\n'])
    );
    const w = worker(fetchImpl);
    const p = panel();
    w.connect(p);
    await vi.waitFor(() => expect(p.heard).toHaveLength(1));
    expect(p.heard[0].event).toEqual({ type: 'grid-marks', case_id: 'c1', revision: 4 });
    w.leave(p);
  });

  it('opens nothing until a panel asks, and lets go when the last one leaves', async () => {
    const fetchImpl = vi.fn(async () => streaming([': connected\n\n']));
    const w = worker(fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled(); // a worker with no panel holds no request
    const p = panel();
    w.connect(p);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const { signal } = fetchImpl.mock.calls[0][1];
    expect(signal.aborted).toBe(false);
    w.leave(p);
    expect(signal.aborted).toBe(true);
  });

  it('ignores a port that is not a panel', () => {
    const fetchImpl = vi.fn(async () => streaming([]));
    const w = worker(fetchImpl);
    w.connect(panel('something-else'));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('asks for nothing while the extension is unpaired', async () => {
    const chrome = makeChrome();
    chrome.storage.local.get = vi.fn(async (defaults) => ({
      ...defaults,
      backendUrl: 'http://127.0.0.1:8477',
      token: '',
    }));
    const fetchImpl = vi.fn(async () => streaming([]));
    const w = worker(fetchImpl, chrome);
    const p = panel();
    w.connect(p);
    await vi.waitFor(() => expect(chrome.storage.local.get).toHaveBeenCalled());
    expect(fetchImpl).not.toHaveBeenCalled();
    w.leave(p);
  });

  it('opens the stream again when a panel speaks on a port that outlived it', async () => {
    // an evicted worker comes back with the port but no stream: the panel's own
    // heartbeat is what tells it to look again
    const fetchImpl = vi.fn(async () => streaming([': connected\n\n']));
    const w = worker(fetchImpl);
    const p = panel();
    w.connect(p);
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    w.stopEvents();
    for (const cb of p.messages) cb({ type: 'watch' });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    w.leave(p);
  });
});
