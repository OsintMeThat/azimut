// @vitest-environment happy-dom
/**
 * The two halves of a place column, actually mounted.
 *
 * The bug this exists to keep fixed was reported as "it is so slow it is useless": a column
 * whose cells already point at placed entities sent every one of them to Nominatim, one a
 * second, and came back with nothing — `3rd Bde` is not a toponym. What the case answers is
 * exact, offline and instant, so it has to be asked first, and the geocoder has to be left
 * out of it entirely for those rows.
 *
 * The lib suite next door reads the rules; this one drives the dialog, because "the pass
 * proposed a write without any lookup" is a claim about the screen.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const get = vi.fn();
const post = vi.fn();
vi.mock('../lib/api.js', () => ({ api: { get, post } }));

const { default: SheetGeocode } = await import('./SheetGeocode.svelte');

const TABLE = {
  columns: ['id', 'Subject', 'Coordinates'],
  rows: [
    ['r1', '3rd Bde', ''],
    ['r2', 'Kherson, Ukraine', ''],
  ],
};
const META = { links: { r1: { Subject: 'e_brigade' } } };
const WRITABLE = [
  { name: 'Subject', index: 1 },
  { name: 'Coordinates', index: 2 },
];

let live = null;

function open(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(SheetGeocode, {
    target,
    props: {
      caseId: 'c1',
      sheetId: 's1',
      table: TABLE,
      meta: META,
      column: { name: 'Subject', index: 1 },
      mode: 'forward',
      rows: [0, 1],
      writable: WRITABLE,
      onedits: vi.fn(),
      onclose: vi.fn(),
      ...props,
    },
  });
  flushSync();
  return target;
}

/** The dialog asks the case as it opens, so a test has to let that answer land: a macrotask
 *  drains the request's own microtasks, and the flush draws what it changed. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

function buttons(target) {
  return [...target.querySelectorAll('button')].map((node) => node.textContent.trim());
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  post.mockResolvedValue({ points: { e_brigade: { lat: 48.85, lon: 2.35 } } });
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

describe('a forward pass over a column the case partly answers', () => {
  it('asks the case as it opens, and only about the entities the cells point at', async () => {
    open();
    await settle();
    expect(post).toHaveBeenCalledWith('/api/cases/c1/sheets/s1/points', { ids: ['e_brigade'] });
  });

  it('offers the linked row as a write with no lookup run at all', async () => {
    const target = open();
    await settle();
    // The point the case holds, in the app's own spelling, proposed and not applied.
    expect(target.textContent).toContain('1 row is answered by the case itself');
    expect(buttons(target)).toContain('Write 1 cell');
    expect(get).not.toHaveBeenCalled();
  });

  it('leaves the unlinked row to the geocoder, and says how many that is', async () => {
    const target = open();
    await settle();
    expect(target.textContent).toContain('1 distinct name left to look up');
    expect(buttons(target)).toContain('Look up 1');
  });

  it('writes the case answer into the target column when the write is pressed', async () => {
    const onedits = vi.fn();
    const target = open({ onedits });
    await settle();
    target.querySelectorAll('button').forEach((node) => {
      if (node.textContent.trim() === 'Write 1 cell') node.click();
    });
    flushSync();
    expect(onedits).toHaveBeenCalledWith(
      [{ row: 0, column: 2, before: '', after: '48.85000, 2.35000' }],
      '1 cell written.',
    );
  });

  it('offers no lookup at all when the case covers the whole column', async () => {
    const target = open({
      table: { columns: TABLE.columns, rows: [TABLE.rows[0]] },
      rows: [0],
    });
    await settle();
    expect(buttons(target)).toContain('Write 1 cell');
    expect(buttons(target).some((label) => label.startsWith('Look up'))).toBe(false);
  });

  it('falls back to the geocoder for every row when the case cannot answer', async () => {
    post.mockResolvedValue({ points: {} });
    const target = open();
    await settle();
    expect(target.textContent).not.toContain('answered by the case');
    expect(buttons(target)).toContain('Look up 2');
  });
});
