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
 * the app accepts (the app drops anything else without a word); and the actions
 * show only while the note says it is open.
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
async function openPanel({ front = ARTICLE, stored = { lastCaseId: 'case-1' }, sendMessage } = {}) {
  document.body.innerHTML = bodyOf(panelHtml).replace(/<iframe[^>]*><\/iframe>/, '<div id="note"></div>');
  const frameWindow = { postMessage: vi.fn() };
  const frame = $('note');
  Object.defineProperty(frame, 'contentWindow', { value: frameWindow });

  const ports = [];
  const handlers = {};
  const chrome = {
    storage: {
      local: { get: vi.fn(async (defaults) => ({ ...defaults, backendUrl: `${APP}/`, ...stored })) },
      onChanged: event(),
    },
    windows: { getCurrent: vi.fn(async () => ({ id: 1 })) },
    tabs: { query: vi.fn(async () => (front ? [front] : [])), onActivated: event(), onUpdated: event() },
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

  /** A message as the note's frame posts it. */
  const fromNote = (data, { origin = APP, source = frameWindow } = {}) => handlers.message({ data, origin, source });
  const port = () => ports.at(-1);
  return { chrome, frame, frameWindow, fromNote, ports, port, handlers };
}

const open = (extra = {}) => ({ azimut: 'note-panel', v: 1, state: 'ready', caseId: 'case-1', noteId: 'n1', title: 'Leads', ...extra });

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

  it('shows no action until the note says it is open, and tells the worker', async () => {
    const { fromNote, port } = await openPanel();
    expect($('bar').hidden).toBe(true);
    expect($('actions').hidden).toBe(true);

    fromNote(open());
    expect($('bar').hidden).toBe(false);
    expect($('actions').hidden).toBe(false);
    expect(port().sent.at(-1)).toEqual({ type: 'state', windowId: 1, ready: true, caseId: 'case-1' });

    fromNote({ azimut: 'note-panel', v: 1, state: 'none' });
    expect($('actions').hidden).toBe(true);
    expect(port().sent.at(-1)).toMatchObject({ type: 'state', ready: false, caseId: '' });
  });

  it('ignores a message from anywhere but its frame at the app origin', async () => {
    const { fromNote } = await openPanel();
    fromNote(open(), { origin: 'https://evil.example' });
    fromNote(open(), { source: {} });
    expect($('actions').hidden).toBe(true);
  });

  it('says to right-click on a tab it cannot read', async () => {
    const { fromNote } = await openPanel({ front: { id: 5, windowId: 1 } });
    fromNote(open());
    expect($('actions').hidden).toBe(true);
    expect($('hint').hidden).toBe(false);
    expect($('hint').textContent).toBe('Right-click the page to cite, quote or capture it.');
  });

  it('offers nothing on the app itself', async () => {
    const { fromNote } = await openPanel({ front: { ...ARTICLE, url: `${APP}/#board` } });
    fromNote(open());
    expect($('actions').hidden).toBe(true);
    expect($('hint').hidden).toBe(true);
  });

  it('names a post a post', async () => {
    const { fromNote } = await openPanel({ front: { ...ARTICLE, url: 'https://bsky.app/profile/a.bsky.social/post/3k' } });
    fromNote(open());
    expect($('cite').textContent).toBe('Cite post');
  });

  it("hands a press's facts to the note, at the app's exact origin", async () => {
    const { chrome, fromNote, frameWindow } = await openPanel();
    fromNote(open());
    $('cite').click();
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
    $('quote').click();
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
    $('capture').click();
    expect($('status').textContent).toBe('Capturing…');
    await settle();
    expect($('status').textContent).toBe('Captures are for map sites. Cite this page instead.');
    expect(frameWindow.postMessage).not.toHaveBeenCalled();
  });

  it('says so when the note does not answer', async () => {
    const { fromNote } = await openPanel();
    fromNote(open());
    vi.useFakeTimers();
    $('cite').click();
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
