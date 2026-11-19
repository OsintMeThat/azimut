// @vitest-environment happy-dom
/**
 * Show on a map, mounted: the columns it proposes, the plan it reads back from the server
 * before anything is made, the rows it leaves off said and listed, and the one press that
 * makes the layer. From a note it starts with the case's sheets.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const get = vi.fn();
const post = vi.fn();
vi.mock('../lib/api.js', () => ({ api: { get, post } }));

const { default: SheetMapDialog } = await import('./SheetMapDialog.svelte');

const TABLE = {
  columns: ['id', 'Identification', 'Grade', 'Position', 'Seen'],
  rows: [
    ['r1', 'Streit Cougar', 'confirmed', '12.74625, 43.49463 (±30 m)', '2026-09-03'],
    ['r2', 'BATT UMG', 'confirmed', '~12.7590, 43.4950 (±450 m)', '2026-09-04'],
    ['r3', 'Oshkosh M-ATV', 'set aside', 'location unknown', ''],
    ['r4', 'Al-Wahsh MRAP', 'confirmed', '12.73586, 43.49302 (±30 m)', '2026-09-05'],
  ],
};
const PLAN = {
  title: 'Register', rows: 4, placed: 3, unplaced_count: 1,
  unplaced: [{ row: 'r3', number: 3, name: 'Oshkosh M-ATV', text: 'location unknown', reason: 'unread', said: 'not a place the map can read' }],
  groups: [{ value: 'confirmed', colour: '#184f95', count: 3 }], hows: { coordinates: 3 },
  dated: 3, undated: 0, first: '2026-09-03', last: '2026-09-05', bbox: [43.49, 12.73, 43.5, 12.76], layers: [],
};

let live = null;
const onmade = vi.fn();
const onupdated = vi.fn();
const onclose = vi.fn();

function open(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(SheetMapDialog, { target, props: { caseId: 'c1', onmade, onupdated, onclose, ...props } });
  flushSync();
}

async function settle() {
  for (let index = 0; index < 4; index += 1) {
    await vi.advanceTimersByTimeAsync(200);
    await tick();
    flushSync();
  }
}

const text = () => document.body.textContent.replace(/\s+/g, ' ');
const field = (label) => document.body.querySelector(`[aria-label="${label}"]`);
const pressing = (words) => [...document.body.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(words));

beforeEach(() => {
  vi.useFakeTimers();
  get.mockReset();
  post.mockReset();
  onmade.mockReset();
  onupdated.mockReset();
  post.mockImplementation(async (url) => (url.endsWith('/map/preview') ? PLAN : { name: 'Register', title: 'Register', made: { points: 3, unplaced: 1 } }));
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('from the Sheet tool', () => {
  it('proposes the columns from the sheet and says what they put on the map before anything is made', async () => {
    open({ sheetId: 's1', table: TABLE, meta: {}, sheetTitle: 'Register' });
    await settle();

    expect(field('Place column').value).toBe('Position');
    expect(field('Name column').value).toBe('Identification');
    expect(field('Colour column').value).toBe('Grade');
    expect(field('From column').value).toBe('Seen');
    const [url, body] = post.mock.calls.at(-1);
    expect(url).toBe('/api/cases/c1/sheets/s1/map/preview');
    expect(body.choice).toMatchObject({ place: 'Position', name: 'Identification', colour: 'Grade', start: 'Seen' });
    expect(text()).toContain('3 of 4 rows go on the map.');
    expect(text()).toContain('Read as coordinates (3).');
    expect(text()).toContain('3 points are dated from 3 Sep 2026 to 5 Sep 2026.');
    expect(text()).toContain('confirmed3');
    expect(post.mock.calls.every(([called]) => called.endsWith('/preview')), 'nothing is made before the press').toBe(true);
  });

  it('lists the rows it leaves off, with what they hold and why', async () => {
    open({ sheetId: 's1', table: TABLE, meta: {}, sheetTitle: 'Register' });
    await settle();

    pressing('1 row has no place').click();
    flushSync();
    const listed = document.body.querySelector('[aria-label="Rows off the map"]').textContent;
    expect(listed).toContain('Row 3');
    expect(listed).toContain('location unknown');
    expect(listed).toContain('not a place the map can read');
  });

  it('asks again when a column is corrected, and makes the layer in one press', async () => {
    open({ sheetId: 's1', table: TABLE, meta: {}, sheetTitle: 'Register' });
    await settle();
    const colour = field('Colour column');
    colour.value = '';
    colour.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(post.mock.calls.at(-1)[1].choice.colour).toBe('');

    pressing('Make the layer (3 points)').click();
    await settle();
    const made = post.mock.calls.find(([url]) => url === '/api/cases/c1/sheets/s1/map');
    expect(made[1]).toMatchObject({ choice: { place: 'Position', colour: '' }, title: 'Register' });
    expect(onmade).toHaveBeenCalledWith(expect.objectContaining({ name: 'Register' }));
  });

  it('offers to update a layer the sheet already makes, rather than a second', async () => {
    post.mockImplementation(async (url) => (url.endsWith('/map/preview')
      ? { ...PLAN, layers: [{ name: 'Register', title: 'Register', sheet: { id: 's1', changed: true } }] }
      : { name: 'Register', updated: { changed: 1 } }));
    open({ sheetId: 's1', table: TABLE, meta: {}, sheetTitle: 'Register' });
    await settle();
    expect(text()).toContain('It already makes the layer “Register”. The sheet changed since.');

    pressing('Update it').click();
    await settle();
    expect(post).toHaveBeenCalledWith('/api/cases/c1/map-layers/Register/sheet', { replace: false });
    expect(onupdated).toHaveBeenCalled();
  });

  it('says why a choice cannot be read, and makes nothing', async () => {
    post.mockImplementation(async () => { throw new Error('the column “Seen” is not in this sheet'); });
    open({ sheetId: 's1', table: TABLE, meta: {}, sheetTitle: 'Register' });
    await settle();
    expect(text()).toContain('the column “Seen” is not in this sheet');
    expect(pressing('Make the layer').disabled).toBe(true);
  });
});

describe('from a note’s map', () => {
  it('lists the case’s sheets first, then reads the one picked', async () => {
    get.mockImplementation(async (url) => (url === '/api/cases/c1/sheets'
      ? { sheets: [{ id: 's1', title: 'Register', rows: 4, columns: 5 }] }
      : { id: 's1', title: 'Register', columns: TABLE.columns, rows: TABLE.rows, meta: {} }));
    open();
    await settle();
    expect(text()).toContain('Register 4 rows');

    pressing('Register').click();
    await settle();
    expect(get).toHaveBeenCalledWith('/api/cases/c1/sheets/s1');
    expect(field('Place column').value).toBe('Position');
    expect(field('Layer name').value).toBe('Register');
    expect(text()).toContain('3 of 4 rows go on the map.');
  });
});
