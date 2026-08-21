// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The table, driven the way an analyst drives it.
 *
 * `Board.test.js` reads the source for what the tool is wired to; this drives the
 * one gesture that removes case material in bulk, because a delete that ticks the
 * wrong rows is the one mistake the tests have to catch before a user does.
 */

const TYPES = [
  { type: 'place', label: 'Place', family: 'material', hint: 'somewhere', fields: [] },
  { type: 'media', label: 'Media', family: 'material', hint: 'a file', fields: [] },
  { type: 'person', label: 'Person', family: 'actor', hint: 'somebody', fields: [] },
];

const ROWS = [
  { id: 'e1', type: 'place', label: 'Quai sud', attrs: {}, provenance: { at: '2026-08-01' } },
  { id: 'e2', type: 'media', label: 'Clip', attrs: {}, provenance: { at: '2026-08-02' } },
  { id: 'e3', type: 'person', label: 'Witness', attrs: {}, provenance: { at: '2026-08-03' } },
  { id: 'e4', type: 'place', label: 'Pont nord', attrs: {}, provenance: { at: '2026-08-04' } },
];

const SUMMARY = {
  total: ROWS.length,
  by_type: { place: 2, media: 1, person: 1 },
  by_status: {},
  by_folder: {},
  by_source: {},
  unlinked: 0,
};

const get = vi.fn(async (url) => {
  if (url.includes('/entity-types')) return TYPES;
  if (url.includes('/catalog/summary')) return SUMMARY;
  if (url.includes('/catalog/entities')) {
    return { items: ROWS, total: ROWS.length, next_cursor: null };
  }
  if (url.includes('/catalog/attributes')) return { attrs: [] };
  if (url.includes('/dependents')) return { cascade: [], tombstone: [] };
  if (url.includes('/analysis-views')) return { views: [] };
  return {};
});
const post = vi.fn(async () => ({ status: 'deleted', deleted: ['e1', 'e4'], trash: 'trash-1' }));
const del = vi.fn(async () => ({ status: 'deleted', deleted: ['e1'], trash: 'trash-2' }));
vi.mock('../lib/api.js', () => ({
  api: { get, post, del, patch: vi.fn(), put: vi.fn() },
  ApiError: Error,
}));

const toast = vi.fn();
const reloadCase = vi.fn(async () => {});
const uiState = { tool: 'board', openBoardEntity: null, drawInGraph: null, openGraphEntity: null };
vi.mock('../lib/state.svelte.js', async () => {
  const { caseState } = await import('../components/views.fixture.svelte.js');
  return {
    caseState,
    reloadCase,
    toast,
    uiState,
    registerCaseChangeGuard: () => () => {},
  };
});
vi.mock('../components/EntityDetails.svelte', async () => await import('../components/Modal.svelte'));

const { default: Board } = await import('./Board.svelte');

let live = null;
let target = null;

async function settle() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  flushSync();
}

async function open() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(Board, { target });
  flushSync();
  await settle();
  return target;
}

/** The boxes of the rows themselves, in the order the table shows them. */
const boxes = () => [...target.querySelectorAll('.table tbody td.pick input')];
const headBox = () => target.querySelector('.table thead th.pick input');
const bar = () => target.querySelector('.picked');
const dialog = () => document.querySelector('[role="alertdialog"]');

async function tick(index, { shift = false } = {}) {
  boxes()[index].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: shift }));
  flushSync();
  await settle();
}

async function tickHead() {
  headBox().click();
  flushSync();
  await settle();
}

async function press(label, root = document.body) {
  const button = [...root.querySelectorAll('button')].find((b) => b.textContent.trim().includes(label));
  button.click();
  flushSync();
  await settle();
  return button;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  document.querySelectorAll('[role="alertdialog"]').forEach((node) => node.remove());
});

describe('ticking rows', () => {
  it('gives every row a box, and says how many are ticked', async () => {
    await open();
    expect(boxes()).toHaveLength(ROWS.length);
    expect(bar()).toBeNull(); // nothing ticked, nothing to act on

    await tick(0);
    await tick(2);

    expect(bar().textContent).toContain('2 selected');
    expect(boxes().map((box) => box.checked)).toEqual([true, false, true, false]);
  });

  it('does not open the row it ticks: the box is not the row', async () => {
    await open();
    await tick(1);

    expect(target.querySelector('.table tbody input:checked')).not.toBeNull();
    expect(document.querySelector('.modal, [role="dialog"]')).toBeNull();
  });

  it('shift carries the run from the last box touched', async () => {
    await open();
    await tick(0);
    await tick(3, { shift: true });

    expect(boxes().every((box) => box.checked)).toBe(true);
    expect(bar().textContent).toContain('4 selected');

    // and takes it back the same way: the run is measured from the box last
    // touched, and a shift on a ticked box unticks everything it covers
    await tick(1, { shift: true });
    expect(boxes().map((box) => box.checked)).toEqual([true, false, false, false]);
  });

  it('the heading box clears a part-ticked table rather than completing it', async () => {
    // the reported bug: ticking everything but one row and pressing the heading box
    // ticked the row that had been deliberately left out
    await open();
    await tickHead();
    await tick(2);
    expect(bar().textContent).toContain('3 selected');

    await tickHead();

    expect(bar()).toBeNull();
    expect(boxes().some((box) => box.checked)).toBe(false);
  });

  it('the heading box shows which of the three states the table is in', async () => {
    await open();
    expect(headBox().checked).toBe(false);
    expect(headBox().indeterminate).toBe(false);

    await tick(0);
    expect(headBox().indeterminate).toBe(true);

    await tickHead(); // clears, from the dash
    expect(headBox().indeterminate).toBe(false);
    expect(headBox().checked).toBe(false);

    await tickHead(); // and takes the whole table from empty
    expect(headBox().checked).toBe(true);
    expect(headBox().indeterminate).toBe(false);
  });

  it('Clear leaves no box behind, ticked or not', async () => {
    await open();
    await tick(0);
    await tick(1);
    await tick(2);
    await press('Clear', target);

    expect(boxes().map((box) => box.checked)).toEqual([false, false, false, false]);
  });

  it('the heading box covers the rows loaded, and clears them', async () => {
    await open();
    headBox().click();
    flushSync();
    await settle();
    expect(bar().textContent).toContain('4 selected');

    headBox().click();
    flushSync();
    await settle();
    expect(bar()).toBeNull();
  });

  it('Clear drops the ticks without touching the case', async () => {
    await open();
    await tick(0);
    await press('Clear', target);

    expect(bar()).toBeNull();
    expect(post).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});

describe('deleting what is ticked', () => {
  it('counts the selection before it runs, and promises the way back', async () => {
    await open();
    await tick(0);
    await tick(3);
    await press('Delete', target);

    expect(dialog().textContent).toContain('Delete 2 items?');
    expect(dialog().textContent).toContain('restore it from Trash');
    // nothing has gone yet: the dialog is the whole point
    expect(post).not.toHaveBeenCalled();
  });

  it('sends the selection as one act, so one Undo takes it back', async () => {
    await open();
    await tick(0);
    await tick(3);
    await press('Delete', target);
    await press('Delete all');

    expect(post).toHaveBeenCalledWith('/api/cases/case-a/entities/delete', {
      ids: ['e1', 'e4'],
    });
    expect(reloadCase).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      'Deleted 2 items',
      'info',
      7000,
      expect.objectContaining({ label: 'Undo' })
    );
    expect(bar()).toBeNull(); // the ticks went with the rows
  });

  it('one ticked row still goes over its own route, with its plan previewed', async () => {
    await open();
    await tick(1);
    await press('Delete', target);

    expect(get).toHaveBeenCalledWith('/api/cases/case-a/entities/e2/dependents');
    expect(dialog().textContent).toContain('Clip');

    await press('Delete everywhere');
    expect(del).toHaveBeenCalledWith('/api/cases/case-a/entities/e2');
    expect(post).not.toHaveBeenCalled();
  });

  it('Cancel leaves the case and the ticks alone', async () => {
    await open();
    await tick(0);
    await press('Delete', target);
    await press('Cancel');

    expect(post).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(bar().textContent).toContain('1 selected');
  });
});
