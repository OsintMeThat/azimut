// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The note in the extension's side panel: the case and the note, each picked in
 * the bar, the note or its pages, and nothing else. It tells the extension's page
 * which note it holds, and what that page sends lands like every tool's put, with
 * the toast and its Undo. A message from anywhere but an extension's page gets no
 * answer and changes nothing.
 */

const { get, post, put, del, postBytes } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), postBytes: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: { get, post, put, del, postBytes, patch: vi.fn() } }));
// the PDF is drawn by PDF.js in a browser; here a document of two A4 pages stands for it
const { pdf } = vi.hoisted(() => ({ pdf: { destroy: null } }));
vi.mock('../lib/notes/pdfjs.js', () => ({
  openPdf: vi.fn(async () => ({
    numPages: 2,
    getPage: async () => ({ getViewport: () => ({ width: 595, height: 842 }) }),
    destroy: pdf.destroy,
  })),
  drawPage: vi.fn(async () => document.createElement('canvas')),
  releaseCanvas: vi.fn((canvas) => canvas?.remove()),
}));
vi.mock('../lib/catalog.js', () => ({
  fetchAllEntities: vi.fn(async (caseId) => (caseId === 'case-b'
    ? [{ id: 'n9', type: 'note', label: 'Depot', attrs: {} }]
    : [{ id: 'n1', type: 'note', label: 'Port lead', attrs: {} }])),
}));
const { opened } = vi.hoisted(() => ({ opened: { id: 'case-a' } }));
vi.mock('../lib/state.svelte.js', async (actual) => {
  const real = await actual();
  return {
    ...real,
    initSession: vi.fn(async (asked) => {
      if (opened.id) real.caseState.current = { id: asked || opened.id, name: 'Harbour strike', folders: [] };
    }),
  };
});
vi.mock('../lib/entityTypes.svelte.js', async (actual) => ({ ...(await actual()), loadEntityTypes: vi.fn() }));

// what is near the view is said at once: every page is seen
vi.stubGlobal('IntersectionObserver', class {
  constructor(callback) { this.callback = callback; }
  observe(node) { queueMicrotask(() => this.callback([{ target: node, isIntersecting: true }])); }
  unobserve() {}
  disconnect() {}
});

const { caseState, uiState } = await import('../lib/state.svelte.js');
const { pinnedNote } = await import('../lib/notes/putInNote.svelte.js');
const { openNote, releaseNote, resetOpenNotes } = await import('../lib/notes/noteDoc.svelte.js');
const { setDockNote } = await import('../lib/notes/noteDock.svelte.js');
const { releaseCanvas } = await import('../lib/notes/pdfjs.js');
const { default: NotePanel } = await import('./NotePanel.svelte');

const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const PAGE = 'https://example.org/news/strike';

let target;
let app;
let parent;
let written;

async function settle(rounds = 30) {
  for (let round = 0; round < rounds; round += 1) await Promise.resolve();
  flushSync();
}

async function panel(hash = '#notebook?case=case-a&note=n1&solo=1&panel=1') {
  history.replaceState(null, '', `/${hash}`);
  target = document.createElement('div');
  document.body.append(target);
  app = mount(NotePanel, { target });
  await settle();
  await vi.waitFor(() => expect(target.querySelector('.cm-content')).not.toBeNull());
  await settle();
}

/** What the extension's page was told, in order. */
const told = () => parent.postMessage.mock.calls.map(([message, origin]) => ({ ...message, to: origin }));

function send(data, { origin = EXT, source = parent } = {}) {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
}

const CASES = [
  { id: 'case-a', name: 'Harbour strike', scratch: false },
  { id: 'case-b', name: 'Dock fire', scratch: false },
  { id: 'scratch-1', name: 'scratch-1', scratch: true },
];

beforeEach(() => {
  localStorage.clear();
  opened.id = 'case-a';
  written = '';
  pdf.destroy = vi.fn();
  parent = { postMessage: vi.fn() };
  Object.defineProperty(window, 'parent', { value: parent, configurable: true });
  get.mockImplementation(async (url) => {
    if (url.endsWith('/notes/index')) {
      return { items: [{ id: 'case', title: 'Case notes', folder: '', updated_at: '' }, { id: 'n1', title: 'Port lead', folder: '', updated_at: '2026-11-01T10:00:00Z' }] };
    }
    if (url.includes('/sources/lookup')) return { url: PAGE, title: 'Strike on the port', found: [] };
    if (url === '/api/cases/case-a') return { id: 'case-a', name: 'Harbour strike', folders: [] };
    if (url === '/api/cases/case-b') return { id: 'case-b', name: 'Dock fire', folders: [] };
    if (url === '/api/cases') return CASES;
    if (url === '/api/workspace/folders') return [{ name: 'Loose photos', state: 'adoptable' }];
    if (url.endsWith('/look')) return { look: { style: 'report' } };
    if (url === '/api/cases/case-b/notes/n9') return { text: 'Smoke over the depot.' };
    return { text: written };
  });
  postBytes.mockResolvedValue({
    data: new ArrayBuffer(8),
    headers: new Headers({
      'X-Note-Pages': '[0, 6]',
      'X-Note-Warnings': JSON.stringify(['1 task is still open.']),
      'X-Note-Warning-Lines': '[4]',
      'X-Note-Warning-Kinds': '["open-task"]',
    }),
  });
  put.mockImplementation(async (_url, body) => { written = body.text; return { status: 'saved' }; });
  post.mockImplementation(async (url, body) => {
    if (url.endsWith('/entities')) return { id: 'b_new', ...body };
    return { redirects: {} };
  });
  del.mockResolvedValue({ status: 'deleted', deleted: ['b_new'], tombstoned: [], trash: 't1' });
});

afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  document.querySelectorAll('.float-menu').forEach((node) => node.remove());
  app = null;
  resetOpenNotes();
  caseState.current = null;
  caseState.list = [];
  caseState.folders = [];
  uiState.toasts.splice(0);
  delete window.parent;
  vi.clearAllMocks();
});

describe('the note in the extension\'s panel', () => {
  it('shows the note asked for under its case, pins it, and tells the extension it holds it', async () => {
    await panel();
    expect(target.querySelector('.case').textContent).toBe('Harbour strike');
    expect(target.querySelector('button.which').textContent).toContain('Port lead');
    // the case, the note and Write | Page: none of the dock's Add, Notebook, own tab or close
    expect([...target.querySelectorAll('.panel-bar button')].map((button) => button.textContent.trim()))
      .toEqual(['Harbour strike', 'Port lead', 'Write', 'Page']);
    expect(pinnedNote()).toEqual({ caseId: 'case-a', noteId: 'n1', title: 'Port lead' });
    await vi.waitFor(() => expect(told()).toContainEqual({
      azimut: 'note-panel', v: 1, state: 'ready', caseId: 'case-a', noteId: 'n1', title: 'Port lead', to: '*',
    }));
  });

  it('picks another note of the case, keeps it in the address, and says so', async () => {
    await panel();
    target.querySelector('button.which').click();
    await settle();
    const rows = [...document.querySelectorAll('.float-menu button')];
    // Case notes and the case's notes, nothing else
    expect(rows.map((row) => row.textContent.trim())).toEqual(['Case notes', 'Port lead']);
    rows[0].click();
    await settle();
    await vi.waitFor(() => expect(told().at(-1)).toMatchObject({ state: 'ready', noteId: 'case', title: 'Case notes' }));
    expect(location.hash).toContain('note=case');
    expect(location.hash).toContain('panel=1');
  });

  it('puts a quote the extension sends, linked to its passage, with the toast and its Undo', async () => {
    await panel();
    send({ azimut: 'note-put', v: 1, id: 'put-1', action: 'quote', url: PAGE, title: 'Strike | Example', text: 'Berths 10 to 14 were closed.' });
    await vi.waitFor(() => expect(told()).toContainEqual({ azimut: 'note-put-done', v: 1, id: 'put-1', ok: true, to: EXT }));
    await vi.waitFor(() => expect(written).toContain(
      `> [“Berths 10 to 14 were closed.”](${PAGE}#:~:text=Berths%2010%20to%2014%20were%20closed.) [[entity:b_new|Strike on the port]]`));
    expect(get).toHaveBeenCalledWith(expect.stringContaining('title=Strike+%7C+Example'));
    const toast = uiState.toasts.find((item) => item.message === 'Put in “Port lead”');
    expect(toast.action.label).toBe('Undo');
    await toast.action.onClick();
    await vi.waitFor(() => expect(del).toHaveBeenCalledWith('/api/cases/case-a/entities/b_new'));
  });

  it('answers a refused put with its sentence', async () => {
    await panel();
    get.mockImplementation(async (url) => (url.includes('/chain') ? Promise.reject(new Error('not found')) : { text: written }));
    send({ azimut: 'note-put', v: 1, id: 'put-2', action: 'picture', entityId: 'e_gone' });
    await vi.waitFor(() => expect(told()).toContainEqual({
      azimut: 'note-put-done', v: 1, id: 'put-2', ok: false, error: 'That capture is not in this case', to: EXT,
    }));
  });

  it('says so when the note is open in another tab, and files nothing', async () => {
    await panel();
    const doc = openNote('case-a', 'n1');
    doc.elsewhere = true;
    send({ azimut: 'note-put', v: 1, id: 'put-6', action: 'cite', url: PAGE });
    await vi.waitFor(() => expect(told()).toContainEqual({
      azimut: 'note-put-done', v: 1, id: 'put-6', ok: false, error: 'This note is open in another tab', to: EXT,
    }));
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining('/sources/lookup'));
    await releaseNote(doc);
  });

  it('drops a put from a web page or a window that does not frame it, without an answer', async () => {
    await panel();
    const before = told().length;
    send({ azimut: 'note-put', v: 1, id: 'put-3', action: 'cite', url: PAGE }, { origin: 'https://evil.example' });
    send({ azimut: 'note-put', v: 1, id: 'put-4', action: 'cite', url: PAGE }, { source: window });
    send({ azimut: 'note-put', v: 1, id: 'put-5', action: 'cite', url: 'javascript:alert(1)' });
    await settle(60);
    expect(told().slice(before)).toEqual([]);
    expect(post).not.toHaveBeenCalledWith(expect.stringMatching(/\/entities$/), expect.anything());
  });

  it('says how to open a case when none is open, and that it holds no note', async () => {
    opened.id = '';
    history.replaceState(null, '', '/#notebook?solo=1&panel=1');
    target = document.createElement('div');
    document.body.append(target);
    app = mount(NotePanel, { target });
    await settle();
    expect(target.querySelector('.none').textContent.trim())
      .toBe("Open a case in Azimut, or pick one in the extension's popup, then open Notes again.");
    expect(told()).toEqual([{ azimut: 'note-panel', v: 1, state: 'none', to: '*' }]);
  });
});

describe('the pages of the panel\'s note', () => {
  const LINES = 'One\nTwo\nThree\nFour\nFive\nSix\nSeven\nEight';
  const bar = (words) => [...target.querySelectorAll('.panel-bar button')].find((button) => button.textContent.trim() === words);
  const pressed = () => [...target.querySelectorAll('.modes button[aria-pressed="true"]')].map((button) => button.textContent.trim());
  async function cursorLine() {
    const { EditorView } = await import('@codemirror/view');
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor'));
    return view.state.doc.lineAt(view.state.selection.main.head).number;
  }

  it('shows the note\'s pages in its place on Page, remembers it for the panel, and lets them go on Write', async () => {
    written = LINES;
    postBytes.mockResolvedValue({
      data: new ArrayBuffer(8),
      headers: new Headers({
        'X-Note-Pages': '[0, 6]',
        'X-Note-Pictures': JSON.stringify([{ line: 2, ref: 'media:m2', page: 0, box: [0.1, 0.2, 0.4, 0.2], width: '50%', align: 'left' }]),
      }),
    });
    await panel();
    const editor = target.querySelector('.cm-editor');
    expect(target.querySelector('.page-pane')).toBeNull();
    expect(pressed()).toEqual(['Write']);
    expect(postBytes).not.toHaveBeenCalled();

    bar('Page').click();
    await settle();
    await vi.waitFor(() => expect(target.querySelectorAll('.sheet')).toHaveLength(2));
    expect(pressed()).toEqual(['Page']);
    expect(localStorage.getItem('azimut:notePanel-page')).toBe('1');
    expect(localStorage.getItem('azimut:noteDock-page')).toBeNull();
    const [url, body] = postBytes.mock.calls[0];
    expect(url).toBe('/api/cases/case-a/notes/preview');
    // in the look the Notebook gave it
    expect(body).toMatchObject({ note: 'n1', title: 'Port lead', text: LINES, look: { style: 'report' } });
    // the text stays under the pages, out of reach, as it was
    const writing = target.querySelector('.writing');
    expect(writing.classList.contains('away')).toBe(true);
    expect(writing.hasAttribute('inert')).toBe(true);
    expect(target.querySelector('.cm-editor')).toBe(editor);
    // a picture goes to its line, but has no size marks on a page this narrow
    expect(target.querySelector('.picture-hit')).not.toBeNull();
    expect(target.querySelector('.picture-bar')).toBeNull();

    bar('Write').click();
    flushSync();
    expect(target.querySelector('.page-pane')).toBeNull();
    expect(writing.hasAttribute('inert')).toBe(false);
    expect(target.querySelector('.cm-editor')).toBe(editor);
    expect(localStorage.getItem('azimut:notePanel-page')).toBe('0');
    expect(pdf.destroy).toHaveBeenCalled();
    expect(releaseCanvas).toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('opens on the pages when left there, and goes back to Write at the line a page or a warning is about', async () => {
    written = LINES;
    localStorage.setItem('azimut:notePanel-page', '1');
    await panel();
    await vi.waitFor(() => expect(target.querySelectorAll('.sheet')).toHaveLength(2));
    expect(pressed()).toEqual(['Page']);

    target.querySelectorAll('.sheet .hit')[1].click();
    flushSync();
    expect(target.querySelector('.page-pane')).toBeNull();
    expect(pressed()).toEqual(['Write']);
    expect(await cursorLine()).toBe(7);
    expect(localStorage.getItem('azimut:notePanel-page')).toBe('0');

    // a browser takes the focus from text made inert; happy-dom leaves it there
    document.activeElement?.blur();
    bar('Page').click();
    await settle();
    await vi.waitFor(() => expect(target.querySelector('.warning.go')).not.toBeNull());
    expect(target.querySelector('.warning.go').textContent).toContain('1 task is still open.');
    target.querySelector('.warning.go').click();
    flushSync();
    expect(target.querySelector('.page-pane')).toBeNull();
    expect(await cursorLine()).toBe(5);
  });

  it('brings the text back for a put sent while the pages show, and lands it there', async () => {
    localStorage.setItem('azimut:notePanel-page', '1');
    await panel();
    await vi.waitFor(() => expect(target.querySelector('.page-pane')).not.toBeNull());
    send({ azimut: 'note-put', v: 1, id: 'put-7', action: 'quote', url: PAGE, title: 'Strike | Example', text: 'Berths closed.' });
    await vi.waitFor(() => expect(told()).toContainEqual({ azimut: 'note-put-done', v: 1, id: 'put-7', ok: true, to: EXT }));
    expect(target.querySelector('.page-pane')).toBeNull();
    expect(pressed()).toEqual(['Write']);
    expect(target.querySelector('.cm-content').textContent).toContain('Berths closed.');
    expect(uiState.toasts.some((item) => item.message === 'Put in “Port lead”')).toBe(true);
  });
});

describe('the panel\'s case', () => {
  const caseRows = () => [...document.querySelectorAll('.float-menu[aria-label="Cases"] button')];

  async function openCases() {
    target.querySelector('.panel-bar button.case').click();
    await settle();
    await vi.waitFor(() => expect(caseRows()).toHaveLength(3));
  }

  it('lists the workspace\'s cases with the one open marked, and nothing else', async () => {
    await panel();
    await openCases();
    expect(caseRows().map((row) => row.textContent.replace(/\s+/g, ' ').trim())).toEqual(['Harbour strike', 'Dock fire', 'scratch-1 scratch']);
    expect(document.querySelector('.float-menu [aria-current="true"]').textContent.trim()).toBe('Harbour strike');
    // a workspace folder is not a case
    expect(document.querySelector('.float-menu').textContent).not.toContain('Loose photos');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(document.querySelector('.float-menu')).toBeNull();
  });

  it('switches to another case in place, on the note pinned for it, once the note shown is written', async () => {
    await panel();
    setDockNote('case-b', 'n9');
    const { EditorView } = await import('@codemirror/view');
    EditorView.findFromDOM(target.querySelector('.cm-editor')).dispatch({ changes: { from: 0, insert: 'Pier 4. ' } });
    await openCases();
    caseRows().find((row) => row.textContent.includes('Dock fire')).click();
    await vi.waitFor(() => expect(told().at(-1)).toMatchObject({ state: 'ready', caseId: 'case-b', noteId: 'n9', title: 'Depot' }));
    // what was typed was written to the case left, before the other was opened
    const wrote = put.mock.calls.findIndex(([url, body]) => url === '/api/cases/case-a/notes/n1' && body.text === 'Pier 4. ');
    const opening = get.mock.calls.findIndex(([url]) => url === '/api/cases/case-b');
    expect(wrote).toBeGreaterThanOrEqual(0);
    expect(put.mock.invocationCallOrder[wrote]).toBeLessThan(get.mock.invocationCallOrder[opening]);
    expect(target.querySelector('.panel-bar button.case').textContent.trim()).toBe('Dock fire');
    expect(target.querySelector('button.which').textContent).toContain('Depot');
    await vi.waitFor(() => expect(target.querySelector('.cm-content').textContent).toContain('Smoke over the depot.'));
    expect(pinnedNote()).toEqual({ caseId: 'case-b', noteId: 'n9', title: 'Depot' });
    expect(location.hash).toContain('case=case-b');
    expect(location.hash).toContain('note=n9');
    expect(location.hash).toContain('panel=1');
  });

  it('shows Case notes for a case with no note pinned', async () => {
    await panel();
    await openCases();
    caseRows().find((row) => row.textContent.includes('Dock fire')).click();
    await vi.waitFor(() => expect(told().at(-1)).toMatchObject({ state: 'ready', caseId: 'case-b', noteId: 'case', title: 'Case notes' }));
    expect(location.hash).toContain('note=case');
  });

  it('stays on its case when the note shown could not be written', async () => {
    await panel();
    put.mockRejectedValue(new Error('disk full'));
    const { EditorView } = await import('@codemirror/view');
    EditorView.findFromDOM(target.querySelector('.cm-editor')).dispatch({ changes: { from: 0, insert: 'Pier 4. ' } });
    await openCases();
    caseRows().find((row) => row.textContent.includes('Dock fire')).click();
    await vi.waitFor(() => expect(uiState.toasts.map((item) => item.message))
      .toContain('The note is not saved, so this case stays open: disk full'));
    expect(caseState.current.id).toBe('case-a');
    expect(get).not.toHaveBeenCalledWith('/api/cases/case-b');
  });
});
