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

const { caseState } = await import('../lib/state.svelte.js');
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
