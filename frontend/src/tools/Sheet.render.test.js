// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The grid, driven the way an analyst drives it.
 *
 * `lib/sheet.test.js` owns the table logic; this owns what the screen does with
 * it — that a cell edit reaches the file, that the search does not leak into the
 * grid's own keyboard, and that a linked cell can be opened.
 */

const SHEET = {
  id: 'e_sheet',
  title: 'Candidates',
  path: 'sheets/Candidates.csv',
  columns: ['id', 'Subject', 'Status'],
  rows: [
    ['r1', 'Quai sud', 'ruled out'],
    ['r2', 'Pont nord', ''],
    ['r3', 'Gare est', 'to check'],
  ],
  meta: { version: 1, widths: {}, hidden: [], sort: null, colours: {}, links: {}, frozen: null },
  stamp: '1000-64',
  assigned: false,
};

const get = vi.fn();
const put = vi.fn(async (_path, body) => ({ status: 'saved', stamp: '2000-64', ...body }));
const post = vi.fn();
const patch = vi.fn(async () => ({}));
const del = vi.fn(async () => ({}));
vi.mock('../lib/api.js', () => ({ api: { get, put, post, patch, del }, ApiError: Error }));

const toast = vi.fn();
vi.mock('../lib/state.svelte.js', async () => {
  const { caseState } = await import('../components/views.fixture.svelte.js');
  return { caseState, toast, uiState: {} };
});
vi.mock('../components/EntityDetails.svelte', async () => await import('../components/Modal.svelte'));

const { caseState } = await import('../components/views.fixture.svelte.js');
const { default: Sheet } = await import('./Sheet.svelte');

let live = null;
let target = null;

async function settle() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
  flushSync();
}

function route(path) {
  if (path.endsWith('/sheets')) {
    return Promise.resolve({
      sheets: [{ id: SHEET.id, title: SHEET.title, path: SHEET.path, rows: 3, columns: 3 }],
    });
  }
  if (path.includes('/sheets/')) return Promise.resolve(structuredClone(SHEET));
  if (path.includes('/catalog/summary')) {
    return Promise.resolve({ total: 3, by_type: { person: 2, vehicle: 1 } });
  }
  if (path.includes('/catalog/entities')) {
    const all = [
      { id: 'e_person', label: 'Witness A', type: 'person', folder: 'witnesses' },
      { id: 'e_other', label: 'Witness B', type: 'person' },
      { id: 'e_van', label: 'AB-123', type: 'vehicle' },
      { id: 'e_late', label: 'Zulu depot', type: 'place' },
    ];
    const asked = new URL(path, 'http://x').searchParams;
    let items = asked.get('type') ? all.filter((i) => i.type === asked.get('type')) : all;
    if (asked.get('order') === '-label') items = [...items].reverse();
    // Two per page, so the paging and the count are exercised rather than assumed.
    const from = Number(asked.get('cursor') ?? 0);
    const slice = items.slice(from, from + 2);
    return Promise.resolve({
      items: slice,
      total: items.length,
      next_cursor: from + 2 < items.length ? String(from + 2) : null,
    });
  }
  return Promise.resolve({});
}

async function open() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(Sheet, { target });
  await settle();
  return target;
}

const rows = () => [...target.querySelectorAll('.row')];
const cellsOf = (row) => [...row.querySelectorAll('.cell:not(.gutter) .value')];
const text = (row) => cellsOf(row).map((cell) => cell.textContent.trim());
const button = (label) =>
  [...target.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(label));

beforeEach(() => {
  caseState.current = { id: 'case-a', name: 'Harbour' };
  caseState.rev = 0;
  get.mockImplementation(route);
  put.mockClear();
  patch.mockClear();
  toast.mockClear();
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('opening a sheet', () => {
  it('draws the case table with its headings', async () => {
    await open();
    const headings = [...target.querySelectorAll('.heading-name span')].map((n) => n.textContent);
    expect(headings).toEqual(['id', 'Subject', 'Status']);
    expect(rows()).toHaveLength(3);
    expect(text(rows()[0])).toEqual(['r1', 'Quai sud', 'ruled out']);
  });

  it('counts what is shown against what the sheet holds', async () => {
    await open();
    expect(target.querySelector('.count').textContent.replace(/\s+/g, ' ')).toContain('3 of 3');
  });

  it('says so when the file on disk carries no key column', async () => {
    get.mockImplementation((path) =>
      path.includes('/sheets/') && !path.endsWith('/sheets')
        ? Promise.resolve({ ...structuredClone(SHEET), assigned: true })
        : route(path),
    );
    await open();
    expect(target.querySelector('.notice')?.textContent).toContain('id');
  });
});

describe('the question asked of the rows', () => {
  it('narrows the table and keeps the denominator', async () => {
    await open();
    const search = target.querySelector('.search input');
    search.value = 'gare';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    expect(rows()).toHaveLength(1);
    expect(text(rows()[0])[1]).toBe('Gare est');
    expect(target.querySelector('.count').textContent.replace(/\s+/g, ' ')).toContain('1 of 3');
  });

  it('does not let a letter typed in the search reach the grid', async () => {
    await open();
    // A cell is under the cursor, the way it would be after a click.
    target.querySelector('.row .cell:not(.gutter)').click();
    await settle();

    const search = target.querySelector('.search input');
    search.focus();
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
    await settle();

    expect(target.querySelector('.editor')).toBeNull();
  });
});

describe('editing a cell', () => {
  it('writes the table back to the case', async () => {
    vi.useFakeTimers();
    await open();
    const cell = rows()[0].querySelectorAll('.cell:not(.gutter)')[1];
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    flushSync();

    const editor = target.querySelector('.editor');
    expect(editor).not.toBeNull();
    editor.value = 'Quai nord';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('blur', { bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put).toHaveBeenCalledTimes(1);
    const [path, body] = put.mock.calls[0];
    expect(path).toBe('/api/cases/case-a/sheets/e_sheet');
    expect(body.rows[0]).toEqual(['r1', 'Quai nord', 'ruled out']);
  });

  it('leaves the key column alone', async () => {
    await open();
    const key = rows()[0].querySelectorAll('.cell:not(.gutter)')[0];
    key.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    flushSync();
    expect(target.querySelector('.editor')).toBeNull();
  });
});

describe('rows and columns', () => {
  it('appends a row already carrying its key', async () => {
    vi.useFakeTimers();
    await open();
    button('Row').click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(rows()).toHaveLength(4);
    expect(put.mock.calls[0][1].rows).toHaveLength(4);
    expect(put.mock.calls[0][1].rows[3][0]).toMatch(/^r[0-9a-f]{10}$/);
  });

  it('paints the ticked rows and records the colour beside the table', async () => {
    vi.useFakeTimers();
    await open();
    rows()[0].querySelector('.gutter input').click();
    flushSync();

    target.querySelector('.swatches .c-red').click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls[0][1].meta.colours).toEqual({ r1: 'red' });
    // A colour is presentation: it must not have become a column of the file.
    expect(put.mock.calls[0][1].columns).toEqual(['id', 'Subject', 'Status']);
  });

  it('sorts on a heading and puts the sort back on the third click', async () => {
    await open();
    const heading = target.querySelectorAll('.heading-name')[2];
    heading.click();
    await settle();
    expect(text(rows()[0])[2]).toBe('ruled out'); // blanks sink, r-uled before t-o check

    heading.click();
    await settle();
    expect(text(rows()[0])[2]).toBe('to check');

    heading.click();
    await settle();
    expect(text(rows()[0])[0]).toBe('r1'); // back to the file's own order
  });
});

describe('a cell pointing at an entity', () => {
  /** Open the picker on one cell and let its two requests land. */
  async function pickerOn(rowIndex, columnIndex) {
    rows()[rowIndex].querySelectorAll('.cell:not(.gutter)')[columnIndex]
      .querySelector('.cell-link')
      .click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();
  }

  it('leads with what the case holds, per type, before a key is pressed', async () => {
    // The analyst usually does not know the label: the cell says `3rd Bde` and the
    // case holds `3rd Separate Brigade`. A bare search bar only works when you
    // already know the answer, so the counts come first.
    vi.useFakeTimers();
    await open();
    await pickerOn(1, 2); // an empty cell: nothing to seed the box with

    const chips = [...document.querySelectorAll('.picker .types .chip')].map((chip) =>
      chip.textContent.replace(/\s+/g, ' ').trim(),
    );
    expect(chips).toEqual(['Everything 3', 'person 2', 'vehicle 1']);
    expect([...document.querySelectorAll('.picker .result .label')].map((n) => n.textContent))
      .toEqual(['Witness A', 'Witness B']);
  });

  it('says how much of the answer is on screen, and loads the rest', async () => {
    // A list silently cut at its first page reads as "that is all there is".
    vi.useFakeTimers();
    await open();
    await pickerOn(1, 2);

    expect(document.querySelector('.picker .shown').textContent.replace(/\s+/g, ' ').trim())
      .toBe('2 of 4 shown');

    const more = document.querySelector('.picker .more');
    expect(more.textContent.trim()).toBe('Load 2 more');
    more.click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();

    expect([...document.querySelectorAll('.picker .result .label')].map((n) => n.textContent))
      .toEqual(['Witness A', 'Witness B', 'AB-123', 'Zulu depot']);
    expect(document.querySelector('.picker .more')).toBeNull();
  });

  it('orders the whole matching set, not the page already loaded', async () => {
    vi.useFakeTimers();
    await open();
    await pickerOn(1, 2);

    [...document.querySelectorAll('.picker .order')]
      .find((node) => node.textContent.trim() === 'Z→A')
      .click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();

    // Reversed on the server across all four, so the first page changes entirely —
    // which a client-side sort of the loaded two could not do.
    expect([...document.querySelectorAll('.picker .result .label')].map((n) => n.textContent))
      .toEqual(['Zulu depot', 'AB-123']);
  });

  it('narrows to one type on a click', async () => {
    vi.useFakeTimers();
    await open();
    await pickerOn(1, 2);

    [...document.querySelectorAll('.picker .types .chip')]
      .find((chip) => chip.textContent.includes('vehicle'))
      .click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();

    expect([...document.querySelectorAll('.picker .result .label')].map((n) => n.textContent))
      .toEqual(['AB-123']);
  });

  it('picks with the keyboard, without reaching for the mouse', async () => {
    vi.useFakeTimers();
    await open();
    await pickerOn(1, 2);

    const box = document.querySelector('.picker input');
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    flushSync();
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls[0][1].meta.links).toEqual({ r2: { Status: 'e_other' } });
  });

  it('marks the entity the cell already points at', async () => {
    vi.useFakeTimers();
    await open();
    await pickerOn(1, 2);
    document.querySelectorAll('.picker .result')[0].click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    await pickerOn(1, 2);
    expect(document.querySelector('.picker .result.linked .label').textContent).toBe('Witness A');
    // The modal mounts on the body, so this one is not reachable through `target`.
    const clear = [...document.querySelectorAll('.picker button')].find(
      (node) => node.textContent.trim() === 'Clear the link',
    );
    expect(clear).not.toBeUndefined();
  });

  it('records the link and names the entity in the file', async () => {
    vi.useFakeTimers();
    await open();
    await pickerOn(1, 1);

    const result = [...document.querySelectorAll('.picker .result')][0];
    expect(result.textContent).toContain('Witness A');
    result.click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    const body = put.mock.calls[0][1];
    expect(body.meta.links).toEqual({ r2: { Subject: 'e_person' } });
    // The cell already held "Pont nord", so the link does not overwrite it.
    expect(body.rows[1][1]).toBe('Pont nord');
  });

  it('fills an empty cell with the entity name, so the CSV still says it', async () => {
    vi.useFakeTimers();
    await open();
    await pickerOn(1, 2);

    [...document.querySelectorAll('.picker .result')][0].click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls[0][1].rows[1][2]).toBe('Witness A');
  });

  it('opens the entity a cell points at', async () => {
    vi.useFakeTimers();
    await open();
    await pickerOn(1, 1);
    [...document.querySelectorAll('.picker .result')][0].click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    const mark = rows()[1].querySelectorAll('.cell:not(.gutter)')[1].querySelector('.link-mark');
    expect(mark).not.toBeNull();
    mark.click();
    await vi.advanceTimersByTimeAsync(0);
    flushSync();

    // The assertion is the wrapper, not the panel: EntityDetails is panel content with
    // no chrome of its own, and hosting it bare rendered it into nowhere — the mark
    // appeared to do nothing at all. Board and Timeline both wrap it in a Modal.
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    expect(dialogs.some((node) => node.getAttribute('aria-label') === 'Details')).toBe(true);
  });
});

describe('backing out of what is open over the grid', () => {
  // A menu left open by a stray click is the most common way to be stuck in a grid,
  // so every popover answers Escape and a click beside it.
  const open_ = (label) => {
    button(label).click();
    flushSync();
  };

  it('closes the column menu on Escape', async () => {
    await open();
    target.querySelectorAll('.heading-menu')[1].click();
    await settle();
    expect(target.querySelector('.head-menu')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(target.querySelector('.head-menu')).toBeNull();
  });

  it('closes the column menu on a pointer beside it', async () => {
    await open();
    target.querySelectorAll('.heading-menu')[1].click();
    await settle();

    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await settle();
    expect(target.querySelector('.head-menu')).toBeNull();
  });

  it('keeps the column menu open when the pointer lands on its own heading', async () => {
    // The wrapper holds the trigger too: closing on the press and reopening on the
    // click would leave the menu open and look like the button does nothing.
    await open();
    const trigger = target.querySelectorAll('.heading-menu')[1];
    trigger.click();
    await settle();

    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await settle();
    expect(target.querySelector('.head-menu')).not.toBeNull();
  });

  it('closes the columns menu and the sheet list the same way', async () => {
    await open();
    open_('Columns');
    expect(target.querySelector('.columns-menu')).not.toBeNull();
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await settle();
    expect(target.querySelector('.columns-menu')).toBeNull();

    open_('1 in this case');
    expect(target.querySelector('.sheet-menu')).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(target.querySelector('.sheet-menu')).toBeNull();
  });

  it('closes the fill bar and the row panel on Escape', async () => {
    await open();
    rows()[0].querySelector('.gutter input').click();
    await settle();
    open_('Fill a column');
    expect(target.querySelector('.fill-bar')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(target.querySelector('.fill-bar')).toBeNull();

    rows()[0].querySelector('.cell-open').click();
    await settle();
    expect(target.querySelector('.panel')).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(target.querySelector('.panel')).toBeNull();
  });

  it('leaves Escape to the cell editor while a cell is being typed in', async () => {
    await open();
    const cell = rows()[0].querySelectorAll('.cell:not(.gutter)')[1];
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    expect(target.querySelector('.editor')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(target.querySelector('.editor')).toBeNull();
  });
});

describe('two writers on one file', () => {
  // The premise is that the file is the artifact, so the analyst may have it open in
  // a spreadsheet too. The grid must not win a race it cannot see.
  it('presents the stamp it read, so the server can refuse a stale save', async () => {
    vi.useFakeTimers();
    await open();
    button('Row').click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls[0][1].stamp).toBe('1000-64');
  });

  it('asks rather than overwriting when the file has moved on', async () => {
    vi.useFakeTimers();
    const conflict = Object.assign(new Error('this file changed on disk'), { status: 409 });
    put.mockRejectedValueOnce(conflict);
    await open();
    button('Row').click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    const notice = target.querySelector('.notice.danger');
    expect(notice.textContent).toContain('changed on disk');
    // The banner says it, once. A toast on top would say the same thing and vanish.
    expect(toast).not.toHaveBeenCalled();
  });

  it('writes nothing more until the analyst has answered', async () => {
    vi.useFakeTimers();
    put.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }));
    await open();
    button('Row').click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(put).toHaveBeenCalledTimes(1);

    button('Row').click();
    flushSync();
    await vi.advanceTimersByTimeAsync(2000);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('reloads the file and loses the grid version of it', async () => {
    vi.useFakeTimers();
    put.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }));
    await open();
    button('Row').click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    get.mockImplementation((path) =>
      path.includes('/sheets/') && !path.endsWith('/sheets')
        ? Promise.resolve({ ...structuredClone(SHEET), stamp: '9000-70' })
        : route(path),
    );
    button('Reload').click();
    await vi.advanceTimersByTimeAsync(10);
    flushSync();

    expect(rows()).toHaveLength(3); // the appended row is gone
    expect(target.querySelector('.notice.danger')).toBeNull();
  });

  it('overwrites on request, by sending no stamp at all', async () => {
    vi.useFakeTimers();
    put.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }));
    await open();
    button('Row').click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    button('Overwrite').click();
    await vi.advanceTimersByTimeAsync(10);
    flushSync();

    expect(put.mock.calls[1][1].stamp).toBeUndefined();
    expect(target.querySelector('.notice.danger')).toBeNull();
  });
});

describe('the clipboard', () => {
  function pasteInto(text) {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    event.clipboardData = { getData: () => text };
    window.dispatchEvent(event);
    flushSync();
  }

  it('lands a block of cells where the cursor is', async () => {
    vi.useFakeTimers();
    await open();
    rows()[0].querySelectorAll('.cell:not(.gutter)')[1].click();
    flushSync();

    pasteInto('Quai nord\tconfirmed\nPont sud\tto check');
    await vi.advanceTimersByTimeAsync(1000);

    const body = put.mock.calls[0][1];
    expect(body.rows[0]).toEqual(['r1', 'Quai nord', 'confirmed']);
    expect(body.rows[1]).toEqual(['r2', 'Pont sud', 'to check']);
  });

  it('turns a wall of links into one row per link', async () => {
    // The "to be sorted" inbox every field binder keeps, in one gesture.
    vi.useFakeTimers();
    await open();
    rows()[0].querySelectorAll('.cell:not(.gutter)')[1].click();
    flushSync();

    pasteInto('https://a.example/one\nhttps://b.example/two\nhttps://c.example/three');
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls[0][1].rows.map((row) => row[1])).toEqual([
      'https://a.example/one',
      'https://b.example/two',
      'https://c.example/three',
    ]);
  });

  it('grows the sheet when the links outnumber the rows', async () => {
    vi.useFakeTimers();
    await open();
    rows()[2].querySelectorAll('.cell:not(.gutter)')[1].click();
    flushSync();

    pasteInto('https://a.example/one\nhttps://b.example/two\nhttps://c.example/three');
    await vi.advanceTimersByTimeAsync(1000);

    const body = put.mock.calls[0][1];
    expect(body.rows).toHaveLength(5);
    expect(body.rows[4][1]).toBe('https://c.example/three');
    expect(body.rows[4][0]).toMatch(/^r[0-9a-f]{10}$/);
  });

  it('says so when a pasted block was wider than the sheet', async () => {
    vi.useFakeTimers();
    await open();
    rows()[0].querySelectorAll('.cell:not(.gutter)')[2].click();
    flushSync();

    pasteInto('a\tb\tc');
    await vi.advanceTimersByTimeAsync(1000);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('did not fit'));
  });

  it('leaves a paste into the search box to the search box', async () => {
    vi.useFakeTimers();
    await open();
    const search = target.querySelector('.search input');
    search.focus();
    const event = new Event('paste', { bubbles: true, cancelable: true });
    event.clipboardData = { getData: () => 'a\tb' };
    search.dispatchEvent(event);
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put).not.toHaveBeenCalled();
  });

  it('copies the selected range as a block a spreadsheet reads back', async () => {
    await open();
    rows()[0].querySelectorAll('.cell:not(.gutter)')[1].click();
    flushSync();
    // Shift-click the far corner: two rows by two columns.
    rows()[1].querySelectorAll('.cell:not(.gutter)')[2].dispatchEvent(
      new MouseEvent('click', { bubbles: true, shiftKey: true }),
    );
    flushSync();

    let written = null;
    const event = new Event('copy', { bubbles: true, cancelable: true });
    event.clipboardData = { setData: (_type, value) => (written = value) };
    window.dispatchEvent(event);

    expect(written).toBe('Quai sud\truled out\nPont nord\t');
  });
});

describe('working on many rows at once', () => {
  it('ticks everything shown, and only what is shown', async () => {
    await open();
    const search = target.querySelector('.search input');
    search.value = 'quai';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    target.querySelector('.head .gutter input').click();
    await settle();
    expect(target.querySelector('.question .count').textContent).toContain('1 of 3');
    expect([...target.querySelectorAll('.question .count')][1].textContent).toContain('1 ticked');
  });

  it('ticks a range on shift-click, in the order the grid draws', async () => {
    await open();
    rows()[0].querySelector('.gutter input').click();
    flushSync();
    rows()[2].querySelector('.gutter input').dispatchEvent(
      new MouseEvent('click', { bubbles: true, shiftKey: true }),
    );
    await settle();

    expect([...target.querySelectorAll('.question .count')][1].textContent).toContain('3 ticked');
  });

  it('fills one column for every ticked row, as one step', async () => {
    vi.useFakeTimers();
    await open();
    target.querySelector('.head .gutter input').click();
    flushSync();
    button('Fill a column').click();
    flushSync();

    [...target.querySelectorAll('.fill-columns .chip')]
      .find((chip) => chip.textContent.trim() === 'Status')
      .click();
    flushSync();
    const value = target.querySelector('.fill-bar input');
    value.value = 'geolocated';
    value.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    target.querySelector('.fill-bar .btn-primary').click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls[0][1].rows.map((row) => row[2])).toEqual([
      'geolocated',
      'geolocated',
      'geolocated',
    ]);
  });

  it('copies a cell down the selection and walks the whole run back at once', async () => {
    vi.useFakeTimers();
    await open();
    rows()[0].querySelectorAll('.cell:not(.gutter)')[2].click();
    flushSync();
    rows()[2].querySelectorAll('.cell:not(.gutter)')[2].dispatchEvent(
      new MouseEvent('click', { bubbles: true, shiftKey: true }),
    );
    flushSync();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(put.mock.calls[0][1].rows.map((row) => row[2])).toEqual([
      'ruled out',
      'ruled out',
      'ruled out',
    ]);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(put.mock.calls[1][1].rows.map((row) => row[2])).toEqual([
      'ruled out',
      '',
      'to check',
    ]);
  });
});

describe('reading the table', () => {
  it('opens a link in a cell instead of showing a hundred characters of it', async () => {
    get.mockImplementation((path) => {
      if (path.includes('/sheets/') && !path.endsWith('/sheets')) {
        const sheet = structuredClone(SHEET);
        sheet.rows[0][1] = 'https://t.me/channel/1234?single';
        return Promise.resolve(sheet);
      }
      return route(path);
    });
    await open();
    const link = rows()[0].querySelector('.cell-url');
    expect(link.getAttribute('href')).toBe('https://t.me/channel/1234?single');
    expect(link.textContent.trim()).toBe('t.me/…');
  });

  it('reads one row down a panel, because fourteen columns do not read across', async () => {
    await open();
    rows()[1].querySelector('.cell-open').click();
    await settle();

    const panel = target.querySelector('.panel');
    expect(panel).not.toBeNull();
    expect([...panel.querySelectorAll('.label span')].map((n) => n.textContent)).toEqual([
      'id',
      'Subject',
      'Status',
    ]);
    expect(panel.querySelector('.progress').textContent).toContain('1 of 2 filled');
  });

  it('writes an edit made in the panel back to the file', async () => {
    vi.useFakeTimers();
    await open();
    rows()[1].querySelector('.cell-open').click();
    flushSync();

    // The key column is read-only in the panel, so the boxes are Subject then Status.
    const field = [...target.querySelectorAll('.panel textarea')][0];
    field.value = 'Pont sud';
    field.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls[0][1].rows[1][1]).toBe('Pont sud');
  });

  it('narrows on what a column does not hold, which no list of values can do', async () => {
    await open();
    target.querySelectorAll('.heading-menu')[2].click();
    await settle();

    const without = target.querySelector('.without input');
    without.value = 'ruled';
    without.dispatchEvent(new Event('input', { bubbles: true }));
    without.dispatchEvent(new Event('blur', { bubbles: true }));
    await settle();

    expect(rows()).toHaveLength(2);
    expect(target.querySelector('.chip').textContent).toContain('without ruled');
  });

  it('narrows on the rows with nothing in a column yet', async () => {
    await open();
    target.querySelectorAll('.heading-menu')[2].click();
    await settle();
    button('Only the empty ones').click();
    await settle();

    expect(rows()).toHaveLength(1);
    expect(text(rows()[0])[1]).toBe('Pont nord');
  });

  it('keeps a chosen column in view and records it beside the table', async () => {
    vi.useFakeTimers();
    await open();
    target.querySelectorAll('.heading-menu')[1].click();
    flushSync();
    button('Keep this column in view').click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls[0][1].meta.frozen).toBe('Subject');
    // The key column sticks at the gutter, the chosen one just past it.
    const sticky = [...rows()[0].querySelectorAll('.cell.sticky')];
    expect(sticky.map((cell) => cell.style.left)).toEqual(['34px', '194px']);
  });

  it('moves a column in the file, where a collaborator will see it', async () => {
    vi.useFakeTimers();
    await open();
    const headings = [...target.querySelectorAll('.head .heading')];
    headings[2].querySelector('.grip').dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true }),
    );
    flushSync();
    expect(target.querySelectorAll('.heading.dragged')).toHaveLength(1);

    headings[1].dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    flushSync();
    expect(target.querySelectorAll('.heading.target')).toHaveLength(1);

    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls[0][1].columns).toEqual(['id', 'Status', 'Subject']);
    expect(put.mock.calls[0][1].rows[0]).toEqual(['r1', 'ruled out', 'Quai sud']);
  });

  it('reaches the search from the grid, and adds a row from anywhere', async () => {
    vi.useFakeTimers();
    await open();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
    flushSync();
    expect(document.activeElement).toBe(target.querySelector('.search input'));

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
    );
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(put.mock.calls[0][1].rows).toHaveLength(4);
  });
});

describe('the sheet itself', () => {
  it('renames through the entity, so the file follows', async () => {
    await open();
    const name = target.querySelector('.title-input');
    name.value = 'Shortlist';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    name.dispatchEvent(new Event('blur', { bubbles: true }));
    await settle();

    expect(patch).toHaveBeenCalledWith('/api/cases/case-a/entities/e_sheet', {
      label: 'Shortlist',
    });
  });

  it('offers a way in when the case holds none', async () => {
    get.mockImplementation((path) =>
      path.endsWith('/sheets') ? Promise.resolve({ sheets: [] }) : route(path),
    );
    await open();
    expect(target.querySelector('.empty')).not.toBeNull();
    expect(button('New sheet')).not.toBeUndefined();
  });
});
