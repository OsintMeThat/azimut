// Tests for the notes panel's side of the capture extension's worker
// (extension/background.js, "the notes panel").
//
// Like extension.test.js next door, the worker is a classic script with no
// exports: the suite evaluates the panel's helpers (extension/notesmsg.js) and
// the worker together, with a stubbed `chrome`, and drives the right-click items
// and the panel's port by hand.
//
// What is worth pinning: the items exist only while a panel holds a note; a
// click reaches the note through the panel, never anywhere else; captures stay
// maps only, and file only the area the user drags; only the panel page may ask
// the worker to read a tab; and a browser's refusal reaches the panel as what to
// do instead, never in the browser's own words.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ext = join(here, '../../../extension');
const helpers = readFileSync(join(ext, 'notesmsg.js'), 'utf8');
const worker = readFileSync(join(ext, 'background.js'), 'utf8');

const PANEL = { url: 'chrome-extension://id/notes.html' };
const ARTICLE = { id: 5, windowId: 1, url: 'https://example.com/story', title: 'A story' };
const MAP = { id: 6, windowId: 1, url: 'https://www.google.com/maps/@48.85,2.29,17z', title: 'Google Maps' };

/** Chrome's words for a capture without a click on the page, and for a script on a page it keeps. */
const NO_CAPTURE = "Either the '<all_urls>' or 'activeTab' permission is required.";
const NO_SCRIPT = 'Cannot access contents of the page. Extension manifest must request permission to access the respective host.';

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
};

function event() {
  const listeners = [];
  return {
    listeners,
    addListener: vi.fn((cb) => listeners.push(cb)),
    fire: (...args) => listeners.map((cb) => cb(...args)),
  };
}

/** A worker with stubs, and handles on what it did. */
function load({ front = ARTICLE, answers = {}, selection = '', stored = {}, inject = null, capture = null } = {}) {
  const items = new Map();
  const session = new Map();
  const drawn = [];
  const on = {
    connect: event(),
    message: event(),
    clicked: event(),
    activated: event(),
    updated: event(),
    focus: event(),
  };
  const chrome = {
    storage: {
      local: {
        get: vi.fn(async (defaults) => ({
          ...defaults,
          backendUrl: 'http://127.0.0.1:18999',
          token: 'tok-123',
          ...stored,
        })),
        set: vi.fn(),
      },
      session: {
        get: vi.fn(async (keys) => {
          if (typeof keys === 'string') return session.has(keys) ? { [keys]: session.get(keys) } : {};
          const out = { ...(keys || {}) };
          for (const key of Object.keys(out)) if (session.has(key)) out[key] = session.get(key);
          return out;
        }),
        set: vi.fn(async (values) => {
          for (const [key, value] of Object.entries(values)) session.set(key, value);
        }),
        remove: vi.fn(async (key) => {
          session.delete(key);
        }),
      },
    },
    tabs: {
      query: vi.fn(async () => (front ? [front] : [])),
      captureVisibleTab: vi.fn(async () => {
        if (capture) throw capture;
        return 'data:image/png;base64,AA';
      }),
      sendMessage: vi.fn(async () => ({ ok: true })),
      onActivated: on.activated,
      onUpdated: on.updated,
      onRemoved: event(),
    },
    windows: { onFocusChanged: on.focus },
    scripting: {
      executeScript: vi.fn(async ({ func, files }) => {
        if (files) {
          if (inject) throw inject;
          return [{ result: undefined }];
        }
        const said = String(func);
        if (said.includes('getSelection')) {
          if (selection instanceof Error) throw selection;
          return [{ result: selection }];
        }
        if (said.includes('innerWidth')) return [{ result: { w: 1000, h: 600 } }];
        return [{ result: null }];
      }),
    },
    notifications: { create: vi.fn() },
    management: { getSelf: vi.fn(async () => ({ installType: 'development' })) },
    contextMenus: {
      create: vi.fn((props, cb) => {
        items.set(props.id, { ...props });
        cb?.();
        return props.id;
      }),
      update: vi.fn((id, props, cb) => {
        Object.assign(items.get(id), props);
        cb?.();
      }),
      removeAll: vi.fn((cb) => {
        items.clear();
        cb?.();
      }),
      onClicked: on.clicked,
    },
    runtime: {
      getManifest: () => ({ version: '9.9.9' }),
      getURL: (p) => `chrome-extension://id/${p}`,
      onMessage: on.message,
      onConnect: on.connect,
    },
  };
  const fetchImpl = vi.fn(async (url, init) => {
    const address = String(url);
    for (const [fragment, answer] of Object.entries(answers)) {
      if (address.includes(fragment)) return answer(address, init);
    }
    throw new Error(`unexpected fetch ${address}`);
  });
  const OffscreenCanvasStub = class {
    constructor(w, h) {
      this.size = [w, h];
    }
    getContext() {
      return { drawImage: (...args) => drawn.push({ size: this.size, from: args.slice(1, 5) }) };
    }
    convertToBlob({ type }) {
      return Promise.resolve(new Blob(['png'], { type }));
    }
  };
  const factory = new Function(
    'chrome',
    'browser',
    'fetch',
    'createImageBitmap',
    'OffscreenCanvas',
    `${helpers}\n${worker}\n;return { handle };`
  );
  const internals = factory(chrome, undefined, fetchImpl, async () => ({ width: 2000, height: 1200 }), OffscreenCanvasStub);
  return { chrome, items, on, fetchImpl, session, drawn, ...internals };
}

/** A port as the panel page opens it. */
function connect(on, sender = PANEL) {
  const port = {
    name: 'notes-panel',
    sender,
    sent: [],
    onMessage: event(),
    onDisconnect: event(),
    postMessage: vi.fn((msg) => port.sent.push(msg)),
    disconnect: vi.fn(),
  };
  on.connect.fire(port);
  return port;
}

const ready = (port, extra = {}) =>
  port.onMessage.fire({ type: 'state', windowId: 1, ready: true, caseId: 'case-1', ...extra });

const json = (body) => () => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body });

/** A worker whose front tab is a map the app knows. */
const mapRun = ({ screenshot = { entity_id: 'cap_42', case_id: 'case-1', title: '48.85, 2.29' }, ...rest } = {}) =>
  load({
    front: MAP,
    answers: {
      '/api/ingest/parse': json({ site: 'google-maps', lat: 48.85, lon: 2.29, zoom: 17, bearing: null }),
      '/api/ingest/screenshot': json(screenshot),
      'data:image': () => ({ blob: async () => new Blob(['frame']) }),
    },
    ...rest,
  });

/** Whether the area selection was drawn on a tab. */
const drawsSelection = (run) =>
  run.chrome.scripting.executeScript.mock.calls.some(([call]) => call.files?.includes('overlay.js'));

/** The capture filed with the app, as `[url, init]`, or undefined. */
const filed = (run) => run.fetchImpl.mock.calls.find(([url]) => String(url).includes('/api/ingest/screenshot'));

describe('the right-click items', () => {
  it('stay down while no panel holds a note, and clear what an earlier worker left', async () => {
    const { chrome, items, on } = load();
    await settle();
    expect(chrome.contextMenus.removeAll).toHaveBeenCalled();
    connect(on);
    await settle();
    expect(items.size).toBe(0);
  });

  it('come up when a panel holds a note, and go with it', async () => {
    const { items, on } = load();
    const port = connect(on);
    ready(port);
    await settle();
    expect([...items.keys()]).toEqual(['azimut-note-cite', 'azimut-note-quote', 'azimut-note-capture']);
    expect(items.get('azimut-note-cite').title).toBe('Cite this page');
    expect(items.get('azimut-note-quote')).toMatchObject({ title: 'Quote the selection', contexts: ['selection'] });
    expect(items.get('azimut-note-capture').title).toBe('Capture into the note');
    // web pages only: nothing on the browser's own pages or a local file
    for (const item of items.values()) expect(item.documentUrlPatterns).toEqual(['http://*/*', 'https://*/*']);

    port.onMessage.fire({ type: 'state', windowId: 1, ready: false });
    await settle();
    expect(items.size).toBe(0);

    ready(port);
    await settle();
    expect(items.size).toBe(3);
    port.onDisconnect.fire();
    await settle();
    expect(items.size).toBe(0);
  });

  it('are created once when two panels speak at once', async () => {
    const { chrome, on } = load();
    const one = connect(on);
    const two = connect(on);
    ready(one);
    ready(two, { windowId: 2 });
    await settle();
    expect(chrome.contextMenus.create).toHaveBeenCalledTimes(3);
  });

  it('answer no port but the panel page', async () => {
    const { items, on } = load();
    // a content script on some site, connecting under the panel's port name
    const port = connect(on, { tab: { id: 9 }, url: 'https://evil.example/' });
    expect(port.disconnect).toHaveBeenCalled();
    ready(port);
    await settle();
    expect(items.size).toBe(0);
  });

  it('read "Cite this post" while a post is in front, and follow the tab', async () => {
    const run = load({ front: { ...ARTICLE, url: 'https://x.com/someone/status/123' } });
    const port = connect(run.on);
    ready(port);
    await settle();
    expect(run.items.get('azimut-note-cite').title).toBe('Cite this post');

    run.chrome.tabs.query.mockImplementation(async () => [ARTICLE]);
    run.on.activated.fire({ tabId: 5, windowId: 1 });
    await settle();
    expect(run.items.get('azimut-note-cite').title).toBe('Cite this page');
  });
});

describe('a right-click', () => {
  it('cites the page through the panel of its window', async () => {
    const { on } = load();
    const port = connect(on);
    ready(port);
    on.clicked.fire({ menuItemId: 'azimut-note-cite', pageUrl: ARTICLE.url, frameId: 0 }, ARTICLE);
    await settle();
    expect(port.sent).toContainEqual({
      type: 'put',
      put: { action: 'cite', url: ARTICLE.url, title: 'A story' },
    });
  });

  it('reaches the note on another screen when this window has none', async () => {
    const { on } = load();
    const elsewhere = connect(on);
    ready(elsewhere, { windowId: 2 });
    on.clicked.fire({ menuItemId: 'azimut-note-cite', pageUrl: ARTICLE.url }, ARTICLE);
    await settle();
    expect(elsewhere.sent.map((m) => m.type)).toEqual(['put']);
  });

  it('prefers the panel in the window that was clicked', async () => {
    const { on } = load();
    const elsewhere = connect(on);
    const here = connect(on);
    ready(elsewhere, { windowId: 2 });
    ready(here, { windowId: 1 });
    // the other one spoke last, and still loses to the window's own
    elsewhere.onMessage.fire({ type: 'state', windowId: 2, ready: true, caseId: 'case-2' });
    on.clicked.fire({ menuItemId: 'azimut-note-cite', pageUrl: ARTICLE.url }, ARTICLE);
    await settle();
    expect(here.sent.map((m) => m.type)).toEqual(['put']);
    expect(elsewhere.sent).toEqual([]);
  });

  it('quotes the selection with its line breaks', async () => {
    const { on } = load({ selection: 'first line\nsecond line' });
    const port = connect(on);
    ready(port);
    on.clicked.fire(
      { menuItemId: 'azimut-note-quote', pageUrl: ARTICLE.url, frameId: 0, selectionText: 'first line second line' },
      ARTICLE
    );
    await settle();
    expect(port.sent).toContainEqual({
      type: 'put',
      put: { action: 'quote', url: ARTICLE.url, title: 'A story', text: 'first line\nsecond line' },
    });
  });

  it("falls back to the browser's copy of the selection when the frame cannot be read", async () => {
    const { on } = load({ selection: new Error('Cannot access contents of the page') });
    const port = connect(on);
    ready(port);
    on.clicked.fire(
      { menuItemId: 'azimut-note-quote', pageUrl: ARTICLE.url, frameId: 4, selectionText: 'in a frame' },
      ARTICLE
    );
    await settle();
    expect(port.sent.at(-1).put.text).toBe('in a frame');
  });

  it('says so when nothing is selected', async () => {
    const { on } = load({ selection: '   ' });
    const port = connect(on);
    ready(port);
    on.clicked.fire({ menuItemId: 'azimut-note-quote', pageUrl: ARTICLE.url, frameId: 0 }, ARTICLE);
    await settle();
    expect(port.sent).toContainEqual({ type: 'trouble', error: 'Select the words to quote first.' });
  });

  it('refuses a capture of a page that is not a map, before a pixel is taken', async () => {
    const run = load({ answers: { '/api/ingest/parse': json({ site: null }) } });
    const port = connect(run.on);
    ready(port);
    run.on.clicked.fire({ menuItemId: 'azimut-note-capture', pageUrl: ARTICLE.url }, ARTICLE);
    await settle();
    expect(port.sent.at(-1)).toEqual({
      type: 'trouble',
      error: 'Captures are for map sites. Cite this page instead.',
    });
    expect(run.chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
    expect(drawsSelection(run)).toBe(false);
  });

  it('draws the area selection on a map, and takes nothing before the drag', async () => {
    const run = mapRun();
    const port = connect(run.on);
    ready(port);
    run.on.clicked.fire({ menuItemId: 'azimut-note-capture', pageUrl: MAP.url }, MAP);
    await settle();

    // the popup's own overlay, with what to file waiting for the drag
    expect(drawsSelection(run)).toBe(true);
    expect(run.session.get('pending:6')).toMatchObject({
      url: MAP.url,
      caseId: 'case-1',
      lat: 48.85,
      lon: 2.29,
      zoom: 17,
      note: { title: 'Google Maps' },
    });
    expect(port.sent.at(-1)).toEqual({ type: 'selecting', tabId: 6 });
    // the right-click opened the page: no capture is tried before the drag
    expect(run.chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
    expect(filed(run)).toBeUndefined();
  });

  it("files only the dragged rectangle into the panel's case, and puts that picture in", async () => {
    const run = mapRun();
    const port = connect(run.on);
    ready(port);
    run.on.clicked.fire({ menuItemId: 'azimut-note-capture', pageUrl: MAP.url }, MAP);
    await settle();

    const done = await run.handle(
      { type: 'area-selected', rect: { x: 100, y: 50, w: 300, h: 200 }, viewportW: 1000 },
      { tab: MAP }
    );
    expect(done).toEqual({ ok: true });
    expect(run.chrome.tabs.captureVisibleTab).toHaveBeenCalledTimes(1);
    // the frame is 2000 px for a 1000 px viewport: the rectangle, at twice the size
    expect(run.drawn).toEqual([{ size: [600, 400], from: [200, 100, 600, 400] }]);

    expect(port.sent).toContainEqual({ type: 'working', text: 'Capturing…' });
    expect(port.sent.at(-1)).toEqual({
      type: 'put',
      put: { action: 'picture', url: MAP.url, title: 'Google Maps', entityId: 'cap_42' },
    });
    const [, init] = filed(run);
    // filed into the note's case, not the popup's last one or a fresh scratch
    expect(init.body.get('case_id')).toBe('case-1');
    expect(init.body.get('url')).toBe(MAP.url);
    expect(init.body.get('lat')).toBe('48.85');
    expect(init.headers['X-Azimut-Token']).toBe('tok-123');
    expect(run.session.has('pending:6')).toBe(false);
  });

  it('files nothing and puts nothing when the selection is cancelled', async () => {
    const run = mapRun();
    const port = connect(run.on);
    ready(port);
    run.on.clicked.fire({ menuItemId: 'azimut-note-capture', pageUrl: MAP.url }, MAP);
    await settle();

    expect(await run.handle({ type: 'area-cancelled' }, { tab: MAP })).toEqual({ ok: true });
    expect(port.sent.at(-1)).toEqual({ type: 'idle' });
    expect(port.sent.some((m) => m.type === 'put')).toBe(false);
    expect(run.chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
    expect(filed(run)).toBeUndefined();
    expect(run.session.has('pending:6')).toBe(false);
  });

  it('says what to do when the browser refuses the capture at the end of the drag', async () => {
    const run = mapRun({ capture: new Error(NO_CAPTURE) });
    const port = connect(run.on);
    ready(port);
    run.on.clicked.fire({ menuItemId: 'azimut-note-capture', pageUrl: MAP.url }, MAP);
    await settle();
    await run.handle({ type: 'area-selected', rect: { x: 0, y: 0, w: 50, h: 50 }, viewportW: 1000 }, { tab: MAP });
    expect(port.sent.at(-1)).toEqual({ type: 'trouble', error: 'Right-click the map to capture it.' });
    expect(filed(run)).toBeUndefined();
  });

  it("leaves the popup's own capture as it was", async () => {
    const run = mapRun();
    const port = connect(run.on);
    ready(port);
    const meta = { url: MAP.url, caseId: 'case-9', title: 'Here', lat: 1, lon: 2, zoom: 3, bearing: null, marks: false };
    expect(await run.handle({ type: 'start-area-select', tabId: 6, meta }, {})).toEqual({ ok: true });
    expect(run.session.get('pending:6')).toEqual(meta);

    await run.handle({ type: 'area-selected', rect: { x: 0, y: 0, w: 50, h: 50 }, viewportW: 1000 }, { tab: MAP });
    expect(filed(run)[1].body.get('case_id')).toBe('case-9');
    expect(run.chrome.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Capture filed into Azimut' })
    );
    // the note hears nothing of a capture it did not ask for
    expect(port.sent).toEqual([]);
  });

  it('says why when the app files a capture without naming it', async () => {
    // an app older than this extension: the capture is filed, the note cannot hold it
    const run = mapRun({ screenshot: { case_id: 'case-1', title: 't' } });
    const port = connect(run.on);
    ready(port);
    run.on.clicked.fire({ menuItemId: 'azimut-note-capture', pageUrl: MAP.url }, MAP);
    await settle();
    await run.handle({ type: 'area-selected', rect: { x: 0, y: 0, w: 50, h: 50 }, viewportW: 1000 }, { tab: MAP });
    // the worker hands the facts over; the panel's builder is what refuses an empty id
    expect(port.sent.at(-1).put.entityId).toBeUndefined();
  });

  it('treats a page of the paired app as no source', async () => {
    const { on } = load();
    const port = connect(on);
    ready(port);
    const app = { ...ARTICLE, url: 'http://127.0.0.1:18999/#notebook' };
    on.clicked.fire({ menuItemId: 'azimut-note-cite', pageUrl: app.url }, app);
    await settle();
    expect(port.sent.at(-1)).toEqual({ type: 'trouble', error: 'This is Azimut itself, not a source.' });
  });

  it('inside the panel itself, says the note is no source', async () => {
    const { on } = load();
    const port = connect(on);
    ready(port);
    on.clicked.fire({ menuItemId: 'azimut-note-quote', pageUrl: PANEL.url, selectionText: 'my own words' }, undefined);
    await settle();
    expect(port.sent.at(-1)).toEqual({ type: 'trouble', error: 'This is Azimut itself, not a source.' });
  });
});

describe('a panel button', () => {
  it("reads the window's front tab for the panel", async () => {
    const { handle } = load();
    const answer = await handle({ type: 'notes-facts', action: 'cite', windowId: 1, caseId: 'case-1' }, PANEL);
    expect(answer).toEqual({ ok: true, put: { action: 'cite', url: ARTICLE.url, title: 'A story' } });
  });

  it('says to right-click on a tab the browser keeps from the extension', async () => {
    // no address on the tab: nothing pointed the extension at it
    const { handle } = load({ front: { id: 5, windowId: 1 } });
    const answer = await handle({ type: 'notes-facts', action: 'cite', windowId: 1 }, PANEL);
    expect(answer).toEqual({ ok: false, error: 'Right-click the page to cite, quote or capture it.' });
  });

  it('draws the area selection on a map the browser lets it capture', async () => {
    const run = mapRun();
    const answer = await run.handle({ type: 'notes-facts', action: 'capture', windowId: 1, caseId: 'case-1' }, PANEL);
    expect(answer).toEqual({ ok: true, selecting: 6 });
    expect(drawsSelection(run)).toBe(true);
    // one frame tried and thrown away, since a press in the panel opens no page
    expect(run.chrome.tabs.captureVisibleTab).toHaveBeenCalledTimes(1);
    expect(filed(run)).toBeUndefined();
  });

  it('says to right-click a map the browser will not let it capture, and draws nothing', async () => {
    // Google Maps, held for the reverse-image engines: its address reads, a capture is refused
    const run = mapRun({ capture: new Error(NO_CAPTURE) });
    const answer = await run.handle({ type: 'notes-facts', action: 'capture', windowId: 1, caseId: 'case-1' }, PANEL);
    expect(answer).toEqual({ ok: false, error: 'Right-click the map to capture it.' });
    expect(drawsSelection(run)).toBe(false);
    expect(run.session.has('pending:6')).toBe(false);
  });

  it("waits out Chrome's two captures a second rather than refuse a quick second press", async () => {
    const run = mapRun();
    run.chrome.tabs.captureVisibleTab.mockImplementationOnce(async () => {
      throw new Error('This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.');
    });
    vi.useFakeTimers();
    try {
      const answer = run.handle({ type: 'notes-facts', action: 'capture', windowId: 1, caseId: 'case-1' }, PANEL);
      await vi.advanceTimersByTimeAsync(1000);
      expect(await answer).toEqual({ ok: true, selecting: 6 });
      expect(run.chrome.tabs.captureVisibleTab).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says the same in Firefox's words", async () => {
    const run = mapRun({ capture: new Error('Missing activeTab permission') });
    const answer = await run.handle({ type: 'notes-facts', action: 'capture', windowId: 1, caseId: 'case-1' }, PANEL);
    expect(answer.error).toBe('Right-click the map to capture it.');
  });

  it('says to right-click when the page refuses the selection, and leaves nothing waiting', async () => {
    const run = mapRun({ inject: new Error(NO_SCRIPT) });
    const answer = await run.handle({ type: 'notes-facts', action: 'capture', windowId: 1, caseId: 'case-1' }, PANEL);
    expect(answer).toEqual({ ok: false, error: 'Right-click the map to capture it.' });
    expect(run.session.has('pending:6')).toBe(false);
  });

  it('says to right-click the selection when the page will not hand it over', async () => {
    const { handle } = load({ selection: new Error('Missing host permission for the tab') });
    const answer = await handle({ type: 'notes-facts', action: 'quote', windowId: 1 }, PANEL);
    expect(answer).toEqual({ ok: false, error: 'Right-click the selection to quote it.' });
  });

  it('answers no one but the panel page', async () => {
    const { handle } = load();
    const fromTab = await handle({ type: 'notes-facts', action: 'cite', windowId: 1 }, { tab: { id: 5 }, url: ARTICLE.url });
    expect(fromTab.ok).toBe(false);
    const fromOptions = await handle(
      { type: 'notes-facts', action: 'cite', windowId: 1 },
      { url: 'chrome-extension://id/options.html' }
    );
    expect(fromOptions.ok).toBe(false);
  });
});
