import { describe, expect, it } from 'vitest';
import {
  MAX_COLUMNS,
  MAX_ROWS,
  tooBigBy,
  DEFAULT_WIDTH,
  GUTTER_WIDTH,
  ID_COLUMN,
  addColumn,
  addRow,
  applyEdits,
  clearFilters,
  columnValues,
  compareCells,
  dropChip,
  duplicateColumn,
  duplicateRows,
  emptyMeta,
  explodeRow,
  fillEdits,
  filterChips,
  filterSummary,
  freeColumnName,
  highlightParts,
  insertColumn,
  insertRow,
  isFilterActive,
  keyIndex,
  keysBetween,
  linkAt,
  linkedEntityIds,
  linkLabel,
  answersTerms,
  searchTerms,
  mergeRows,
  moveColumn,
  nextSecondSort,
  nextSort,
  onlyFilterValue,
  readFilters,
  removeColumn,
  removeRows,
  renameColumn,
  renameFilterColumn,
  rowHeight,
  rowKey,
  scrollFromThumb,
  scrollThumb,
  serializeFilters,
  setCells,
  setColour,
  setFilterContains,
  setFilterRange,
  setFilterWithout,
  setFrozen,
  setLegend,
  setLink,
  setPinned,
  setTall,
  setWidth,
  shownKeys,
  stickyOffsets,
  suggestMapping,
  toggleFilterFill,
  toggleFilterValue,
  toggleHidden,
  urlsIn,
  visibleColumns,
  visibleRows,
  withoutEntities,
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
    expect(answersTerms(['r1', 'Quai sud', 'ruled out'], searchTerms('quai out'))).toBe(true);
    expect(answersTerms(['r1', 'Quai sud', 'ruled out'], searchTerms('quai nord'))).toBe(false);
  });

  it('matches everything when nothing is typed', () => {
    expect(answersTerms(['r1', 'x'], searchTerms('  '))).toBe(true);
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
    expect(counted.values).toEqual([
      { value: 'a', rows: 2 },
      { value: 'b', rows: 1 },
    ]);
    expect(counted.total).toBe(2);
    expect(counted.capped).toBe(false);
  });

  it('pages a column holding more values than a menu lists, rather than refusing it', () => {
    const rows = Array.from({ length: 60 }, (_, index) => [`r${index}`, `value ${index}`]);
    const counted = columnValues({ columns: ['id', 'Free'], rows }, 'Free', null, { limit: 40 });
    expect(counted.values).toHaveLength(40);
    expect(counted.total).toBe(60);
    expect(counted.capped).toBe(true);
  });

  it('narrows the values against the whole column, not against the page', () => {
    const rows = Array.from({ length: 60 }, (_, index) => [`r${index}`, `value ${index}`]);
    const counted = columnValues({ columns: ['id', 'Free'], rows }, 'Free', null, {
      term: 'value 5',
      limit: 40,
    });
    // `value 5` and `value 50`..`value 59`: found past the fortieth entry of the list.
    expect(counted.matching).toBe(11);
    expect(counted.capped).toBe(false);
  });
});

describe('edits', () => {

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

  it('keeps the rows holding a term, which is all a column of prose can offer', () => {
    // The other half of `without`. Past the bound there is no list of values to tick,
    // so a column of notes could be ruled out by a word and never kept by one.
    const filters = setFilterContains({}, 'Note', 'found');
    expect(visibleRows(worklist(), { filters })).toEqual([1]);
  });

  it('reads the two halves of that question together', () => {
    let filters = setFilterContains({}, 'Note', 'o');
    filters = setFilterWithout(filters, 'Note', 'AI');
    expect(visibleRows(worklist(), { filters })).toEqual([0, 1, 2]);
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

  it('takes back a term the same way a chip does', () => {
    const filters = setFilterContains({}, 'Note', 'found');
    const [chip] = filterChips(filters);
    expect(chip.label).toBe('with found');
    expect(dropChip(filters, chip)).toEqual({});
  });

  it('asking for one value drops what else was asked of that column', () => {
    // What a cell offers: the answer under the pointer is the whole question, so a
    // second value ticked in the menu is not carried along with it.
    let filters = toggleFilterValue({}, 'Note', 'no idea');
    filters = setFilterWithout(filters, 'Note', 'AI');
    filters = toggleFilterFill(filters, 'Coordinates', 'blank');

    const only = onlyFilterValue(filters, 'Note', 'to be found');
    expect(filterSummary(only.Note)).toBe('to be found');
    // And it leaves the other columns exactly as they were.
    expect(filterSummary(only.Coordinates)).toBe('empty');
  });

  it('says what is asked of a column in one line, for the panel to state', () => {
    let filters = toggleFilterValue({}, 'Note', 'no idea');
    filters = setFilterContains(filters, 'Note', 'ide');
    expect(filterSummary(filters.Note)).toBe('no idea · with ide');
    expect(filterSummary(undefined)).toBe('');
  });

  it('finds a value inside a cell that holds several of them', () => {
    // Comparing the whole cell found neither answer, so clicking a chip in the grid
    // narrowed a list column to nothing at all.
    const table = {
      columns: ['id', 'Equipments'],
      rows: [['r1', 'Buk-M2E, ZU23-2'], ['r2', 'S-125'], ['r3', '']],
    };
    const roles = { Equipments: { kind: 'choice', multi: ', ' } };
    const filters = toggleFilterValue({}, 'Equipments', 'ZU23-2');
    expect(visibleRows(table, { filters, roles })).toEqual([0]);
    expect(
      visibleRows(table, { filters: toggleFilterValue({}, 'Equipments', 'S-125'), roles }),
    ).toEqual([1]);
    // And an empty cell still answers the blank entry the menu offers.
    expect(visibleRows(table, { filters: toggleFilterValue({}, 'Equipments', ''), roles })).toEqual([
      2,
    ]);
  });

  it('asks a column for the cells its own type cannot read', () => {
    const table = {
      columns: ['id', 'Count'],
      rows: [['r1', '3'], ['r2', 'about 12'], ['r3', '']],
    };
    const roles = { Count: { kind: 'number' } };
    const filters = toggleFilterFill({}, 'Count', 'unreadable');
    expect(visibleRows(table, { filters, roles })).toEqual([1]);
    expect(filterChips(filters)[0].label).toBe('to check');
  });

  it('counts a list column value by value rather than cell by cell', () => {
    const table = {
      columns: ['id', 'Equipments'],
      rows: [['r1', 'Buk-M2E, S-125'], ['r2', 'S-125']],
    };
    expect(columnValues(table, 'Equipments', { kind: 'choice', multi: ', ' }).values)
      .toEqual([
        { value: 'S-125', rows: 2 },
        { value: 'Buk-M2E', rows: 1 },
      ]);
  });
});

describe('asking a column for a range', () => {
  const distances = () => ({
    columns: ['id', 'Distance'],
    rows: [['r1', '2'], ['r2', '12'], ['r3', 'about 5'], ['r4', '']],
  });

  it('keeps the rows between the two bounds and drops what it cannot read', () => {
    const filters = setFilterRange({}, 'Distance', { from: '1', to: '10' });
    expect(visibleRows(distances(), { filters, roles: { Distance: { kind: 'number' } } }))
      .toEqual([0]);
  });

  it('takes either bound on its own', () => {
    const roles = { Distance: { kind: 'number' } };
    expect(visibleRows(distances(), { filters: setFilterRange({}, 'Distance', { from: '3' }), roles }))
      .toEqual([1]);
    expect(visibleRows(distances(), { filters: setFilterRange({}, 'Distance', { to: '3' }), roles }))
      .toEqual([0]);
  });

  it('reads a date column as moments rather than as words', () => {
    const table = {
      columns: ['id', 'When'],
      rows: [['r1', '03/01/2026'], ['r2', '28/02/2026'], ['r3', 'unknown']],
    };
    const filters = setFilterRange({}, 'When', { from: '2026-02-01' });
    expect(visibleRows(table, { filters, roles: { When: { kind: 'when' } } })).toEqual([1]);
  });

  it('says each bound as its own chip, and each one is removable alone', () => {
    const filters = setFilterRange({}, 'Distance', { from: '1', to: '10' });
    const chips = filterChips(filters);
    expect(chips.map((chip) => chip.label)).toEqual(['from 1', 'to 10']);
    expect(isFilterActive(dropChip(filters, chips[0]).Distance)).toBe(true);
    expect(dropChip(dropChip(filters, chips[0]), chips[1]).Distance).toBeUndefined();
  });
});

describe('marking what the search found', () => {
  it('cuts a cell into the parts a term matched and the parts it did not', () => {
    expect(highlightParts('Quai sud, Kherson', 'kherson')).toEqual([
      { text: 'Quai sud, ', hit: false },
      { text: 'Kherson', hit: true },
    ]);
  });

  it('marks two overlapping terms once rather than twice', () => {
    expect(highlightParts('Kherson', 'kher kherson')).toEqual([{ text: 'Kherson', hit: true }]);
  });

  it('leaves the cell whole when nothing is being searched for', () => {
    expect(highlightParts('Quai sud', '  ')).toEqual([{ text: 'Quai sud', hit: false }]);
  });
});

describe('growing a table where the work is', () => {
  it('inserts a column at an index rather than at the end', () => {
    const next = insertColumn(table(), 2, 'Verdict');
    expect(next.columns).toEqual(['id', 'Subject', 'Verdict', 'Status', 'Score']);
    expect(next.rows[0]).toEqual(['r1', 'Quai sud', '', 'ruled out', '10']);
  });

  it('names an inserted column around one already taken', () => {
    expect(insertColumn(table(), 1, 'Status').columns[1]).toBe('Status 2');
  });

  it('copies a column beside itself with its cells and its lens', () => {
    const meta = { ...emptyMeta(), widths: { Status: 220 }, roles: { Status: { kind: 'state' } },
      notes: { Status: 'where it got to' }, links: { r1: { Status: 'e_7' } } };
    const copied = duplicateColumn(table(), meta, 2);
    expect(copied.table.columns).toEqual(['id', 'Subject', 'Status', 'Status copy', 'Score']);
    expect(copied.table.rows[0][3]).toBe('ruled out');
    expect(copied.meta.widths['Status copy']).toBe(220);
    expect(copied.meta.roles['Status copy']).toEqual({ kind: 'state' });
    expect(copied.meta.notes['Status copy']).toBe('where it got to');
    // The link stays on the cell the case answered about, and is not claimed by a copy.
    expect(copied.meta.links.r1['Status copy']).toBeUndefined();
  });

  it('inserts a blank row at an index, keyed', () => {
    const next = insertRow(table(), 1);
    expect(next.rows).toHaveLength(4);
    expect(next.rows[1][0]).toMatch(/^r[0-9a-f]{10}$/);
    expect(next.rows[1][1]).toBe('');
    expect(next.rows[2][1]).toBe('Pont nord');
  });

  it('duplicates rows under themselves, each with a key of its own', () => {
    const { table: next, keys } = duplicateRows(table(), [0, 2]);
    expect(next.rows.map((row) => row[1])).toEqual([
      'Quai sud', 'Quai sud', 'Pont nord', 'Gare est', 'Gare est',
    ]);
    expect(keys).toHaveLength(2);
    expect(new Set(next.rows.map((row) => row[0])).size).toBe(5);
  });
});

describe('sorting a column that knows what it holds', () => {
  // The most visible thing a role buys, and the reason the roles reach `visibleRows`.
  const dated = () => ({
    columns: ['id', 'Date'],
    rows: [
      ['r1', '01/02/2026'],
      ['r2', '31/01/2026'],
      ['r3', 'AFTER'],
      ['r4', ''],
    ],
  });

  it('reads a European date as a date instead of as text', () => {
    const asText = visibleRows(dated(), { sort: { column: 'Date', desc: false } });
    expect(asText.slice(0, 2)).toEqual([0, 1]); // 01/02 before 31/01: wrong, and expected

    const byRole = visibleRows(dated(), {
      sort: { column: 'Date', desc: false },
      roles: { Date: { kind: 'when', dayFirst: true } },
    });
    expect(byRole.slice(0, 2)).toEqual([1, 0]); // 31 January before 1 February
  });

  it('keeps the blank at the bottom whichever way the arrow points', () => {
    const roles = { Date: { kind: 'when', dayFirst: true } };
    for (const desc of [false, true]) {
      const shown = visibleRows(dated(), { sort: { column: 'Date', desc }, roles });
      expect(shown.at(-1)).toBe(3);
    }
  });

  it('puts a cell the role cannot read after the ones it can', () => {
    const shown = visibleRows(dated(), {
      sort: { column: 'Date', desc: false },
      roles: { Date: { kind: 'when' } },
    });
    expect(shown).toEqual([1, 0, 2, 3]);
  });

  it('ranks a state column by its vocabulary, not its alphabet', () => {
    const table = {
      columns: ['id', 'Status'],
      rows: [['r1', 'done'], ['r2', 'to do'], ['r3', 'in progress']],
    };
    const shown = visibleRows(table, {
      sort: { column: 'Status', desc: false },
      roles: { Status: { kind: 'state', values: ['to do', 'in progress', 'done'] } },
    });
    expect(shown.map((index) => table.rows[index][1])).toEqual(['to do', 'in progress', 'done']);
  });

  it('falls back to reading the words where the role says nothing', () => {
    const table = { columns: ['id', 'Name'], rows: [['r1', 'AB-10'], ['r2', 'AB-2']] };
    const shown = visibleRows(table, {
      sort: { column: 'Name', desc: false },
      roles: { Name: { kind: 'stamped' } },
    });
    expect(shown).toEqual([1, 0]);
  });

  it('sorts as before when no role is declared, so nothing regressed', () => {
    const shown = visibleRows(table(), { sort: { column: 'Score', desc: false } });
    expect(shown.map((index) => table().rows[index][3])).toEqual(['9', '10', '100']);
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

// -- the question, written down -----------------------------------------------
//
// The sort and the hidden columns were always in the sidecar; the half that decides
// which rows are on screen lived in the tab and died with it. The runtime holds the
// chosen values as a Set and the file holds a list — JSON has no set — so these two
// functions are the boundary and they have to agree.

describe('the question a sheet was left on', () => {
  it('writes the chosen values out as a list and reads them back as a set', () => {
    const asked = toggleFilterValue({}, 'Status', 'to do');
    const stored = serializeFilters(asked);
    expect(Array.isArray(stored.Status.values)).toBe(true);
    expect(stored.Status.values).toEqual(['to do']);

    const back = readFilters(stored, ['id', 'Status']);
    expect(back.Status.values).toBeInstanceOf(Set);
    expect(isFilterActive(back.Status)).toBe(true);
  });

  it('does not write down a filter that asks nothing', () => {
    const off = toggleFilterValue(toggleFilterValue({}, 'Status', 'to do'), 'Status', 'to do');
    expect(serializeFilters(off)).toEqual({});
  });

  it('drops a stored filter whose column the file no longer has', () => {
    const stored = serializeFilters(toggleFilterValue({}, 'Gone', 'anything'));
    expect(readFilters(stored, ['id', 'Status'])).toEqual({});
    // With no list of columns to check against, everything stored is taken.
    expect(Object.keys(readFilters(stored))).toEqual(['Gone']);
  });

  it('moves what is asked of a column onto its new name, and drops it on a delete', () => {
    // The rows on screen must not change because a heading was spelled again.
    const asked = toggleFilterValue({}, 'Status', 'to do');
    expect(Object.keys(renameFilterColumn(asked, 'Status', 'State'))).toEqual(['State']);
    expect(renameFilterColumn(asked, 'Status', null)).toEqual({});
    // A column nothing was asked of leaves the rest alone.
    expect(renameFilterColumn(asked, 'Subject', 'Name')).toEqual(asked);
  });

  it('clears every column at once', () => {
    expect(clearFilters()).toEqual({});
  });
});

describe('a rename or a delete, and everything hanging off the column name', () => {
  const table = {
    columns: ['id', 'Subject', 'Status'],
    rows: [['r1', 'Quai sud', 'done']],
  };
  const meta = {
    ...emptyMeta(),
    widths: { Status: 200 },
    hidden: ['Status'],
    roles: { Status: { kind: 'state' } },
    notes: { Status: 'where this row got to' },
    filters: { Status: { values: ['done'] } },
    promoted: { r1: { Status: 'done' } },
    links: { r1: { Status: 'e_7' } },
    progress: 'Status',
    frozen: 'Status',
    sort: { column: 'Subject', desc: false, then: { column: 'Status', desc: true } },
  };

  it('takes all of it with the new name', () => {
    const moved = renameColumn(table, meta, 2, 'State');
    expect(moved.table.columns).toEqual(['id', 'Subject', 'State']);
    expect(moved.meta.widths).toEqual({ State: 200 });
    expect(moved.meta.hidden).toEqual(['State']);
    expect(moved.meta.roles.State.kind).toBe('state');
    expect(moved.meta.notes).toEqual({ State: 'where this row got to' });
    expect(moved.meta.filters).toEqual({ State: { values: ['done'] } });
    expect(moved.meta.promoted).toEqual({ r1: { State: 'done' } });
    expect(moved.meta.links).toEqual({ r1: { State: 'e_7' } });
    expect(moved.meta.progress).toBe('State');
    expect(moved.meta.frozen).toBe('State');
    expect(moved.meta.sort.then).toEqual({ column: 'State', desc: true });
  });

  it('takes all of it away with the column', () => {
    const gone = removeColumn(table, meta, 2);
    expect(gone.table.columns).toEqual(['id', 'Subject']);
    expect(gone.meta.widths).toEqual({});
    expect(gone.meta.hidden).toEqual([]);
    expect(gone.meta.roles).toEqual({});
    expect(gone.meta.notes).toEqual({});
    expect(gone.meta.filters).toEqual({});
    expect(gone.meta.promoted).toEqual({});
    expect(gone.meta.links).toEqual({});
    expect(gone.meta.progress).toBeNull();
    expect(gone.meta.frozen).toBeNull();
    // The first key survives; only the tiebreak it no longer has is dropped.
    expect(gone.meta.sort).toEqual({ column: 'Subject', desc: false });
  });

  it('drops the sort itself when the column it sorted on goes', () => {
    const sorted = { ...emptyMeta(), sort: { column: 'Status', desc: true } };
    expect(removeColumn(table, sorted, 2).meta.sort).toBeNull();
    expect(renameColumn(table, sorted, 2, 'State').meta.sort).toEqual({
      column: 'State',
      desc: true,
    });
  });
});

describe('a second key, for when the first one ties', () => {
  it('cycles ascending, descending, off', () => {
    const sort = { column: 'Status', desc: false };
    const up = nextSecondSort(sort, 'Subject');
    expect(up.then).toEqual({ column: 'Subject', desc: false });
    const down = nextSecondSort(up, 'Subject');
    expect(down.then).toEqual({ column: 'Subject', desc: true });
    expect(nextSecondSort(down, 'Subject').then).toBeUndefined();
  });

  it('refuses to break a column ties with itself, which is a loop', () => {
    const sort = { column: 'Status', desc: false, then: { column: 'Subject', desc: false } };
    expect(nextSecondSort(sort, 'Status').then).toBeUndefined();
  });

  it('is nothing at all without a first key', () => {
    expect(nextSecondSort(null, 'Subject')).toBeNull();
  });

  it('orders the rows by the second key inside the first', () => {
    const table = {
      columns: ['id', 'Status', 'Subject'],
      rows: [
        ['r1', 'done', 'Quai sud'],
        ['r2', 'to do', 'Aval'],
        ['r3', 'done', 'Amont'],
        ['r4', 'to do', 'Zone 5'],
      ],
    };
    const sort = { column: 'Status', desc: false, then: { column: 'Subject', desc: false } };
    const seen = visibleRows(table, { sort }).map((index) => table.rows[index][0]);
    expect(seen).toEqual(['r3', 'r1', 'r2', 'r4']);
  });
});

describe('folding rows together and pulling one apart', () => {
  const table = {
    columns: ['id', 'Subject', 'Notes'],
    rows: [
      ['r1', 'Quai sud', ''],
      ['r2', 'Quai sud, harbour side', 'seen on the 4th'],
      ['r3', 'Pont nord', ''],
    ],
  };

  it('keeps the fullest answer per column, and the first row own key', () => {
    // The surviving row keeps its key, so its colour, its links and its promotion
    // record survive with it.
    const merged = mergeRows(table, [0, 1]);
    expect(merged.folded).toBe(1);
    expect(merged.key).toBe('r1');
    expect(merged.table.rows).toEqual([
      ['r1', 'Quai sud, harbour side', 'seen on the 4th'],
      ['r3', 'Pont nord', ''],
    ]);
  });

  it('does nothing to one row on its own', () => {
    expect(mergeRows(table, [1]).table).toBe(table);
    expect(mergeRows(table, []).folded).toBe(0);
  });

  it('turns one cell of values into a row each, the rest of the row copied down', () => {
    const inbox = {
      columns: ['id', 'Systems', 'Source'],
      rows: [['r1', 'Buk-M2E, ZU23-2, S-300', 'https://a.org/1']],
    };
    const grown = explodeRow(inbox, 0, 1, ',');
    expect(grown.keys).toHaveLength(2);
    expect(grown.table.rows.map((row) => row[1])).toEqual(['Buk-M2E', 'ZU23-2', 'S-300']);
    expect(grown.table.rows.every((row) => row[2] === 'https://a.org/1')).toBe(true);
    // Every new row is its own row, so nothing hangs on somebody else's key.
    expect(new Set(grown.table.rows.map((row) => row[0])).size).toBe(3);
  });

  it('leaves a cell holding one value alone, and never splits the handle', () => {
    expect(explodeRow(table, 0, 1, ',').keys).toEqual([]);
    expect(explodeRow(table, 0, 0, ',').table).toBe(table);
  });
});

describe('what the grid remembers about how it is drawn', () => {
  it('answers one of two row heights, because a note cannot live in one line', () => {
    expect(rowHeight(emptyMeta())).toBe(30);
    expect(rowHeight(setTall(emptyMeta(), true))).toBe(78);
    expect(setTall(setTall(emptyMeta(), true), false).tall).toBe(false);
  });

  it('names a colour, and forgets it when the name is taken away', () => {
    const named = setLegend(emptyMeta(), 'red', '  ruled out  ');
    expect(named.legend).toEqual({ red: 'ruled out' });
    expect(setLegend(named, 'red', '').legend).toEqual({});
    // A colour the palette does not hold is not a colour this sheet paints with.
    expect(setLegend(emptyMeta(), 'chartreuse', 'invented').legend).toEqual({});
  });

  it('keeps one row under the heading, and lets it go when it is pinned again', () => {
    const pinned = setPinned(emptyMeta(), 'r1');
    expect(pinned.pinned).toBe('r1');
    expect(setPinned(pinned, 'r1').pinned).toBeNull();
    expect(setPinned(pinned, 'r2').pinned).toBe('r2');
  });
});


describe('the bounds the file actually has', () => {
  const table = (rows, columns = 3) => ({
    columns: Array.from({ length: columns }, (_, at) => `c${at}`),
    rows: Array.from({ length: rows }, () => []),
  });

  it('lets an ordinary sheet grow', () => {
    expect(tooBigBy(table(10), { rows: 400 })).toBeNull();
    expect(tooBigBy(table(10), { columns: 6 })).toBeNull();
  });

  it('says how much room is left rather than only refusing', () => {
    const said = tooBigBy(table(MAX_ROWS - 12), { rows: 400 });
    expect(said).toContain('12');
  });

  it('refuses the column that would not fit', () => {
    expect(tooBigBy(table(1, MAX_COLUMNS), { columns: 1 })).toContain(String(MAX_COLUMNS));
    expect(tooBigBy(table(1, MAX_COLUMNS - 1), { columns: 1 })).toBeNull();
  });

  it('answers for a table that is already over, which is how a pass is checked', () => {
    // `cleanTable` asks about the table a pass produced, not about a growth it planned.
    expect(tooBigBy(table(1, MAX_COLUMNS + 2))).not.toBeNull();
    expect(tooBigBy(table(MAX_ROWS + 1))).toContain('full');
  });
});

describe('a sidecar and what the case still holds', () => {
  const meta = {
    ...emptyMeta(),
    links: { r1: { Subject: 'e_gone', Note: 'e_kept' }, r2: { Subject: 'e_gone' } },
    values: { Unit: { 'Buk-M2E': 'e_gone', 'ZU23-2': 'e_kept' } },
    attachments: { r1: ['e_file', 'e_gone'] },
    colours: { r1: 'grey' },
  };

  it('names every entity the sidecar points at, once each', () => {
    expect(linkedEntityIds(meta).sort()).toEqual(['e_file', 'e_gone', 'e_kept']);
    expect(linkedEntityIds(emptyMeta())).toEqual([]);
  });

  it('drops the pointers at what was deleted, in all three places', () => {
    const next = withoutEntities(meta, new Set(['e_gone']));

    expect(next.links).toEqual({ r1: { Note: 'e_kept' } });
    expect(next.values).toEqual({ Unit: { 'ZU23-2': 'e_kept' } });
    expect(next.attachments).toEqual({ r1: ['e_file'] });
  });

  it('leaves the reading built around them alone', () => {
    // a colour is the analyst's, not a pointer at the case
    expect(withoutEntities(meta, new Set(['e_gone'])).colours).toEqual({ r1: 'grey' });
  });

  it('hands back the same sidecar when nothing it points at has gone', () => {
    expect(withoutEntities(meta, new Set(['e_elsewhere']))).toBe(meta);
    expect(withoutEntities(meta, new Set())).toBe(meta);
  });
});

describe('lining two sheets up before a row is moved', () => {
  it('takes an identical name as the answer, and says nothing about it', () => {
    expect(suggestMapping(['Subject', 'Status'], ['id', 'Subject', 'Status'])).toEqual([
      { name: 'Subject', to: 'Subject', guessed: false },
      { name: 'Status', to: 'Status', guessed: false },
    ]);
  });

  it('proposes a name that differs only in how it is written, and calls it a guess', () => {
    // Case, accents and the space against the underscore: the same column, twice.
    expect(suggestMapping(['Local time', 'Vérifié'], ['id', 'local_time', 'verifie'])).toEqual([
      { name: 'Local time', to: 'local_time', guessed: true },
      { name: 'Vérifié', to: 'verifie', guessed: true },
    ]);
  });

  it('leaves a column the other sheet has nothing for pointed at nothing', () => {
    expect(suggestMapping(['Scratch'], ['id', 'Subject'])).toEqual([
      { name: 'Scratch', to: '', guessed: false },
    ]);
  });

  it('spends a target once, and the exact spelling has first claim on it', () => {
    const pairs = suggestMapping(['adresse', 'Adresse'], ['id', 'Adresse']);

    expect(pairs).toEqual([
      { name: 'adresse', to: '', guessed: false },
      { name: 'Adresse', to: 'Adresse', guessed: false },
    ]);
  });

  it('leaves the key column out of it, on both sides', () => {
    const pairs = suggestMapping(['id', 'Subject'], ['id', 'Subject']);

    expect(pairs).toEqual([{ name: 'Subject', to: 'Subject', guessed: false }]);
  });
});
