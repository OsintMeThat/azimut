// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The note editor as the tools reach it: where a put lands, the pictures its picker
 * offers, and a pasted link looked up in the case before anything is filed.
 */

const { get, post, put } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: { get, post, put, del: vi.fn(), patch: vi.fn() } }));
const { reloadCase } = vi.hoisted(() => ({ reloadCase: vi.fn(async () => {}) }));
vi.mock('../lib/state.svelte.js', async (actual) => ({ ...(await actual()), reloadCase }));

const { prefs, uiState } = await import('../lib/state.svelte.js');
const { openNote, resetOpenNotes, noteReady } = await import('../lib/notes/noteDoc.svelte.js');
const { default: NoteEditor } = await import('./NoteEditor.svelte');
const { registerOpener } = await import('../lib/notes/openers.js');

const ENTITIES = [
  { id: 'm1', type: 'media', label: 'Roof shot', attrs: { path: 'media/roof.png', kind: 'image' } },
  { id: 'pr1', type: 'proof', label: 'Depot proof', attrs: { path: 'proofs/depot.png', spec: 'proofs/.meta/depot.json' } },
  { id: 'pr2', type: 'proof', label: 'Unsaved proof', attrs: { spec: 'proofs/.meta/x.json' } },
  { id: 'pl1', type: 'place', label: 'Depot', attrs: {} },
];

let target;
let app;
let handle;

async function settle() {
  for (let round = 0; round < 20; round += 1) await Promise.resolve();
  flushSync();
}

async function editor(text = 'Seen at the quay.') {
  get.mockImplementation(async (url) => {
    if (url.includes('/sources/lookup')) return lookupAnswer(url);
    return { text };
  });
  const doc = openNote('c1', 'n1');
  await noteReady(doc);
  target = document.createElement('div');
  document.body.append(target);
  app = mount(NoteEditor, { target, props: { doc, caseId: 'c1', entities: ENTITIES, where: 'dock', onready: (api) => (handle = api) } });
  await settle();
  return doc;
}

let lookupAnswer = () => ({ url: '', title: '', found: [] });
const view = () => target.querySelector('.cm-content');

beforeEach(() => {
  uiState.toasts.splice(0);
  put.mockResolvedValue({ status: 'saved' });
});

afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  app = null;
  handle = null;
  resetOpenNotes();
  vi.clearAllMocks();
});

describe('where a put lands', () => {
  it('is the end of a note nobody wrote in this visit', async () => {
    await editor('First line.\n\nLast line.');
    const spot = handle.spot();
    const landed = handle.place(spot, 'PUT');
    expect(landed.text).toBe('\n\nPUT\n');
    expect(view().textContent).toBe('First line.Last line.PUT');
  });

  it('is the cursor once the note was written in', async () => {
    await editor('First line.\n\nLast line.');
    view().dispatchEvent(new FocusEvent('focus'));
    // the cursor is where the editor opened, at the start
    const landed = handle.place(handle.spot(), 'PUT', { inline: true });
    expect(landed.text).toBe('PUT ');
    expect(view().textContent.startsWith('PUT First line.')).toBe(true);
  });

  it('is taken back by Undo', async () => {
    await editor('First line.');
    const landed = handle.place(handle.spot(), 'PUT');
    expect(handle.takeBack(landed)).toBe(true);
    expect(view().textContent).toBe('First line.');
  });
});

describe('the picture picker', () => {
  it('offers the case’s proofs beside its pictures, never a proof with no picture yet', async () => {
    await editor();
    target.querySelector('button[aria-label="Put in a case picture"]').click();
    flushSync();
    const rows = [...target.querySelectorAll('.picture-row:not(.built-in) span')].map((row) => row.textContent);
    expect(rows).toEqual(['Depot proof', 'Roof shot']);
    target.querySelector('.picture-row:not(.built-in)').click();
    flushSync();
    expect(handle).not.toBeNull();
    expect(target.querySelector('.cm-block-picture img').getAttribute('alt')).toBe('Depot proof');
  });

  it('offers the Azimut logo, your logo and your signature first, each said missing until Settings has it', async () => {
    prefs.logoSet = true;
    prefs.signatureSet = false;
    const doc = await editor('');
    target.querySelector('button[aria-label="Put in a case picture"]').click();
    flushSync();
    const own = [...target.querySelectorAll('.picture-row.built-in')];
    expect(own.map((row) => row.querySelector('span').textContent)).toEqual(['Azimut logo', 'Your logo', 'Your signature']);
    expect(own.map((row) => Boolean(row.querySelector('small')))).toEqual([false, false, true]);
    expect(own[2].title).toBe('No signature set in Settings › Publishing');
    own[1].click();
    flushSync();
    expect(doc.text).toBe('![Logo](azimut:my-logo){width=25%}\n');
    expect(target.querySelector('.cm-block-picture img').getAttribute('src')).toMatch(/^\/api\/notes\/pictures\/my-logo\?v=/);
    prefs.logoSet = false;
  });
});

describe('/ › Cover page', () => {
  async function pickCover(props = {}) {
    const doc = await editor('Findings.');
    get.mockImplementation(async (url) => (url.endsWith('/look') ? { look: { style: 'report', cover: { on: true, subtitle: 'Kept' } } } : { text: 'Findings.' }));
    if (Object.keys(props).length) {
      unmount(app);
      app = mount(NoteEditor, { target, props: { doc, caseId: 'c1', entities: ENTITIES, onready: (api) => (handle = api), ...props } });
      await settle();
    }
    const { EditorView } = await import('@codemirror/view');
    const { startCompletion, acceptCompletion } = await import('@codemirror/autocomplete');
    const cm = EditorView.findFromDOM(target.querySelector('.cm-editor'));
    cm.dispatch({ changes: { from: cm.state.doc.length, insert: '\n\n/cover' }, selection: { anchor: cm.state.doc.length + 8 } });
    startCompletion(cm);
    await vi.waitFor(() => expect(target.querySelector('.cm-tooltip-autocomplete li[aria-selected]')?.textContent).toContain('Cover page'));
    // a list just opened takes no Enter for a moment (`interactionDelay`)
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(acceptCompletion(cm)).toBe(true);
    await settle();
    return doc;
  }

  it('writes the page at the top and, with no Look beside the note, turns its look to Your own page itself', async () => {
    put.mockImplementation(async (url, body) => (url.endsWith('/look') ? { look: body } : { status: 'saved' }));
    const doc = await pickCover();
    expect(doc.text.startsWith('::: top-right\n![Azimut](azimut:logo)')).toBe(true);
    expect(doc.text).toContain('<!-- cover -->\n\nFindings.');
    await vi.waitFor(() => expect(put.mock.calls.some(([url]) => url === '/api/cases/c1/notes/n1/look')).toBe(true));
    const [, look] = put.mock.calls.find(([url]) => url === '/api/cases/c1/notes/n1/look');
    expect(look.cover).toMatchObject({ on: true, mode: 'own', subtitle: 'Kept' });
  });

  it('hands the look to the Notebook when it shows one', async () => {
    const oncover = vi.fn();
    const doc = await pickCover({ oncover });
    expect(oncover).toHaveBeenCalledTimes(1);
    expect(doc.text).toContain('<!-- cover -->');
    expect(put.mock.calls.some(([url]) => url.endsWith('/look'))).toBe(false);
  });
});

describe('a pasted link', () => {
  function paste(url) {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    event.clipboardData = { items: [], getData: () => url };
    view().dispatchEvent(event);
  }

  it('offers to cite what the case already filed for it', async () => {
    lookupAnswer = () => ({ url: 'https://x.com/a/status/1', title: 'Post by @a on X', found: [{ id: 'b1', type: 'bookmark', label: 'Kept post', attrs: {} }] });
    await editor('');
    paste('https://x.com/a/status/1');
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settle();
    const said = uiState.toasts.at(-1);
    expect(said.message).toBe('Already in the case as “Kept post”');
    expect(said.action.label).toBe('Cite it');
    expect(post).not.toHaveBeenCalled();
  });

  it('offers a bookmark named from the address when the case holds none', async () => {
    lookupAnswer = () => ({ url: 'https://t.me/port/4', title: 'Telegram, port #4', found: [] });
    post.mockResolvedValue({ id: 'b9', type: 'bookmark', label: 'Telegram, port #4', attrs: {} });
    await editor('');
    paste('https://t.me/port/4');
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settle();
    const said = uiState.toasts.at(-1);
    expect(said.message).toBe('Link pasted');
    await said.action.onClick();
    expect(post).toHaveBeenCalledWith('/api/cases/c1/entities', {
      type: 'bookmark', label: 'Telegram, port #4', attrs: { url: 'https://t.me/port/4', notes: '', folder: '' },
    });
  });
});

describe('without the app\'s tools around it', () => {

  async function shown(props = {}) {
    get.mockImplementation(async () => ({ text: '[[media:m1|Roof shot]]\n\nSeen at 14.79800, 42.95400.' }));
    // whether the picture's source may be stated: read off the media index
    post.mockResolvedValue([]);
    const doc = openNote('c1', 'n1');
    await noteReady(doc);
    target = document.createElement('div');
    document.body.append(target);
    app = mount(NoteEditor, { target, props: { doc, caseId: 'c1', entities: ENTITIES, ...props } });
    await settle();
  }

  it('offers no Open in… on a picture and no way to the map on coordinates, as the extension\'s panel has none', async () => {
    const undo = registerOpener('collage', { accepts: (entity) => entity.id === 'm1', open: vi.fn(), label: 'Open in Collage' });
    try {
      await shown();
      expect(target.querySelector('.cm-coords-go')).not.toBeNull();
      expect(target.querySelector('.cm-size-bar [data-open]')?.textContent).toBe('Open in Collage');
      unmount(app);
      target.remove();
      resetOpenNotes();
      await shown({ tools: false });
      expect(target.querySelector('.cm-coords')).not.toBeNull();
      expect(target.querySelector('.cm-coords-go')).toBeNull();
      expect(target.querySelector('.cm-size-bar')).not.toBeNull();
      expect(target.querySelector('.cm-size-bar [data-open]')).toBeNull();
    } finally {
      undo();
    }
  });
});
