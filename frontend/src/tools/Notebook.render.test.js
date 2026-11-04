// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The Notebook driven the way an analyst drives it: the home of cards, a note
 * opened and left, a note started from a ready one. A note written by the old
 * Notebook must open as it was and never be written for being opened.
 */

const { get, post, put, postBytes } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), postBytes: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: { get, post, put, postBytes, del: vi.fn(), patch: vi.fn() } }));
vi.mock('../lib/catalog.js', () => ({ fetchAllEntities: vi.fn(async () => ENTITIES) }));
// the PDF is drawn by PDF.js in a browser; here a document of two A4 pages stands for it
vi.mock('../lib/notes/pdfjs.js', () => ({
  openPdf: vi.fn(async () => ({
    numPages: 2,
    getPage: async () => ({ getViewport: () => ({ width: 595, height: 842 }) }),
    destroy: vi.fn(),
  })),
  drawPage: vi.fn(async () => document.createElement('canvas')),
  releaseCanvas: vi.fn((canvas) => canvas?.remove()),
}));
vi.mock('../lib/notes/thumbs.js', () => ({ templateThumb: vi.fn(async () => 'data:image/png;base64,AAAA') }));

const OLD_TEXT = '# Old lead\n\n::: center\n**Centred**\n:::\n\nSeen at [[entity:p1|Quay]].\n- [ ] Verify date\n';
const ENTITIES = [
  { id: 'n1', type: 'note', label: 'Old lead', attrs: { path: 'notes/Old lead.md', folder: 'Leads' } },
  { id: 'p1', type: 'place', label: 'Quay', attrs: {} },
];
const row = (id, title, extra = {}) => ({
  id, title, folder: '', updated_at: '2026-10-01T10:00:00Z', excerpt: '', words: 0, tasks: { open: 0, done: 0 }, mentions: 0, pictures: 0,
  look: null, includes: 0, ...extra,
});
const INDEX = {
  items: [
    row('case', 'Case notes', { updated_at: '2026-11-01T10:00:00Z', excerpt: 'Log of the day', words: 4 }),
    row('n1', 'Old lead', { folder: 'Leads', excerpt: 'Seen at Quay.', words: 3, tasks: { open: 1, done: 0 }, mentions: 1 }),
  ],
};
const MORE = {
  items: [
    ...INDEX.items,
    row('n3', 'Shadows', { folder: 'Leads', updated_at: '2026-09-01T10:00:00Z', excerpt: 'Measured at noon.' }),
    row('n4', 'Mast', { updated_at: '2026-08-01T10:00:00Z' }),
    row('r1', 'Weekly', { look: { style: 'brief' } }),
    row('r2', 'Bundle', { includes: 2 }),
  ],
};

const { caseState, uiState, templatesState } = await import('../lib/state.svelte.js');
const { resetOpenNotes } = await import('../lib/notes/noteDoc.svelte.js');
const { default: Notebook } = await import('./Notebook.svelte');

let component;
let target;

async function settle() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  flushSync();
}

/** Mount again on a home holding more notes, reports among them. */
async function withMore() {
  await unmount(component);
  index = MORE;
  component = mount(Notebook, { target });
  await settle();
}

let index = INDEX;

// what is near the view is said at once: every page and picture is seen
class SeenAtOnce {
  constructor(callback) { this.callback = callback; }
  observe(node) { queueMicrotask(() => this.callback([{ target: node, isIntersecting: true }])); }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('IntersectionObserver', SeenAtOnce);

beforeEach(async () => {
  localStorage.clear();
  index = INDEX;
  get.mockImplementation(async (url) => {
    if (url.endsWith('/notes/index')) return index;
    if (url.endsWith('/look')) return { look: { style: 'plain' } };
    if (url === '/api/settings') return { export_dirs: { notes: '' } };
    if (url.endsWith('/notes/n1')) return { text: OLD_TEXT };
    if (url.endsWith('/notes')) return { text: 'Log of the day' };
    return {};
  });
  post.mockImplementation(async (url, body) => {
    if (url.endsWith('/notes')) return { id: 'n2', type: 'note', label: body.title, attrs: { folder: body.folder } };
    if (url.endsWith('/notes/pdf/diagrams')) return { diagrams: [] };
    if (url.endsWith('/notes/pdf')) return { written: body.notes.map((id) => `${id}.pdf`), warnings: [], path: '' };
    return { redirects: {} };
  });
  put.mockImplementation(async (url, body) => (url.endsWith('/look') ? { look: body } : { status: 'saved' }));
  postBytes.mockResolvedValue({ data: new ArrayBuffer(8), headers: new Headers({ 'X-Note-Pages': '[0, 6]' }) });
  caseState.current = { id: 'case-a', name: 'Harbour', folders: ['Leads'] };
  templatesState.note = [{ id: 't1', name: 'House write-up', data: { body: '## Claim\n', folder: '' } }];
  uiState.openNotebook = null;
  uiState.tool = 'notebook';
  target = document.createElement('div');
  document.body.append(target);
  component = mount(Notebook, { target });
  await settle();
});

afterEach(async () => {
  if (component) await unmount(component);
  target?.remove();
  resetOpenNotes();
  caseState.current = null;
  templatesState.note = [];
  vi.clearAllMocks();
});

const text = () => target.textContent.replace(/\s+/g, ' ');
const buttonNamed = (words) => [...target.querySelectorAll('button')].find((button) => button.textContent.includes(words));
// a dialog is put on the page's body, outside the tool
const everything = () => document.body.textContent.replace(/\s+/g, ' ');
const anyButton = (words) => [...document.body.querySelectorAll('button')].find((button) => button.textContent.trim() === words);

describe('the home', () => {
  it('shows the case notes, each note with what it holds, and what a new one starts from', () => {
    expect(text()).toContain('Case notes');
    expect(text()).toContain('Log of the day');
    expect(text()).toContain('Old lead');
    expect(text()).toContain('Seen at Quay.');
    expect(text()).toContain('1 to do');
    expect(text()).toContain('House write-up');
    for (const name of ['Blank', 'Geolocation report', 'Chronolocation', 'Media verification', 'Incident brief (5W)',
      'Source profile', 'Daily SITREP', 'Fact-check', 'Investigation log']) {
      expect(text()).toContain(name);
    }
    expect(target.querySelectorAll('[data-guide="notebook.ready"] img')).toHaveLength(9);
  });

  it('opens a note, draws it, and goes back to the cards', async () => {
    target.querySelector('button[title="Open Old lead"]').click();
    await settle();
    expect(target.querySelector('input[aria-label="Note name"]').value).toBe('Old lead');
    expect(target.querySelector('.cm-editor')).not.toBeNull();
    expect(target.querySelector('.cm-chip')?.textContent).toContain('Quay');
    buttonNamed('Notes').click();
    await settle();
    expect(target.querySelector('.cm-editor')).toBeNull();
    expect(text()).toContain('In this case');
  });

  it('goes to the line asked for, even in the note already open', async () => {
    target.querySelector('button[title="Open Old lead"]').click();
    await settle();
    const { EditorView } = await import('@codemirror/view');
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor'));
    expect(view.state.selection.main.head).toBe(0);
    uiState.openNotebook = { noteId: 'n1', line: 7 };
    await settle();
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(8);
  });

  it('never writes a note for being opened and left', async () => {
    target.querySelector('button[title="Open Old lead"]').click();
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 900));
    buttonNamed('Notes').click();
    await settle();
    expect(put).not.toHaveBeenCalled();
  });

  it('starts a note from a ready one at once, named after it', async () => {
    buttonNamed('Investigation log').click();
    await settle();
    const [url, body] = post.mock.calls.find(([address]) => address.endsWith('/notes'));
    expect(url).toBe('/api/cases/case-a/notes');
    expect(body.title).toBe('Investigation log');
    expect(body.content).toMatch(/^<!--\? One entry per step/);
    expect(body.content).toMatch(/\n### \d{4}-\d{2}-\d{2} \d{2}:\d{2} /);
    expect(body.content).not.toContain('{now}');
    // the look the log prints in goes with it
    const look = put.mock.calls.find(([address]) => address.endsWith('/look'));
    expect(look[0]).toBe('/api/cases/case-a/notes/n2/look');
    expect(look[1].style).toBe('journal');
  });

  it('starts a blank note without a look of its own', async () => {
    buttonNamed('An empty page').click();
    await settle();
    expect(post.mock.calls.find(([address]) => address.endsWith('/notes'))[1].title).toBe('Note');
    expect(put.mock.calls.some(([address]) => address.endsWith('/look'))).toBe(false);
  });

  it('shows the reports first: a note with a style of its own, or chapters', async () => {
    await withMore();
    const reports = target.querySelector('[data-guide="notebook.reports"]');
    expect(reports.textContent).toContain('Weekly');
    expect(reports.textContent).toContain('Brief');
    expect(reports.textContent).toContain('Bundle');
    expect(reports.textContent).toContain('2 chapters');
    const cards = target.querySelector('[data-guide="notebook.cards"]').textContent;
    expect(cards).not.toContain('Weekly');
    expect(cards).toContain('Shadows');
  });
});

describe('picking notes on the home', () => {
  const box = (title) => target.querySelector(`input[aria-label="Pick ${title}"]`);
  const shiftClick = (node) => node.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
  const bar = () => target.querySelector('[data-guide="notebook.selection"]');

  it('ticks cards, a run with Shift, and says how many', async () => {
    await withMore();
    expect(bar()).toBeNull();
    box('Old lead').click();
    flushSync();
    expect(bar().textContent).toContain('1 selected');
    // the cards on screen: Old lead, Shadows, Mast
    shiftClick(box('Mast'));
    flushSync();
    expect(bar().textContent).toContain('3 selected');
    // while picking, a press on a card picks it rather than opening it
    target.querySelector('button[title="Pick Shadows"]').click();
    flushSync();
    expect(bar().textContent).toContain('2 selected');
    expect(target.querySelector('.cm-editor')).toBeNull();
    buttonNamed('Cancel').click();
    flushSync();
    expect(bar()).toBeNull();
  });

  it('picks every note of a folder at once', async () => {
    await withMore();
    [...target.querySelectorAll('.folders button')].find((button) => button.textContent === 'Leads').click();
    flushSync();
    buttonNamed('Select').click();
    flushSync();
    buttonNamed('Select all 2').click();
    flushSync();
    expect(bar().textContent).toContain('2 selected');
  });

  it('exports the picked notes, one PDF each, where the notes go', async () => {
    await withMore();
    box('Old lead').click();
    box('Case notes').click();
    flushSync();
    buttonNamed('Export as PDF').click();
    await settle();
    expect(everything()).toContain('Export notes as PDF');
    expect(everything()).toContain('2 PDFs will be written, one per note.');
    anyButton('Export 2 PDFs').click();
    await settle();
    const [, asked] = post.mock.calls.find(([address]) => address.endsWith('/notes/pdf/diagrams'));
    expect(asked.notes).toEqual(['n1', 'case']);
    expect(post.mock.calls.find(([address]) => address.endsWith('/notes/pdf'))[1].notes).toEqual(['n1', 'case']);
    expect(bar()).toBeNull();
  });

  it('makes a report of them, chapters in the order picked, and opens it beside its pages', async () => {
    await withMore();
    box('Mast').click();
    box('Old lead').click();
    flushSync();
    buttonNamed('Make a report').click();
    await settle();
    await settle();
    const [, made] = post.mock.calls.find(([address]) => address.endsWith('/notes'));
    expect(made.title).toBe('Report');
    expect(made.content).toBe('[[include:n4]]\n\n[[include:n1]]\n');
    const [address, look] = put.mock.calls.find(([url]) => url.endsWith('/look'));
    expect(address).toBe('/api/cases/case-a/notes/n2/look');
    expect(look).toMatchObject({ style: 'report', toc: true, cover: { on: true } });
    expect(localStorage.getItem('azimut:notebook-page')).toBe('1');
  });
});

describe('a note, and how it prints', () => {
  async function openOldLead() {
    target.querySelector('button[title="Open Old lead"]').click();
    await settle();
  }

  it('has no way left to export several from the note', async () => {
    await openOldLead();
    target.querySelector('button[aria-label="More"]').click();
    flushSync();
    expect(document.body.textContent).not.toContain('Export several as PDF');
    expect(document.body.textContent).toContain('Keep as template');
  });

  it('shows the PDF beside the note on Page, and remembers it', async () => {
    await openOldLead();
    expect(target.querySelector('.page-pane')).toBeNull();
    buttonNamed('Page').click();
    await settle();
    await settle();
    expect(target.querySelector('.page-pane')).not.toBeNull();
    expect(localStorage.getItem('azimut:notebook-page')).toBe('1');
    const [url, body] = postBytes.mock.calls[0];
    expect(url).toBe('/api/cases/case-a/notes/preview');
    expect(body).toMatchObject({ note: 'n1', title: 'Old lead', text: OLD_TEXT });
    expect(target.querySelectorAll('.sheet')).toHaveLength(2);
    // a press on page 2 goes to the line it starts at
    target.querySelectorAll('.sheet .hit')[1].click();
    const { EditorView } = await import('@codemirror/view');
    const view = EditorView.findFromDOM(target.querySelector('.cm-editor'));
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(7);
    buttonNamed('Write').click();
    flushSync();
    expect(target.querySelector('.page-pane')).toBeNull();
    expect(put).not.toHaveBeenCalled();
  });

  it('keeps a look picked in the header beside the note, and never in its text', async () => {
    await openOldLead();
    target.querySelector('[data-guide="notebook.look"]').click();
    flushSync();
    [...document.querySelectorAll('.style-card')].find((card) => card.textContent.includes('Journal')).click();
    await settle();
    const [address, look] = put.mock.calls.find(([url]) => url.endsWith('/look'));
    expect(address).toBe('/api/cases/case-a/notes/n1/look');
    expect(look.style).toBe('journal');
    expect(put.mock.calls.some(([url]) => url.endsWith('/notes/n1'))).toBe(false);
    expect(target.querySelector('[data-guide="notebook.look"]').textContent).toContain('Journal');
  });
});

describe('a template from Settings', () => {
  async function openTemplate() {
    templatesState.note = [{ id: 't1', name: 'House write-up', data: { body: '## Claim\n\n<!--? Who said it -->\n', folder: '', look: { style: 'brief' } } }];
    uiState.openNoteTemplate = 't1';
    await settle();
    await settle();
  }

  it('shows its pages from the route that needs no case, and keeps its look with it', async () => {
    await openTemplate();
    expect(target.querySelector('input[aria-label="Template name"]').value).toBe('House write-up');
    expect(target.querySelector('[data-guide="notebook.look"]').textContent).toContain('Brief');
    // guidance is drawn as grey words in the template too
    expect(target.querySelector('.cm-hint')?.textContent).toBe('Who said it');
    buttonNamed('Page').click();
    await settle();
    const [url, body] = postBytes.mock.calls[0];
    expect(url).toBe('/api/templates/note/preview');
    expect(body).toMatchObject({ title: 'House write-up', text: '## Claim\n\n<!--? Who said it -->\n', look: { style: 'brief' } });
    expect('note' in body).toBe(false);

    target.querySelector('[data-guide="notebook.look"]').click();
    flushSync();
    [...document.querySelectorAll('.style-card')].find((card) => card.textContent.includes('Report')).click();
    await settle();
    const [address, saved] = post.mock.calls.find(([where]) => where === '/api/templates/note');
    expect(address).toBe('/api/templates/note');
    expect(saved).toMatchObject({ id: 't1', name: 'House write-up', data: { body: '## Claim\n\n<!--? Who said it -->\n', look: { style: 'report' } } });
    expect(put).not.toHaveBeenCalled();
  });
});
