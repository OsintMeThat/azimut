/**
 * The note in the extension's panel: the app's own note, framed by the extension's
 * side panel (`#notebook?case=…&note=…&solo=1&panel=1`), and the messages the two
 * pass each other.
 *
 * The extension sends facts only: the page's address and title, the words selected,
 * a capture it filed. The app builds what goes in the note (`panelPuts.js`) and puts
 * it in through the same seam as every tool (`putInNote.svelte.js`).
 *
 *   extension → app:  { azimut: 'note-put', v: 1, id, action: 'cite' | 'quote' | 'picture',
 *                       url?, title?, text?, entityId? }
 *                     { azimut: 'note-tab', v: 1, access: 'open' | 'closed' | 'none', url, title, selection, post }
 *   app → extension:  { azimut: 'note-panel', v: 1, state: 'ready', caseId, noteId, title } | { …, state: 'none' }
 *                     { azimut: 'note-put-done', v: 1, id, ok: true } | { …, ok: false, error }
 *                     { azimut: 'note-tab-ask', v: 1 }                 the Add menu opened: what is the tab in front?
 *                     { azimut: 'note-tab-run', v: 1, action }         action: 'capture' | 'cite' | 'quote' | 'allow'
 *
 * A put or a tab is taken only in a framed panel, from the frame's parent, from an
 * extension's origin (`panelOrigin.js`), and only when every field is what it should
 * be. Anything else is dropped without an answer. The two asks carry no data, so they
 * go to the parent whoever it is, as `note-panel` does. What a `note-tab-run` brings
 * comes back as a `note-put`.
 */
import { splitHash } from '../hash.js';
import { acceptsOrigin } from './panelOrigin.js';

export const VERSION = 1;
export const ACTIONS = ['cite', 'quote', 'picture'];
/** What the browser tab in front lets the extension do: read it, wait for a first permission, or nothing. */
export const TAB_ACCESS = ['open', 'closed', 'none'];
/** What the Add menu asks the extension to do with that tab. */
export const TAB_ACTIONS = ['capture', 'cite', 'quote', 'allow'];
/** The longest of each field a put or a tab may carry. */
export const LIMITS = { url: 2048, title: 300, text: 5000, selection: 5000 };

const KEYS = new Set(['azimut', 'v', 'id', 'action', 'url', 'title', 'text', 'entityId']);
const TAB_KEYS = ['azimut', 'v', 'access', 'url', 'title', 'selection', 'post', 'map'];
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Whether this page is the note in the extension's panel: asked for so, and framed. */
export function inNotePanel(hash, win = globalThis.window) {
  const { route, params } = splitHash(hash);
  return route === 'notebook' && params.get('panel') === '1' && Boolean(win) && win.parent !== win;
}

function webAddress(value) {
  if (typeof value !== 'string' || !value || value.length > LIMITS.url) return null;
  try {
    const url = new URL(value);
    const web = (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname;
    // written out in full, as the case keeps it, it still fits
    return web && url.href.length <= LIMITS.url ? url.href : null;
  } catch {
    return null;
  }
}

const absent = (value) => value === undefined || value === null;

/**
 * A put as the panel takes it, `{ id, action, url, title, text, entityId }`, or null
 * when anything about it is off: an unknown key, a field of the wrong kind or too
 * long, an address that is not http(s), a quote with no words, a picture with no record.
 */
export function readPut(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (Object.getPrototypeOf(data) !== Object.prototype && Object.getPrototypeOf(data) !== null) return null;
  if (Object.keys(data).some((key) => !KEYS.has(key))) return null;
  if (data.azimut !== 'note-put' || data.v !== VERSION) return null;
  if (typeof data.id !== 'string' || !ID.test(data.id)) return null;
  if (!ACTIONS.includes(data.action)) return null;

  let url = '';
  if (!absent(data.url)) {
    url = webAddress(data.url);
    if (!url) return null;
  }
  if (!absent(data.title) && (typeof data.title !== 'string' || data.title.length > LIMITS.title)) return null;
  if (!absent(data.text) && (typeof data.text !== 'string' || data.text.length > LIMITS.text)) return null;
  if (!absent(data.entityId) && (typeof data.entityId !== 'string' || !ID.test(data.entityId))) return null;
  const title = (data.title ?? '').replace(/\s+/g, ' ').trim();
  const text = data.text ?? '';

  if ((data.action === 'cite' || data.action === 'quote') && !url) return null;
  if (data.action === 'quote' && !text.trim()) return null;
  if (data.action === 'picture' && absent(data.entityId)) return null;
  return { id: data.id, action: data.action, url, title, text, entityId: data.entityId ?? '' };
}

/**
 * The tab in front as the panel takes it, `{ access, url, title, selection, post }`, or
 * null when anything about it is off: a key missing or unknown, a field of the wrong
 * kind or too long, an address that is not http(s), or a tab it may read that has none.
 * A tab it may not read (`closed`, `none`) holds nothing, whatever it was sent.
 */
export function readTab(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (Object.getPrototypeOf(data) !== Object.prototype && Object.getPrototypeOf(data) !== null) return null;
  const keys = Object.keys(data);
  if (keys.length !== TAB_KEYS.length || TAB_KEYS.some((key) => !keys.includes(key))) return null;
  if (data.azimut !== 'note-tab' || data.v !== VERSION) return null;
  if (!TAB_ACCESS.includes(data.access)) return null;
  if (typeof data.url !== 'string' || data.url.length > LIMITS.url) return null;
  if (typeof data.title !== 'string' || data.title.length > LIMITS.title) return null;
  if (typeof data.selection !== 'string' || data.selection.length > LIMITS.selection) return null;
  if (typeof data.post !== 'boolean' || typeof data.map !== 'boolean') return null;
  const url = data.url === '' ? '' : webAddress(data.url);
  if (url === null) return null;
  if (data.access !== 'open') return { access: data.access, url: '', title: '', selection: '', post: false, map: false };
  if (!url) return null;
  return {
    access: 'open',
    url,
    title: data.title.replace(/\s+/g, ' ').trim(),
    selection: data.selection.trim() ? data.selection : '',
    post: data.post,
    map: data.map,
  };
}

/** What the panel says it holds: a note, with its case, or none. Case notes are `case`. */
export function panelState(note) {
  if (!note?.caseId) return { azimut: 'note-panel', v: VERSION, state: 'none' };
  return {
    azimut: 'note-panel',
    v: VERSION,
    state: 'ready',
    caseId: note.caseId,
    noteId: note.noteId ?? 'case',
    title: note.title || 'Case notes',
  };
}

/** The answer to put `id`. */
export function putDone(id, { ok, error = '' } = {}) {
  return ok
    ? { azimut: 'note-put-done', v: VERSION, id, ok: true }
    : { azimut: 'note-put-done', v: VERSION, id, ok: false, error: error || 'Nothing was put in the note' };
}

/** Say what the panel holds to the extension's page that frames it. */
export function tellPanel(note, win = globalThis.window) {
  if (!win || win.parent === win) return;
  // Before any message from it the panel cannot know its parent's origin. Only the
  // app itself and an extension's page may frame the app (`frame-ancestors`).
  win.parent.postMessage(panelState(note), '*');
}

/**
 * Take puts from the extension's page that frames this one: `run(put)` answers
 * `{ ok, error? }`, sent back to that page alone. Answers the undoing.
 */
export function receivePuts(run, { win = globalThis.window, accepts = acceptsOrigin } = {}) {
  if (!win || win.parent === win) return () => {};
  const listener = async (event) => {
    if (event.source !== win.parent || !accepts(event.origin)) return;
    const put = readPut(event.data);
    if (!put) return;
    let answer;
    try {
      answer = await run(put);
    } catch (error) {
      answer = { ok: false, error: error?.message };
    }
    event.source.postMessage(putDone(put.id, answer ?? {}), event.origin);
  };
  win.addEventListener('message', listener);
  return () => win.removeEventListener('message', listener);
}

/**
 * Take what the extension's page that frames this one says about the tab in front:
 * `handle(tab)` gets it as `readTab` reads it. Nothing is answered. Answers the undoing.
 */
export function receiveTab(handle, { win = globalThis.window, accepts = acceptsOrigin } = {}) {
  if (!win || win.parent === win) return () => {};
  const listener = (event) => {
    if (event.source !== win.parent || !accepts(event.origin)) return;
    const tab = readTab(event.data);
    if (tab) handle(tab);
  };
  win.addEventListener('message', listener);
  return () => win.removeEventListener('message', listener);
}

/**
 * Ask the extension's page what the tab in front is (the Add menu opened). It answers
 * with a `note-tab`. Like `tellPanel`, to the parent whoever it is: the ask holds no data.
 */
export function askTab(win = globalThis.window) {
  if (!win || win.parent === win) return false;
  win.parent.postMessage({ azimut: 'note-tab-ask', v: VERSION }, '*');
  return true;
}

/**
 * Ask the extension's page to add from the tab in front: `capture` (draw the map's area),
 * `cite` (the page), `quote` (the words selected) or `allow` (its first permission).
 * Answers whether it was asked; any other word is not sent.
 */
export function runTab(action, win = globalThis.window) {
  if (!TAB_ACTIONS.includes(action) || !win || win.parent === win) return false;
  win.parent.postMessage({ azimut: 'note-tab-run', v: VERSION, action }, '*');
  return true;
}
