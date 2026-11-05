// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The note in the extension's side panel: the case named, a picker, the note, and
 * nothing else. It tells the extension's page which note it holds, and what that
 * page sends lands like every tool's put, with the toast and its Undo. A message
 * from anywhere but an extension's page gets no answer and changes nothing.
 */

const { get, post, put, del } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: { get, post, put, del, patch: vi.fn() } }));
vi.mock('../lib/catalog.js', () => ({
  fetchAllEntities: vi.fn(async () => [{ id: 'n1', type: 'note', label: 'Port lead', attrs: {} }]),
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

const { caseState, uiState } = await import('../lib/state.svelte.js');
const { pinnedNote } = await import('../lib/notes/putInNote.svelte.js');
const { openNote, releaseNote, resetOpenNotes } = await import('../lib/notes/noteDoc.svelte.js');
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

beforeEach(() => {
  localStorage.clear();
  opened.id = 'case-a';
  written = '';
  parent = { postMessage: vi.fn() };
  Object.defineProperty(window, 'parent', { value: parent, configurable: true });
  get.mockImplementation(async (url) => {
    if (url.endsWith('/notes/index')) {
      return { items: [{ id: 'case', title: 'Case notes', folder: '', updated_at: '' }, { id: 'n1', title: 'Port lead', folder: '', updated_at: '2026-11-01T10:00:00Z' }] };
    }
    if (url.includes('/sources/lookup')) return { url: PAGE, title: 'Strike on the port', found: [] };
    if (url === '/api/cases/case-a') return { id: 'case-a', name: 'Harbour strike', folders: [] };
    return { text: written };
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
  uiState.toasts.splice(0);
  delete window.parent;
  vi.clearAllMocks();
});

describe('the note in the extension\'s panel', () => {
  it('shows the note asked for under its case, pins it, and tells the extension it holds it', async () => {
    await panel();
    expect(target.querySelector('.case').textContent).toBe('Harbour strike');
    expect(target.querySelector('button.which').textContent).toContain('Port lead');
    // the note and a picker: none of the dock's Add, Notebook, own tab or close
    expect([...target.querySelectorAll('.panel-bar button')]).toHaveLength(1);
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
