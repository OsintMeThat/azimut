// @vitest-environment happy-dom
/**
 * Tests for the capture extension's notes panel (extension/notes.html, notes.js),
 * the helpers it shares with the worker (extension/notesmsg.js), and the popup's
 * way into it.
 *
 * Like the other extension suites, these files have no exports: the page is
 * loaded into the document, `chrome` is stubbed, and the source is evaluated by
 * hand. The note's frame is a stand-in window, so nothing is loaded from any
 * address; the panel's own listeners are handed in rather than left on the
 * shared test window, so one test's panel never answers another's messages.
 *
 * What is worth pinning: the panel only ever posts to the paired app's exact
 * origin, and only listens to its own frame from there; what it sends is what
 * the app accepts (the app drops anything else without a word); the actions
 * show only while the note says it is open; a browser's refusal is never shown
 * in its own words; and the panel's case and the extension's `lastCaseId` follow
 * each other without loading the note in a loop.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ext = join(here, '../../../extension');
const helpers = readFileSync(join(ext, 'notesmsg.js'), 'utf8');
const panelSource = readFileSync(join(ext, 'notes.js'), 'utf8');
const panelHtml = readFileSync(join(ext, 'notes.html'), 'utf8');
const popupSource = readFileSync(join(ext, 'popup.js'), 'utf8');
const overlaySource = readFileSync(join(ext, 'overlay.js'), 'utf8');
const popupHtml = readFileSync(join(ext, 'popup.html'), 'utf8');

const N = new Function(`${helpers}\nreturn AzimutNotes;`)();

const APP = 'http://127.0.0.1:18999';
const ARTICLE = { id: 5, windowId: 1, url: 'https://example.com/story', title: 'A story' };
const $ = (id) => document.getElementById(id);
const settle = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};
const bodyOf = (html) =>
  html
    .replace(/[\s\S]*<body[^>]*>/, '')
    .replace(/<\/body>[\s\S]*/, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');

function event() {
  const listeners = [];
  return { addListener: vi.fn((cb) => listeners.push(cb)), fire: (...args) => listeners.map((cb) => cb(...args)) };
}

/** Open the panel page against a front tab. */
async function openPanel({ front = ARTICLE, stored = { lastCaseId: 'case-1' }, sendMessage, allowed = true, selection = '' } = {}) {
  document.body.innerHTML = bodyOf(panelHtml).replace(/<iframe[^>]*><\/iframe>/, '<div id="note"></div>');
  // Each frame the panel opens is a stand-in with a window of its own; a fresh one
  // comes from cloning the last, as the panel does to load the note again.
  const frames = [];
  const dress = (el) => {
    Object.defineProperty(el, 'contentWindow', { value: { postMessage: vi.fn() } });
    el.cloneNode = () => {
      const next = document.createElement('div');
      next.id = 'note';
      return dress(next);
    };
    frames.push(el);
    return el;
  };
  const frame = dress($('note'));
  const frameWindow = frame.contentWindow;

  const ports = [];
  const handlers = {};
  const chrome = {
    storage: {
      local: {
        get: vi.fn(async (defaults) => ({ ...defaults, backendUrl: `${APP}/`, ...stored })),
        set: vi.fn(async () => {}),
      },
      onChanged: event(),
    },
    windows: { getCurrent: vi.fn(async () => ({ id: 1 })) },
    permissions: {
      contains: vi.fn(async () => allowed),
      request: vi.fn(async () => true),
    },
    scripting: { executeScript: vi.fn(async () => [{ result: selection }]) },
    tabs: {
      query: vi.fn(async () => (front ? [front] : [])),
      onActivated: event(),
      onUpdated: event(),
      sendMessage: vi.fn(async () => ({ ok: true })),
    },
    runtime: {
      connect: vi.fn(() => {
        const port = { sent: [], onMessage: event(), onDisconnect: event() };
        port.postMessage = vi.fn((msg) => port.sent.push(msg));
        ports.push(port);
        return port;
      }),
      sendMessage:
        sendMessage ??
        vi.fn(async ({ action }) => ({
          ok: true,
          put: { action, url: ARTICLE.url, title: ARTICLE.title, ...(action === 'quote' ? { text: 'the words' } : {}) },
        })),
    },
  };
  const win = { addEventListener: (type, fn) => (handlers[type] = fn) };
  const doc = {
    getElementById: (id) => document.getElementById(id),
    documentElement: { addEventListener: (type, fn) => (handlers[type] = fn) },
  };
  new Function('chrome', 'browser', 'window', 'document', `${helpers}\n${panelSource}`)(chrome, undefined, win, doc);
  await settle();

  /** A message as the note's frame posts it: the frame the panel holds now, unless said otherwise. */
  const fromNote = (data, { origin = APP, source = $('note').contentWindow } = {}) =>
    handlers.message({ data, origin, source });
  const port = () => ports.at(-1);
  /** A change to the extension's stored settings, as the browser reports it. */
  const stored_ = (changes) =>
    chrome.storage.onChanged.fire(
      Object.fromEntries(Object.entries(changes).map(([key, newValue]) => [key, { newValue }])),
      'local'
    );
  return { chrome, frame, frames, frameWindow, fromNote, ports, port, handlers, storedChange: stored_ };
}

const open = (extra = {}) => ({ azimut: 'note-panel', v: 1, state: 'ready', caseId: 'case-1', noteId: 'n1', title: 'Leads', ...extra });
/** A pick in the note's Add, as the frame posts it. */
const run = (action) => ({ azimut: 'note-tab-run', v: 1, action });
const ASK = { azimut: 'note-tab-ask', v: 1 };
/** What the panel told the frame of the tab in front, last. */
const toldTab = (frameWindow) => frameWindow.postMessage.mock.calls.map(([message]) => message).filter((m) => m.azimut === 'note-tab').at(-1);

afterEach(() => {
  vi.useRealTimers();
});

describe('notesmsg: what crosses to the note', () => {
  it('opens the note alone and compact, naming a note only with its case', () => {
    expect(N.panelUrl(`${APP}/`, { caseId: 'case-1', noteId: 'n1' })).toBe(
      `${APP}/#notebook?case=case-1&note=n1&solo=1&panel=1`
    );
    expect(N.panelUrl(APP, { noteId: 'n1' })).toBe(`${APP}/#notebook?solo=1&panel=1`);
    expect(N.panelUrl('not an address', {})).toBeNull();
  });

  it('posts to the origin alone, never a path', () => {
    expect(N.appOrigin('http://localhost:8477/some/path')).toBe('http://localhost:8477');
    expect(N.appOrigin('file:///tmp/x')).toBeNull();
  });

  it('calls a post a post, as the app names one', () => {
    const posts = [
      'https://x.com/someone/status/123',
      'https://twitter.com/someone/status/123/photo/1',
      'https://mobile.twitter.com/someone/status/123',
      'https://t.me/channel/42',
      'https://t.me/s/channel/42',
      'https://t.me/c/1234/42',
      'https://bsky.app/profile/someone.bsky.social/post/3k2',
      'https://www.instagram.com/p/Cabc/',
      'https://www.instagram.com/someone/reel/Cabc/',
      'https://www.tiktok.com/@someone/video/123',
      'https://www.facebook.com/page/posts/123',
      'https://www.reddit.com/r/osint/comments/abc/title/',
    ];
    const pages = [
      'https://x.com/someone',
      'https://t.me/channel',
      'https://bsky.app/profile/someone.bsky.social',
      'https://example.com/story',
      'https://www.youtube.com/watch?v=abc',
      'not an address',
    ];
    for (const url of posts) expect(N.citeLabel(url), url).toBe('Cite this post');
    for (const url of pages) expect(N.citeLabel(url), url).toBe('Cite this page');
    expect(N.citeButton(posts[0])).toBe('Cite post');
  });

  it('sends only the keys the app accepts', () => {
    const put = N.buildPut('put-1-2', { action: 'quote', url: ARTICLE.url, title: 'T', text: 'words', extra: 'x' });
    expect(put).toEqual({ azimut: 'note-put', v: 1, id: 'put-1-2', action: 'quote', url: ARTICLE.url, title: 'T', text: 'words' });
    const picture = N.buildPut('put-1-3', { action: 'picture', url: ARTICLE.url, title: '', entityId: 'cap_42' });
    expect(Object.keys(picture).sort()).toEqual(['action', 'azimut', 'entityId', 'id', 'title', 'url', 'v']);
  });

  it('cuts what is too long rather than have the app drop it', () => {
    const put = N.buildPut('p1', { action: 'quote', url: ARTICLE.url, title: 't'.repeat(400), text: 'w'.repeat(6000) });
    expect(put.title.length).toBeLessThanOrEqual(300);
    expect(put.title.endsWith('…')).toBe(true);
    expect(put.text.length).toBe(5000);
    // never half a surrogate pair at the cut
    const emoji = N.buildPut('p2', { action: 'quote', url: ARTICLE.url, text: `${'a'.repeat(4999)}😀` });
    expect(emoji.text).toBe('a'.repeat(4999));
  });

  it('keeps the line breaks of a quote', () => {
    expect(N.buildPut('p1', { action: 'quote', url: ARTICLE.url, text: ' one\r\ntwo \n' }).text).toBe('one\ntwo');
  });

  it('refuses, in a sentence, what the app would drop', () => {
    const refused = (facts, id = 'p1') => {
      try {
        N.buildPut(id, facts);
        return null;
      } catch (e) {
        return e.message;
      }
    };
    expect(refused({ action: 'cite', url: 'chrome://settings' })).toBe('Open a web page to cite it.');
    expect(refused({ action: 'cite', url: `https://example.com/${'a'.repeat(2048)}` })).toBe(
      'This address is too long to cite.'
    );
    expect(refused({ action: 'quote', url: ARTICLE.url, text: '  ' })).toBe('Select the words to quote first.');
    expect(refused({ action: 'picture', url: ARTICLE.url })).toMatch(/gave no picture/);
    expect(refused({ action: 'picture', url: ARTICLE.url, entityId: '../x' })).toMatch(/gave no picture/);
    expect(refused({ action: 'cite', url: ARTICLE.url }, 'bad id!')).toMatch(/not a message id/);
    expect(refused({ action: 'erase', url: ARTICLE.url })).toMatch(/no such note action/);
  });

  it("never shows a browser's refusal in the browser's words", () => {
    const chrome = "Either the '<all_urls>' or 'activeTab' permission is required.";
    const script = 'Cannot access contents of the page. Extension manifest must request permission to access the respective host.';
    expect(N.plain(new Error(chrome), 'capture')).toBe('Right-click the map, or press Alt+Shift+S, to capture it.');
    expect(N.plain('Missing activeTab permission', 'capture')).toBe('Right-click the map, or press Alt+Shift+S, to capture it.');
    expect(N.plain(script, 'quote')).toBe('Right-click the selection to quote it.');
    expect(N.plain('Missing host permission for the tab', 'quote')).toBe('Right-click the selection to quote it.');
    expect(N.plain('The extensions gallery cannot be scripted.', 'cite')).toBe(
      'Right-click the page to cite, quote or capture it.'
    );
    expect(N.plain(script)).toBe('Right-click the page to cite, quote or capture it.');
    expect(N.plain('This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.', 'capture')).toBe(
      'Wait a second, then capture again.'
    );
    // a sentence already written to be read passes as it is
    expect(N.plain(new Error('Captures are for map sites. Cite this page instead.'), 'capture')).toBe(
      'Captures are for map sites. Cite this page instead.'
    );
    expect(N.plain('Azimut refused the capture (500): no space left on device', 'capture')).toMatch(/^Azimut refused/);
  });

  it("hears only the panel's own frame, from the app's origin", () => {
    const frame = {};
    const data = open();
    expect(N.readFrame({ source: frame, origin: APP, data }, frame, APP)).toEqual({
      kind: 'panel',
      ready: true,
      caseId: 'case-1',
    });
    expect(N.readFrame({ source: frame, origin: 'https://evil.example', data }, frame, APP)).toBeNull();
    expect(N.readFrame({ source: {}, origin: APP, data }, frame, APP)).toBeNull();
    expect(N.readFrame({ source: frame, origin: APP, data: { ...data, v: 2 } }, frame, APP)).toBeNull();
    expect(N.readFrame({ source: frame, origin: APP, data: { azimut: 'other', v: 1 } }, frame, APP)).toBeNull();
    expect(
      N.readFrame({ source: frame, origin: APP, data: { azimut: 'note-put-done', v: 1, id: 'p1', ok: false, error: 'No.' } }, frame, APP)
    ).toEqual({ kind: 'done', id: 'p1', ok: false, error: 'No.' });
  });
});

describe('the notes panel', () => {
  it("opens the app's note in panel mode, from the paired address", async () => {
    const { frame } = await openPanel();
    expect(frame.src).toBe(`${APP}/#notebook?case=case-1&solo=1&panel=1`);
    const fresh = await openPanel({ stored: {} });
    expect(fresh.frame.src).toBe(`${APP}/#notebook?solo=1&panel=1`);
  });

  it('shows no bar over the note, and tells the worker when the note is open', async () => {
    const { fromNote, port } = await openPanel();
    expect($('bar').hidden).toBe(true);
    fromNote(open());
    expect($('bar').hidden).toBe(true);
    expect(port().sent.at(-1)).toEqual({ type: 'state', windowId: 1, ready: true, caseId: 'case-1' });
    fromNote({ azimut: 'note-panel', v: 1, state: 'none' });
    expect(port().sent.at(-1)).toMatchObject({ type: 'state', ready: false, caseId: '' });
  });

  it('ignores a message from anywhere but its frame at the app origin', async () => {
    const { fromNote, frameWindow, port } = await openPanel();
    fromNote(open(), { origin: 'https://evil.example' });
    fromNote(open(), { source: {} });
    expect(port().sent.at(-1)).toMatchObject({ ready: false });
    fromNote(ASK, { origin: 'https://evil.example' });
    fromNote(run('cite'), { source: {} });
    await settle();
    expect(frameWindow.postMessage).not.toHaveBeenCalled();
  });

  it("answers the note's Add with the tab in front: its address, title and the words selected", async () => {
    const { chrome, fromNote, frameWindow } = await openPanel({ selection: '  the words\r\non two lines ' });
    fromNote(open());
    fromNote(ASK);
    await settle();
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 5 } }));
    const [message, target] = frameWindow.postMessage.mock.calls.at(-1);
    expect(target).toBe(APP);
    expect(message).toEqual({
      azimut: 'note-tab', v: 1, access: 'open', url: ARTICLE.url, title: 'A story', selection: 'the words\non two lines', post: false, map: false,
    });
  });

  it('says a tab is closed until the extension may read pages, and reads nothing of it', async () => {
    const { chrome, fromNote, frameWindow } = await openPanel({ allowed: false });
    fromNote(open());
    fromNote(ASK);
    await settle();
    expect(toldTab(frameWindow)).toEqual({ azimut: 'note-tab', v: 1, access: 'closed', url: '', title: '', selection: '', post: false, map: false });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('offers nothing from the app itself, nor from a page that is not on the web', async () => {
    for (const url of [`${APP}/#board`, 'chrome://extensions/']) {
      const { fromNote, frameWindow } = await openPanel({ front: { ...ARTICLE, url } });
      fromNote(open());
      fromNote(ASK);
      await settle();
      expect(toldTab(frameWindow)).toMatchObject({ access: 'none', url: '' });
    }
  });

  it('says a map is a map, as the worker asks the app', async () => {
    const sendMessage = vi.fn(async (msg) => (msg.type === 'notes-map' ? { map: true } : { ok: true }));
    const { fromNote, frameWindow } = await openPanel({ sendMessage });
    fromNote(open());
    fromNote(ASK);
    await settle();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'notes-map', url: ARTICLE.url });
    expect(toldTab(frameWindow)).toMatchObject({ access: 'open', map: true });
  });

  it('names a post a post', async () => {
    const { fromNote, frameWindow } = await openPanel({ front: { ...ARTICLE, url: 'https://bsky.app/profile/a.bsky.social/post/3k' } });
    fromNote(open());
    fromNote(ASK);
    await settle();
    expect(toldTab(frameWindow)).toMatchObject({ access: 'open', post: true });
  });

  it('asks for the permission at the first pick, then does what was picked', async () => {
    const { chrome, fromNote, frameWindow } = await openPanel({ allowed: false });
    fromNote(open());
    chrome.permissions.request.mockImplementation(async () => {
      chrome.permissions.contains.mockImplementation(async () => true);
      return true;
    });
    fromNote(run('cite'));
    await settle();
    expect(chrome.permissions.request).toHaveBeenCalledWith({ origins: ['<all_urls>'] });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'notes-facts', action: 'cite', windowId: 1, caseId: 'case-1' });
    // the note hears the tab is open now, then gets the citation
    const said = frameWindow.postMessage.mock.calls.map(([message]) => message.azimut);
    expect(said).toEqual(['note-tab', 'note-put']);
    expect($('allowing').hidden).toBe(true);
  });

  it('offers Allow on its own line when the browser will not ask from inside the note', async () => {
    const { chrome, fromNote } = await openPanel({ allowed: false });
    fromNote(open());
    chrome.permissions.request.mockImplementationOnce(async () => {
      throw new Error('permissions.request may only be called from a user input handler');
    });
    fromNote(run('capture'));
    await settle();
    expect($('bar').hidden).toBe(false);
    expect($('allowing').hidden).toBe(false);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    // pressed here, it is asked again, and the pick that waited runs
    $('allow').click();
    await settle();
    expect(chrome.permissions.request).toHaveBeenCalledTimes(2);
    expect($('allowing').hidden).toBe(true);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'capture' }));
  });

  it('says what still works when the permission is refused', async () => {
    const { chrome, fromNote } = await openPanel({ allowed: false });
    fromNote(open());
    chrome.permissions.request.mockImplementation(async () => false);
    fromNote(run('quote'));
    await settle();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    expect($('status').textContent).toBe('Right-click the page to cite, quote or capture it.');
    // Allow alone asks, and runs nothing
    fromNote(run('allow'));
    await settle();
    expect(chrome.permissions.request).toHaveBeenCalledTimes(2);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("hands a press's facts to the note, at the app's exact origin", async () => {
    const { chrome, fromNote, frameWindow } = await openPanel();
    fromNote(open());
    fromNote(run('cite'));
    await settle();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'notes-facts',
      action: 'cite',
      windowId: 1,
      caseId: 'case-1',
    });
    expect(frameWindow.postMessage).toHaveBeenCalledTimes(1);
    const [message, target] = frameWindow.postMessage.mock.calls[0];
    expect(target).toBe(APP);
    expect(message).toMatchObject({ azimut: 'note-put', v: 1, action: 'cite', url: ARTICLE.url, title: 'A story' });
    expect(message.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);

    fromNote({ azimut: 'note-put-done', v: 1, id: message.id, ok: true });
    await settle();
    expect($('status').hidden).toBe(true);
  });

  it("shows the note's refusal in its own words", async () => {
    const { fromNote, frameWindow } = await openPanel();
    fromNote(open());
    fromNote(run('quote'));
    await settle();
    const [message] = frameWindow.postMessage.mock.calls[0];
    fromNote({ azimut: 'note-put-done', v: 1, id: message.id, ok: false, error: 'This note is read only.' });
    await settle();
    expect($('status').textContent).toBe('This note is read only.');
  });

  it("keeps the worker's refusal in the bar", async () => {
    const sendMessage = vi.fn(async () => ({ ok: false, error: 'Captures are for map sites. Cite this page instead.' }));
    const { fromNote, frameWindow } = await openPanel({ sendMessage });
    fromNote(open());
    fromNote(run('capture'));
    await settle();
    expect($('status').textContent).toBe('Captures are for map sites. Cite this page instead.');
    expect(frameWindow.postMessage).not.toHaveBeenCalled();
  });

  it("shows what to do instead of a refusal in the browser's words", async () => {
    const raw = "Either the '<all_urls>' or 'activeTab' permission is required.";
    const sendMessage = vi.fn(async () => ({ ok: false, error: raw }));
    const { fromNote, port } = await openPanel({ sendMessage });
    fromNote(open());
    fromNote(run('capture'));
    await settle();
    expect($('status').textContent).toBe('Right-click the map, or press Alt+Shift+S, to capture it.');

    port().onMessage.fire({ type: 'trouble', error: 'Missing host permission for the tab' });
    expect($('status').textContent).toBe('Right-click the page to cite, quote or capture it.');
  });

  it('says the extension did not answer rather than what the browser said', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    });
    const { fromNote } = await openPanel({ sendMessage });
    fromNote(open());
    fromNote(run('cite'));
    await settle();
    expect($('status').textContent).toBe('The extension did not answer. Try again.');
  });

  it('draws the area selection on Capture, and puts the picture in once it is dragged', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, selecting: 6 }));
    const { fromNote, frameWindow, port } = await openPanel({ sendMessage });
    fromNote(open());
    fromNote(run('capture'));
    await settle();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'notes-facts', action: 'capture', windowId: 1, caseId: 'case-1' });
    expect($('status').textContent).toBe('Drag over the map to capture it. Esc cancels.');
    // nothing goes to the note before the drag
    expect(frameWindow.postMessage).not.toHaveBeenCalled();

    port().onMessage.fire({ type: 'working', text: 'Capturing…' });
    expect($('status').textContent).toBe('Capturing…');
    port().onMessage.fire({
      type: 'put',
      put: { action: 'picture', url: 'https://www.google.com/maps/@1,2,3z', title: 'Google Maps', entityId: 'cap_42' },
    });
    await settle();
    const [message, target] = frameWindow.postMessage.mock.calls[0];
    expect(target).toBe(APP);
    expect(message).toMatchObject({ action: 'picture', entityId: 'cap_42' });
  });

  it('takes the selection down on Escape in the panel, and puts nothing', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, selecting: 6 }));
    const { chrome, fromNote, frameWindow, port, handlers } = await openPanel({ sendMessage });
    fromNote(open());
    fromNote(run('capture'));
    await settle();

    handlers.keydown({ key: 'a' });
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    handlers.keydown({ key: 'Escape' });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(6, { type: 'area-cancel' });
    // the overlay cancels, and the worker says so
    port().onMessage.fire({ type: 'idle' });
    expect($('status').hidden).toBe(true);
    expect(frameWindow.postMessage).not.toHaveBeenCalled();

    // with nothing drawn, Escape asks nothing of any tab
    handlers.keydown({ key: 'Escape' });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('clears its line when the tab took the selection away with it', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, selecting: 6 }));
    const { chrome, fromNote, handlers } = await openPanel({ sendMessage });
    chrome.tabs.sendMessage.mockImplementation(async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    });
    fromNote(open());
    fromNote(run('capture'));
    await settle();
    handlers.keydown({ key: 'Escape' });
    await settle();
    expect($('status').hidden).toBe(true);
  });

  it('shows the selection a right-click drew, and lets Escape here take it down', async () => {
    const { chrome, fromNote, port, handlers } = await openPanel();
    fromNote(open());
    port().onMessage.fire({ type: 'selecting', tabId: 9 });
    expect($('status').textContent).toBe('Drag over the map to capture it. Esc cancels.');
    handlers.keydown({ key: 'Escape' });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(9, { type: 'area-cancel' });
  });

  it('says so when the note does not answer', async () => {
    const { fromNote } = await openPanel();
    fromNote(open());
    vi.useFakeTimers();
    fromNote(run('cite'));
    await vi.advanceTimersByTimeAsync(15000);
    expect($('status').textContent).toBe('The note did not answer. Try again.');
  });

  it("puts a right-click's facts in the same way", async () => {
    const { fromNote, frameWindow, port } = await openPanel();
    fromNote(open());
    port().onMessage.fire({ type: 'put', put: { action: 'quote', url: ARTICLE.url, title: 'A story', text: 'the words' } });
    await settle();
    const [message, target] = frameWindow.postMessage.mock.calls[0];
    expect(target).toBe(APP);
    expect(message).toMatchObject({ action: 'quote', text: 'the words' });
  });

  it('says what a right-click could not do', async () => {
    const { fromNote, port } = await openPanel();
    fromNote(open());
    port().onMessage.fire({ type: 'trouble', error: 'Select the words to quote first.' });
    expect($('status').textContent).toBe('Select the words to quote first.');
  });

  it("opens the case's note in a fresh frame when a case is picked elsewhere", async () => {
    const { frame, frames, fromNote, port, storedChange } = await openPanel();
    fromNote(open());
    storedChange({ lastCaseId: 'case-2' });
    // no note named: the app opens that case's own
    expect($('note').src).toBe(`${APP}/#notebook?case=case-2&solo=1&panel=1`);
    // a new frame, not a new hash on the old one, which would load nothing and
    // never tell the note left behind to save
    expect(frames).toHaveLength(2);
    expect($('note')).not.toBe(frame);
    expect(frame.isConnected).toBe(false);
    expect(port().sent.at(-1)).toMatchObject({ ready: false });

    // a late word from the frame it left is not the new note's
    fromNote({ azimut: 'note-panel', v: 1, state: 'ready', caseId: 'case-1' }, { source: frame.contentWindow });
    expect(port().sent.at(-1)).toMatchObject({ ready: false });
    fromNote(open({ caseId: 'case-2' }));
    expect(port().sent.at(-1)).toMatchObject({ ready: true, caseId: 'case-2' });
  });

  it('loads nothing again for the case it already shows', async () => {
    const { frames, fromNote, storedChange } = await openPanel();
    fromNote(open());
    storedChange({ lastCaseId: 'case-1' });
    storedChange({ lastCaseId: '' });
    expect(frames).toHaveLength(1);
    expect($('note').src).toContain('case=case-1');
  });

  it('stores a case picked in the note, without loading the note again', async () => {
    const { chrome, frames, fromNote, storedChange } = await openPanel();
    fromNote(open());
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    fromNote(open({ caseId: 'case-3', noteId: 'case' }));
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ lastCaseId: 'case-3' });
    // the write comes back as a change: the frame shows that case already
    storedChange({ lastCaseId: 'case-3' });
    expect(frames).toHaveLength(1);
    // and saying it again stores nothing more
    fromNote(open({ caseId: 'case-3', noteId: 'n2' }));
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
  });

  it('stores the case the app opened when the extension had none', async () => {
    const { chrome, frames, fromNote, storedChange } = await openPanel({ stored: {} });
    fromNote(open({ caseId: 'case-7' }));
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ lastCaseId: 'case-7' });
    storedChange({ lastCaseId: 'case-7' });
    expect(frames).toHaveLength(1);
    // a note that closes stores nothing
    fromNote({ azimut: 'note-panel', v: 1, state: 'none' });
    expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
  });

  it('follows the popup, then the note, then the popup again', async () => {
    const { chrome, frames, fromNote, storedChange } = await openPanel();
    fromNote(open());
    storedChange({ lastCaseId: 'case-2' });
    expect($('note').src).toContain('case=case-2');
    fromNote(open({ caseId: 'case-2' }));
    expect(chrome.storage.local.set).not.toHaveBeenCalled();

    fromNote(open({ caseId: 'case-4' }));
    storedChange({ lastCaseId: 'case-4' });
    expect(frames).toHaveLength(2);

    storedChange({ lastCaseId: 'case-1' });
    expect($('note').src).toContain('case=case-1');
    expect(frames).toHaveLength(3);
  });

  it('opens the note of a new address with no case', async () => {
    const { storedChange } = await openPanel();
    storedChange({ backendUrl: 'http://127.0.0.1:18998/' });
    expect($('note').src).toBe('http://127.0.0.1:18998/#notebook?solo=1&panel=1');
  });

  it('says the app is not there when the frame stays silent', async () => {
    vi.useFakeTimers();
    const { fromNote } = await openPanel();
    await vi.advanceTimersByTimeAsync(12000);
    expect($('down').hidden).toBe(false);
    expect($('down-text').textContent).toContain(APP);
    expect($('note').hidden).toBe(true);

    // pressing Try again loads the note again, and a note that answers clears it
    $('retry').click();
    expect($('down').hidden).toBe(true);
    fromNote(open());
    await vi.advanceTimersByTimeAsync(12000);
    expect($('down').hidden).toBe(true);
  });

  it('opens its port again when the worker goes', async () => {
    vi.useFakeTimers();
    const { ports } = await openPanel();
    expect(ports).toHaveLength(1);
    ports[0].onDisconnect.fire();
    await vi.advanceTimersByTimeAsync(2000);
    expect(ports).toHaveLength(2);
    expect(ports[1].sent[0]).toMatchObject({ type: 'state', windowId: 1 });
  });
});

describe('the popup opens the panel', () => {
  async function runPopup(browser) {
    document.body.innerHTML = bodyOf(popupHtml);
    globalThis.Option = function Option(text, value) {
      const option = document.createElement('option');
      option.textContent = text;
      option.value = value ?? text;
      return option;
    };
    const api = {
      tabs: { query: vi.fn(async () => [{ id: 7, windowId: 4, url: ARTICLE.url }]), sendMessage: vi.fn(async () => {}) },
      storage: { local: { get: vi.fn(async (defaults) => ({ ...defaults, backendUrl: APP, token: 't' })), set: vi.fn() } },
      runtime: { getManifest: () => ({ version: '0.3.3' }), sendMessage: vi.fn(), openOptionsPage: vi.fn() },
      scripting: { executeScript: vi.fn(async () => [{ result: 900 }]) },
      ...browser,
    };
    globalThis.chrome = api;
    globalThis.fetch = vi.fn(async (url) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).includes('/parse') ? { site: null } : []),
    }));
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    new Function('browser', popupSource)(browser.firefox ? api : undefined);
    await new Promise((r) => setTimeout(r, 0));
    return { api, close };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("opens Chrome's side panel for this window, inside the click", async () => {
    const open = vi.fn(async () => {});
    const { close } = await runPopup({ sidePanel: { open } });
    $('open-notes').click();
    expect(open).toHaveBeenCalledWith({ windowId: 4 });
    await settle();
    expect(close).toHaveBeenCalled();
  });

  it("opens Firefox's sidebar", async () => {
    const open = vi.fn(async () => {});
    await runPopup({ firefox: true, sidebarAction: { open } });
    $('open-notes').click();
    expect(open).toHaveBeenCalled();
  });

  it('says so when the browser has no panel to open', async () => {
    await runPopup({});
    $('open-notes').click();
    await settle();
    expect($('status').textContent).toMatch(/Could not open the notes panel/);
  });
});

describe('the area selection a capture into the note draws', () => {
  /** The popup's own overlay (extension/overlay.js), on a page of its own. */
  function drawOverlay() {
    return drawOverlayOn(() => { document.body.innerHTML = ''; });
  }

  /** The same, over a page `dress` lays out first. */
  function drawOverlayOn(dress) {
    dress();
    const win = {
      __azimutOverlayActive: false,
      innerWidth: 1000,
      innerHeight: 900,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const listeners = [];
    const chrome = {
      runtime: {
        sendMessage: vi.fn(),
        onMessage: {
          addListener: vi.fn((fn) => listeners.push(fn)),
          removeListener: vi.fn((fn) => listeners.splice(listeners.indexOf(fn), 1)),
        },
      },
    };
    const frame = (fn) => fn();
    new Function('window', 'chrome', 'browser', 'requestAnimationFrame', overlaySource)(win, chrome, undefined, frame);
    return { chrome, listeners, win };
  }

  it("sends the map's own credit line with the rectangle: the providers the strip at the foot names", () => {
    document.body.innerHTML = '';
    const place = (text, top) => {
      const el = document.createElement('span');
      el.textContent = text;
      el.getBoundingClientRect = () => ({ width: 120, top, bottom: top + 14 });
      document.body.append(el);
    };
    const { chrome } = drawOverlayOn(() => {
      place('Images ©2026 Airbus, Maxar Technologies', 878);
      place('Map data ©2026', 878);
      place('Images ©2026 Airbus, Maxar Technologies', 878); // said twice on the page, sent once
      place('© a caption up in the page, not a credit', 300);
      place('No sign here', 880);
    });
    const host = document.documentElement.lastElementChild;
    host.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 100, bubbles: true }));
    host.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 400, clientY: 300, bubbles: true }));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'area-selected',
      rect: { x: 100, y: 100, w: 300, h: 200 },
      viewportW: 1000,
      credit: 'Images ©2026 Airbus, Maxar Technologies · Map data ©2026',
    });
  });

  it("is taken down by the panel's Escape, and says it was cancelled", () => {
    const { chrome, listeners, win } = drawOverlay();
    expect(listeners).toHaveLength(1);
    const answer = vi.fn();
    listeners[0]({ type: 'something else' }, {}, answer);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();

    listeners[0]({ type: 'area-cancel' }, {}, answer);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'area-cancelled' });
    expect(answer).toHaveBeenCalledWith({ ok: true });
    // gone from the page, and deaf from now on
    expect(listeners).toHaveLength(0);
    expect(win.__azimutOverlayActive).toBe(false);
  });
});
