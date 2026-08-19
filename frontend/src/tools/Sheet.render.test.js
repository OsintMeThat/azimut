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
const uiState = { tool: 'sheet', mapSheetPoints: null, timelineRange: null };
const reloadCase = vi.fn(async () => {});
vi.mock('../lib/state.svelte.js', async () => {
  const { caseState } = await import('../components/views.fixture.svelte.js');
  return { caseState, toast, uiState, reloadCase };
});
vi.mock('../components/EntityDetails.svelte', async () => await import('../components/Modal.svelte'));

const { caseState } = await import('../components/views.fixture.svelte.js');
const { default: Sheet } = await import('./Sheet.svelte');

let live = null;
let target = null;

/** Drain the microtask queue and paint. Generously: a press can run through a chain of
 *  awaits — an export flushes a pending save, and that save queues behind whatever write
 *  is already in the air — and a count too tight reads as "the button did nothing". */
async function settle() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  flushSync();
}

/**
 * Type into the search box and let the narrowing land.
 *
 * What is typed and what the grid is filtered on answer on different clocks: the box has to
 * echo the keystroke at once and the pass over the rows runs a moment later, so a test that
 * only drains microtasks reads the table unfiltered.
 */
async function typeSearch(term) {
  const box = target.querySelector('.search input');
  box.value = term;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 220));
  await settle();
}

function route(path) {
  if (path.endsWith('/sheets')) {
    return Promise.resolve({
      sheets: [{ id: SHEET.id, title: SHEET.title, path: SHEET.path, rows: 3, columns: 3 }],
    });
  }
  if (path.includes('/sheets/')) return Promise.resolve(structuredClone(SHEET));
  if (path.includes('/entity-types')) {
    return Promise.resolve([
      {
        type: 'person',
        label: 'Person',
        family: 'subject',
        manual: true,
        promotable: true,
        attrs: [{ key: 'role', label: 'Role', kind: 'text' }],
      },
      {
        type: 'organization',
        label: 'Organization',
        family: 'subject',
        manual: true,
        promotable: true,
        attrs: [],
      },
      {
        type: 'vehicle',
        label: 'Vehicle',
        family: 'subject',
        manual: true,
        promotable: true,
        attrs: [],
      },
      {
        type: 'place',
        label: 'Place',
        family: 'place',
        manual: false,
        promotable: true,
        attrs: [],
      },
    ]);
  }
  if (path.includes('/relation-types')) {
    return Promise.resolve([
      {
        type: 'member-of', label: 'is a member of', inverse_label: 'has member',
        manual: true, action: 'relation', ratable: true,
        from_types: ['person'], to_types: ['organization'],
      },
      {
        type: 'associated-with', label: 'is associated with',
        inverse_label: 'is associated with', manual: true, action: 'relation', ratable: true,
        from_types: ['person', 'organization'], to_types: ['person', 'organization'],
      },
      {
        type: 'owns', label: 'owns', inverse_label: 'is owned by',
        manual: true, action: 'relation', ratable: true,
        from_types: ['person'], to_types: ['vehicle'],
      },
    ]);
  }
  if (path.includes('/confidence-levels')) {
    return Promise.resolve([
      { value: 3, label: 'Certain' },
      { value: 2, label: 'Probable' },
      { value: 1, label: 'Possible' },
    ]);
  }
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

/** The rows the sheet actually holds. Not the ghost — the grid always ends on an empty
 *  line that is an offer rather than a row — and not the pinned copy, which is one of
 *  these drawn a second time under the heading. */
const rows = () => [...target.querySelectorAll('.rows:not(.ghost) .row')];
const ghostRow = () => target.querySelector('.ghost .row');
/** Grow the sheet the way the grid offers it: by writing in the empty line it ends on.
 *  There is no button for this any more, which is the point — a footer button for the most
 *  ordinary thing a grid does was a trip to the bottom of the screen and back. */
const addGhostRow = () => target.querySelector('.ghost .ghost-cell').click();
const cellsOf = (row) => [...row.querySelectorAll('.cell:not(.gutter) .value')];
const text = (row) => cellsOf(row).map((cell) => cell.textContent.trim());
const button = (label) =>
  [...target.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(label));
/** A button of the confirmation that is open. Scoped to the dialog rather than to the
 *  document: it is portalled onto `body` so it survives a tool going fullscreen, and
 *  its `Delete` and the question bar's `Delete` are two different buttons. */
const inDialog = (label) =>
  [...document.querySelectorAll('[role="alertdialog"] button')].find((node) =>
    node.textContent.trim().startsWith(label),
  );
/**
 * Open a heading's short menu — the frequent gestures — and hand it back.
 *
 * The `...` used to open the setup panel straight away. It opens this instead, because
 * insert, duplicate, rename and split had no door at all while a role editor had one, and
 * the panel is now this menu's last row.
 */
async function headingMenu(columnIndex) {
  target.querySelectorAll('.heading-menu')[columnIndex].click();
  await settle();
  return document.querySelector('.heading-menu[role="menu"]');
}

/** A row of that menu, by what it says. */
const inHeadingMenu = (label) =>
  [...document.querySelectorAll('.heading-menu[role="menu"] button')].find((node) =>
    node.textContent.trim().startsWith(label),
  );

/** The setup panel, which is two presses from the heading now: the short menu, then its
 *  last row. Everything the panel used to be reached by goes through here. */
async function setupOf(columnIndex) {
  await headingMenu(columnIndex);
  inHeadingMenu('Set up this column')?.click();
  await settle();
  return target.querySelector('.column-panel');
}

/** Open a column's filter, which lives on its heading's funnel rather than in the
 *  panel: the panel is where a column is set up, the funnel is what is asked of it. */
async function askOf(columnIndex) {
  target.querySelectorAll('.heading-filter')[columnIndex].click();
  await settle();
  return target.querySelector('.filter-menu');
}
/** Press an element the way a browser does: the pointer goes down, then the click lands.
 *  The grid places its cursor on `pointerdown`, because a spreadsheet's selection is a
 *  drag, and `.click()` alone is not what a mouse sends. */
const press = (node, options = {}) => {
  node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, ...options }));
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, ...options }));
};

beforeEach(() => {
  caseState.current = { id: 'case-a', name: 'Harbour' };
  caseState.rev = 0;
  // Every handler the grid puts on `window` fires only while the sheet is the tool on
  // screen — tools stay mounted and are hidden with CSS, so without that guard a Delete
  // pressed over the map emptied cells here. The handoffs leave this pointing elsewhere.
  uiState.tool = 'sheet';
  uiState.mapSheetPoints = null;
  uiState.timelineRange = null;
  get.mockImplementation(route);
  put.mockClear();
  post.mockClear();
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
    await typeSearch('gare');

    expect(rows()).toHaveLength(1);
    expect(text(rows()[0])[1]).toBe('Gare est');
    expect(target.querySelector('.count').textContent.replace(/\s+/g, ' ')).toContain('1 of 3');
  });

  it('does not let a letter typed in the search reach the grid', async () => {
    await open();
    // A cell is under the cursor, the way it would be after a click.
    press(target.querySelector('.row .cell:not(.gutter)'));
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
    addGhostRow();
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
    // A colour is the grid's, not the file's, so it goes down the sidecar's own route and
    // the CSV is left byte-identical. Rewriting the file to record a paint moved the
    // modification time the stamp is made of, and the analyst's next save then answered a
    // conflict nobody caused.
    expect(put.mock.calls[0][0]).toBe('/api/cases/case-a/sheets/e_sheet/meta');
    expect(put.mock.calls[0][1].columns).toBeUndefined();
    expect(put.mock.calls[0][1].rows).toBeUndefined();
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

  it('drops the link when the cell that held it is emptied', async () => {
    // A blank cell still holding a link is a link nobody can see, reach or clear — and it
    // would keep its `mentions` edge on every save, so the case would go on believing a
    // row that says nothing.
    vi.useFakeTimers();
    await open();
    await pickerOn(1, 1);
    [...document.querySelectorAll('.picker .result')][0].click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(put.mock.calls[0][1].meta.links).toEqual({ r2: { Subject: 'e_person' } });

    press(rows()[1].querySelectorAll('.cell:not(.gutter)')[1]);
    flushSync();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    const body = put.mock.calls.at(-1)[1];
    expect(body.rows[1][1]).toBe('');
    expect(body.meta.links).toEqual({});
  });

  it('lets go of a link the case has deleted, without saving anything', async () => {
    // the link is an id in the sidecar, so the delete elsewhere cannot reach the copy on
    // screen: the cell kept a live-looking link, and the next save wrote the dead id back
    get.mockImplementation((path) =>
      path.includes('/sheets/') && !path.endsWith('/sheets')
        ? Promise.resolve({
            ...structuredClone(SHEET),
            meta: { ...SHEET.meta, links: { r1: { Subject: 'e_gone' }, r2: { Subject: 'e_kept' } } },
          })
        : route(path),
    );
    post.mockResolvedValueOnce({ missing: ['e_gone'] });
    await open();
    const mark = (index) =>
      rows()[index].querySelectorAll('.cell:not(.gutter)')[1].querySelector('.link-mark');
    expect(mark(0)).not.toBeNull();

    caseState.rev += 1; // something was deleted on another screen
    await settle();

    expect(post).toHaveBeenCalledWith('/api/cases/case-a/entities/missing', {
      ids: ['e_gone', 'e_kept'],
    });
    expect(mark(0)).toBeNull();
    expect(mark(1)).not.toBeNull(); // the live one is untouched
    expect(toast).toHaveBeenCalledWith('Dropped 1 link to deleted items', 'info');
    // the file was cleared by the delete itself, so the screen has nothing to write back
    expect(put).not.toHaveBeenCalled();
  });

  it('asks nothing of a case change when the sheet points at nobody', async () => {
    await open();
    caseState.rev += 1;
    await settle();

    expect(post).not.toHaveBeenCalled();
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

  it('closes the column panel on Escape', async () => {
    await open();
    await setupOf(1);
    expect(target.querySelector('.column-panel')).not.toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(target.querySelector('.column-panel')).toBeNull();
  });

  it('leaves the column panel open when the pointer lands in the grid', async () => {
    // A panel is not a popover: working on a column means clicking cells of it, and a
    // panel that closed on the first of those would be unusable.
    await open();
    await setupOf(1);

    press(rows()[0].querySelectorAll('.cell:not(.gutter)')[1]);
    await settle();
    expect(target.querySelector('.column-panel')).not.toBeNull();
  });

  it('follows the next heading rather than closing, and closes on its own', async () => {
    // The one thing the panel does that the menu could not: six roles are six clicks.
    await open();
    await setupOf(1);
    expect(target.querySelector('.column-panel .name').value).toBe('Subject');

    await setupOf(2);
    expect(target.querySelector('.column-panel .name').value).toBe('Status');

    target.querySelector('.column-panel header .btn-ghost').click();
    await settle();
    expect(target.querySelector('.column-panel')).toBeNull();
  });

  it('deletes a column from its heading, from the grid and from the file', async () => {
    // Pressed rather than called: the button is what was broken once, and the logic under
    // it was green the whole time. A test that calls `removeColumn` proves the arithmetic
    // and nothing about the button that never reached it.
    vi.useFakeTimers();
    await open();
    await setupOf(2);
    expect(target.querySelector('.column-panel .name').value).toBe('Status');

    await headingMenu(2);
    inHeadingMenu('Delete this column').click();
    await settle();
    // A column carries a role, a note and a width nothing else remembers, so the
    // click is confirmed before the cells go.
    expect(document.querySelector('[role="alertdialog"]').textContent).toContain('Status');
    inDialog('Delete the column').click();
    await settle();

    expect([...target.querySelectorAll('.heading-name span')].map((n) => n.textContent)).toEqual([
      'id',
      'Subject',
    ]);
    expect(target.querySelector('.column-panel')).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(put.mock.calls[0][1].columns).toEqual(['id', 'Subject']);
    expect(put.mock.calls[0][1].rows[0]).toEqual(['r1', 'Quai sud']);
  });

  it('takes the deleted column out of what the sidecar remembers', async () => {
    vi.useFakeTimers();
    await open();
    // A width on the doomed column, so the sidecar has something to lose with it.
    await headingMenu(2);
    inHeadingMenu('Delete this column').click();
    await settle();
    inDialog('Delete the column').click();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);

    expect(Object.keys(put.mock.calls[0][1].meta.widths)).not.toContain('Status');
    expect(put.mock.calls[0][1].meta.roles?.Status).toBeUndefined();
  });

  it('gives the right slot to one panel at a time', async () => {
    await open();
    rows()[0].querySelector('.cell-open').click();
    await settle();
    expect(target.querySelector('.panel')).not.toBeNull();
    expect(target.querySelector('.column-panel')).toBeNull();

    await setupOf(1);
    expect(target.querySelector('.column-panel')).not.toBeNull();
    expect(target.querySelectorAll('.panel')).toHaveLength(1);
  });

  it('closes the columns menu and the sheet list the same way', async () => {
    await open();
    open_('Columns');
    expect(target.querySelector('.columns-menu')).not.toBeNull();
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await settle();
    expect(target.querySelector('.columns-menu')).toBeNull();

    open_('1 sheet');
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
    addGhostRow();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls[0][1].stamp).toBe('1000-64');
  });

  it('asks rather than overwriting when the file has moved on', async () => {
    vi.useFakeTimers();
    const conflict = Object.assign(new Error('this file changed on disk'), { status: 409 });
    put.mockRejectedValueOnce(conflict);
    await open();
    addGhostRow();
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
    addGhostRow();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(put).toHaveBeenCalledTimes(1);

    addGhostRow();
    flushSync();
    await vi.advanceTimersByTimeAsync(2000);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('reloads the file and loses the grid version of it', async () => {
    vi.useFakeTimers();
    put.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }));
    await open();
    addGhostRow();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    get.mockImplementation((path) =>
      path.includes('/sheets/') && !path.endsWith('/sheets')
        ? Promise.resolve({ ...structuredClone(SHEET), stamp: '9000-70' })
        : route(path),
    );
    // Asked first: this drops the analyst's own unsaved row, and the undo stack with it.
    button('Reload').click();
    flushSync();
    inDialog('Reload').click();
    await vi.advanceTimersByTimeAsync(10);
    flushSync();

    expect(rows()).toHaveLength(3); // the appended row is gone
    expect(target.querySelector('.notice.danger')).toBeNull();
  });

  it('does not ask before reading a file that costs the grid nothing', async () => {
    vi.useFakeTimers();
    await open();
    // The soft banner: the file moved on, nothing was refused and nothing is unsaved.
    get.mockImplementation((path) =>
      path.endsWith('/stamp')
        ? Promise.resolve({ stamp: '9000-70' })
        : path.includes('/sheets/') && !path.endsWith('/sheets')
          ? Promise.resolve({ ...structuredClone(SHEET), stamp: '9000-70' })
          : route(path),
    );
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(10);
    flushSync();

    button('Reload').click();
    await vi.advanceTimersByTimeAsync(10);
    flushSync();

    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(target.querySelector('.notice')).toBeNull();
  });

  it('overwrites on request, by sending no stamp at all', async () => {
    vi.useFakeTimers();
    put.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }));
    await open();
    addGhostRow();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    // Asked first: this drops whatever a colleague or a spreadsheet wrote.
    button('Overwrite').click();
    flushSync();
    inDialog('Overwrite').click();
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
    press(rows()[0].querySelectorAll('.cell:not(.gutter)')[1]);
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
    press(rows()[0].querySelectorAll('.cell:not(.gutter)')[1]);
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
    press(rows()[2].querySelectorAll('.cell:not(.gutter)')[1]);
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
    press(rows()[0].querySelectorAll('.cell:not(.gutter)')[2]);
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

  it('pulls a selection across the cells the pointer passes, as a spreadsheet does', async () => {
    await open();
    press(rows()[0].querySelectorAll('.cell:not(.gutter)')[1]);
    flushSync(); // a browser paints between the press and the first move
    // Held, and dragged across to a far corner without releasing.
    rows()[1]
      .querySelectorAll('.cell:not(.gutter)')[2]
      .dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    await settle();
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await settle();

    expect(target.querySelector('.foot').textContent).toContain('2 × 2 selected');
    // Released, so passing over another cell no longer extends it.
    rows()[2]
      .querySelectorAll('.cell:not(.gutter)')[2]
      .dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    await settle();
    expect(target.querySelector('.foot').textContent).toContain('2 × 2 selected');
  });

  it('lands a block on the rows the search left on screen', async () => {
    // Copied off a narrowed screen, pasted back onto it. Walking the file instead would
    // write the block into rows the analyst filtered away and cannot watch it land on.
    vi.useFakeTimers();
    await open();
    const box = target.querySelector('.search input');
    box.value = 'e';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(250);
    flushSync();
    // 'Quai sud' (ruled out) and 'Gare est' match; the row between them is off the
    // screen, and it is the one a paste that walked the file would have written.
    expect(rows()).toHaveLength(2);
    press(rows()[0].querySelectorAll('.cell:not(.gutter)')[1]);
    flushSync();

    pasteInto('one\ntwo');
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls[0][1].rows.map((row) => row[1])).toEqual(['one', 'Pont nord', 'two']);
  });

  it('copies an empty rectangle as empty, rather than leaving an older clipboard in place', async () => {
    // The grid is not selectable text, so a copy the tool declines is a copy nobody
    // makes: the keystroke looked like it worked and the next paste brought back
    // whatever had been copied before it.
    await open();
    press(rows()[1].querySelectorAll('.cell:not(.gutter)')[2]);
    flushSync();

    let written = null;
    const event = new Event('copy', { bubbles: true, cancelable: true });
    event.clipboardData = { setData: (_type, value) => (written = value) };
    window.dispatchEvent(event);

    expect(written).toBe('');
    expect(event.defaultPrevented).toBe(true);
  });

  it('copies the selected range as a block a spreadsheet reads back', async () => {
    await open();
    press(rows()[0].querySelectorAll('.cell:not(.gutter)')[1]);
    flushSync();
    // Shift-click the far corner: two rows by two columns.
    press(rows()[1].querySelectorAll('.cell:not(.gutter)')[2], { shiftKey: true });
    flushSync();

    let written = null;
    const event = new Event('copy', { bubbles: true, cancelable: true });
    event.clipboardData = { setData: (_type, value) => (written = value) };
    window.dispatchEvent(event);

    expect(written).toBe('Quai sud\truled out\nPont nord\t');
  });
});

describe('the bars around the grid', () => {
  it('keeps the ways of starting a sheet under one button', async () => {
    // Five buttons in a header that also carries a title, a subtitle, the sheet list, an
    // export and a delete ran off the edge of a laptop screen. They are asked once per
    // sheet; the grid's own controls are asked all day.
    await open();
    expect(button('Import a file')).toBeUndefined();
    button('New').click();
    await settle();

    const rows_ = [...target.querySelectorAll('.new-menu .menu-row')].map((node) =>
      node.textContent.trim(),
    );
    expect(rows_).toEqual([
      'Blank sheet',
      'Import a file',
      'Paste a table',
      'From the case',
      'Add rows to this sheet',
    ]);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(target.querySelector('.new-menu')).toBeNull();
  });

  it('draws what the chosen rows can do over the grid, not in the question bar', async () => {
    // In the question bar these ten controls wrapped it onto a second line, which pushed
    // the table down a row height under the pointer that had just ticked the row.
    await open();
    expect(target.querySelector('.selection')).toBeNull();
    rows()[0].querySelector('.gutter input').click();
    await settle();

    const bar = target.querySelector('.selection');
    expect(bar).not.toBeNull();
    expect(bar.closest('.grid-wrap')).not.toBeNull();
    expect(target.querySelector('.question').textContent).not.toContain('Promote');
  });

  it('drops the selection from the bar, the way Escape does', async () => {
    await open();
    rows()[0].querySelector('.gutter input').click();
    rows()[1].querySelector('.gutter input').click();
    await settle();
    expect(target.querySelector('.selection .count').textContent).toContain('2 ticked');

    target.querySelector('[aria-label="Drop the selection"]').click();
    await settle();
    expect(target.querySelector('.selection')).toBeNull();
    expect(target.querySelectorAll('.row.ticked')).toHaveLength(0);
  });
});

describe('working on many rows at once', () => {
  it('ticks everything shown, and only what is shown', async () => {
    await open();
    await typeSearch('quai');

    target.querySelector('.head .gutter input').click();
    await settle();
    expect(target.querySelector('.question .count').textContent).toContain('1 of 3');
    expect(target.querySelector('.selection .count').textContent).toContain('1 ticked');
  });

  it('ticks a range on shift-click, in the order the grid draws', async () => {
    await open();
    rows()[0].querySelector('.gutter input').click();
    flushSync();
    rows()[2].querySelector('.gutter input').dispatchEvent(
      new MouseEvent('click', { bubbles: true, shiftKey: true }),
    );
    await settle();

    expect(target.querySelector('.selection .count').textContent).toContain('3 ticked');
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

  it('says how many rows are about to go before they go', async () => {
    vi.useFakeTimers();
    await open();
    target.querySelector('.head .gutter input').click();
    flushSync();
    button('Delete').click();
    await settle();

    expect(document.querySelector('[role="alertdialog"]').textContent).toContain('Delete 3 rows');
    expect(rows()).toHaveLength(3);

    inDialog('Cancel').click();
    await settle();
    expect(rows()).toHaveLength(3);
  });

  it('deletes them once the count has been read', async () => {
    vi.useFakeTimers();
    await open();
    rows()[0].querySelector('.gutter input').click();
    flushSync();
    button('Delete').click();
    await settle();
    inDialog('Delete').click();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);

    expect(rows()).toHaveLength(2);
    expect(put.mock.calls[0][1].rows.map((row) => row[0])).toEqual(['r2', 'r3']);
  });

  it('copies a cell down the selection and walks the whole run back at once', async () => {
    vi.useFakeTimers();
    await open();
    press(rows()[0].querySelectorAll('.cell:not(.gutter)')[2]);
    flushSync();
    press(rows()[2].querySelectorAll('.cell:not(.gutter)')[2], { shiftKey: true });
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
    const menu = await askOf(1);

    // Holding, then Without: the two halves of one question, in that order.
    const without = [...menu.querySelectorAll('.field input')][1];
    without.value = 'ruled';
    without.dispatchEvent(new Event('input', { bubbles: true }));
    without.dispatchEvent(new Event('blur', { bubbles: true }));
    await settle();

    expect(rows()).toHaveLength(2);
    expect(target.querySelector('.question .chip').textContent).toContain('without ruled');
  });

  it('narrows on a word a column must hold, which is all a prose column offers', async () => {
    await open();
    const menu = await askOf(1);

    const holding = [...menu.querySelectorAll('.field input')][0];
    holding.value = 'ruled';
    holding.dispatchEvent(new Event('input', { bubbles: true }));
    holding.dispatchEvent(new Event('blur', { bubbles: true }));
    await settle();

    expect(rows()).toHaveLength(1);
    expect(text(rows()[0])[1]).toBe('Quai sud');
    expect(target.querySelector('.question .chip').textContent).toContain('with ruled');
  });

  it('narrows on the rows with nothing in a column yet', async () => {
    await open();
    await askOf(1);
    button('Empty').click();
    await settle();

    expect(rows()).toHaveLength(1);
    expect(text(rows()[0])[1]).toBe('Pont nord');
  });

  it('keeps the funnel lit on a column that is being asked something', async () => {
    await open();
    await askOf(1);
    button('Empty').click();
    await settle();

    const funnels = [...target.querySelectorAll('.heading-filter')];
    expect(funnels[1].classList.contains('asking')).toBe(true);
    expect(funnels[0].classList.contains('asking')).toBe(false);
  });

  it('filters on the value under the pointer, from the cell itself', async () => {
    await open();
    const cell = [...rows()[0].querySelectorAll('.cell:not(.gutter)')][2];
    cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 60 }));
    await settle();

    button('Only “ruled out”').click();
    await settle();

    expect(rows()).toHaveLength(1);
    expect(text(rows()[0])[1]).toBe('Quai sud');
    expect(target.querySelector('.cell-menu')).toBeNull();
  });

  it('offers the empty rows when the cell right-clicked holds nothing', async () => {
    await open();
    const cell = [...rows()[1].querySelectorAll('.cell:not(.gutter)')][2];
    cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 60 }));
    await settle();

    button('Only the empty ones').click();
    await settle();

    expect(rows()).toHaveLength(1);
    expect(text(rows()[0])[1]).toBe('Pont nord');
  });

  it('says what is asked of a column in the panel, without offering it twice', async () => {
    await open();
    await askOf(1);
    button('Empty').click();
    await settle();
    await setupOf(2);

    const panel = target.querySelector('.column-panel');
    expect(panel.querySelector('.asked').textContent).toContain('empty');
    // The filter is set on the heading and nowhere else: two places to ask one
    // question is what splitting the two doors was for.
    expect([...panel.querySelectorAll('button')].map((n) => n.textContent.trim())).not.toContain(
      'Empty',
    );

    panel.querySelector('.asked .clear').click();
    await settle();
    expect(rows()).toHaveLength(3);
  });

  it('keeps a chosen column in view and records it beside the table', async () => {
    vi.useFakeTimers();
    await open();
    await headingMenu(1);
    inHeadingMenu('Keep it in view').click();
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

describe('a column that knows what it holds', () => {
  /** A sheet shaped like the binders: a status, a coordinate column half filled, a date
   *  written the European way, and a list of equipment with a quantity in it. */
  const BINDER = {
    ...SHEET,
    columns: ['id', 'Title', 'Status', 'Coordinates', 'Date', 'Equipments'],
    rows: [
      ['r1', 'Quai sud', 'done', '48.85660, 2.35220', '31/01/2026', 'Buk-M2E, 2x S-125'],
      ['r2', 'Pont nord', '', '', '01/02/2026', ''],
      ['r3', 'Gare est', 'OK en cours', '48.85, 2.35', 'AFTER', 'ZU23-2'],
    ],
    meta: {
      version: 2,
      widths: {},
      hidden: [],
      sort: null,
      colours: {},
      links: {},
      frozen: null,
      roles: {
        Status: { kind: 'state', values: ['to do', 'in progress', 'done'] },
        Coordinates: { kind: 'latlon' },
        Date: { kind: 'when', shape: 'date', dayFirst: true },
        Equipments: { kind: 'choice', multi: ', ' },
      },
      notes: {},
      progress: 'Coordinates',
    },
  };

  async function openBinder(overrides = {}) {
    const sheet = { ...structuredClone(BINDER), ...overrides };
    get.mockImplementation((path) =>
      path.includes('/sheets/') && !path.endsWith('/sheets')
        ? Promise.resolve(sheet)
        : route(path),
    );
    await open();
  }

  const chipsIn = (row, columnIndex) =>
    [...row.querySelectorAll('.cell:not(.gutter)')[columnIndex].querySelectorAll('.cell-chip')].map(
      (chip) => chip.textContent.replace(/\s+/g, ' ').trim(),
    );

  it('draws a set of values as one chip per value', async () => {
    await openBinder();
    // The cell's own words, each one a chip. Reading `2x S-125` as two of `S-125` was a
    // count kept in a column of values, and a count belongs in a number column.
    expect(chipsIn(rows()[0], 5)).toEqual(['Buk-M2E', '2x S-125']);
    // A state column is a set of values too, so it draws the same way.
    expect(chipsIn(rows()[0], 2)).toEqual(['done']);
  });

  it('marks a value outside the column own words without hiding it', async () => {
    // The binders write outside their vocabulary on every page. A lens that hid that
    // would hide the work.
    await openBinder();
    const chip = rows()[2].querySelector('.cell-chip');
    expect(chip.textContent.trim()).toBe('OK en cours');
    expect(chip.classList.contains('unknown')).toBe(true);
  });

  it('filters on a chip when it is clicked', async () => {
    await openBinder();
    rows()[0].querySelectorAll('.cell-chip')[0].click();
    await settle();
    expect(rows()).toHaveLength(1);
  });

  it('says when a point claims less than it looks like it claims', async () => {
    // `48.85, 2.35` is a kilometre, not a building, and it looks identical to an address
    // until the badge is there.
    await openBinder();
    expect(rows()[0].querySelector('.badge')).toBeNull();
    expect(rows()[2].querySelector('.badge').textContent.trim()).toBe('±1113m');
  });

  it('sorts a European date by the date, not by the characters', async () => {
    await openBinder();
    target.querySelectorAll('.heading-name')[4].click();
    await settle();
    expect(text(rows()[0])[4]).toBe('31/01/2026');
    // The cell the role cannot read goes last, not into the middle of January.
    expect(text(rows().at(-1))[4]).toBe('AFTER');
  });

  it('counts progress off the column the sheet says carries it', async () => {
    await openBinder();
    const foot = target.querySelector('.foot .progress').textContent.replace(/\s+/g, ' ');
    expect(foot).toContain('Coordinates');
    expect(foot).toContain('2 filled');
    expect(foot).toContain('1 left');
  });

  it('opens on every row, and the rows left are one click and never a surprise', async () => {
    // A filter was once posted on open, off the progress column's empty rows. It could not
    // tell "the analyst cleared their filters" from "this sheet has never been asked
    // anything" — both are an empty table in the sidecar — so it came back on every
    // reopen, which reads as a filter appearing from nowhere. The footer was already
    // offering exactly those rows, named and asked for.
    const sheet = structuredClone(BINDER);
    get.mockImplementation((path) =>
      path.includes('/sheets/') && !path.endsWith('/sheets')
        ? Promise.resolve(sheet)
        : route(path),
    );
    await open();

    expect(rows()).toHaveLength(3);
    expect(target.querySelector('.question .chip')).toBeNull();

    target.querySelector('.foot .progress-left').click();
    await settle();
    expect(rows()).toHaveLength(1);
    expect(text(rows()[0])[1]).toBe('Pont nord');
    const chip = target.querySelector('.question .chip');
    expect(chip.textContent.replace(/\s+/g, ' ')).toContain('Coordinates empty');
  });

  it('counts a state column by its buckets when that is the progress column', async () => {
    await openBinder({
      meta: { ...structuredClone(BINDER.meta), progress: 'Status' },
    });
    const foot = target.querySelector('.foot .progress').textContent.replace(/\s+/g, ' ');
    expect(foot).toContain('1 done');
    expect(foot).toContain('1 other'); // `OK en cours` is outside the vocabulary
    expect(foot).toContain('1 empty');
  });

  it('offers a progress column when the sheet names none, without applying it', async () => {
    // A declared status column is what it offers first; the emptiest column is the
    // fallback for the binder that has no status at all.
    await openBinder({ meta: { ...structuredClone(BINDER.meta), progress: null } });
    const offer = target.querySelector('.suggest-progress');
    expect(offer.textContent).toContain('Status');
    expect(rows()).toHaveLength(3); // nothing filtered until it is accepted

    offer.click();
    await settle();
    expect(target.querySelector('.foot .progress')).not.toBeNull();
  });

  it('refuses to open an editor on a column the app writes', async () => {
    await openBinder({
      meta: {
        ...structuredClone(BINDER.meta),
        roles: { ...BINDER.meta.roles, Title: { kind: 'computed', of: 'has_point' } },
      },
    });
    rows()[0]
      .querySelectorAll('.cell:not(.gutter)')[1]
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    expect(target.querySelector('.editor')).toBeNull();
  });

  it('says so when a role lost the column it named', async () => {
    // Renaming a column in a spreadsheet takes its role — and its map layer — with it.
    await openBinder({ dropped_roles: ['Coordinates'] });
    expect(target.querySelector('.notice').textContent).toContain('Coordinates');
  });

  it('hands a column of points to the map, and only the readable ones', async () => {
    await openBinder();
    await setupOf(3);
    button('Show on the map').click();
    await settle();

    expect(uiState.mapSheetPoints.points).toHaveLength(2);
    expect(uiState.mapSheetPoints.column).toBe('Coordinates');
    expect(uiState.mapSheetPoints.points[0]).toMatchObject({ lat: 48.8566, label: 'Quai sud' });
    expect(uiState.tool).toBe('satellite');
  });

  it('sends one cell to the map from the row being read, and offers nothing on a cell it cannot read', async () => {
    await openBinder();
    uiState.mapSheetPoints = null;
    const mapButton = (row) =>
      row.querySelectorAll('.cell:not(.gutter)')[3].querySelector('.cell-map');
    // Nothing to see: the cell is empty, so the grid offers no map to see it on.
    expect(mapButton(rows()[1])).toBeNull();

    mapButton(rows()[2]).click();
    await settle();

    expect(uiState.mapSheetPoints.points).toEqual([
      { lat: 48.85, lon: 2.35, label: 'Gare est', decimals: 2 },
    ]);
    expect(uiState.mapSheetPoints.column).toBe('Coordinates');
    expect(uiState.tool).toBe('satellite');
  });

  it('writes a number column unit beside the heading, where a spreadsheet writes it', async () => {
    // Set on the column and shown nowhere but the footer, a unit reads as not taken.
    await openBinder({
      columns: [...BINDER.columns, 'Range'],
      rows: BINDER.rows.map((row, index) => [...row, ['12', '', '40'][index]]),
      meta: {
        ...structuredClone(BINDER.meta),
        roles: {
          ...BINDER.meta.roles,
          Range: { kind: 'number', unit: 'km', summary: 'sum' },
        },
      },
    });
    const heading = [...target.querySelectorAll('.heading-name')][6];
    expect(heading.textContent.replace(/\s+/g, ' ').trim()).toBe('Range km');
    // Once, in the heading: the cells keep the digits the file holds, and nothing is
    // written after them until the column asks for it.
    expect(text(rows()[0])[6]).toBe('12');
    expect(rows()[0].querySelectorAll('.cell:not(.gutter)')[6].querySelector('.cell-unit'))
      .toBeNull();
    // And the footer names the reading it is giving: a total and an average are the
    // same digits from the strip.
    expect(
      target.querySelector('.foot .progress').textContent.replace(/\s+/g, ' ').trim(),
    ).toBe('Range total 52 km over 2');
  });

  it('writes the unit after every cell when the column asks, and never after a blank', async () => {
    await openBinder({
      columns: [...BINDER.columns, 'Share'],
      rows: BINDER.rows.map((row, index) => [...row, ['40', '', '60'][index]]),
      meta: {
        ...structuredClone(BINDER.meta),
        roles: {
          ...BINDER.meta.roles,
          Share: { kind: 'number', unit: '%', unitInCells: true, summary: 'mean' },
        },
      },
    });
    const unitIn = (index) =>
      rows()[index].querySelectorAll('.cell:not(.gutter)')[6].querySelector('.cell-unit');
    expect(unitIn(0).textContent).toBe('%');
    // A blank means unknown, and `%` on its own would be a reading of nothing.
    expect(unitIn(1)).toBeNull();
    // Beside the value, never inside it: what is copied out of the grid is the file.
    expect(text(rows()[0])[6]).toBe('40');
  });

  it('turns the unit on in the cells from the column panel, and records it beside the file', async () => {
    vi.useFakeTimers();
    await openBinder({
      columns: [...BINDER.columns, 'Share'],
      rows: BINDER.rows.map((row, index) => [...row, ['40', '', '60'][index]]),
      meta: {
        ...structuredClone(BINDER.meta),
        roles: { ...BINDER.meta.roles, Share: { kind: 'number', unit: '%', summary: 'mean' } },
      },
    });
    await setupOf(6);
    const check = [...target.querySelectorAll('.column-panel .check')].find((node) =>
      node.textContent.includes('after every cell'),
    );
    check.querySelector('input').click();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls.at(-1)[1].meta.roles.Share.unitInCells).toBe(true);
    expect(
      rows()[0].querySelectorAll('.cell:not(.gutter)')[6].querySelector('.cell-unit').textContent,
    ).toBe('%');
  });

  it('hands the window a column of dates covers to the Timeline', async () => {
    await openBinder();
    await setupOf(4);
    button('Open the Timeline on this period').click();
    await settle();

    expect(uiState.timelineRange.from).toBe('2026-01-31T00:00:00.000Z');
    expect(uiState.tool).toBe('timeline');
  });

  it('edits a vocabulary as rows: the order, the colour and what uses each value', async () => {
    // The textarea was smaller and it hid all three — the colour was typed as
    // `done #green`, which nothing on screen taught.
    vi.useFakeTimers();
    await openBinder();
    await setupOf(2);

    const entries = () => [...target.querySelectorAll('.column-panel .vocab .entry')];
    expect(entries().map((entry) => entry.querySelector('.word').value)).toEqual([
      'to do',
      'in progress',
      'done',
    ]);
    expect(entries().map((entry) => entry.querySelector('.held').textContent)).toEqual([
      '0',
      '0',
      '1',
    ]);
    // And the values nothing uses are said out loud rather than left to be counted.
    expect(target.querySelector('.column-panel .menu-note').textContent).toContain(
      'to do, in progress',
    );

    entries()[2].querySelector('[aria-label="Move done up"]').click();
    await settle();
    expect(entries().map((entry) => entry.querySelector('.word').value)).toEqual([
      'to do',
      'done',
      'in progress',
    ]);

    entries()[0].querySelector('.dot').click();
    await settle();
    target.querySelector('.column-panel .palette [aria-label="Paint to do red"]').click();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);

    const saved = put.mock.calls.at(-1)[1].meta.roles.Status;
    expect(saved.values).toEqual(['to do', 'done', 'in progress']);
    expect(saved.colours).toEqual({ 'to do': 'red' });
  });

  it('takes the words the cells use into the list, keeping the order already set', async () => {
    vi.useFakeTimers();
    await openBinder();
    await setupOf(2);

    const adopt = [...target.querySelectorAll('.column-panel .menu-row')].find((node) =>
      node.textContent.includes('the cells use'),
    );
    expect(adopt.textContent.replace(/\s+/g, ' ')).toContain('Add the 1 word');
    adopt.click();
    await settle();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls.at(-1)[1].meta.roles.Status.values).toEqual([
      'to do',
      'in progress',
      'done',
      'OK en cours',
    ]);
  });

  it('draws a yes/no column as boxes when it asks to be, and cycles three states', async () => {
    vi.useFakeTimers();
    const meta = structuredClone(BINDER.meta);
    meta.roles.Checked = { kind: 'boolean', values: ['YES', 'NO'], tick: true };
    await openBinder({
      columns: [...BINDER.columns, 'Checked'],
      rows: BINDER.rows.map((row, index) => [...row, ['YES', '', 'NO'][index]]),
      meta,
    });

    const boxOf = (row) => rows()[row].querySelector('.cell-tick');
    expect([0, 1, 2].map((row) => boxOf(row).dataset.state)).toEqual(['yes', 'blank', 'no']);
    // A box is read the way a box is read: only yes carries a mark, no is the empty
    // box, and blank is that box faded rather than a second glyph to learn.
    expect([0, 1, 2].map((row) => boxOf(row).querySelectorAll('svg').length)).toEqual([1, 0, 0]);

    // Blank is not no: the third state is what says nobody has been through that row.
    boxOf(1).click();
    flushSync();
    expect(boxOf(1).dataset.state).toBe('yes');
    boxOf(1).click();
    flushSync();
    boxOf(1).click();
    flushSync();
    expect(boxOf(1).dataset.state).toBe('blank');

    await vi.advanceTimersByTimeAsync(1000);
    // The file keeps the words either way: a tick is how the cell is drawn.
    expect(put.mock.calls.at(-1)[1].rows.map((row) => row[6])).toEqual(['YES', '', 'NO']);
  });

  it('keeps a box clicked while the save is in the air', async () => {
    // The save reply carries the sheet as the server cleaned it, and adopting it used to
    // be unconditional — so a box clicked during the round trip was flipped back under
    // the analyst's hand, and the revert was then written on the next pass.
    vi.useFakeTimers();
    const meta = structuredClone(BINDER.meta);
    meta.roles.Checked = { kind: 'boolean', values: ['YES', 'NO'], tick: true };
    await openBinder({
      columns: [...BINDER.columns, 'Checked'],
      rows: BINDER.rows.map((row) => [...row, '']),
      meta,
    });

    let land = null;
    put.mockImplementationOnce(
      (_path, body) =>
        new Promise((resolve) => {
          // The sheet as the server would hand it back: what was sent, at a new stamp.
          land = () =>
            resolve(JSON.parse(JSON.stringify({ ...body, status: 'saved', stamp: '2000-64' })));
        }),
    );

    const boxOf = (row) => rows()[row].querySelector('.cell-tick');
    boxOf(1).click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][1].rows[1][6]).toBe('YES');

    // Clicked again before the reply lands: the reply still says YES.
    boxOf(1).click();
    flushSync();
    expect(boxOf(1).dataset.state).toBe('no');
    land();
    await settle();

    expect(boxOf(1).dataset.state).toBe('no');
    expect(target.querySelector('.save-state')?.textContent.trim()).toBe('Unsaved');

    // And the second write carries NO, with the stamp the first one came back with.
    await vi.advanceTimersByTimeAsync(1000);
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[1][1].rows[1][6]).toBe('NO');
    expect(put.mock.calls[1][1].stamp).toBe('2000-64');
  });

  it('shows a word a tick column cannot read rather than swallowing it', async () => {
    const meta = structuredClone(BINDER.meta);
    meta.roles.Checked = { kind: 'boolean', values: ['YES', 'NO'], tick: true };
    await openBinder({
      columns: [...BINDER.columns, 'Checked'],
      rows: BINDER.rows.map((row, index) => [...row, index === 0 ? 'maybe' : '']),
      meta,
    });

    const cell = rows()[0].querySelectorAll('.cell:not(.gutter)')[6];
    expect(cell.querySelector('.cell-tick').dataset.state).toBe('other');
    expect(cell.querySelector('.value').textContent.trim()).toBe('maybe');
  });

  it('counts a list column value by value in the filter menu', async () => {
    await openBinder();
    const menu = await askOf(4);

    const offered = [...menu.querySelectorAll('.values .row-btn')].map((node) =>
      node.textContent.replace(/\s+/g, ' ').trim(),
    );
    // `Buk-M2E, 2x S-125` is two answers, counted one row each.
    expect(offered).toContain('Buk-M2E 1');
    expect(offered).toContain('2x S-125 1');
    expect(offered).toContain('ZU23-2 1');
  });

  it('narrows the offers to what is being typed, and Enter takes the one lit', async () => {
    vi.useFakeTimers();
    await openBinder();
    rows()[1]
      .querySelectorAll('.cell:not(.gutter)')[2]
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    flushSync();

    const box = target.querySelector('.editor');
    box.value = 'in';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(
      [...target.querySelectorAll('.offers .offer:not(.add)')].map((n) => n.textContent.trim()),
    ).toEqual(['in progress']);

    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(put.mock.calls[0][1].rows[1][2]).toBe('in progress');
  });

  it('offers to take a word the column has never heard of into its own list', async () => {
    // The column panel could always do this, and that is two screens away from the
    // moment it is wanted.
    vi.useFakeTimers();
    await openBinder();
    rows()[1]
      .querySelectorAll('.cell:not(.gutter)')[2]
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    flushSync();

    const box = target.querySelector('.editor');
    box.value = 'OK en cours';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    const adopt = target.querySelector('.offers .offer.add');
    expect(adopt.textContent).toContain('OK en cours');
    adopt.click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls[0][1].meta.roles.Status.values).toContain('OK en cours');
  });

  it('flips a yes/no cell on one click of its chip', async () => {
    // The tooltip said two words is a toggle while the only way to do it was a
    // double-click or Enter.
    vi.useFakeTimers();
    await openBinder({
      rows: [['r1', 'Quai sud', '', '', '', 'YES'], ['r2', 'Pont nord', '', '', '', 'NO']],
      meta: {
        ...structuredClone(BINDER.meta),
        roles: { Equipments: { kind: 'boolean', values: ['YES', 'NO'] } },
      },
    });
    rows()[0].querySelectorAll('.cell:not(.gutter)')[5].querySelector('.cell-chip').click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls[0][1].rows[0][5]).toBe('NO');
    expect(target.querySelector('.question .chip')).toBeNull(), 'a flip is not a filter';
  });

  it('says in the heading what each column is', async () => {
    await openBinder();
    const marks = [...target.querySelectorAll('.head .cell.heading')].map(
      (heading) => heading.querySelector('.role-mark')?.getAttribute('title') ?? '',
    );
    expect(marks).toEqual([
      '',
      '',
      'State: Status',
      'Point: Coordinates',
      'Date or time: Date',
      'Values: Equipments',
    ]);
  });

  it('marks a cell its column cannot read, and offers those cells as a filter', async () => {
    await openBinder({
      columns: ['id', 'Title', 'Rounds'],
      rows: [['r1', 'Quai sud', '12'], ['r2', 'Pont nord', 'unknown'], ['r3', 'Gare est', '8']],
      meta: {
        ...structuredClone(BINDER.meta),
        progress: null,
        roles: { Rounds: { kind: 'number', summary: 'sum', unit: '' } },
      },
    });
    expect(rows()[1].querySelectorAll('.cell:not(.gutter)')[2].querySelector('.badge.bad'))
      .not.toBeNull();

    const footer = target.querySelector('.foot .progress');
    expect(footer.textContent.replace(/\s+/g, ' ')).toContain('20 over 2');
    footer.querySelector('.progress-left').click();
    await settle();
    expect(rows()).toHaveLength(1);
    expect(text(rows()[0])[1]).toBe('Pont nord');
  });

  it('gives a number column the one answer it was told to give, in its own unit', async () => {
    await openBinder({
      columns: ['id', 'Title', 'Share'],
      rows: [['r1', 'Quai sud', '40'], ['r2', 'Pont nord', '60']],
      meta: {
        ...structuredClone(BINDER.meta),
        progress: null,
        roles: { Share: { kind: 'number', summary: 'mean', unit: '%' } },
      },
    });
    // Named, not just given: an average and a total are the same digits from the footer.
    expect(
      target.querySelector('.foot .progress').textContent.replace(/\s+/g, ' ').trim(),
    ).toBe('Share average 50 % over 2');
  });

  it('acts on the rows dragged across when none are ticked', async () => {
    // There were two selections and they disagreed: a screenful selected by dragging
    // offered no way to paint it, and forty ticked rows could not be copied.
    vi.useFakeTimers();
    await openBinder();
    const cellsOfRow = (index) => rows()[index].querySelectorAll('.cell:not(.gutter)');
    cellsOfRow(0)[1].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    cellsOfRow(2)[1].dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    flushSync();

    expect(target.querySelector('.selection .count').textContent).toContain(
      '3 selected',
    );
    target.querySelector('.swatches .swatch').click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(Object.keys(put.mock.calls[0][1].meta.colours)).toEqual(['r1', 'r2', 'r3']);
  });

  it('keeps a bulk fill off the columns the app writes', async () => {
    await openBinder({
      meta: {
        ...structuredClone(BINDER.meta),
        roles: { ...BINDER.meta.roles, Date: { kind: 'stamped' } },
      },
    });
    rows()[0].querySelector('.gutter input').click();
    await settle();
    button('Fill a column').click();
    await settle();

    const offered = [...target.querySelectorAll('.fill-columns .chip')].map((n) => n.textContent);
    expect(offered).not.toContain('Date');
    expect(offered).not.toContain('id');
    expect(offered).toContain('Title');
  });

  it('says when a row has been edited since the case took it', async () => {
    await openBinder({
      meta: {
        ...structuredClone(BINDER.meta),
        links: { r1: { Title: 'e_person' }, r2: { Title: 'e_other' } },
        promoted: { r1: { Title: 'Quai nord' }, r2: { Title: 'Pont nord' } },
      },
    });
    const mark = (index) => rows()[index].querySelectorAll('.cell:not(.gutter)')[1].querySelector('.link-mark');
    expect(mark(0).classList.contains('moved')).toBe(true);
    expect(mark(0).getAttribute('title')).toContain('Edited since');
    expect(mark(1).classList.contains('moved')).toBe(false);
  });

  it('rewrites a column of points in one form, in one undoable step', async () => {
    // The only action here that touches the file, and the only way the file itself gets
    // better: a role never rewrites a cell.
    vi.useFakeTimers();
    await openBinder();
    await setupOf(3);
    button('Rewrite as').click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls[0][1].rows.map((row) => row[3])).toEqual([
      '48.85660, 2.35220',
      '',
      '48.85000, 2.35000',
    ]);
  });

  /** The panel a row is read down, on the columns that were set up carefully. It used to
   *  put a bare box on every one of them, so the panel was a worse place to work than the
   *  row it was showing. */
  const panelField = (name) =>
    [...target.querySelectorAll('.panel .field')].find(
      (node) => node.querySelector('.label span')?.textContent === name,
    );

  it('offers the column own words in the row panel, and writes what is picked', async () => {
    vi.useFakeTimers();
    await openBinder();
    rows()[1].querySelector('.cell-open').click();
    flushSync();

    const words = [...panelField('Status').querySelectorAll('.word')];
    expect(words.map((node) => node.textContent.trim())).toEqual([
      'to do',
      'in progress',
      'done',
    ]);
    words[1].click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(put.mock.calls[0][1].rows[1][2]).toBe('in progress');
  });

  it('builds a list in the panel on a column that holds several values', async () => {
    vi.useFakeTimers();
    await openBinder({
      meta: {
        ...structuredClone(BINDER.meta),
        roles: {
          ...structuredClone(BINDER.meta.roles),
          Equipments: { kind: 'choice', multi: ', ', values: ['Buk-M2E', 'ZU23-2'] },
        },
      },
    });
    rows()[1].querySelector('.cell-open').click();
    flushSync();

    const words = [...panelField('Equipments').querySelectorAll('.word')];
    words[0].click();
    flushSync();
    words[1].click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(put.mock.calls[0][1].rows[1][5]).toBe('Buk-M2E, ZU23-2');
  });

  it('answers a yes/no field in the panel, and writes no box for a column the app fills', async () => {
    vi.useFakeTimers();
    await openBinder({
      columns: ['id', 'Title', 'Checked', 'Added on'],
      rows: [['r1', 'Quai sud', '', '']],
      meta: {
        ...structuredClone(BINDER.meta),
        roles: {
          Checked: { kind: 'boolean', values: ['yes', 'no'] },
          'Added on': { kind: 'stamped' },
        },
        progress: null,
      },
    });
    rows()[0].querySelector('.cell-open').click();
    flushSync();

    panelField('Checked').querySelector('.answer').click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(put.mock.calls[0][1].rows[0][2]).toBe('yes');
    // The app rewrites that column on every save, so the panel says so rather than
    // offering a box whose value is gone by the next one.
    expect(panelField('Added on').querySelector('textarea')).toBeNull();
    expect(panelField('Added on').querySelector('.written')).not.toBeNull();
  });

  it('shows what a column says twice, and paints those rows', async () => {
    await openBinder({
      rows: [
        ['r1', 'Quai sud', '', '', '', ''],
        ['r2', 'Quai sud', '', '', '', ''],
        ['r3', 'Gare est', '', '', '', ''],
      ],
    });
    await setupOf(1);
    button('Show duplicates').click();
    await settle();

    const reading = target.querySelector('.reading');
    expect(reading.textContent).toContain('Quai sud');
    reading.querySelector('.found .chip').click();
    await settle();
    expect(target.querySelector('.selection .count').textContent).toContain('2 ticked');
  });

  it('finds points too close to be two places', async () => {
    await openBinder({
      rows: [
        ['r1', 'A', '', '48.856600, 2.352200', '', ''],
        ['r2', 'B', '', '48.856610, 2.352210', '', ''],
        ['r3', 'C', '', '50.100000, 3.000000', '', ''],
      ],
    });
    await setupOf(3);
    button('Find points too close').click();
    await settle();
    expect(target.querySelector('.reading').textContent).toContain('1 pair');
  });

  it('undoes a role the server writes cells for, cells and all', async () => {
    // Declaring `On map` makes the server write YES/NO into the file. Undoing the role
    // has to take those back too, or the column keeps its answers after the role that
    // produced them is gone and the undo reads as having done nothing.
    vi.useFakeTimers();
    put.mockImplementation(async (_path, body) => ({
      status: 'saved',
      stamp: '2000-64',
      ...body,
      // What the server does on a computed column.
      rows: body.meta.roles?.Title
        ? body.rows.map((row) => [...row.slice(0, 1), 'YES', ...row.slice(2)])
        : body.rows,
    }));
    await openBinder({ meta: { ...structuredClone(BINDER.meta), roles: {} } });

    await setupOf(1);
    button('Answered by the app').click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(text(rows()[0])[1]).toBe('YES');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(text(rows()[0])[1]).toBe('Quai sud');
    expect(put.mock.calls.at(-1)[1].meta.roles.Title).toBeUndefined();
  });

  it('offers a calendar on a date column, spelled the way the column spells dates', async () => {
    // The picker hands over an ISO date whatever the locale; what lands in the cell is
    // this column's own form, or picking a date would restyle the file from a click.
    vi.useFakeTimers();
    await openBinder();
    rows()[0]
      .querySelectorAll('.cell:not(.gutter)')[4]
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    flushSync();

    const calendar = target.querySelector('.offers input[type="date"]');
    expect(calendar.value).toBe('2026-01-31');
    calendar.value = '2026-03-04';
    calendar.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    target.querySelector('.editor').dispatchEvent(new Event('blur', { bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls[0][1].rows[0][4]).toBe('04/03/2026');
  });

  it('offers a clock, not a calendar, on a column of bare times', async () => {
    // The role reads "a date or a time" because the binders write all three shapes. A
    // calendar here would offer to put a date where the analyst deliberately did not: the
    // binder's `Local time` holds `01:57` for an event whose date is in the sheet's title.
    vi.useFakeTimers();
    await openBinder({
      rows: [
        ['r1', 'Quai sud', '', '', '01:57', ''],
        ['r2', 'Pont nord', '', '', '02:10', ''],
      ],
      meta: {
        ...structuredClone(BINDER.meta),
        roles: { ...BINDER.meta.roles, Date: { kind: 'when', shape: 'time', dayFirst: true } },
      },
    });
    rows()[0]
      .querySelectorAll('.cell:not(.gutter)')[4]
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    flushSync();

    const picker = target.querySelector('.offers input');
    expect(picker.getAttribute('type')).toBe('time');
    expect(picker.value).toBe('01:57');
    picker.value = '03:20';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    target.querySelector('.editor').dispatchEvent(new Event('blur', { bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls[0][1].rows[0][4]).toBe('03:20');
  });

  it('offers a date and a time together on a column that holds both', async () => {
    vi.useFakeTimers();
    await openBinder({
      rows: [
        ['r1', 'Quai sud', '', '', '31/01/2026 06:42', ''],
        ['r2', 'Pont nord', '', '', '01/02/2026 07:15', ''],
      ],
      meta: {
        ...structuredClone(BINDER.meta),
        roles: { ...BINDER.meta.roles, Date: { kind: 'when', shape: 'datetime', dayFirst: true } },
      },
    });
    rows()[0]
      .querySelectorAll('.cell:not(.gutter)')[4]
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    flushSync();

    const picker = target.querySelector('.offers input');
    expect(picker.getAttribute('type')).toBe('datetime-local');
    expect(picker.value).toBe('2026-01-31T06:42');
    picker.value = '2026-03-04T09:05';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    target.querySelector('.editor').dispatchEvent(new Event('blur', { bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls[0][1].rows[0][4]).toBe('04/03/2026 09:05');
  });

  it('offers the vocabulary on a state column, and keeps the box free to type in', async () => {
    vi.useFakeTimers();
    await openBinder();
    rows()[1]
      .querySelectorAll('.cell:not(.gutter)')[2]
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    flushSync();

    const offers = [...target.querySelectorAll('.offers .offer')].map((node) =>
      node.textContent.trim(),
    );
    expect(offers).toEqual(['to do', 'in progress', 'done']);
    // The box is still there, because `OK en cours` has to remain typeable.
    expect(target.querySelector('.editor')).not.toBeNull();

    target.querySelectorAll('.offers .offer')[1].click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(put.mock.calls[0][1].rows[1][2]).toBe('in progress');
  });

  it('builds a multi-value cell one value at a time', async () => {
    vi.useFakeTimers();
    await openBinder({
      meta: {
        ...structuredClone(BINDER.meta),
        roles: {
          ...BINDER.meta.roles,
          Equipments: { kind: 'choice', multi: ', ', values: ['Buk-M2E', 'ZU23-2'] },
        },
      },
    });
    rows()[1]
      .querySelectorAll('.cell:not(.gutter)')[5]
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    flushSync();

    const offers = () => [...target.querySelectorAll('.offers .offer')];
    offers()[0].click();
    flushSync();
    offers()[1].click();
    flushSync();
    target.querySelector('.editor').dispatchEvent(new Event('blur', { bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls[0][1].rows[1][5]).toBe('Buk-M2E, ZU23-2');
  });

  it('flips a yes/no column on a click, without opening anything', async () => {
    // Two words is a toggle, not a menu, and making the analyst pick from a list of two is
    // a click too many on the column they will touch most.
    vi.useFakeTimers();
    await openBinder({
      rows: [['r1', 'Quai sud', '', '', '', 'YES'], ['r2', 'Pont nord', '', '', '', '']],
      meta: {
        ...structuredClone(BINDER.meta),
        roles: { Equipments: { kind: 'boolean', values: ['YES', 'NO'] } },
      },
    });
    const cell = rows()[0].querySelectorAll('.cell:not(.gutter)')[5];
    cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    flushSync();
    expect(target.querySelector('.editor')).toBeNull();
    await vi.advanceTimersByTimeAsync(1000);
    expect(put.mock.calls[0][1].rows[0][5]).toBe('NO');

    // And an empty cell answers with the first word.
    rows()[1]
      .querySelectorAll('.cell:not(.gutter)')[5]
      .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(put.mock.calls.at(-1)[1].rows[1][5]).toBe('YES');
  });

  it('totals a number column over the rows on screen, not the whole sheet', async () => {
    // Filtering to what is left and then being told the total of everything answers a
    // question nobody asked.
    await openBinder({
      rows: [
        ['r1', 'Quai sud', '', '', '', '3'],
        ['r2', 'Pont nord', '', '', '', '1 200'],
        ['r3', 'Gare est', '', '', '', 'Only 9 in service?'],
      ],
      meta: {
        ...structuredClone(BINDER.meta),
        roles: { Equipments: { kind: 'number' } },
      },
    });
    const foot = () => target.querySelector('.foot .progress').textContent.replace(/\s+/g, ' ');
    expect(foot()).toContain('1203');
    expect(foot()).toContain('over 2'); // the prose cell is not a number and is not counted

    await typeSearch('quai');
    expect(foot()).toContain('3');
    expect(foot()).toContain('over 1');
  });

  it('paints a chip in the colour its own vocabulary gives it', async () => {
    await openBinder({
      meta: {
        ...structuredClone(BINDER.meta),
        roles: {
          ...BINDER.meta.roles,
          Status: {
            kind: 'state',
            values: ['to do', 'in progress', 'done'],
            colours: { done: 'green' },
          },
        },
      },
    });
    const chip = rows()[0].querySelectorAll('.cell:not(.gutter)')[2].querySelector('.cell-chip');
    expect(chip.textContent.trim()).toBe('done');
    expect(chip.classList.contains('tinted')).toBe(true);
    expect(chip.classList.contains('c-green')).toBe(true);
  });

  it('keeps a line of instruction for whoever opens the sheet next', async () => {
    vi.useFakeTimers();
    await openBinder();
    await setupOf(2);
    const box = [...target.querySelectorAll('.column-panel .field input')].at(-1);
    box.value = 'where this row got to';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('blur', { bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls[0][1].meta.notes).toEqual({ Status: 'where this row got to' });
  });
});

describe('a whole sheet into the case, in one declaration', () => {
  /** A binder's line: a person, the unit they are in, the van they own, the page it rests
   *  on and the point it happened at. Which is the shape no older road could promote —
   *  each of them saw one column and an edge needs two. */
  const ROSTER = {
    ...SHEET,
    columns: ['id', 'Name', 'Unit', 'Van', 'Source', 'Coordinates'],
    rows: [
      ['r1', 'Ivanov', '3rd Brigade', 'AB-123', 'https://example.org/a', '48.85, 2.35'],
      ['r2', 'Petrov', '3rd Brigade', '', 'https://example.org/b', ''],
      ['r3', '', '', '', '', ''],
    ],
    meta: { ...structuredClone(SHEET.meta), roles: { Coordinates: { kind: 'latlon' } } },
  };

  const PLAN = {
    entities: [
      {
        mode: 'row',
        column: 'Name',
        counts: { make: 2, join: 0, update: 0, skip: 1, error: 0 },
        rows: [
          { key: 'r1', label: 'Ivanov', action: 'make', reason: '', entity: null,
            entity_label: '', attrs: {}, problems: [], candidates: [] },
          { key: 'r2', label: 'Petrov', action: 'make', reason: '', entity: null,
            entity_label: '', attrs: {}, problems: [],
            candidates: [{ id: 'e_other', label: 'Petrov' }] },
          { key: 'r3', label: '', action: 'skip', reason: "nothing in 'Name' to name it",
            entity: null, entity_label: '', attrs: {}, problems: [], candidates: [] },
        ],
      },
      {
        mode: 'value',
        column: 'Unit',
        counts: { make: 1, join: 0, update: 0, skip: 0, error: 0 },
        rows: [
          { key: '3rd Brigade', value: '3rd Brigade', action: 'make', reason: '',
            entity: null, entity_label: '', candidates: [] },
        ],
      },
    ],
    joins: [
      { from: 'Name', to: 'Unit', verb: 'member-of', label: 'is a member of',
        ratable: true, rows: 2, blocked: [] },
    ],
  };

  async function openRoster() {
    get.mockImplementation((path) =>
      path.includes('/sheets/') && !path.endsWith('/sheets')
        ? Promise.resolve(structuredClone(ROSTER))
        : route(path),
    );
    await open();
    target.querySelector('.head .gutter input').click();
    await settle();
    button('To the case').click();
    await settle();
    return document.querySelector('.to-case');
  }

  /** Answer one of the screen's selects, the way an analyst does. */
  async function choose(label, value) {
    const select = document.querySelector(`.to-case select[aria-label="${label}"]`);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    return select;
  }

  const press_ = (label) =>
    [...document.querySelectorAll('.to-case button')]
      .find((node) => node.textContent.trim().startsWith(label))
      .click();

  /** The declaration the screen sends: a subject, a column of words, and the join the
   *  vocabulary allows between them. */
  async function declare(plan = PLAN) {
    await openRoster();
    await choose('What Name is', 'row');
    await choose('What Name becomes', 'person');
    await choose('What Unit is', 'value');
    await choose('What Unit becomes', 'organization');
    await choose('How Name and Unit are joined', 'member-of:out');
    post.mockResolvedValueOnce(plan);
    press_('Preview');
    await settle();
    return document.querySelector('.to-case');
  }

  it('says what one pass would do before the case changes', async () => {
    const dialog = await declare();

    const [path, body] = post.mock.calls.at(-1);
    expect(path).toBe('/api/cases/case-a/sheets/e_sheet/promote/preview');
    expect(body.keys).toEqual(['r1', 'r2', 'r3']);
    expect(body.subject).toMatchObject({ column: 'Name', type: 'person' });
    expect(body.values).toEqual([
      { column: 'Unit', type: 'organization', attach: {}, skip: [] },
    ]);
    expect(body.joins).toEqual([{ from: 'Name', to: 'Unit', verb: 'member-of' }]);

    // Both layers, counted: the entities each column makes, and the edges between them.
    expect([...dialog.querySelectorAll('.plan-row .mark')].map((n) => n.textContent)).toEqual([
      'New',
      'New',
      'Left out',
      'New',
    ]);
    expect(dialog.querySelector('.plan-row.skip .why').textContent).toContain('nothing in');
    expect(dialog.querySelector('.join-plan').textContent).toContain('Name is a member of Unit');
    // The button says how much it will write, over both layers, so the press is not a leap.
    expect(dialog.textContent).toContain('Send 5');
  });

  it('offers to attach a row to the name the case already holds', async () => {
    const dialog = await declare();
    const picker = dialog.querySelector('.plan-row .tiny');
    expect([...picker.options].map((option) => option.textContent)).toEqual([
      'Create it',
      'Attach to Petrov',
    ]);

    post.mockResolvedValueOnce({
      ...PLAN,
      entities: [
        {
          ...PLAN.entities[0],
          counts: { make: 1, join: 1, update: 0, skip: 1, error: 0 },
          rows: PLAN.entities[0].rows.map((row) =>
            row.key === 'r2'
              ? { ...row, action: 'join', entity: 'e_other', entity_label: 'Petrov' }
              : row,
          ),
        },
        PLAN.entities[1],
      ],
    });
    picker.value = 'e_other';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    // Which is the whole of what the old *link these cells* screen did, minus the screen:
    // a name the case already holds is pointed at rather than filed a second time.
    expect(post.mock.calls.at(-1)[1].subject.attach).toEqual({ r2: 'e_other' });
    expect(dialog.querySelector('.plan-row.join')).not.toBeNull();
  });

  it('sends the ticked rows, saving the table it was given', async () => {
    await declare();
    post.mockResolvedValueOnce({
      status: 'promoted',
      entities: [
        { mode: 'row', column: 'Name', make: 2, join: 0, update: 0, skip: 1, error: 0 },
        { mode: 'value', column: 'Unit', make: 1, join: 0, update: 0, skip: 0, error: 0 },
      ],
      joins: [{ from: 'Name', to: 'Unit', verb: 'member-of', drawn: 2, failed: [] }],
      columns: ROSTER.columns,
      rows: ROSTER.rows,
      meta: { ...ROSTER.meta, links: { r1: { Name: 'e_new' } } },
      stamp: '3000-70',
    });
    press_('Send 5');
    await settle();

    const [path, body] = post.mock.calls.at(-1);
    expect(path).toBe('/api/cases/case-a/sheets/e_sheet/promote');
    expect(body.stamp).toBe('1000-64');
    expect(body.rows).toEqual(ROSTER.rows);
    expect(body.subject).toMatchObject({ column: 'Name', type: 'person' });
    // Counted apart, because "six sent" hides what the case actually gained — and the
    // edges are counted apart again, being the half no older road could draw.
    expect(toast).toHaveBeenCalledWith('3 added · 2 edges · 1 left out');
  });

  it('opens the sync points over the declaration, and Escape gives it back', async () => {
    // A binder's synchro sheet: the rows carry offsets against one shot that has no time
    // yet, which is the one thing between them and real hours.
    const SYNCHRO = {
      ...ROSTER,
      columns: ['id', 'Name', 'start synchro'],
      rows: [['r1', 'Video A', '-00:01:50']],
      meta: {
        ...structuredClone(SHEET.meta),
        roles: { 'start synchro': { kind: 'offset', anchor: 'IGLA launch' } },
        anchors: { 'IGLA launch': { at: '' } },
      },
    };
    get.mockImplementation((path) =>
      path.includes('/sheets/') && !path.endsWith('/sheets')
        ? Promise.resolve(structuredClone(SYNCHRO))
        : route(path),
    );
    await open();
    target.querySelector('.head .gutter input').click();
    await settle();
    button('To the case').click();
    await settle();
    await choose('What Name is', 'row');
    await choose('What start synchro is', 'statement');
    press_('From a sync point');
    await settle();

    press_('Date it');
    await settle();
    // Both are on screen: the declaration is what sent the analyst there, so closing it to
    // ask for one date would be asking them to make it twice.
    expect(document.querySelector('.anchors')).not.toBeNull();
    expect(document.querySelector('.to-case')).not.toBeNull();

    // And Escape answers the one on top, not both.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(document.querySelector('.anchors')).toBeNull();
    expect(document.querySelector('.to-case')).not.toBeNull();
  });

  it('turns a refusal into the same banner a stale save gets', async () => {
    await declare();
    post.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }));
    press_('Send 5');
    await settle();

    expect(target.querySelector('.notice.danger')).not.toBeNull();
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

  it('exports the rows on screen rather than the file on disk', async () => {
    // The case folder already holds the CSV. What the analyst does not have is this
    // reading of it: the rows the filter left, in the columns that are drawn.
    post.mockResolvedValue({ file: 'Candidates.csv', path: '/w/case/exports' });
    await open();
    await typeSearch('quai');

    button('Export').click();
    await settle();
    button('Save 1 rows on screen').click();
    await settle();

    const [path, body] = post.mock.calls.at(-1);
    expect(path).toBe('/api/cases/case-a/sheets/e_sheet/csv');
    expect(body.columns).toEqual(['id', 'Subject', 'Status']);
    expect(body.rows).toEqual([['r1', 'Quai sud', 'ruled out']]);
    // Where it landed, because a file nobody can find is a file exported twice.
    expect(toast.mock.calls.at(-1)[0]).toContain('1 of 3 rows');
    // Named the way the rest of the app names a destination, and carrying a way to get
    // there: a sentence about a folder is a folder the analyst then goes hunting for.
    expect(toast.mock.calls.at(-1)[0]).toContain('exports');
    expect(toast.mock.calls.at(-1)[3].label).toBe('Show');
  });

  it('leaves out a hidden column, because the export is what is on screen', async () => {
    post.mockResolvedValue({ file: 'Candidates.csv', path: '/w/case/exports' });
    await open();
    button('Columns').click();
    await settle();
    target.querySelectorAll('.column-row input')[1].click();
    await settle();

    button('Export').click();
    await settle();
    button('Save 3 rows on screen').click();
    await settle();

    expect(post.mock.calls.at(-1)[1].columns).toEqual(['id', 'Subject']);
  });
});

describe('the map of a sheet too wide to read at once', () => {
  it('says what each column is and what is being asked of it', async () => {
    await open();
    await askOf(1);
    button('Empty').click();
    await settle();

    button('Columns').click();
    await settle();
    const listed = [...target.querySelectorAll('.column-row')];
    expect(listed.map((row) => row.querySelector('.column-name').textContent)).toEqual([
      'Subject',
      'Status',
    ]);
    expect(listed[1].querySelector('.column-ask').classList.contains('on')).toBe(true);
    expect(listed[0].querySelector('.column-ask').classList.contains('on')).toBe(false);
  });

  it('opens the filter of a column from the list, bringing it back into view', async () => {
    await open();
    button('Columns').click();
    await settle();
    // Hidden, which is exactly the case the list exists for: there is no heading to
    // click, so asking something of it has to unhide it first.
    target.querySelectorAll('.column-row input')[1].click();
    await settle();
    expect([...target.querySelectorAll('.heading-name span')].map((n) => n.textContent)).toEqual([
      'id',
      'Subject',
    ]);

    target.querySelectorAll('.column-row .column-ask')[1].click();
    await settle();

    expect([...target.querySelectorAll('.heading-name span')].map((n) => n.textContent)).toContain(
      'Status',
    );
    expect(target.querySelector('.filter-menu').getAttribute('aria-label')).toBe('Filter Status');
  });
});

/**
 * The gestures a heading and a gutter owe an analyst.
 *
 * The complaint this answers was precise: the actions on a column were behind a `...`
 * nobody presses, half of what a column needs was not there at all, and a row could not
 * be inserted where the work is. So these press the real controls — a right-click, a
 * menu row, a double-click on a heading — rather than calling the functions under them.
 */
describe('what a heading and a gutter can do', () => {
  const headings = () => [...target.querySelectorAll('.heading-name span')].map((n) => n.textContent);
  const rightClick = (node) => {
    node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    flushSync();
  };

  it('opens the short menu on a right-click, which is what a spreadsheet does', async () => {
    await open();
    rightClick(target.querySelectorAll('.head .cell.heading')[1]);
    await settle();
    expect(document.querySelector('.heading-menu[role="menu"]')).not.toBeNull();
    expect(inHeadingMenu('Insert a column left')).toBeDefined();
  });

  it('inserts a column beside the one being worked on, on either side', async () => {
    await open();
    await headingMenu(1);
    inHeadingMenu('Insert a column right').click();
    await settle();
    // It lands in rename, so its heading is a box rather than a label until Escape.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(headings()).toEqual(['id', 'Subject', 'Column', 'Status']);

    await headingMenu(1);
    inHeadingMenu('Insert a column left').click();
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(headings()).toEqual(['id', 'Column 2', 'Subject', 'Column', 'Status']);
  });

  it('lands the cursor in the column it just inserted, renaming it', async () => {
    await open();
    await headingMenu(1);
    inHeadingMenu('Insert a column right').click();
    await settle();
    expect(target.querySelector('.heading-rename')).not.toBeNull();
  });

  it('duplicates a column with its cells and its lens', async () => {
    vi.useFakeTimers();
    await open();
    await headingMenu(2);
    inHeadingMenu('Duplicate this column').click();
    await settle();

    expect(headings()).toEqual(['id', 'Subject', 'Status', 'Status copy']);
    expect(text(rows()[0]).slice(1)).toEqual(['Quai sud', 'ruled out', 'ruled out']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(put.mock.calls.at(-1)[1].columns).toEqual(['id', 'Subject', 'Status', 'Status copy']);
    vi.useRealTimers();
  });

  it('renames a heading in place on a double-click', async () => {
    vi.useFakeTimers();
    await open();
    const heading = target.querySelectorAll('.heading-name')[1];
    heading.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    flushSync();

    const box = target.querySelector('.heading-rename');
    expect(box.value).toBe('Subject');
    box.value = 'Candidate';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    box.dispatchEvent(new Event('blur', { bubbles: true }));
    await settle();

    expect(headings()).toEqual(['id', 'Candidate', 'Status']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(put.mock.calls.at(-1)[1].columns).toContain('Candidate');
    vi.useRealTimers();
  });

  it('sorts from the menu in the direction the row names', async () => {
    await open();
    await headingMenu(1);
    inHeadingMenu('Sort Z → A').click();
    await settle();
    expect(text(rows()[0])[1]).toBe('Quai sud');

    await headingMenu(1);
    inHeadingMenu('Sort A → Z').click();
    await settle();
    expect(text(rows()[0])[1]).toBe('Gare est');
  });

  it('numbers the rows, because the key is a handle and not a position', async () => {
    await open();
    expect([...target.querySelectorAll('.row-number')].map((n) => n.textContent)).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('inserts a row where the analyst is reading, not four hundred rows below', async () => {
    await open();
    rightClick(rows()[0].querySelector('.cell.gutter'));
    await settle();
    [...document.querySelectorAll('.row-menu button')]
      .find((node) => node.textContent.includes('Insert a row below'))
      .click();
    await settle();

    expect(rows()).toHaveLength(4);
    expect(text(rows()[1]).slice(1)).toEqual(['', '']);
  });

  it('duplicates a row under itself, keyed anew and ticked', async () => {
    await open();
    rightClick(rows()[2].querySelector('.cell.gutter'));
    await settle();
    [...document.querySelectorAll('.row-menu button')]
      .find((node) => node.textContent.includes('Duplicate'))
      .click();
    await settle();

    expect(rows()).toHaveLength(4);
    expect(text(rows()[3]).slice(1)).toEqual(['Gare est', 'to check']);
    expect(target.querySelectorAll('.row.ticked')).toHaveLength(1);
  });

  it('asks before deleting the rows the gutter menu is about', async () => {
    await open();
    rightClick(rows()[0].querySelector('.cell.gutter'));
    await settle();
    [...document.querySelectorAll('.row-menu button')]
      .find((node) => node.textContent.includes('Delete'))
      .click();
    await settle();

    expect(document.querySelector('[role="alertdialog"]').textContent).toContain('Delete 1 row');
    inDialog('Delete').click();
    await settle();
    expect(rows()).toHaveLength(2);
  });
});

describe('the passes that fix an imported column', () => {
  const cleanRow = (label) =>
    [...document.querySelectorAll('.clean .pass')].find((node) =>
      node.textContent.trim().startsWith(label),
    );

  async function openClean(columnIndex, label = 'Find and replace') {
    await headingMenu(columnIndex);
    inHeadingMenu(label === 'Find and replace' ? 'Find and replace' : 'Split, merge or tidy').click();
    await settle();
    return document.querySelector('.clean');
  }

  it('says how many cells a replace would touch before it is pressed', async () => {
    await open();
    await openClean(2);
    const find = document.querySelector('.clean .field .input');
    find.value = 'ruled out';
    find.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(document.querySelector('.clean .says').textContent).toContain('1 cell would change');
  });

  it('replaces a word across the rows on screen, in one undoable step', async () => {
    vi.useFakeTimers();
    await open();
    await openClean(2);
    const [find, replace] = document.querySelectorAll('.clean .field .input');
    find.value = 'ruled out';
    find.dispatchEvent(new Event('input', { bubbles: true }));
    replace.value = 'dropped';
    replace.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    [...document.querySelectorAll('.clean button')]
      .find((node) => node.textContent.trim() === 'Replace')
      .click();
    await settle();

    expect(text(rows()[0])[2]).toBe('dropped');
    await vi.advanceTimersByTimeAsync(1000);
    expect(put.mock.calls.at(-1)[1].rows[0][2]).toBe('dropped');
    vi.useRealTimers();
  });

  it('splits a column into as many as its separator makes, keeping the original', async () => {
    await open();
    await openClean(1, 'Split');
    const separator = document.querySelector('.clean .narrow');
    separator.value = ' ';
    separator.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    [...document.querySelectorAll('.clean button')]
      .find((node) => node.textContent.trim() === 'Split')
      .click();
    await settle();

    expect([...target.querySelectorAll('.heading-name span')].map((n) => n.textContent)).toEqual([
      'id',
      'Subject',
      'Subject 1',
      'Subject 2',
      'Status',
    ]);
    expect(text(rows()[0]).slice(1)).toEqual(['Quai sud', 'Quai', 'sud', 'ruled out']);
  });
});

describe('the case, as rows to work through', () => {
  it('builds a worklist out of a type and opens it', async () => {
    post.mockImplementation(async (path) =>
      path.endsWith('/from-case')
        ? { id: 'e_built', label: 'Person to check', type: 'sheet', taken: 2, total: 2 }
        : {},
    );
    await open();
    // The ways of starting a sheet live under one button now: five of them in the header
    // was five sixths of a bar that also has to fit a title, the sheet list and an export.
    button('New').click();
    await settle();
    button('From the case').click();
    await settle();

    // The modal is portalled onto the body, so its buttons are not under `target`.
    const inModal = (label) =>
      [...document.querySelectorAll('.from-case button')].find((node) =>
        node.textContent.trim().startsWith(label),
      );
    inModal('Person').click();
    await settle();
    inModal('Build the sheet').click();
    await settle();

    const [path, body] = post.mock.calls.find(([route]) => route.endsWith('/from-case'));
    expect(path).toBe('/api/cases/case-a/sheets/from-case');
    expect(body.type).toBe('person');
    expect(body.title).toBe('Person to check');
  });
});

describe('what the grid draws for a column that says what it holds', () => {
  it('marks what the search found, in the cell rather than only in the count', async () => {
    await open();
    await typeSearch('quai');
    expect(rows()[0].querySelector('.value mark').textContent).toBe('Quai');
  });

  it('offers the @ where pointing a cell somewhere means something', async () => {
    // A status is not a thing the case holds an entity for, and an `@` on every cell read
    // as an offer to point one at a person.
    await open();
    const plain = rows()[0].querySelectorAll('.cell:not(.gutter)');
    expect(plain[1].querySelector('.cell-link')).not.toBeNull();
    expect(plain[2].querySelector('.cell-link')).not.toBeNull();
    unmount(live);

    get.mockImplementation((path) =>
      path.includes('/sheets/') && !path.endsWith('/sheets')
        ? Promise.resolve({
            ...structuredClone(SHEET),
            meta: { ...structuredClone(SHEET.meta), roles: { Status: { kind: 'state' } } },
          })
        : route(path),
    );
    await open();
    const withRole = rows()[0].querySelectorAll('.cell:not(.gutter)');
    expect(withRole[1].querySelector('.cell-link')).not.toBeNull();
    expect(withRole[2].querySelector('.cell-link')).toBeNull();
  });

  it('draws a picture column as its pictures', async () => {
    get.mockImplementation((path) =>
      path.includes('/sheets/') && !path.endsWith('/sheets')
        ? Promise.resolve({
            ...structuredClone(SHEET),
            columns: ['id', 'Subject', 'Shot'],
            rows: [['r1', 'Quai sud', 'https://example.org/a.jpg'], ['r2', 'Pont nord', 'later']],
            meta: { ...structuredClone(SHEET.meta), roles: { Shot: { kind: 'picture' } } },
          })
        : route(path),
    );
    await open();
    expect(rows()[0].querySelector('.cell-shot img').getAttribute('src')).toBe(
      'https://example.org/a.jpg',
    );
    // A cell that is not an address is shown as it is and marked, never refused.
    expect(rows()[1].querySelector('.cell-shot')).toBeNull();
    expect(rows()[1].querySelector('.badge.bad')).not.toBeNull();
  });
});

/**
 * The grid's own shape: the line it ends on, the row it keeps under the heading, how tall
 * a row is and what its colour means. None of these is in the file — losing all of them
 * costs presentation and never a finding — and every one of them is written down, because
 * a reading rebuilt every morning is a reading nobody keeps.
 */
describe('how the grid is drawn, and what it remembers of that', () => {
  const openWith = async (sheet) => {
    get.mockImplementation((path) =>
      path.includes('/sheets/') && !path.endsWith('/sheets')
        ? Promise.resolve({ ...structuredClone(SHEET), ...sheet })
        : route(path),
    );
    await open();
  };

  it('always ends on an empty line, which is not one of the rows', async () => {
    await open();
    expect(rows()).toHaveLength(3);
    expect(ghostRow()).not.toBeNull();
    // It counts for nothing: the denominator is the file's rows, not the offer.
    expect(target.querySelector('.count').textContent.replace(/\s+/g, ' ')).toContain('3 of 3');
  });

  it('makes that line a row when it is written in, with the editor already open', async () => {
    vi.useFakeTimers();
    await open();
    // The second column, because the first is the row's handle and nothing writes there.
    target.querySelectorAll('.ghost .ghost-cell')[1].click();
    flushSync();
    expect(rows()).toHaveLength(4);
    expect(target.querySelector('.editor')).not.toBeNull();

    await vi.advanceTimersByTimeAsync(1000);
    expect(put.mock.calls.at(-1)[1].rows).toHaveLength(4);
  });

  it('opens the editor on a column an edit can land in, never on the app own', async () => {
    // Clicking the handle's own ghost cell must not open a box whose value is overwritten.
    await open();
    addGhostRow();
    await settle();
    expect(target.querySelector('.editor')).not.toBeNull();
    expect(target.querySelector('.cell.cursor').dataset.column).toBe('1');
  });

  it('says so rather than losing a row the filter would hide the instant it exists', async () => {
    // A blank row answers most filters with nothing, so it was written to the file and
    // vanished from the screen in the same breath — which reads as the press doing nothing.
    await open();
    await typeSearch('gare');
    expect(rows()).toHaveLength(1);

    addGhostRow();
    await settle();
    expect(rows()).toHaveLength(1), 'the filter is the analyst own and is not cleared';
    expect(target.querySelector('.editor')).toBeNull();
    expect(toast.mock.calls.at(-1)[0]).toContain('hidden by the current filter');

    // And the offer beside it drops the question, chips and search together.
    toast.mock.calls.at(-1)[3].onClick();
    await settle();
    expect(rows()).toHaveLength(4);
    expect(target.querySelector('.search input').value).toBe('');
  });

  it('keeps one row under the heading, drawn a second time rather than moved', async () => {
    await openWith({ meta: { ...structuredClone(SHEET.meta), pinned: 'r2' } });
    const pinned = target.querySelector('.pinned .row');
    expect(pinned).not.toBeNull();
    expect(text(pinned)[1]).toBe('Pont nord');
    // The rows that scroll are everything else, so the reference is not counted twice.
    expect(rows().map((row) => text(row)[1])).toEqual(['Quai sud', 'Gare est']);
  });

  it('does not draw a reference the filter has taken away', async () => {
    // A row pinned and then filtered out is not on screen, and drawing it there anyway
    // would be the grid disagreeing with its own count.
    await openWith({ meta: { ...structuredClone(SHEET.meta), pinned: 'r2' } });
    await typeSearch('quai');
    expect(target.querySelector('.pinned')).toBeNull();
    expect(rows()).toHaveLength(1);
  });

  it('pins and unpins from the gutter, through the sidecar alone', async () => {
    vi.useFakeTimers();
    await open();
    rows()[0]
      .querySelector('.gutter')
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    flushSync();
    [...document.querySelectorAll('.row-menu button')]
      .find((node) => node.textContent.includes('Keep it in view'))
      .click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    expect(put.mock.calls.at(-1)[0]).toBe('/api/cases/case-a/sheets/e_sheet/meta');
    expect(put.mock.calls.at(-1)[1].meta.pinned).toBe('r1');
  });

  it('gives the rows room for a note, and writes down which of the two it is', async () => {
    vi.useFakeTimers();
    await open();
    expect(target.querySelector('.grid').classList.contains('tall')).toBe(false);
    button('Tall rows').click();
    flushSync();
    expect(target.querySelector('.grid').classList.contains('tall')).toBe(true);
    expect(button('Short rows')).toBeDefined();

    await vi.advanceTimersByTimeAsync(1000);
    expect(put.mock.calls.at(-1)[1].meta.tall).toBe(true);
  });

  it('names what a colour means, and only for the colours the sheet uses', async () => {
    vi.useFakeTimers();
    await openWith({
      meta: { ...structuredClone(SHEET.meta), colours: { r1: 'red' }, legend: { red: 'ruled out' } },
    });
    // Under the rows carrying it, rather than in one analyst's head on a case that gets
    // handed over.
    expect(target.querySelector('.foot .legend-chip').textContent.trim()).toBe('ruled out');
    expect(target.querySelectorAll('.foot .legend-chip')).toHaveLength(1);

    button('Colours').click();
    flushSync();
    const line = [...target.querySelectorAll('.legend-menu .line input')][0];
    line.value = 'checked twice';
    line.dispatchEvent(new Event('blur', { bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);
    expect(put.mock.calls.at(-1)[1].meta.legend.red).toBe('checked twice');
  });

  it('says nothing about colours when the sheet paints with none', async () => {
    await open();
    expect(button('Colours')).toBeUndefined();
    expect(target.querySelector('.foot .legend-chip')).toBeNull();
  });
});

describe('the question the sheet was left on', () => {
  it('opens on the filter and the search the sidecar held', async () => {
    get.mockImplementation((path) =>
      path.includes('/sheets/') && !path.endsWith('/sheets')
        ? Promise.resolve({
            ...structuredClone(SHEET),
            meta: { ...structuredClone(SHEET.meta), query: 'quai' },
          })
        : route(path),
    );
    await open();
    expect(target.querySelector('.search input').value).toBe('quai');
    expect(rows()).toHaveLength(1);
  });

  it('writes the search down, through the sidecar alone', async () => {
    // It is a view change, so it never rewrites the CSV — and never enters the undo stack,
    // because Ctrl+Z is for what was written, not for what was asked.
    vi.useFakeTimers();
    await open();
    const box = target.querySelector('.search input');
    box.value = 'gare';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    await vi.advanceTimersByTimeAsync(1500);

    expect(put.mock.calls.at(-1)[0]).toBe('/api/cases/case-a/sheets/e_sheet/meta');
    expect(put.mock.calls.at(-1)[1].meta.query).toBe('gare');
    expect(target.querySelector('[title^="Undo"]').disabled).toBe(true);
  });

  /** Keep only the value under the pointer, which is the fastest filter there is. */
  async function onlyThisValue(rowIndex, columnIndex) {
    rows()[rowIndex]
      .querySelectorAll('.cell:not(.gutter)')[columnIndex]
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await settle();
    [...document.querySelectorAll('.cell-menu button')]
      .find((node) => node.textContent.includes('Only'))
      .click();
    await settle();
  }

  it('takes every chip off at once, once there is more than one to take off', async () => {
    await open();
    await onlyThisValue(0, 1);
    // One chip is already one click to clear, so the offer would be noise.
    expect(button('Clear all')).toBeUndefined();

    await onlyThisValue(0, 2);
    expect(target.querySelectorAll('.question .chip')).toHaveLength(2);
    button('Clear all').click();
    await settle();
    expect(target.querySelectorAll('.question .chip')).toHaveLength(0);
    expect(rows()).toHaveLength(3);
  });
});

describe('reading what a file that moved on actually says', () => {
  it('says the file has changed when the window comes back, without refusing anything', async () => {
    // A stat is cheap enough to ask on every focus, and hearing it now beats hearing it at
    // the save — with the analyst's own edits on one side and somebody else's on the other.
    await open();
    get.mockImplementation((path) =>
      path.endsWith('/stamp') ? Promise.resolve({ stamp: '9000-64' }) : route(path),
    );
    window.dispatchEvent(new Event('focus'));
    await settle();

    const notice = target.querySelector('.notice');
    expect(notice.textContent).toContain('changed on disk');
    expect(notice.classList.contains('danger')).toBe(false);
    expect([...notice.querySelectorAll('button')].map((n) => n.textContent.trim())).toEqual([
      'See what changed',
      'Reload',
      'Overwrite',
      'Later',
    ]);
  });

  it('counts and samples the difference before either irreversible press', async () => {
    await open();
    get.mockImplementation((path) => {
      if (path.endsWith('/stamp')) return Promise.resolve({ stamp: '9000-64' });
      if (path.includes('/sheets/') && !path.endsWith('/sheets')) {
        return Promise.resolve({
          ...structuredClone(SHEET),
          stamp: '9000-64',
          rows: [
            ['r1', 'Quai sud', 'done'],
            ['r2', 'Pont nord', ''],
            ['r3', 'Gare est', 'to check'],
            ['r4', 'Bassin ouest', ''],
          ],
        });
      }
      return route(path);
    });
    window.dispatchEvent(new Event('focus'));
    await settle();
    button('See what changed').click();
    await settle();

    const notice = target.querySelector('.notice');
    expect(notice.textContent).toContain('1 row not in this grid');
    expect(notice.textContent).toContain('1 cell written differently');
    // The sample, which is what makes the count believable.
    const change = notice.querySelector('.diff-rows li');
    expect(change.textContent).toContain('Status');
    expect(change.querySelector('.was').textContent.trim()).toBe('ruled out');
    // Having read it, the choice is the same two presses and no third one.
    expect(button('See what changed')).toBeUndefined();
  });

  it('carries on when the file holds the same table, written again', async () => {
    // A spreadsheet that opened the file and saved it unchanged rewrote every byte of it,
    // which moves the stamp and changes nothing.
    await open();
    get.mockImplementation((path) =>
      path.endsWith('/stamp')
        ? Promise.resolve({ stamp: '9000-64' })
        : path.includes('/sheets/') && !path.endsWith('/sheets')
          ? Promise.resolve({ ...structuredClone(SHEET), stamp: '9000-64' })
          : route(path),
    );
    window.dispatchEvent(new Event('focus'));
    await settle();
    button('See what changed').click();
    await settle();

    expect(target.querySelector('.notice')).toBeNull();
    expect(toast.mock.calls.at(-1)[0]).toContain('same table');
  });
});

describe('one row into many, and many into one', () => {
  it('splits a cell of values into a row each, from the cell own menu', async () => {
    vi.useFakeTimers();
    get.mockImplementation((path) =>
      path.includes('/sheets/') && !path.endsWith('/sheets')
        ? Promise.resolve({
            ...structuredClone(SHEET),
            rows: [['r1', 'Buk-M2E, ZU23-2, S-300', 'to check']],
          })
        : route(path),
    );
    await open();
    rows()[0]
      .querySelectorAll('.cell:not(.gutter)')[1]
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    flushSync();
    [...document.querySelectorAll('.cell-menu button')]
      .find((node) => node.textContent.includes('Split into rows'))
      .click();
    flushSync();

    expect(rows().map((row) => text(row)[1])).toEqual(['Buk-M2E', 'ZU23-2', 'S-300']);
    // The rest of the row is copied down, so nothing is lost by splitting it.
    expect(rows().every((row) => text(row)[2] === 'to check')).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(put.mock.calls.at(-1)[1].rows).toHaveLength(3);
  });

  it('offers no split on a cell holding nothing', async () => {
    await open();
    rows()[1]
      .querySelectorAll('.cell:not(.gutter)')[2]
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await settle();
    expect(
      [...document.querySelectorAll('.cell-menu button')].some((node) =>
        node.textContent.includes('Split into rows'),
      ),
    ).toBe(false);
  });

  it('folds the ticked rows into the first of them, keeping its key', async () => {
    vi.useFakeTimers();
    get.mockImplementation((path) =>
      path.includes('/sheets/') && !path.endsWith('/sheets')
        ? Promise.resolve({
            ...structuredClone(SHEET),
            rows: [
              ['r1', 'Quai sud', ''],
              ['r2', 'Quai sud, harbour side', 'to check'],
            ],
          })
        : route(path),
    );
    await open();
    rows()[0].querySelector('.gutter input').click();
    rows()[1].querySelector('.gutter input').click();
    flushSync();
    rows()[0]
      .querySelector('.gutter')
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    flushSync();
    [...document.querySelectorAll('.row-menu button')]
      .find((node) => node.textContent.includes('Merge'))
      .click();
    flushSync();
    await vi.advanceTimersByTimeAsync(1000);

    // The fullest answer per column, and the surviving row keeps its key so its colour,
    // its links and its promotion record survive with it.
    expect(put.mock.calls.at(-1)[1].rows).toEqual([['r1', 'Quai sud, harbour side', 'to check']]);
  });
});

describe('the handoffs, on the rows that were chosen', () => {
  it('sends the ticked rows to the map rather than everything on screen', async () => {
    // An analyst who has just ticked eleven candidates out of four hundred wants those
    // eleven drawn, not the field.
    get.mockImplementation((path) =>
      path.includes('/sheets/') && !path.endsWith('/sheets')
        ? Promise.resolve({
            ...structuredClone(SHEET),
            columns: ['id', 'Subject', 'Coordinates'],
            rows: [
              ['r1', 'Quai sud', '48.85000, 2.35000'],
              ['r2', 'Pont nord', '48.86000, 2.36000'],
            ],
            meta: { ...structuredClone(SHEET.meta), roles: { Coordinates: { kind: 'latlon' } } },
          })
        : route(path),
    );
    await open();
    rows()[1].querySelector('.gutter input').click();
    await settle();
    button('Map').click();
    await settle();

    expect(uiState.tool).toBe('satellite');
    expect(uiState.mapSheetPoints.points).toHaveLength(1);
    expect(uiState.mapSheetPoints.points[0].label).toBe('Pont nord');
  });

  it('says so rather than sending nothing when no column holds points', async () => {
    await open();
    rows()[0].querySelector('.gutter input').click();
    await settle();
    button('Map').click();
    await settle();

    expect(uiState.tool).toBe('sheet');
    expect(toast.mock.calls.at(-1)[0]).toContain('No column');
  });
});

describe('a row moving up a floor', () => {
  /** A second sheet for it to land in, with one heading spelled the other way. */
  const WORKLIST = {
    id: 'e_worklist', title: 'Worklist', path: 'sheets/Worklist.csv',
    rows: 1, columns: 3, headings: ['id', 'Subject', 'status'],
  };

  async function openWithSecondSheet() {
    get.mockImplementation((path) =>
      path.endsWith('/sheets')
        ? Promise.resolve({
            sheets: [
              { id: SHEET.id, title: SHEET.title, path: SHEET.path, rows: 3, columns: 3,
                headings: SHEET.columns },
              WORKLIST,
            ],
          })
        : route(path),
    );
    await open();
    rows()[0].querySelector('.gutter input').click();
    await settle();
    button('Move').click();
    await settle();
  }

  /** The dialog is portalled onto the body, so its buttons are not under `target`. */
  const inDialog = (label) =>
    [...document.querySelectorAll('.move button')].find((node) =>
      node.textContent.trim().startsWith(label),
    );

  it('asks where and then which column, and sends what the screens said', async () => {
    post.mockImplementation(async () => ({
      moved: 1, landed: ['r1'], dropped: ['Status'],
      to: { id: WORKLIST.id, title: 'Worklist', rows: 2 },
      columns: SHEET.columns, rows: SHEET.rows.slice(1), meta: SHEET.meta, stamp: '3000-64',
    }));
    await openWithSecondSheet();

    // Nothing writes off the first screen: the drop is read before it happens.
    inDialog('Next').click();
    await settle();
    expect(post).not.toHaveBeenCalled();

    inDialog('Move 1 row').click();
    await settle();

    const [path, body] = post.mock.calls.at(-1);
    expect(path).toContain('/move');
    expect(body.keys).toEqual(['r1']);
    // `Status` at this end, `status` at the other: the name match alone called it a loss.
    expect(body.mapping).toEqual({ Subject: 'Subject', Status: 'status' });
  });

  it('offers to put it back, and puts the sheet back as it stood', async () => {
    post.mockImplementation(async () => ({
      moved: 1, landed: ['r9'], dropped: [],
      to: { id: WORKLIST.id, title: 'Worklist', rows: 2 },
      columns: SHEET.columns, rows: SHEET.rows.slice(1), meta: SHEET.meta, stamp: '3000-64',
    }));
    await openWithSecondSheet();
    inDialog('Next').click();
    await settle();
    inDialog('Move 1 row').click();
    await settle();

    expect(rows()).toHaveLength(2);
    const [message, kind, , action] = toast.mock.calls.at(-1);
    expect(message).toContain('1 moved to');
    expect(kind).toBe('ok');

    post.mockImplementation(async () => ({
      undone: 1, columns: SHEET.columns, rows: SHEET.rows, meta: SHEET.meta, stamp: '4000-64',
    }));
    await action.onClick();
    await settle();

    const [path, body] = post.mock.calls.at(-1);
    expect(path).toContain('/move/undo');
    // The table as it stood, not the move replayed backwards: a move drops the columns the
    // other sheet does not have, and a reverse one would hand the rows back with holes.
    expect(body.rows).toHaveLength(3);
    expect(body.keys).toEqual(['r9']);
    expect(body.stamp).toBe('3000-64');
    expect(rows()).toHaveLength(3);
  });
});

describe('a geolocation index into proofs', () => {
  /** The template's own schema: what to call it, what was filmed, what was published, and
   *  where it turns out to be. The one sheet that can feed a build. */
  const INDEX = {
    ...SHEET,
    columns: ['id', 'Title', 'Source media', 'Geolocation proof', 'Coordinates', 'Notes'],
    rows: [
      ['r1', 'Bridge strike', 'https://ex.org/clip', 'https://ex.org/pic', '48.85, 2.35', 'south'],
      ['r2', 'Depot', 'https://ex.org/two', '', '50.45, 30.52', ''],
    ],
    meta: {
      ...structuredClone(SHEET.meta),
      roles: {
        'Source media': { kind: 'url' },
        'Geolocation proof': { kind: 'url' },
        Coordinates: { kind: 'latlon' },
      },
    },
  };

  const PLAN = {
    rows: [
      { key: 'r1', action: 'make', title: 'Bridge strike', coords: '48.85, 2.35',
        writes: 'a proof, its two files and its point', reason: '' },
      { key: 'r2', action: 'make', title: 'Depot', coords: '50.45, 30.52',
        writes: 'the footage, posed on its point', reason: '' },
    ],
    counts: { make: 2, join: 0, update: 0, skip: 0, error: 0 },
    pov: false,
    verb: 'depicts',
  };

  async function openIndex(sheet = INDEX) {
    get.mockImplementation((path) =>
      path.includes('/sheets/') && !path.endsWith('/sheets')
        ? Promise.resolve(structuredClone(sheet))
        : route(path),
    );
    await open();
    target.querySelector('.head .gutter input').click();
    await settle();
  }

  async function openBuild(sheet = INDEX) {
    await openIndex(sheet);
    button('Build proofs').click();
    await settle();
    return document.querySelector('.build');
  }

  const press_ = (label) =>
    [...document.querySelectorAll('.build button')]
      .find((node) => node.textContent.trim().startsWith(label))
      .click();

  async function preview(plan = PLAN, sheet = INDEX) {
    const dialog = await openBuild(sheet);
    post.mockResolvedValueOnce(plan);
    press_('Preview');
    await settle();
    return dialog;
  }

  it('is offered only on a sheet that can feed it', async () => {
    // The offer *is* the answer: a button that has to say "this sheet cannot do that"
    // should not have been drawn.
    await openIndex();
    expect(button('Build proofs')).not.toBeUndefined();

    await openIndex({ ...INDEX, meta: structuredClone(SHEET.meta), rows: SHEET.rows,
                      columns: SHEET.columns });
    expect(button('Build proofs')).toBeUndefined();
  });

  it('proposes which column is which, and says what a build would write', async () => {
    const dialog = await preview();

    const [path, body] = post.mock.calls.at(-1);
    expect(path).toBe('/api/cases/case-a/sheets/e_sheet/proofs/preview');
    // Filled in from the sheet's own roles and names: nobody should have to say that a
    // column called *Geolocation proof* is the published picture.
    expect(body).toMatchObject({
      title: 'Title',
      source: 'Source media',
      proof: 'Geolocation proof',
      point: 'Coordinates',
      note: 'Notes',
      keys: ['r1', 'r2'],
      pov: false,
      skip_states: ['ruled out'],
    });
    expect([...dialog.querySelectorAll('.plan-row .mark')].map((n) => n.textContent)).toEqual([
      'Build',
      'Build',
    ]);
    expect(dialog.textContent).toContain('a proof, its two files and its point');
    expect(dialog.textContent).toContain('Build 2 rows');
  });

  it('runs it as a job, watches the rows go by, and writes the chips back', async () => {
    await preview();
    post.mockResolvedValueOnce({ job_id: 'j1' });
    get.mockImplementation((path) => {
      if (path === '/api/jobs/j1') {
        return Promise.resolve({
          status: 'done',
          result: {
            rows: [
              { key: 'r1', outcome: 'built', reason: '', made: { proof: 'e_p1' } },
              { key: 'r2', outcome: 'built', reason: '', made: { source: 'e_m2' } },
            ],
            counts: { built: 2, restated: 0, failed: 0 },
            links: { r1: { Title: 'e_p1' }, r2: { 'Source media': 'e_m2' } },
            stopped: false,
          },
        });
      }
      return path.includes('/sheets/') && !path.endsWith('/sheets')
        ? Promise.resolve(structuredClone(INDEX))
        : route(path);
    });

    press_('Build 2 rows');
    await settle();

    expect(post.mock.calls.at(-1)[0]).toBe('/api/cases/case-a/sheets/e_sheet/proofs');
    expect(toast).toHaveBeenCalledWith('2 built');

    // The plan on screen now describes what *was* true, so pressing again is not offered
    // until it has been read again: those rows are built, and the case says so.
    const dialog = document.querySelector('.build');
    const labels = [...dialog.querySelectorAll('.modal-row button')]
      .map((node) => node.textContent.trim());
    // `Done` is the way out, not a `Close` that reads as walking away from something.
    expect(labels).toEqual(['Preview again', 'Done']);

    // And the press reads as finished rather than as a plan somebody happens to be
    // looking at: the heading is past tense, the rows say what they turned out to be,
    // and the loose end this road leaves is named.
    expect(dialog.textContent).toContain('What it wrote');
    expect([...dialog.querySelectorAll('.plan-row .mark')].map((n) => n.textContent)).toEqual([
      'Built',
      'Built',
    ]);
    expect(dialog.querySelector('.progress.done').textContent).toContain('2 built');
    expect(dialog.textContent).toContain('Each row now points at what it produced');
    expect(dialog.textContent).toContain('export until it is opened in the composer');

    // The sidecar is the browser's to write: the job hands back which cell points at what,
    // and the sheet's own save is what records it.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await settle();
    const saved = put.mock.calls.at(-1)[1];
    expect(saved.meta.links).toEqual({ r1: { Title: 'e_p1' }, r2: { 'Source media': 'e_m2' } });
  });

  it('stops a press that is running, and keeps what it finished', async () => {
    await preview();
    post.mockResolvedValueOnce({ job_id: 'j2' });
    let answered = 0;
    get.mockImplementation((path) => {
      if (path === '/api/jobs/j2') {
        answered += 1;
        return answered === 1
          ? Promise.resolve({
              status: 'running',
              progress: { done: 1, total: 2, label: 'Depot' },
            })
          : Promise.resolve({
              status: 'done',
              result: {
                rows: [{ key: 'r1', outcome: 'built', reason: '', made: {} }],
                counts: { built: 1, restated: 0, failed: 0 },
                links: {},
                stopped: true,
              },
            });
      }
      return route(path);
    });

    press_('Build 2 rows');
    await settle();
    const dialog = document.querySelector('.build');
    expect(dialog.querySelector('.progress').textContent).toContain('1 of 2');
    // Counted in rows, and drawn: two minutes of downloads with only a word on screen is
    // a wait nobody can tell from a stall.
    const bar = dialog.querySelector('.progress .bar');
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.getAttribute('aria-valuemax')).toBe('2');
    expect(bar.querySelector('.fill').style.width).toBe('50%');
    // A binder's title is a sentence: unbounded beside the bar, one of them squeezed it to
    // nothing and set the dialog scrolling sideways. It yields, and carries itself on hover.
    expect(dialog.querySelector('.progress-meta').title).toBe('Depot');

    post.mockResolvedValueOnce({ stopped: true });
    press_('Stop');
    await settle();
    expect(post.mock.calls.at(-1)[0]).toBe('/api/jobs/j2/cancel');

    await new Promise((resolve) => setTimeout(resolve, 900));
    await settle();
    expect(toast).toHaveBeenCalledWith('1 built · stopped');
  });

  it('names a login wall beside the row, with what to do about it', async () => {
    // A hundred login prompts being impossible, the wall becomes a word beside the row —
    // and no checkbox, because a session named in Settings is used on its own by the time
    // a row still comes back walled. The word says which of the two things it is.
    const WALL = 'needs a login: name a browser in Settings → Downloads';
    await preview();
    post.mockResolvedValueOnce({ job_id: 'j3' });
    get.mockImplementation((path) =>
      path === '/api/jobs/j3'
        ? Promise.resolve({
            status: 'done',
            result: {
              rows: [{ key: 'r1', outcome: 'failed', reason: WALL, made: {} }],
              counts: { built: 0, restated: 0, failed: 1 },
              links: {},
              stopped: false,
            },
          })
        : route(path),
    );
    press_('Build 2 rows');
    await settle();

    const dialog = document.querySelector('.build');
    expect(dialog.querySelector('.plan-row .why').title).toBe(WALL);
    expect(dialog.textContent).not.toContain('checkbox');
    expect(post.mock.calls.at(-1)[1]).not.toHaveProperty('use_cookies');
  });

  it('goes on building when the screen is closed under it', async () => {
    // The downloads are already happening: closing is not a cancel, and what a row
    // produced still has to reach the sidecar. Only `Stop` stops it.
    await preview();
    post.mockResolvedValueOnce({ job_id: 'j5' });
    let answered = 0;
    get.mockImplementation((path) => {
      if (path === '/api/jobs/j5') {
        answered += 1;
        return answered === 1
          ? Promise.resolve({ status: 'running', progress: { done: 0, total: 2 } })
          : Promise.resolve({
              status: 'done',
              result: {
                rows: [{ key: 'r1', outcome: 'built', reason: '', made: {} }],
                counts: { built: 1, restated: 0, failed: 0 },
                links: { r1: { Title: 'e_p1' } },
                stopped: false,
              },
            });
      }
      return route(path);
    });

    press_('Build 2 rows');
    await settle();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(document.querySelector('.build')).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 900));
    await settle();
    expect(toast).toHaveBeenCalledWith('1 built');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await settle();
    expect(put.mock.calls.at(-1)[1].meta.links).toEqual({ r1: { Title: 'e_p1' } });
  });

  it('carries a long title and its reason in full, whatever the row shows', async () => {
    // A binder's title is a sentence. It used to take the whole line and leave four
    // characters for the reason — which on a failed row is the only part worth reading.
    const SAID = "'Unavailable video' could not be reached";
    await preview({
      ...PLAN,
      rows: [
        { ...PLAN.rows[0],
          title: 'A gunmen attacked the driver of a motorbike. Thanks to the intervention of the BAC' },
        PLAN.rows[1],
      ],
    });
    post.mockResolvedValueOnce({ job_id: 'j6' });
    get.mockImplementation((path) =>
      path === '/api/jobs/j6'
        ? Promise.resolve({
            status: 'done',
            result: {
              rows: [{ key: 'r1', outcome: 'failed', reason: SAID, made: {} }],
              counts: { built: 0, restated: 0, failed: 1 },
              links: {},
              stopped: false,
            },
          })
        : route(path),
    );
    press_('Build 2 rows');
    await settle();

    const row = document.querySelector('.build .plan-row');
    expect(row.querySelector('.who').title).toContain('Thanks to the intervention');
    expect(row.querySelector('.why').title).toBe(SAID);
    expect(row.querySelector('.why').textContent.trim()).toBe(SAID);
  });

  it('leaves out the rows the analyst puts aside', async () => {
    const dialog = await preview();
    const aside = [...dialog.querySelectorAll('.plan-row .undo')][1];
    aside.click();
    await settle();
    expect(dialog.textContent).toContain('Build 1 row');

    post.mockResolvedValueOnce({ job_id: 'j4' });
    get.mockImplementation((path) =>
      path === '/api/jobs/j4'
        ? Promise.resolve({
            status: 'done',
            result: { rows: [], counts: { built: 1, restated: 0, failed: 0 }, links: {},
                      stopped: false },
          })
        : route(path),
    );
    press_('Build 1 row');
    await settle();
    expect(post.mock.calls.at(-1)[1].skip).toEqual(['r2']);
  });
});
