// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The note on the side: the first time it opens it says what it is for and how
 * it comes back, and its title picks the note it shows from the case's list.
 */

const { get, put } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('../lib/api.js', () => ({ api: { get, put, post: vi.fn(async () => ({ redirects: {} })), del: vi.fn(), patch: vi.fn() } }));
vi.mock('../lib/catalog.js', () => ({ fetchAllEntities: vi.fn(async () => [{ id: 'n1', type: 'note', label: 'Old lead', attrs: {} }]) }));

const { caseState, uiState } = await import('../lib/state.svelte.js');
const { offerNote, offerPuts, withdrawNote } = await import('../lib/noteHere.svelte.js');
const { pinnedNote } = await import('../lib/notes/putInNote.svelte.js');
const { resetOpenNotes } = await import('../lib/notes/noteDoc.svelte.js');
const { dockNote, setDockNote } = await import('../lib/notes/noteDock.svelte.js');
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
  get.mockImplementation(async (url) => {
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
