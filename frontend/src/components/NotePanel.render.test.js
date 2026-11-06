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
const { forgetMaps } = await import('../lib/notes/panelTab.js');
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
  forgetMaps();
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
    // the case, the note, the note's look, Write | Page and Add: none of the dock's Notebook, own tab or close
    expect([...target.querySelectorAll('.panel-bar button')].map((button) => button.textContent.trim()))
      .toEqual(['Harbour strike', 'Port lead', 'LookReport', 'Write', 'Page', 'Add']);
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

describe('the Look in the panel\'s bar', () => {
  const lookButton = () => target.querySelector('.panel-bar [data-guide="notebook.look"]');
  const menu = () => document.querySelector('.float-menu[aria-label="Look"]');
  const goTo = (name) => {
    [...menu().querySelectorAll('[role="tab"]')].find((item) => item.textContent.trim() === name).click();
    flushSync();
  };
  const looks = () => put.mock.calls.filter(([url]) => url.endsWith('/look'));
  const keepLooks = () => put.mockImplementation(async (url, body) => {
    if (url.endsWith('/look')) return { look: body };
    written = body.text;
    return { status: 'saved' };
  });

  it('sits between Saved and Write | Page, names the note\'s style, and is read with the note', async () => {
    await panel();
    const bar = target.querySelector('.panel-bar');
    const order = [...bar.children].map((node) => node.className || node.tagName);
    expect(order.indexOf(lookButton().className)).toBeGreaterThan(order.findIndex((name) => String(name).includes('said')));
    expect(lookButton().nextElementSibling.className).toContain('modes');
    expect(lookButton().textContent).toContain('Report');
    expect(get).toHaveBeenCalledWith('/api/cases/case-a/notes/n1/look');
    expect(lookButton().disabled).toBe(false);
  });

  it('is out of reach until the look is read', async () => {
    let release;
    get.mockImplementation(async (url) => {
      if (url.endsWith('/look')) return new Promise((resolve) => { release = () => resolve({ look: { style: 'brief' } }); });
      if (url.endsWith('/notes/index')) return { items: [] };
      if (url === '/api/cases/case-a') return { id: 'case-a', name: 'Harbour strike', folders: [] };
      return { text: written };
    });
    await panel();
    expect(lookButton().disabled).toBe(true);
    release();
    await settle();
    expect(lookButton().disabled).toBe(false);
    expect(lookButton().textContent).toContain('Brief');
  });

  it('keeps a style picked beside the note, as the Notebook does, and shows it at once', async () => {
    keepLooks();
    await panel();
    lookButton().click();
    flushSync();
    goTo('Style');
    [...menu().querySelectorAll('.style-card')].find((card) => card.textContent.includes('Journal')).click();
    await settle();
    expect(looks()).toHaveLength(1);
    expect(looks()[0][0]).toBe('/api/cases/case-a/notes/n1/look');
    expect(looks()[0][1]).toMatchObject({ style: 'journal' });
    expect(lookButton().textContent).toContain('Journal');
    // only the look was written: the note's text is its own
    expect(put.mock.calls.some(([url]) => url === '/api/cases/case-a/notes/n1')).toBe(false);
  });

  it('keeps the look of the case notes beside them', async () => {
    keepLooks();
    await panel('#notebook?case=case-a&note=case&solo=1&panel=1');
    expect(get).toHaveBeenCalledWith('/api/cases/case-a/notes/case/look');
    lookButton().click();
    flushSync();
    goTo('Page');
    [...menu().querySelectorAll('button')].find((button) => button.textContent.trim() === 'Letter').click();
    await settle();
    expect(looks()[0][0]).toBe('/api/cases/case-a/notes/case/look');
    expect(looks()[0][1]).toMatchObject({ page: 'letter' });
  });

  it('is read again for another note, and writes to that one', async () => {
    keepLooks();
    get.mockImplementation(async (url) => {
      if (url.endsWith('/notes/index')) return { items: [{ id: 'case', title: 'Case notes', folder: '', updated_at: '' }, { id: 'n1', title: 'Port lead', folder: '', updated_at: '' }] };
      if (url === '/api/cases/case-a/notes/case/look') return { look: { style: 'brief' } };
      if (url.endsWith('/look')) return { look: { style: 'report' } };
      if (url === '/api/cases/case-a') return { id: 'case-a', name: 'Harbour strike', folders: [] };
      return { text: written };
    });
    await panel();
    expect(lookButton().textContent).toContain('Report');
    target.querySelector('button.which').click();
    await settle();
    [...document.querySelectorAll('.float-menu button')][0].click();
    await settle();
    await vi.waitFor(() => expect(lookButton().textContent).toContain('Brief'));
    lookButton().click();
    flushSync();
    goTo('Style');
    [...menu().querySelectorAll('.style-card')].find((card) => card.textContent.includes('Plain')).click();
    await settle();
    expect(looks().at(-1)[0]).toBe('/api/cases/case-a/notes/case/look');
  });

  it('draws the pages again in the look picked', async () => {
    keepLooks();
    localStorage.setItem('azimut:notePanel-page', '1');
    await panel();
    await vi.waitFor(() => expect(target.querySelectorAll('.sheet')).toHaveLength(2));
    expect(postBytes.mock.calls.at(-1)[1]).toMatchObject({ look: { style: 'report' } });
    // read once: the pages do not ask again for a look the panel holds
    expect(get.mock.calls.filter(([url]) => url === '/api/cases/case-a/notes/n1/look')).toHaveLength(1);
    lookButton().click();
    flushSync();
    goTo('Style');
    [...menu().querySelectorAll('.style-card')].find((card) => card.textContent.includes('Brief')).click();
    await settle();
    await vi.waitFor(() => expect(postBytes.mock.calls.at(-1)[1]).toMatchObject({ look: { style: 'brief' } }));
    expect(get.mock.calls.filter(([url]) => url === '/api/cases/case-a/notes/n1/look')).toHaveLength(1);
  });

  it('writes the first page at the top of the note when the cover turns to Your own page', async () => {
    keepLooks();
    await panel();
    lookButton().click();
    flushSync();
    goTo('Cover');
    [...menu().querySelectorAll('button')].find((button) => button.textContent.trim() === 'Your own page').click();
    await settle();
    const { EditorView } = await import('@codemirror/view');
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor'));
    expect(view.state.doc.toString()).toContain('<!-- cover -->');
    expect(looks().at(-1)[1].cover).toMatchObject({ on: true, mode: 'own' });
  });

  it('says so when the look could not be kept, and shows the one that was picked', async () => {
    put.mockImplementation(async (url, body) => {
      if (url.endsWith('/look')) throw new Error('disk full');
      written = body.text;
      return { status: 'saved' };
    });
    await panel();
    lookButton().click();
    flushSync();
    goTo('Style');
    [...menu().querySelectorAll('.style-card')].find((card) => card.textContent.includes('Journal')).click();
    await settle();
    expect(uiState.toasts.map((item) => item.message)).toContain('Look not saved: disk full');
  });

  it('opens a panel as wide as the window lets it: 440 px, or the panel\'s width less its margins', async () => {
    const was = window.innerWidth;
    await panel();
    lookButton().click();
    flushSync();
    expect(menu().style.width).toBe('440px');
    expect(menu().querySelector('.look').classList.contains('narrow')).toBe(false);
    lookButton().click();
    flushSync();
    Object.defineProperty(window, 'innerWidth', { value: 320, configurable: true });
    window.dispatchEvent(new Event('resize'));
    flushSync();
    lookButton().click();
    flushSync();
    expect(menu().style.width).toBe('304px');
    expect(menu().querySelector('.look').classList.contains('narrow')).toBe(true);
    // every section is still there to be reached
    expect([...menu().querySelectorAll('[role="tab"]')].map((item) => item.textContent.trim())).toEqual(['Style', 'Text', 'Page', 'Cover', 'Header & footer']);
    Object.defineProperty(window, 'innerWidth', { value: was, configurable: true });
    window.dispatchEvent(new Event('resize'));
  });
});

describe('Add in the panel\'s bar', () => {
  const addButton = () => target.querySelector('.panel-bar button.add');
  const menu = () => document.querySelector('.float-menu[aria-label="Add to this note"]');
  const items = () => [...menu().querySelectorAll('[role="menuitem"]')];
  const labels = () => items().map((item) => item.querySelector('.fm-grow')?.firstChild?.textContent.trim());
  const item = (label) => items().find((one) => one.querySelector('.fm-grow')?.firstChild?.textContent.trim() === label);
  const URL = 'https://www.example.org/news/strike';
  const tab = (fields = {}) => ({ azimut: 'note-tab', v: 1, access: 'open', url: URL, title: 'Strike | Example News', selection: 'Berths 10 to 14 were closed.', post: false, ...fields });
  const asks = () => told().filter((message) => message.azimut === 'note-tab-ask');
  const runs = () => told().filter((message) => message.azimut === 'note-tab-run');

  /** The map check answers per address; the pairing token is the app's own. */
  function mapAnswers(sites = {}) {
    get.mockImplementation(async (url) => {
      if (url === '/api/settings') return { ingest_token: 'pairing-token' };
      if (url.startsWith('/api/ingest/parse')) return { site: sites[decodeURIComponent(url.split('url=')[1])] ?? null };
      if (url.endsWith('/notes/index')) return { items: [{ id: 'case', title: 'Case notes', folder: '', updated_at: '' }] };
      if (url.includes('/sources/lookup')) return { url: PAGE, title: 'Strike on the port', found: [] };
      if (url === '/api/cases/case-a') return { id: 'case-a', name: 'Harbour strike', folders: [] };
      if (url.endsWith('/look')) return { look: {} };
      return { text: written };
    });
  }

  it('is a button of the bar that asks the extension what the tab in front is when it opens', async () => {
    await panel();
    expect(addButton().getAttribute('aria-label')).toBe('Add');
    expect(addButton().title).toBe('Add from the tab in front, or cite a source');
    expect(addButton().getAttribute('aria-haspopup')).toBe('menu');
    expect(addButton().getAttribute('aria-expanded')).toBe('false');
    expect(asks()).toEqual([]);
    addButton().click();
    await settle();
    expect(addButton().getAttribute('aria-expanded')).toBe('true');
    expect(asks()).toEqual([{ azimut: 'note-tab-ask', v: 1, to: '*' }]);
    // pressed again it closes, and asks nothing more
    addButton().click();
    await settle();
    expect(menu()).toBeNull();
    expect(asks()).toHaveLength(1);
  });

  it('says it is reading the tab until the extension answers', async () => {
    await panel();
    addButton().click();
    await settle();
    expect(menu().querySelector('[role="status"]').textContent).toBe('Reading the tab…');
    expect(labels()).toEqual(['A source…']);
    send(tab());
    await settle();
    expect(menu().querySelector('[role="status"]')).toBeNull();
    expect(menu().textContent).not.toContain('Reading the tab…');
  });

  it('offers to allow the tab when the extension says nothing within a second', async () => {
    await panel();
    addButton().click();
    await settle();
    expect(menu().textContent).toContain('Reading the tab…');
    await vi.waitFor(() => expect(menu().textContent).toContain('Allow Azimut on this tab…'), { timeout: 2500 });
    expect(menu().textContent).not.toContain('Reading the tab…');
  });

  it('lists the page, and the words selected with a preview, for a tab it may read', async () => {
    mapAnswers();
    await panel();
    addButton().click();
    await settle();
    send(tab());
    await settle();
    expect(menu().querySelector('.fm-head').textContent).toBe('From this tab · example.org');
    expect(labels()).toEqual(['This page', 'The passage selected', 'A source…']);
    expect(item('This page').querySelector('small').textContent).toBe('example.org');
    expect(item('This page').title).toBe('Cite this page in the note');
    const quote = item('The passage selected');
    expect(quote.disabled).toBe(false);
    expect(quote.querySelector('small').textContent).toBe('“Berths 10 to 14 were closed.”');
    expect(quote.title).toBe('Quote the words selected, linked to the passage');
    expect(menu().textContent).not.toContain('This map');
  });

  it('says This post for one post of a social site', async () => {
    mapAnswers();
    await panel();
    addButton().click();
    send(tab({ url: 'https://x.com/a/status/1', post: true }));
    await settle();
    expect(labels()).toEqual(['This post', 'The passage selected', 'A source…']);
    expect(item('This post').title).toBe('Cite this post in the note');
    expect(menu().querySelector('.fm-head').textContent).toBe('From this tab · x.com');
  });

  it('shortens a long selection in its preview, and keeps the quote itself whole', async () => {
    mapAnswers();
    await panel();
    addButton().click();
    send(tab({ selection: 'Berths 10 to 14 were closed on Tuesday after a strike hit the port overnight and the harbour said' }));
    await settle();
    expect(item('The passage selected').querySelector('small').textContent).toBe('“Berths 10 to 14 were closed on Tuesday after a strike hit…”');
  });

  it('disables the quote, and says how to have one, while nothing is selected', async () => {
    mapAnswers();
    await panel();
    addButton().click();
    send(tab({ selection: '' }));
    await settle();
    const quote = item('The passage selected');
    expect(quote.disabled).toBe(true);
    expect(quote.title).toBe('Select words on the page to quote them');
    expect(quote.querySelector('small').textContent).toBe('Select words on the page to quote them');
    quote.click();
    await settle();
    expect(runs()).toEqual([]);
    expect(menu()).not.toBeNull();
  });

  it('adds This map only when the app says the page is a map, asked with the token, once a page', async () => {
    mapAnswers({ [URL]: 'google-maps' });
    await panel();
    addButton().click();
    send(tab());
    await settle();
    await vi.waitFor(() => expect(labels()).toContain('This map'));
    expect(labels()).toEqual(['This map', 'This page', 'The passage selected', 'A source…']);
    expect(item('This map').querySelector('small').textContent).toBe('Draw the area to capture');
    const parse = get.mock.calls.filter(([url]) => url.startsWith('/api/ingest/parse'));
    expect(parse).toHaveLength(1);
    expect(parse[0]).toEqual([`/api/ingest/parse?url=${encodeURIComponent(URL)}`, { headers: { 'X-Azimut-Token': 'pairing-token' } }]);
    // opened again on the same page: no second question
    addButton().click();
    await settle();
    addButton().click();
    await settle();
    send(tab());
    await settle();
    await vi.waitFor(() => expect(labels()).toContain('This map'));
    expect(get.mock.calls.filter(([url]) => url.startsWith('/api/ingest/parse'))).toHaveLength(1);
  });

  it('leaves This map out when the page is no map, or the question could not be put', async () => {
    mapAnswers();
    await panel();
    addButton().click();
    send(tab());
    await settle();
    await settle();
    expect(labels()).toEqual(['This page', 'The passage selected', 'A source…']);
    expect(get.mock.calls.some(([url]) => url.startsWith('/api/ingest/parse'))).toBe(true);
    // an address the app cannot ask about
    addButton().click();
    await settle();
    forgetMaps();
    get.mockImplementation(async (url) => {
      if (url === '/api/settings') throw new Error('Azimut is not running');
      if (url.endsWith('/look')) return { look: {} };
      return { text: written };
    });
    addButton().click();
    send(tab({ url: 'https://maps.example.org/@1,2' }));
    await settle();
    await settle();
    expect(labels()).toEqual(['This page', 'The passage selected', 'A source…']);
  });

  it('asks the extension for what is pressed, and closes', async () => {
    mapAnswers({ [URL]: 'google-maps' });
    await panel();
    for (const [label, action] of [['This map', 'capture'], ['This page', 'cite'], ['The passage selected', 'quote']]) {
      addButton().click();
      send(tab());
      await settle();
      await vi.waitFor(() => expect(labels()).toContain('This map'));
      item(label).click();
      await settle();
      expect(runs().at(-1)).toEqual({ azimut: 'note-tab-run', v: 1, action, to: '*' });
      expect(menu()).toBeNull();
    }
    expect(runs().map((message) => message.action)).toEqual(['capture', 'cite', 'quote']);
    // nothing is put by the panel itself: what the extension makes comes back as a put
    expect(post).not.toHaveBeenCalledWith(expect.stringMatching(/\/entities$/), expect.anything());
  });

  it('offers the first permission for a tab it may not read yet, and asks for it', async () => {
    mapAnswers();
    await panel();
    addButton().click();
    send(tab({ access: 'closed', url: '', title: '', selection: '' }));
    await settle();
    expect(menu().querySelector('.fm-head').textContent).toBe('From this tab');
    expect(labels()).toEqual(['Allow Azimut on this tab…', 'A source…']);
    expect(item('Allow Azimut on this tab…').querySelector('small').textContent).toBe('Asked once: Azimut reads a page only when you add from it');
    expect(menu().textContent).not.toContain('This page');
    expect(get.mock.calls.some(([url]) => url.startsWith('/api/ingest/parse'))).toBe(false);
    item('Allow Azimut on this tab…').click();
    await settle();
    expect(runs()).toEqual([{ azimut: 'note-tab-run', v: 1, action: 'allow', to: '*' }]);
    expect(menu()).toBeNull();
  });

  it('says there is nothing to add from a tab that is no web page, and still offers a source', async () => {
    mapAnswers();
    await panel();
    addButton().click();
    send(tab({ access: 'none', url: '', title: '', selection: '' }));
    await settle();
    expect(menu().textContent).toContain('Nothing to add from this tab');
    expect(menu().querySelector('.fm-head')).toBeNull();
    expect(labels()).toEqual(['A source…']);
  });

  it('takes the answer when it comes after the second, and never one from a web page', async () => {
    mapAnswers();
    await panel();
    addButton().click();
    await vi.waitFor(() => expect(menu().textContent).toContain('Allow Azimut on this tab…'), { timeout: 2500 });
    send(tab());
    await settle();
    expect(labels()).toEqual(['This page', 'The passage selected', 'A source…']);
    addButton().click();
    await settle();
    addButton().click();
    await settle();
    send(tab({ selection: 'from a web page' }), { origin: 'https://evil.example' });
    send(tab({ selection: 'from another window' }), { source: window });
    send(tab({ url: 'javascript:alert(1)' }));
    await settle();
    expect(menu().textContent).toContain('Reading the tab…');
  });

  it('starts again at each opening: the last tab is not shown while the new one is asked', async () => {
    mapAnswers();
    await panel();
    addButton().click();
    send(tab());
    await settle();
    expect(labels()).toContain('This page');
    addButton().click();
    await settle();
    addButton().click();
    await settle();
    expect(menu().textContent).toContain('Reading the tab…');
    expect(labels()).toEqual(['A source…']);
    expect(asks()).toHaveLength(2);
  });

  it('closes on Escape, and is not moved by an answer that comes after', async () => {
    mapAnswers();
    await panel();
    addButton().click();
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(menu()).toBeNull();
    send(tab());
    await settle();
    expect(menu()).toBeNull();
    expect(runs()).toEqual([]);
  });

  it('opens a source to cite, as the note on the side does, in place of the menu', async () => {
    mapAnswers();
    await panel();
    addButton().click();
    send(tab());
    await settle();
    expect(item('A source…').title).toBe('Cite a web page or a post, found in the case or kept');
    item('A source…').click();
    await settle();
    expect(menu()).toBeNull();
    const dialog = document.querySelector('.float-menu[aria-label="A source"]');
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector('input[aria-label="Link to cite"]')).not.toBeNull();
    expect(runs()).toEqual([]);
  });

  it('cites a source typed in it in the note, like the dock\'s', async () => {
    mapAnswers();
    post.mockImplementation(async (url, body) => (url.endsWith('/entities') ? { id: 'b_new', ...body } : { redirects: {} }));
    await panel();
    addButton().click();
    await settle();
    item('A source…').click();
    await settle();
    const input = document.querySelector('input[aria-label="Link to cite"]');
    input.value = PAGE;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 260));
    await settle();
    const keep = [...document.querySelectorAll('.float-menu .fm-item')].find((row) => row.textContent.includes('Bookmark'));
    expect(keep).toBeDefined();
    keep.click();
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/api/cases/case-a/entities', expect.objectContaining({ type: 'bookmark' })));
    await vi.waitFor(() => expect(uiState.toasts.some((item) => item.message === 'Put in “Port lead”')).toBe(true));
  });
});
