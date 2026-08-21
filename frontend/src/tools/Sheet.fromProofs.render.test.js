// @vitest-environment happy-dom
/**
 * A sheet built out of the case's proofs, driven the way an analyst drives it.
 *
 * Two claims that only the mounted grid can hold. The columns the **case** owns are read
 * and not typed into — a view somebody can type over is a view that starts lying the
 * first time they do — while still opening the entity behind them, which is the one thing
 * that separates `locked` from the other roles the app writes.
 *
 * And Refresh is a **press**, offered only where there is something to refresh. A sheet
 * that rewrote itself on open would move a file under somebody who came to read it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const PROOFS_SHEET = {
  id: 'e_sheet',
  title: 'My geolocations',
  path: 'sheets/My geolocations.csv',
  columns: ['id', 'Title', 'Source media', 'Place', 'Coordinates', 'In case', 'Status', 'Notes'],
  rows: [
    ['r1', 'Rooftop shot', 'GX010234', 'Rooftop', '47.10000, 37.50000', 'YES', 'done', ''],
    ['r2', 'Bridge shot', 'GX010235', '', '', 'NO', 'done', 'worth keeping'],
  ],
  meta: {
    version: 6,
    widths: {},
    hidden: [],
    sort: null,
    colours: {},
    frozen: null,
    progress: 'Status',
    roles: {
      Title: { kind: 'locked' },
      'Source media': { kind: 'locked' },
      Place: { kind: 'locked' },
      Coordinates: { kind: 'computed', of: 'point', from: 'Place' },
      'In case': { kind: 'computed', of: 'in_case' },
      Status: { kind: 'state', values: ['to do', 'in progress', 'done', 'ruled out'] },
    },
    links: {
      r1: { Title: 'e_proof1', 'Source media': 'e_media1', Place: 'e_place1' },
      r2: { 'Source media': 'e_media2' },
    },
    built: { r1: 'e_proof1', r2: 'e_proof2' },
  },
  stamp: '1000-64',
  assigned: false,
};

/** The same sheet with nothing built into it: a table somebody typed or imported. */
const PLAIN_SHEET = {
  ...PROOFS_SHEET,
  columns: ['id', 'Subject', 'Status'],
  rows: [['r1', 'Quai sud', 'ruled out']],
  meta: { version: 6, widths: {}, hidden: [], sort: null, colours: {}, links: {}, frozen: null },
};

let sheet = PROOFS_SHEET;

const get = vi.fn();
const put = vi.fn(async (_path, body) => ({ status: 'saved', stamp: '2000-64', ...body }));
const post = vi.fn();
const patch = vi.fn(async () => ({}));
const del = vi.fn(async () => ({}));
vi.mock('../lib/api.js', () => ({ api: { get, put, post, patch, del }, ApiError: Error }));

const toast = vi.fn();
const uiState = { tool: 'sheet', mapSheetPoints: null, timelineRange: null };
const reloadCase = vi.fn(async () => {});
vi.mock('../lib/state.svelte.js', async () => {
  const { caseState } = await import('../components/views.fixture.svelte.js');
  return { caseState, toast, uiState, reloadCase };
});
vi.mock('../components/EntityDetails.svelte', async () => await import('../components/Modal.svelte'));

const { default: Sheet } = await import('./Sheet.svelte');

let live = null;
let target = null;

async function settle() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  flushSync();
}

function route(path) {
  if (path.endsWith('/sheets')) {
    return Promise.resolve({
      sheets: [{ id: sheet.id, title: sheet.title, path: sheet.path, rows: 2, columns: 8 }],
    });
  }
  if (path.includes('/sheets/')) return Promise.resolve(structuredClone(sheet));
  if (path.includes('/entity-types')) return Promise.resolve([]);
  if (path.includes('/relation-types')) return Promise.resolve([]);
  if (path.includes('/confidence-levels')) return Promise.resolve([]);
  if (path.includes('/catalog/summary')) return Promise.resolve({ total: 2, by_type: {} });
  return Promise.resolve({});
}

async function open() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(Sheet, { target });
  await settle();
  return target;
}

const rows = () => [...target.querySelectorAll('.rows:not(.ghost) .row')];
const cellAt = (row, index) => rows()[row].querySelectorAll('.cell:not(.gutter)')[index];
const button = (label) =>
  [...target.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(label));

/** Double-click a cell and say whether an editor opened. */
function tryEdit(row, index) {
  cellAt(row, index).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  flushSync();
  const editor = target.querySelector('.editor');
  return editor !== null;
}

beforeEach(async () => {
  sheet = PROOFS_SHEET;
  get.mockReset();
  put.mockClear();
  post.mockReset();
  toast.mockClear();
  get.mockImplementation(route);
  const { caseState } = await import('../components/views.fixture.svelte.js');
  caseState.id = 'case-a';
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target = null;
  document.body.innerHTML = '';
});

describe('the columns the case owns', () => {
  it('refuses an edit in all three, and in the two the app answers', async () => {
    await open();
    expect(tryEdit(0, 1)).toBe(false); // Title
    expect(tryEdit(0, 2)).toBe(false); // Source media
    expect(tryEdit(0, 3)).toBe(false); // Place
    expect(tryEdit(0, 4)).toBe(false); // Coordinates
    expect(tryEdit(0, 5)).toBe(false); // In case
  });

  it('leaves the analyst their own two', async () => {
    await open();
    expect(tryEdit(0, 6)).toBe(true); // Status
  });

  it('still opens the entity behind a locked cell', async () => {
    await open();
    // The mark `linkable()` admits on `locked` and refuses on every other written role.
    expect(cellAt(0, 1).querySelector('.link-mark')).not.toBeNull();
    expect(cellAt(0, 2).querySelector('.link-mark')).not.toBeNull();
    expect(cellAt(0, 3).querySelector('.link-mark')).not.toBeNull();
    // Nothing points at a coordinate or at a YES, so nothing is offered on them.
    expect(cellAt(0, 4).querySelector('.link-mark')).toBeNull();
    expect(cellAt(0, 5).querySelector('.link-mark')).toBeNull();
  });

  it('keeps the row whose proof is gone, with its note and its NO', async () => {
    await open();
    const cells = [...rows()[1].querySelectorAll('.cell:not(.gutter) .value')].map((node) =>
      node.textContent.trim(),
    );
    expect(cells[1]).toBe('Bridge shot');
    expect(cells[5]).toBe('NO');
    expect(cells[7]).toBe('worth keeping');
    // Its link was swept when the proof went; the row is what survives to say so.
    expect(cellAt(1, 1).querySelector('.link-mark')).toBeNull();
  });
});

describe('bringing the sheet level with the case', () => {
  it('offers Refresh on a sheet that was built out of the case', async () => {
    await open();
    expect(button('Refresh')).not.toBeUndefined();
  });

  it('offers it on nothing else, because there would be nothing to refresh', async () => {
    sheet = PLAIN_SHEET;
    await open();
    expect(button('Refresh')).toBeUndefined();
  });

  it('sends the table on screen with its stamp, and says what came back', async () => {
    await open();
    post.mockResolvedValue({
      status: 'saved',
      columns: sheet.columns,
      rows: [...sheet.rows, ['r3', 'New shot', '', '', '', 'YES', 'done', '']],
      meta: sheet.meta,
      stamp: '3000-64',
      added: 1,
      updated: 0,
      gone: 1,
    });
    button('Refresh').click();
    await settle();

    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/api/cases/case-a/sheets/e_sheet/refresh');
    expect(body.stamp).toBe('1000-64');
    expect(body.rows).toHaveLength(2);
    expect(toast).toHaveBeenCalledWith('1 row added, 1 proof no longer in the case.');
    expect(rows()).toHaveLength(3);
  });

  it('says so plainly when the sheet was already level', async () => {
    await open();
    post.mockResolvedValue({
      status: 'saved',
      columns: sheet.columns,
      rows: sheet.rows,
      meta: sheet.meta,
      stamp: '3000-64',
      added: 0,
      updated: 0,
      gone: 0,
    });
    button('Refresh').click();
    await settle();
    expect(toast).toHaveBeenCalledWith('Already level with the case.');
  });

  it('never runs on its own: opening the sheet writes nothing', async () => {
    await open();
    expect(post).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});
