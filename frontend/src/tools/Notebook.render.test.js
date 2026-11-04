// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The Notebook driven the way an analyst drives it: the home of cards, a note
 * opened and left, a note started from a ready one. A note written by the old
 * Notebook must open as it was and never be written for being opened.
 */

const { get, post, put } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: { get, post, put, del: vi.fn(), patch: vi.fn() } }));
vi.mock('../lib/catalog.js', () => ({ fetchAllEntities: vi.fn(async () => ENTITIES) }));

const OLD_TEXT = '# Old lead\n\n::: center\n**Centred**\n:::\n\nSeen at [[entity:p1|Quay]].\n- [ ] Verify date\n';
const ENTITIES = [
  { id: 'n1', type: 'note', label: 'Old lead', attrs: { path: 'notes/Old lead.md', folder: 'Leads' } },
  { id: 'p1', type: 'place', label: 'Quay', attrs: {} },
];
const INDEX = {
  items: [
    { id: 'case', title: 'Case notes', folder: '', updated_at: '2026-11-01T10:00:00Z', excerpt: 'Log of the day', words: 4, tasks: { open: 0, done: 0 }, mentions: 0, pictures: 0 },
    { id: 'n1', title: 'Old lead', folder: 'Leads', updated_at: '2026-10-01T10:00:00Z', excerpt: 'Seen at Quay.', words: 3, tasks: { open: 1, done: 0 }, mentions: 1, pictures: 0 },
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

beforeEach(async () => {
  get.mockImplementation(async (url) => {
    if (url.endsWith('/notes/index')) return INDEX;
    if (url.endsWith('/notes/n1')) return { text: OLD_TEXT };
    if (url.endsWith('/notes')) return { text: 'Log of the day' };
    return {};
  });
  post.mockImplementation(async (url, body) => {
    if (url.endsWith('/notes')) return { id: 'n2', type: 'note', label: body.title, attrs: { folder: body.folder } };
    return { redirects: {} };
  });
  put.mockResolvedValue({ status: 'saved' });
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

describe('the home', () => {
  it('shows the case notes, each note with what it holds, and what a new one starts from', () => {
    expect(text()).toContain('Case notes');
    expect(text()).toContain('Log of the day');
    expect(text()).toContain('Old lead');
    expect(text()).toContain('Seen at Quay.');
    expect(text()).toContain('1 to do');
    expect(text()).toContain('House write-up');
    for (const name of ['Blank', 'Geolocation', 'Investigation log', 'Source profile', 'Daily summary']) {
      expect(text()).toContain(name);
    }
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
    expect(body.content).toMatch(/^Type \/ and pick Log entry/);
    expect(body.content).not.toContain('{now}');
  });
});
