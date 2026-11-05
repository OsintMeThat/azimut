// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The note on the side: the first time it opens it says what it is for and how
 * it comes back, its title picks the note it shows from the case's list, and
 * Write | Page shows the note or its pages in its place.
 */

const { get, put, postBytes } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), postBytes: vi.fn() }));
vi.mock('../lib/api.js', () => ({
  api: { get, put, postBytes, post: vi.fn(async () => ({ redirects: {} })), del: vi.fn(), patch: vi.fn() },
}));
vi.mock('../lib/catalog.js', () => ({ fetchAllEntities: vi.fn(async () => [{ id: 'n1', type: 'note', label: 'Old lead', attrs: {} }]) }));
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
// what is near the view is said at once: every page is seen
vi.stubGlobal('IntersectionObserver', class {
  constructor(callback) { this.callback = callback; }
  observe(node) { queueMicrotask(() => this.callback([{ target: node, isIntersecting: true }])); }
  unobserve() {}
  disconnect() {}
});

const { caseState, uiState } = await import('../lib/state.svelte.js');
const { offerNote, offerPuts, withdrawNote } = await import('../lib/noteHere.svelte.js');
const { pinnedNote } = await import('../lib/notes/putInNote.svelte.js');
const { resetOpenNotes } = await import('../lib/notes/noteDoc.svelte.js');
const { dockNote, setDockNote, setDockOpen, writeIntoNote } = await import('../lib/notes/noteDock.svelte.js');
const { releaseCanvas } = await import('../lib/notes/pdfjs.js');
const { default: NoteDock } = await import('./NoteDock.svelte');

let target;
let app;

async function settle() {
  for (let round = 0; round < 20; round += 1) await Promise.resolve();
  flushSync();
}

async function dock() {
  target = document.createElement('div');
  document.body.append(target);
  app = mount(NoteDock, { target });
  await settle();
}

beforeEach(() => {
  localStorage.clear();
  pdf.destroy = vi.fn();
  postBytes.mockResolvedValue({ data: new ArrayBuffer(8), headers: new Headers({ 'X-Note-Pages': '[0, 1]' }) });
  get.mockImplementation(async (url) => {
    if (url.endsWith('/look')) return { look: { style: 'brief' } };
    if (url.endsWith('/notes/index')) {
      return { items: [{ id: 'case', title: 'Case notes', folder: '', updated_at: '' }, { id: 'n1', title: 'Old lead', folder: '', updated_at: '2026-10-01T10:00:00Z' }] };
    }
    return { text: 'Seen at the quay.' };
  });
  put.mockResolvedValue({ status: 'saved' });
  caseState.current = { id: 'case-a', name: 'Harbour', folders: [] };
});

afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  document.querySelectorAll('.float-menu').forEach((node) => node.remove());
  app = null;
  resetOpenNotes();
  setDockNote('case-a', null);
  caseState.current = null;
  withdrawNote('satellite');
  uiState.tool = 'overview';
  uiState.toasts.splice(0);
  vi.clearAllMocks();
});

describe('the note on the side', () => {
  it('says what it is for the first time it opens, and not after', async () => {
    await dock();
    expect(target.querySelector('.told').textContent).toContain('It stays open as you switch tools. Notes in the sidebar brings it back.');
    target.querySelector('.told button[aria-label="Got it"]').click();
    flushSync();
    expect(target.querySelector('.told')).toBeNull();
    unmount(app);
    target.remove();
    await dock();
    expect(target.querySelector('.told')).toBeNull();
  });

  it('picks the note it shows from the case\'s notes', async () => {
    await dock();
    target.querySelector('button.which').click();
    await settle();
    const menu = document.querySelector('.float-menu');
    expect(menu.querySelector('[aria-current="true"]').textContent.trim()).toBe('Case notes');
    [...menu.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Old lead').click();
    await settle();
    expect(dockNote('case-a')).toBe('n1');
    expect(document.querySelector('.float-menu')).toBeNull();
    expect(target.querySelector('button.which').textContent).toContain('Old lead');
  });
});

describe('the note’s Add menu', () => {
  const rows = () => [...document.querySelectorAll('.float-menu [role="menuitem"], .float-menu [role="separator"]')]
    .map((row) => (row.getAttribute('role') === 'separator' ? '—' : row.textContent.trim()));
  const offer = (id, label, text = `${label} text`) => ({ id, label, hint: label, icon: 'image', put: vi.fn(async () => ({ text })) });

  it('pins the note it shows, for every tool’s Put in', async () => {
    await dock();
    expect(pinnedNote()).toEqual({ caseId: 'case-a', noteId: null, title: 'Case notes' });
    unmount(app);
    app = null;
    expect(pinnedNote()).toBeNull();
  });

  it('offers only a source when the tool on screen has nothing', async () => {
    uiState.tool = 'overview';
    await dock();
    target.querySelector('button.add').click();
    await settle();
    expect(rows()).toEqual(['A source…']);
  });

  it('lists what the tool shows in one order: cite it, its offers, then a source', async () => {
    uiState.tool = 'satellite';
    offerNote('satellite', { id: 'p1', type: 'place', label: 'Water tower', attrs: {} });
    offerPuts('satellite', () => [offer('view', 'This view'), offer('point', 'This point'), offer('a', 'A'), offer('b', 'B'), offer('c', 'C')]);
    await dock();
    target.querySelector('button.add').click();
    await settle();
    expect(rows()).toEqual(['Cite “Water tower”', 'This view', 'This point', 'A', 'B', '—', 'A source…']);
  });

  it('puts an offer at the end of a note not written in yet, and Undo takes it back', async () => {
    uiState.tool = 'satellite';
    const point = offer('point', 'This point', '48.12345, 37.12345');
    offerPuts('satellite', () => [point]);
    await dock();
    target.querySelector('button.add').click();
    await settle();
    [...document.querySelectorAll('.float-menu [role="menuitem"]')].find((row) => row.textContent.includes('This point')).click();
    await settle();
    expect(point.put).toHaveBeenCalledOnce();
    expect(document.querySelector('.float-menu')).toBeNull();
    const page = () => target.querySelector('.cm-content').textContent;
    expect(page()).toContain('Seen at the quay.48.12345, 37.12345');
    const said = uiState.toasts.at(-1);
    expect(said.message).toBe('Put in “Case notes”');
    await said.action.onClick();
    await settle();
    expect(page()).not.toContain('48.12345');
  });

  it('cites what the tool shows', async () => {
    uiState.tool = 'satellite';
    offerNote('satellite', { id: 'p1', type: 'place', label: 'Water tower', attrs: {} });
    await dock();
    target.querySelector('button.add').click();
    await settle();
    document.querySelector('.float-menu [role="menuitem"]').click();
    await settle();
    expect(target.querySelector('.cm-content').textContent).toContain('Water tower');
  });

  it('opens A source… in place of the menu', async () => {
    await dock();
    target.querySelector('button.add').click();
    await settle();
    [...document.querySelectorAll('.float-menu [role="menuitem"]')].at(-1).click();
    await settle();
    expect(document.querySelector('.float-menu[aria-label="A source"] input[type="url"]')).not.toBeNull();
  });
});

describe('the note’s pages', () => {
  const bar = (words) => [...target.querySelectorAll('.dock-bar button')].find((button) => button.textContent.trim() === words);
  const pressed = () => [...target.querySelectorAll('.modes button[aria-pressed="true"]')].map((button) => button.textContent.trim());
  async function editorView() {
    const { EditorView } = await import('@codemirror/view');
    return EditorView.findFromDOM(target.querySelector('.cm-editor'));
  }
  async function onPage() {
    bar('Page').click();
    await settle();
    await vi.waitFor(() => expect(target.querySelectorAll('.sheet')).toHaveLength(2));
  }

  it('shows them in place of the note on Page, remembers it for the dock, and Write finds the note as it was', async () => {
    await dock();
    expect(pressed()).toEqual(['Write']);
    const view = await editorView();
    view.dispatch({ selection: { anchor: 5 } });
    await onPage();
    expect(pressed()).toEqual(['Page']);
    expect(localStorage.getItem('azimut:noteDock-page')).toBe('1');
    expect(localStorage.getItem('azimut:notePanel-page')).toBeNull();
    const [url, body] = postBytes.mock.calls[0];
    expect(url).toBe('/api/cases/case-a/notes/preview');
    expect(body).toMatchObject({ note: 'case', title: 'Case notes', text: 'Seen at the quay.', look: { style: 'brief' } });
    expect(target.querySelector('.writing').hasAttribute('inert')).toBe(true);

    bar('Write').click();
    flushSync();
    expect(target.querySelector('.page-pane')).toBeNull();
    expect(localStorage.getItem('azimut:noteDock-page')).toBe('0');
    // the same editor, its cursor where it was
    expect(await editorView()).toBe(view);
    expect(view.state.selection.main.head).toBe(5);
    expect(pdf.destroy).toHaveBeenCalled();
    expect(releaseCanvas).toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('opens on the pages when the dock was left on them', async () => {
    localStorage.setItem('azimut:noteDock-page', '1');
    await dock();
    await vi.waitFor(() => expect(target.querySelectorAll('.sheet')).toHaveLength(2));
    expect(pressed()).toEqual(['Page']);
  });

  it('brings the note back for what lands in it while the pages show: a put, then a citation', async () => {
    uiState.tool = 'satellite';
    const point = { id: 'point', label: 'This point', hint: 'This point', icon: 'image', put: vi.fn(async () => ({ text: '48.12345, 37.12345' })) };
    offerPuts('satellite', () => [point]);
    await dock();
    await onPage();
    target.querySelector('button.add').click();
    await settle();
    [...document.querySelectorAll('.float-menu [role="menuitem"]')].find((row) => row.textContent.includes('This point')).click();
    await settle();
    expect(target.querySelector('.page-pane')).toBeNull();
    expect(pressed()).toEqual(['Write']);
    expect(target.querySelector('.cm-content').textContent).toContain('48.12345, 37.12345');

    await onPage();
    setDockOpen(true);
    expect(writeIntoNote('[[entity:p1|Water tower]]', { tool: 'satellite' })).toBe('dock');
    flushSync();
    expect(target.querySelector('.page-pane')).toBeNull();
    expect(target.querySelector('.cm-content').textContent).toContain('Water tower');
    setDockOpen(false);
  });

  it('lets the PDF go when the dock closes', async () => {
    await dock();
    await onPage();
    unmount(app);
    app = null;
    expect(pdf.destroy).toHaveBeenCalled();
  });
});
