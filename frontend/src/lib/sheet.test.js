import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WIDTH,
  GUTTER_WIDTH,
  ID_COLUMN,
  addColumn,
  addRow,
  applyEdits,
  columnValues,
  compareCells,
  dropChip,
  emptyMeta,
  fillEdits,
  filterChips,
  freeColumnName,
  isFilterActive,
  keyIndex,
  keysBetween,
  linkAt,
  linkLabel,
  matchesRow,
  moveColumn,
  nextSort,
  removeColumn,
  removeRows,
  renameColumn,
  rowKey,
  scrollFromThumb,
  scrollThumb,
  setCell,
  setCells,
  setColour,
  setFilterWithout,
  setFrozen,
  setLink,
  setWidth,
  shownKeys,
  stickyOffsets,
  toggleFilterFill,
  toggleFilterValue,
  toggleHidden,
  urlsIn,
  visibleColumns,
  visibleRows,
} from './sheet.js';

const table = () => ({
  columns: ['id', 'Subject', 'Status', 'Score'],
  rows: [
    ['r1', 'Quai sud', 'ruled out', '10'],
    ['r2', 'Pont nord', '', '9'],
    ['r3', 'Gare est', 'to check', '100'],
  ],
});

describe('the key column', () => {
  it('is found wherever it sits', () => {
    expect(keyIndex(['id', 'name'])).toBe(0);
    expect(keyIndex(['name', 'ID'])).toBe(1);
  });

  it('falls back to the first column rather than losing the row', () => {
    expect(keyIndex(['name', 'plate'])).toBe(0);
  });

  it('is what a row is addressed by', () => {
    expect(rowKey(['id', 'name'], ['r7', 'Quai sud'])).toBe('r7');
  });

  it('is drawn even when hidden is asked for', () => {
    const drawn = visibleColumns(table().columns, { hidden: [ID_COLUMN, 'Score'] });
    expect(drawn.map((column) => column.name)).toEqual(['id', 'Subject', 'Status']);
  });
});

describe('ordering', () => {
  it('compares numbers as numbers', () => {
    expect(compareCells('9', '10')).toBe(-1);
    expect(compareCells('10', '9')).toBe(1);
  });

  it('compares text the way it reads', () => {
    expect(compareCells('AB-2', 'AB-10')).toBe(-1);
  });

  it('sinks blank cells whichever way the arrow points', () => {
    const rows = table().rows;
    const up = visibleRows(table(), { sort: { column: 'Status', desc: false } });
    const down = visibleRows(table(), { sort: { column: 'Status', desc: true } });
    expect(rows[up.at(-1)][2]).toBe('');
    expect(rows[down.at(-1)][2]).toBe('');
  });

  it('keeps equal cells in the order the file has them', () => {
    const same = {
      columns: ['id', 'Status'],
      rows: [['r1', 'x'], ['r2', 'x'], ['r3', 'x']],
    };
    expect(visibleRows(same, { sort: { column: 'Status', desc: true } })).toEqual([0, 1, 2]);
  });

  it('cycles a heading through up, down and off', () => {
    expect(nextSort(null, 'Status')).toEqual({ column: 'Status', desc: false });
    expect(nextSort({ column: 'Status', desc: false }, 'Status')).toEqual({
      column: 'Status',
      desc: true,
    });
    expect(nextSort({ column: 'Status', desc: true }, 'Status')).toBeNull();
    expect(nextSort({ column: 'Status', desc: true }, 'Score')).toEqual({
      column: 'Score',
      desc: false,
    });
  });
});

describe('the question asked of a sheet', () => {
  it('needs every term to appear somewhere in the row', () => {
    expect(matchesRow(['r1', 'Quai sud', 'ruled out'], 'quai out')).toBe(true);
    expect(matchesRow(['r1', 'Quai sud', 'ruled out'], 'quai nord')).toBe(false);
  });

  it('matches everything when nothing is typed', () => {
    expect(matchesRow(['r1', 'x'], '  ')).toBe(true);
  });

  it('narrows to the chosen values of a column', () => {
    const shown = visibleRows(table(), { filters: { Status: new Set(['to check']) } });
    expect(shown).toEqual([2]);
  });

  it('combines the box and the chips', () => {
    const shown = visibleRows(table(), {
      query: 'gare',
      filters: { Status: new Set(['to check']) },
    });
    expect(shown).toEqual([2]);
    expect(visibleRows(table(), { query: 'quai', filters: { Status: new Set(['to check']) } }))
      .toEqual([]);
  });

  it('counts a column values, commonest first', () => {
    const counted = columnValues(
      { columns: ['id', 'Status'], rows: [['r1', 'a'], ['r2', 'b'], ['r3', 'a']] },
      'Status',
    );
    expect(counted).toEqual([
      { value: 'a', count: 2 },
      { value: 'b', count: 1 },
    ]);
  });

  it('offers no values for a column that holds too many', () => {
    const rows = Array.from({ length: 60 }, (_, index) => [`r${index}`, `value ${index}`]);
    expect(columnValues({ columns: ['id', 'Free'], rows }, 'Free')).toBeNull();
  });
});

describe('edits', () => {
  it('never mutate the table they were handed', () => {
    const before = table();
    setCell(before, 0, 1, 'changed');
    expect(before.rows[0][1]).toBe('Quai sud');
  });

  it('append a row already carrying a key', () => {
    const next = addRow(table());
    expect(next.rows).toHaveLength(4);
    expect(rowKey(next.columns, next.rows[3])).toMatch(/^r[0-9a-f]{10}$/);
  });

  it('drop the rows asked for and leave the rest', () => {
    const next = removeRows(table(), [0, 2]);
    expect(next.rows.map((row) => row[0])).toEqual(['r2']);
  });

  it('never create two columns with one name', () => {
    expect(freeColumnName(['Status'], 'Status')).toBe('Status 2');
    expect(addColumn(table(), 'Status').columns.at(-1)).toBe('Status 2');
    expect(addColumn(table(), 'Status').rows[0]).toHaveLength(5);
  });
});

describe('renaming a column', () => {
  it('carries its width, its sort and its links onto the new name', () => {
    const meta = {
      ...emptyMeta(),
      widths: { Status: 200 },
      hidden: ['Status'],
      sort: { column: 'Status', desc: true },
      links: { r1: { Status: 'e_1', Subject: 'e_2' } },
    };
    const { table: next, meta: moved } = renameColumn(table(), meta, 2, 'Verdict');

    expect(next.columns).toEqual(['id', 'Subject', 'Verdict', 'Score']);
    expect(moved.widths).toEqual({ Verdict: 200 });
    expect(moved.hidden).toEqual(['Verdict']);
    expect(moved.sort).toEqual({ column: 'Verdict', desc: true });
    expect(moved.links.r1).toEqual({ Subject: 'e_2', Verdict: 'e_1' });
  });

  it('refuses to collide with another column and keeps the old name', () => {
    const { table: next } = renameColumn(table(), emptyMeta(), 2, 'Subject');
    expect(next.columns[2]).toBe('Subject 2');
  });

  it('keeps the old name when the new one is blank', () => {
    const { table: next } = renameColumn(table(), emptyMeta(), 2, '   ');
    expect(next.columns[2]).toBe('Status');
  });
});

describe('removing a column', () => {
  it('takes the cells and everything the sidecar hung on it', () => {
    const meta = {
      ...emptyMeta(),
      widths: { Status: 200, Score: 90 },
      sort: { column: 'Status', desc: false },
      links: { r1: { Status: 'e_1' } },
    };
    const { table: next, meta: pruned } = removeColumn(table(), meta, 2);

    expect(next.columns).toEqual(['id', 'Subject', 'Score']);
    expect(next.rows[0]).toEqual(['r1', 'Quai sud', '10']);
    expect(pruned.widths).toEqual({ Score: 90 });
    expect(pruned.sort).toBeNull();
    expect(pruned.links).toEqual({});
  });
});

describe('asking a column something other than a value', () => {
  // The three questions a worklist gets asked. `To be found`, `-`, `?` and an empty
  // cell all mean "not done" to the person filtering, and no list of chosen values
  // catches them.
  const worklist = () => ({
    columns: ['id', 'Coordinates', 'Note'],
    rows: [
      ['r1', '48.85, 2.29', 'confirmed by the author'],
      ['r2', '', 'to be found'],
      ['r3', '   ', 'no idea'],
      ['r4', '50.10, 3.00', 'AI video, do not use'],
    ],
  });

  it('finds the rows with nothing in a column yet', () => {
    const filters = toggleFilterFill({}, 'Coordinates', 'blank');
    expect(visibleRows(worklist(), { filters })).toEqual([1, 2]);
  });

  it('counts whitespace as nothing, the way the analyst reads it', () => {
    const filters = toggleFilterFill({}, 'Coordinates', 'filled');
    expect(visibleRows(worklist(), { filters })).toEqual([0, 3]);
  });

  it('excludes on a term without excluding the blanks', () => {
    const filters = setFilterWithout({}, 'Note', 'AI video');
    expect(visibleRows(worklist(), { filters })).toEqual([0, 1, 2]);
  });

  it('reads a term case-insensitively, like the search box', () => {
    expect(visibleRows(worklist(), { filters: setFilterWithout({}, 'Note', 'ai VIDEO') })).toEqual([
      0, 1, 2,
    ]);
  });

  it('ands the clauses of one column together', () => {
    let filters = toggleFilterFill({}, 'Note', 'filled');
    filters = setFilterWithout(filters, 'Note', 'idea');
    expect(visibleRows(worklist(), { filters })).toEqual([0, 1, 3]);
  });

  it('still takes a bare set of values, which is the common case', () => {
    const shown = visibleRows(worklist(), { filters: { Note: new Set(['no idea']) } });
    expect(shown).toEqual([2]);
  });

  it('asking the same thing twice stops asking it', () => {
    const once = toggleFilterFill({}, 'Coordinates', 'blank');
    expect(isFilterActive(once.Coordinates)).toBe(true);
    expect(toggleFilterFill(once, 'Coordinates', 'blank').Coordinates).toBeUndefined();
  });

  it('drops the column once nothing is left to ask of it', () => {
    const filters = toggleFilterValue({}, 'Note', 'no idea');
    expect(toggleFilterValue(filters, 'Note', 'no idea')).toEqual({});
  });

  it('shows one chip per clause, each removable on its own', () => {
    let filters = toggleFilterValue({}, 'Note', 'no idea');
    filters = toggleFilterFill(filters, 'Coordinates', 'blank');
    filters = setFilterWithout(filters, 'Note', 'AI');

    const chips = filterChips(filters);
    expect(chips.map((chip) => chip.label)).toEqual(['no idea', 'without AI', 'empty']);

    const left = dropChip(filters, chips.find((chip) => chip.part === 'without'));
    expect(filterChips(left).map((chip) => chip.label)).toEqual(['no idea', 'empty']);
  });

  it('names the blank value in a chip rather than showing nothing', () => {
    const chips = filterChips(toggleFilterValue({}, 'Note', ''));
    expect(chips[0].label).toBe('(blank)');
  });
});

describe('writing many cells at once', () => {
  it('fills a column for the rows asked for and leaves the rest', () => {
    const edits = fillEdits(table(), 2, [0, 2], 'done');
    const next = setCells(
      table(),
      edits.map((edit) => ({ ...edit, value: edit.after })),
    );
    expect(next.rows.map((row) => row[2])).toEqual(['done', '', 'done']);
  });

  it('records what each cell held, so the fill can be walked back', () => {
    const edits = fillEdits(table(), 2, [0, 1], 'done');
    expect(edits).toEqual([
      { row: 0, column: 2, before: 'ruled out', after: 'done' },
      { row: 1, column: 2, before: '', after: 'done' },
    ]);
  });

  it('leaves out the cells that already said it', () => {
    expect(fillEdits(table(), 2, [0], 'ruled out')).toEqual([]);
  });

  it('refuses to fill the key column, whatever is asked', () => {
    expect(fillEdits(table(), 0, [0, 1], 'same')).toEqual([]);
  });

  it('walks a step backward and forward again', () => {
    const start = table();
    const edits = fillEdits(start, 2, [0, 1], 'done');
    const done = applyEdits(start, edits, 'forward');
    expect(done.rows.map((row) => row[2])).toEqual(['done', 'done', 'to check']);

    const back = applyEdits(done, edits, 'backward');
    expect(back.rows.map((row) => row[2])).toEqual(['ruled out', '', 'to check']);
  });

  it('never mutates the table it was handed', () => {
    const before = table();
    setCells(before, [{ row: 0, column: 1, value: 'changed' }]);
    expect(before.rows[0][1]).toBe('Quai sud');
  });

  it('ignores a write outside the table', () => {
    const next = setCells(table(), [{ row: 99, column: 1, value: 'x' }, { row: 0, column: 99, value: 'x' }]);
    expect(next.rows).toEqual(table().rows);
  });
});

describe('moving a column', () => {
  it('takes its cells with it', () => {
    const next = moveColumn(table(), 3, 1);
    expect(next.columns).toEqual(['id', 'Score', 'Subject', 'Status']);
    expect(next.rows[0]).toEqual(['r1', '10', 'Quai sud', 'ruled out']);
  });

  it('moves the other way just as well', () => {
    const next = moveColumn(table(), 1, 3);
    expect(next.columns).toEqual(['id', 'Status', 'Score', 'Subject']);
    expect(next.rows[2]).toEqual(['r3', 'to check', '100', 'Gare est']);
  });

  it('leaves the table alone when the move is not one', () => {
    expect(moveColumn(table(), 1, 1)).toEqual(table());
    expect(moveColumn(table(), 9, 0)).toEqual(table());
    expect(moveColumn(table(), 0, -1)).toEqual(table());
  });

  it('is recorded in the file, not in the sidecar', () => {
    // A column order is something the collaborator opening the CSV sees, so it
    // belongs in the file. Nothing in the sidecar is keyed on position.
    const next = moveColumn(table(), 3, 1);
    expect(Object.keys(emptyMeta())).not.toContain('order');
    expect(next.columns.indexOf('Score')).toBe(1);
  });
});

describe('the columns that stay put', () => {
  it('sticks the key column past the gutter', () => {
    const drawn = visibleColumns(table().columns, emptyMeta());
    expect(stickyOffsets(drawn, emptyMeta())).toEqual({ id: GUTTER_WIDTH });
  });

  it('sticks one chosen column beside it, at the key column width', () => {
    const meta = setFrozen(emptyMeta(), 'Subject');
    const drawn = visibleColumns(table().columns, meta);
    expect(stickyOffsets(drawn, meta)).toEqual({
      id: GUTTER_WIDTH,
      Subject: GUTTER_WIDTH + DEFAULT_WIDTH,
    });
  });

  it('accumulates the real widths rather than assuming the default', () => {
    const meta = { ...setFrozen(emptyMeta(), 'Subject'), widths: { id: 80 } };
    const drawn = visibleColumns(table().columns, meta);
    expect(stickyOffsets(drawn, meta).Subject).toBe(GUTTER_WIDTH + 80);
  });

  it('follows the drawn order, so a moved column cannot overlap what it now follows', () => {
    const moved = moveColumn(table(), 1, 0); // Subject before id
    const meta = setFrozen(emptyMeta(), 'Subject');
    const drawn = visibleColumns(moved.columns, meta);
    expect(stickyOffsets(drawn, meta)).toEqual({
      Subject: GUTTER_WIDTH,
      id: GUTTER_WIDTH + DEFAULT_WIDTH,
    });
  });

  it('refuses to freeze the key column, which already stays put', () => {
    expect(setFrozen(emptyMeta(), 'id').frozen).toBeNull();
  });

  it('unfreezes on being asked again', () => {
    const frozen = setFrozen(emptyMeta(), 'Subject');
    expect(setFrozen(frozen, 'Subject').frozen).toBeNull();
  });

  it('carries the freeze onto a renamed column and loses it with a deleted one', () => {
    const meta = setFrozen(emptyMeta(), 'Status');
    expect(renameColumn(table(), meta, 2, 'Verdict').meta.frozen).toBe('Verdict');
    expect(removeColumn(table(), meta, 2).meta.frozen).toBeNull();
  });

  it('drops a column hidden out of sight from the sticky set', () => {
    const meta = { ...setFrozen(emptyMeta(), 'Subject'), hidden: ['Subject'] };
    const drawn = visibleColumns(table().columns, meta);
    expect(stickyOffsets(drawn, meta)).toEqual({ id: GUTTER_WIDTH });
  });
});

describe('ticking a range of rows', () => {
  it('gives the keys on screen in the order they are drawn', () => {
    const sorted = visibleRows(table(), { sort: { column: 'Score', desc: false } });
    expect(shownKeys(table(), sorted)).toEqual(['r2', 'r1', 'r3']);
  });

  it('takes everything between two rows, in display order', () => {
    const sorted = visibleRows(table(), { sort: { column: 'Score', desc: false } });
    expect(keysBetween(table(), sorted, 'r2', 'r3')).toEqual(['r2', 'r1', 'r3']);
  });

  it('reads the same whichever end was clicked first', () => {
    const shown = visibleRows(table(), {});
    expect(keysBetween(table(), shown, 'r3', 'r1')).toEqual(['r1', 'r2', 'r3']);
  });

  it('falls back to the row clicked when the other end is no longer shown', () => {
    const shown = visibleRows(table(), { query: 'gare' });
    expect(keysBetween(table(), shown, 'r1', 'r3')).toEqual(['r3']);
  });
});

describe('links in a cell', () => {
  it('finds every link, not just the first', () => {
    expect(urlsIn('source https://a.example/x and archive https://b.example/y')).toEqual([
      'https://a.example/x',
      'https://b.example/y',
    ]);
  });

  it('leaves the punctuation that ended the sentence behind', () => {
    expect(urlsIn('see https://a.example/x.')).toEqual(['https://a.example/x']);
  });

  it('finds nothing in a cell that holds no link', () => {
    expect(urlsIn('AB-123')).toEqual([]);
    expect(urlsIn(null)).toEqual([]);
  });

  it('shows a link as its host, because the query string says nothing in a grid', () => {
    expect(linkLabel('https://www.example.com/')).toBe('example.com');
    expect(linkLabel('https://t.me/channel/1234?single')).toBe('t.me/…');
    expect(linkLabel('not a url')).toBe('not a url');
  });
});

describe('the scrollbars the grid draws itself', () => {
  it('draws nothing when everything fits', () => {
    expect(scrollThumb(500, 500, 0)).toBeNull();
    expect(scrollThumb(500, 200, 0)).toBeNull();
    expect(scrollThumb(0, 900, 0)).toBeNull();
  });

  it('sizes the thumb by how much of the table is on screen', () => {
    const thumb = scrollThumb(400, 800, 0);
    expect(thumb.size).toBe(200);
    expect(thumb.position).toBe(0);
  });

  it('puts the thumb at the end when the table is scrolled to the end', () => {
    const thumb = scrollThumb(400, 800, 400);
    expect(thumb.position).toBe(thumb.travel);
  });

  it('keeps the thumb grabbable on a very long sheet', () => {
    const thumb = scrollThumb(400, 600_000, 0);
    expect(thumb.size).toBe(30);
    // Travel is the track less the thumb, not the track: using the track here is
    // what makes a minimum-size thumb run off the end of its own bar.
    expect(thumb.travel).toBe(370);
  });

  it('never reports a position outside the bar for an out-of-range offset', () => {
    expect(scrollThumb(400, 800, -50).position).toBe(0);
    expect(scrollThumb(400, 800, 9999).position).toBe(scrollThumb(400, 800, 400).travel);
  });

  it('turns a dragged thumb back into a scroll offset', () => {
    const thumb = scrollThumb(400, 800, 0);
    expect(scrollFromThumb(thumb, 0)).toBe(0);
    expect(scrollFromThumb(thumb, thumb.travel)).toBe(400);
    expect(scrollFromThumb(thumb, thumb.travel / 2)).toBe(200);
  });

  it('clamps a drag that runs past either end', () => {
    const thumb = scrollThumb(400, 800, 0);
    expect(scrollFromThumb(thumb, -200)).toBe(0);
    expect(scrollFromThumb(thumb, 9999)).toBe(400);
    expect(scrollFromThumb(null, 40)).toBe(0);
  });
});

describe('the sidecar', () => {
  it('paints and unpaints a row', () => {
    const painted = setColour(emptyMeta(), 'r1', 'red');
    expect(painted.colours).toEqual({ r1: 'red' });
    expect(setColour(painted, 'r1', null).colours).toEqual({});
  });

  it('ignores a colour outside the palette', () => {
    expect(setColour(emptyMeta(), 'r1', 'chartreuse').colours).toEqual({});
  });

  it('points a cell at an entity and clears it again', () => {
    const linked = setLink(emptyMeta(), 'r1', 'Subject', 'e_7');
    expect(linkAt(linked, 'r1', 'Subject')).toBe('e_7');
    expect(setLink(linked, 'r1', 'Subject', null).links).toEqual({});
  });

  it('keeps a row other links when one of them goes', () => {
    let meta = setLink(emptyMeta(), 'r1', 'Subject', 'e_7');
    meta = setLink(meta, 'r1', 'Status', 'e_8');
    expect(setLink(meta, 'r1', 'Subject', null).links).toEqual({ r1: { Status: 'e_8' } });
  });

  it('bounds a column width to something a grid can draw', () => {
    expect(setWidth(emptyMeta(), 'Subject', 5).widths.Subject).toBe(60);
    expect(setWidth(emptyMeta(), 'Subject', 5000).widths.Subject).toBe(720);
  });

  it('toggles a column out of sight and back', () => {
    const hidden = toggleHidden(emptyMeta(), 'Score');
    expect(hidden.hidden).toEqual(['Score']);
    expect(toggleHidden(hidden, 'Score').hidden).toEqual([]);
  });
});
