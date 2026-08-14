/**
 * The grid's own logic: what a sheet shows, and what an edit does to it.
 *
 * A sheet is `{ columns: string[], rows: string[][] }` — deliberately the shape a
 * CSV already has, because the server writes the file and this never does. There
 * is exactly one CSV parser and one CSV writer in the app and both are in Python
 * (`engine/sheets.py`); the browser sends a table and gets a table back, so an
 * imported file and a saved grid can never become two readings of the same rows.
 *
 * Rows are addressed by their **key** — the value in the `id` column — and never
 * by position. That is the whole reason the column exists: a colour or an entity
 * link hung on "row 4" moves to the wrong row the moment the file is sorted, here
 * or in someone else's spreadsheet.
 */

/** The column holding each row's identity. Mirrors `engine/sheets.ID_COLUMN`. */
export const ID_COLUMN = 'id';

/** Row colours the grid offers. Mirrors `engine/sheets.ROW_COLOURS`. Drawn from
 *  the annotation palette, never the amber accent: that one means selection. */
export const ROW_COLOURS = ['red', 'orange', 'yellow', 'green', 'blue', 'grey'];

/** Past this many distinct values a column is prose, not a set of answers: no
 *  chips, no value menu. Same idea as the Board's bound on offered facet values. */
const MAX_CHOICE_VALUES = 40;

export function emptyMeta() {
  return {
    version: 1,
    widths: {},
    hidden: [],
    sort: null,
    colours: {},
    links: {},
    frozen: null,
  };
}

/** The width the grid draws a column at when the sidecar holds none. Mirrored in
 *  the component's own default, and needed here because the sticky offsets of the
 *  frozen columns are arithmetic on widths. */
export const DEFAULT_WIDTH = 160;

/** The gutter that holds the tick box, in pixels. The first sticky offset. */
export const GUTTER_WIDTH = 34;

/** Where the key column sits. Always 0 on a table the server wrote, but a column
 *  the analyst moved is a change away, so nothing here assumes it. */
export function keyIndex(columns) {
  const at = (columns ?? []).findIndex((name) => String(name).toLowerCase() === ID_COLUMN);
  return at === -1 ? 0 : at;
}

export function rowKey(columns, row) {
  return String(row?.[keyIndex(columns)] ?? '');
}

/** The columns drawn, with the index each one reads from. The key column is
 *  always drawn: it is the row's handle, and hiding it hides why a colour
 *  survived a re-sort. */
export function visibleColumns(columns, meta) {
  const hidden = new Set(meta?.hidden ?? []);
  const key = keyIndex(columns);
  return (columns ?? [])
    .map((name, index) => ({ name, index }))
    .filter((column) => column.index === key || !hidden.has(column.name));
}

const NUMBER = /^-?\d+(?:[.,]\d+)?$/;

function asNumber(value) {
  return NUMBER.test(String(value).trim())
    ? Number(String(value).trim().replace(',', '.'))
    : null;
}

export function isBlank(value) {
  return !String(value ?? '').trim();
}

/** Links inside one cell. A cell holds several often enough — a source and its
 *  archive copy — that returning a list rather than the first one is the honest
 *  answer. Trailing punctuation is left behind: a URL at the end of a sentence is
 *  not a URL with a full stop in it. */
export function urlsIn(value) {
  const found = String(value ?? '').match(/\bhttps?:\/\/[^\s<>"'()[\]]+/gi) ?? [];
  return found.map((url) => url.replace(/[.,;:!?]+$/, ''));
}

/** What a link is shown as in a cell thirty pixels tall: its host, without the
 *  `www.`, plus a mark when the path carries more than the host does. A hundred and
 *  twenty characters of query string in a grid is a cell that says nothing. */
export function linkLabel(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    return parsed.pathname && parsed.pathname !== '/' ? `${host}/…` : host;
  } catch {
    return String(url ?? '');
  }
}

/**
 * Two filled cells, ordered.
 *
 * Numbers compare as numbers, so 9 comes before 10, and everything else compares
 * the way a person reads it — `numeric` makes `AB-2` precede `AB-10`.
 *
 * Blank cells are not this function's business: `visibleRows` holds them at the
 * bottom in **both** directions, because blank is "no answer yet" and a
 * descending sort that opens on a screen of nothing has buried the rows the
 * analyst asked to see.
 */
export function compareCells(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  const [x, y] = [asNumber(left), asNumber(right)];
  if (x !== null && y !== null) return x === y ? 0 : x < y ? -1 : 1;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
}

/** Whether one row answers a typed term. Every term has to appear somewhere in
 *  the row, matching the Board's rule so one box does not behave two ways. */
export function matchesRow(row, query) {
  const terms = String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = (row ?? []).join('\n').toLowerCase();
  return terms.every((term) => text.includes(term));
}

// -- what is asked of a column ------------------------------------------------
//
// A chosen value answers "which ones say this". The other two questions an analyst
// asks of a worklist are "which ones have nothing here yet" and "which ones do not
// mention this", and neither is a value: `To be found`, `-`, `?` and an empty cell
// all mean the same thing to the person filtering, and no list of values catches
// them. So a column's filter is a small record rather than a set, and the three
// parts read together.

/** One column's filter, in the one shape the rest of this module reads. A bare Set
 *  is accepted because chosen values are the common case and the caller that only
 *  has those should not have to build a record. */
export function normalizeFilter(entry) {
  if (!entry) return null;
  if (entry instanceof Set) {
    return { values: entry.size ? entry : null, fill: null, without: '' };
  }
  const values = entry.values instanceof Set && entry.values.size ? entry.values : null;
  const fill = entry.fill === 'blank' || entry.fill === 'filled' ? entry.fill : null;
  return { values, fill, without: String(entry.without ?? '') };
}

export function isFilterActive(entry) {
  const filter = normalizeFilter(entry);
  return Boolean(filter && (filter.values || filter.fill || filter.without));
}

/** Whether one cell answers one column's filter. Every part has to hold: they are
 *  clauses of one question, not alternatives. */
export function matchesFilter(cell, entry) {
  const filter = normalizeFilter(entry);
  if (!filter) return true;
  const value = String(cell ?? '');
  if (filter.values && !filter.values.has(value)) return false;
  if (filter.fill === 'blank' && !isBlank(value)) return false;
  if (filter.fill === 'filled' && isBlank(value)) return false;
  if (filter.without && value.toLowerCase().includes(filter.without.toLowerCase())) return false;
  return true;
}

/** Replace one column's filter, dropping the column entirely when nothing is left
 *  to ask — so `filters` never accumulates empty records the chips would show. */
function withFilter(filters, column, filter) {
  const next = { ...(filters ?? {}) };
  if (isFilterActive(filter)) next[column] = filter;
  else delete next[column];
  return next;
}

export function toggleFilterValue(filters, column, value) {
  const filter = normalizeFilter(filters?.[column]) ?? { values: null, fill: null, without: '' };
  const values = new Set(filter.values ?? []);
  if (!values.delete(value)) values.add(value);
  return withFilter(filters, column, { ...filter, values });
}

/** Ask for blank or for filled, or ask again to stop asking. */
export function toggleFilterFill(filters, column, fill) {
  const filter = normalizeFilter(filters?.[column]) ?? { values: null, fill: null, without: '' };
  return withFilter(filters, column, { ...filter, fill: filter.fill === fill ? null : fill });
}

export function setFilterWithout(filters, column, term) {
  const filter = normalizeFilter(filters?.[column]) ?? { values: null, fill: null, without: '' };
  return withFilter(filters, column, { ...filter, without: String(term ?? '').trim() });
}

export function clearFilter(filters, column) {
  const next = { ...(filters ?? {}) };
  delete next[column];
  return next;
}

/** Every active clause as its own chip, so each is removable on its own. A chip
 *  carries what it takes to undo itself and nothing else. */
export function filterChips(filters) {
  return Object.entries(filters ?? {}).flatMap(([column, entry]) => {
    const filter = normalizeFilter(entry);
    if (!filter) return [];
    const chips = [...(filter.values ?? [])].map((value) => ({
      column,
      part: 'value',
      value,
      label: value || '(blank)',
    }));
    if (filter.fill) {
      chips.push({
        column,
        part: 'fill',
        value: filter.fill,
        label: filter.fill === 'blank' ? 'empty' : 'not empty',
      });
    }
    if (filter.without) {
      chips.push({
        column,
        part: 'without',
        value: filter.without,
        label: `without ${filter.without}`,
      });
    }
    return chips;
  });
}

/** Remove exactly what one chip shows, leaving the column's other clauses alone. */
export function dropChip(filters, chip) {
  if (chip?.part === 'value') return toggleFilterValue(filters, chip.column, chip.value);
  if (chip?.part === 'fill') return toggleFilterFill(filters, chip.column, chip.value);
  if (chip?.part === 'without') return setFilterWithout(filters, chip.column, '');
  return filters;
}

/**
 * The row indices to draw, filtered then sorted.
 *
 * Indices rather than rows, so an edit still addresses the table the caller
 * holds: the grid draws in one order and writes in another, and translating in
 * one place is what keeps that from becoming a bug per column.
 */
export function visibleRows(table, view = {}) {
  const { columns = [], rows = [] } = table ?? {};
  const { query = '', filters = {}, sort = null } = view;
  const active = Object.entries(filters).filter(([, entry]) => isFilterActive(entry));

  let indices = rows
    .map((row, index) => index)
    .filter((index) => matchesRow(rows[index], query))
    .filter((index) =>
      active.every(([name, entry]) => {
        const at = columns.indexOf(name);
        return at !== -1 && matchesFilter(rows[index][at], entry);
      }),
    );

  const at = sort ? columns.indexOf(sort.column) : -1;
  if (at !== -1) {
    const direction = sort.desc ? -1 : 1;
    indices = indices
      .map((index, order) => ({ index, order }))
      .sort((a, b) => {
        const left = rows[a.index][at];
        const right = rows[b.index][at];
        // Blank sinks whichever way the arrow points, and two blanks stay put.
        if (isBlank(left) || isBlank(right)) {
          if (isBlank(left) && isBlank(right)) return a.order - b.order;
          return isBlank(left) ? 1 : -1;
        }
        // Stable: two equal cells keep the order the file has them in.
        const cells = compareCells(left, right);
        return cells === 0 ? a.order - b.order : cells * direction;
      })
      .map((entry) => entry.index);
  }
  return indices;
}

/** The distinct values of one column with their counts, commonest first, or null
 *  when the column holds too many to be a set of answers. */
export function columnValues(table, name) {
  const at = (table?.columns ?? []).indexOf(name);
  if (at === -1) return null;
  const counts = new Map();
  for (const row of table.rows ?? []) {
    const value = String(row[at] ?? '');
    counts.set(value, (counts.get(value) ?? 0) + 1);
    if (counts.size > MAX_CHOICE_VALUES) return null;
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || compareCells(a.value, b.value));
}

// -- edits --------------------------------------------------------------------
//
// Every one of these returns a new table (and a new sidecar where a rename moves
// what the sidecar keyed on a column name). Nothing mutates: the undo stack
// snapshots what these return, and a mutating edit would rewrite its own history.

export function setCell(table, rowIndex, columnIndex, value) {
  const rows = table.rows.map((row, index) =>
    index === rowIndex ? row.map((cell, at) => (at === columnIndex ? String(value ?? '') : cell)) : row,
  );
  return { ...table, rows };
}

/**
 * Write several cells at once, as one edit.
 *
 * The one primitive behind filling a column for every ticked row, copying a cell
 * down a selection, and undoing or redoing either: all four are a list of
 * `{ row, column, value }` applied together. One pass over the table rather than one
 * per cell, which on a few thousand ticked rows is the difference between a grid and
 * a hang.
 */
export function setCells(table, writes) {
  if (!writes?.length) return table;
  const byRow = new Map();
  for (const write of writes) {
    if (!byRow.has(write.row)) byRow.set(write.row, []);
    byRow.get(write.row).push(write);
  }
  const rows = table.rows.map((row, index) => {
    const mine = byRow.get(index);
    if (!mine) return row;
    const next = [...row];
    for (const write of mine) {
      if (write.column >= 0 && write.column < next.length) next[write.column] = String(write.value ?? '');
    }
    return next;
  });
  return { ...table, rows };
}

/** The edits that set one column to *value* across *rowIndices*, each carrying what
 *  it replaced. Cells already holding the value are left out, so undo does not walk
 *  back through steps that changed nothing and the key column is never touched. */
export function fillEdits(table, columnIndex, rowIndices, value) {
  const text = String(value ?? '');
  if (columnIndex === keyIndex(table.columns)) return [];
  return (rowIndices ?? [])
    .filter((index) => table.rows[index] && table.rows[index][columnIndex] !== text)
    .map((index) => ({
      row: index,
      column: columnIndex,
      before: table.rows[index][columnIndex],
      after: text,
    }));
}

/** Apply a recorded step in one direction: 'backward' puts the cells back the way
 *  they were, 'forward' puts them the way the edit left them. */
export function applyEdits(table, edits, direction) {
  const side = direction === 'backward' ? 'before' : 'after';
  return setCells(
    table,
    (edits ?? []).map((edit) => ({ row: edit.row, column: edit.column, value: edit[side] })),
  );
}

/** A row appended with a fresh key. The server mints one for a blank key too, but
 *  the grid needs something to hang a colour on before the next save. */
export function addRow(table, key = newKey()) {
  const cells = table.columns.map((_, index) => (index === keyIndex(table.columns) ? key : ''));
  return { ...table, rows: [...table.rows, cells] };
}

export function newKey() {
  const random = crypto.getRandomValues(new Uint8Array(5));
  return `r${[...random].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function removeRows(table, indices) {
  const drop = new Set(indices);
  return { ...table, rows: table.rows.filter((_, index) => !drop.has(index)) };
}

/** A column name nothing else uses, so two "Status" columns never exist. */
export function freeColumnName(columns, base = 'Column') {
  const taken = new Set(columns.map((name) => String(name).toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  let index = 2;
  while (taken.has(`${base} ${index}`.toLowerCase())) index += 1;
  return `${base} ${index}`;
}

export function addColumn(table, name) {
  const heading = freeColumnName(table.columns, name || 'Column');
  return {
    ...table,
    columns: [...table.columns, heading],
    rows: table.rows.map((row) => [...row, '']),
  };
}

/**
 * Rename a column, and move everything the sidecar keyed on its old name.
 *
 * Without the second half a renamed column silently loses its width and every
 * entity link in it — the analyst's work disappearing because they fixed a
 * spelling.
 */
export function renameColumn(table, meta, index, name) {
  const previous = table.columns[index];
  const heading = freeColumnName(
    table.columns.filter((_, at) => at !== index),
    String(name ?? '').trim() || previous,
  );
  const columns = table.columns.map((current, at) => (at === index ? heading : current));
  return { table: { ...table, columns }, meta: remapColumn(meta, previous, heading) };
}

export function removeColumn(table, meta, index) {
  const name = table.columns[index];
  return {
    table: {
      ...table,
      columns: table.columns.filter((_, at) => at !== index),
      rows: table.rows.map((row) => row.filter((_, at) => at !== index)),
    },
    meta: remapColumn(meta, name, null),
  };
}

/**
 * Move a column to another position, cells and all.
 *
 * The order is moved **in the table**, not remembered in the sidecar. A column order
 * is something the collaborator opening the CSV sees, so it belongs in the file; and
 * a sidecar list of names beside a file with its own order is two answers to one
 * question. Nothing in the sidecar is keyed on position, so nothing has to follow.
 */
export function moveColumn(table, from, to) {
  const width = table.columns.length;
  if (from === to || from < 0 || to < 0 || from >= width || to >= width) return table;
  const order = table.columns.map((_, index) => index);
  order.splice(to, 0, ...order.splice(from, 1));
  return {
    columns: order.map((index) => table.columns[index]),
    rows: table.rows.map((row) => order.map((index) => row[index] ?? '')),
  };
}

/** Move what the sidecar keyed on `from` onto `to`, or drop it when `to` is null. */
function remapColumn(meta, from, to) {
  const next = { ...emptyMeta(), ...meta };
  next.widths = { ...(next.widths ?? {}) };
  if (from in next.widths) {
    const width = next.widths[from];
    delete next.widths[from];
    if (to) next.widths[to] = width;
  }
  const hidden = (next.hidden ?? []).filter((name) => name !== from);
  if (to && (meta?.hidden ?? []).includes(from)) hidden.push(to);
  next.hidden = hidden;
  if (next.sort?.column === from) next.sort = to ? { ...next.sort, column: to } : null;
  if (next.frozen === from) next.frozen = to ?? null;
  next.links = Object.fromEntries(
    Object.entries(next.links ?? {})
      .map(([key, cells]) => {
        const moved = { ...cells };
        if (from in moved) {
          const value = moved[from];
          delete moved[from];
          if (to) moved[to] = value;
        }
        return [key, moved];
      })
      .filter(([, cells]) => Object.keys(cells).length),
  );
  return next;
}

// -- the sidecar --------------------------------------------------------------

export function setColour(meta, key, colour) {
  const colours = { ...(meta?.colours ?? {}) };
  if (colour && ROW_COLOURS.includes(colour)) colours[key] = colour;
  else delete colours[key];
  return { ...emptyMeta(), ...meta, colours };
}

/** Point a cell at an entity, or clear it. The cell keeps whatever text it holds:
 *  the link is what the case knows, the text is what the file says. */
export function setLink(meta, key, column, entityId) {
  const links = { ...(meta?.links ?? {}) };
  const cells = { ...(links[key] ?? {}) };
  if (entityId) cells[column] = entityId;
  else delete cells[column];
  if (Object.keys(cells).length) links[key] = cells;
  else delete links[key];
  return { ...emptyMeta(), ...meta, links };
}

export function linkAt(meta, key, column) {
  return meta?.links?.[key]?.[column] ?? null;
}

export function setWidth(meta, column, width) {
  return {
    ...emptyMeta(),
    ...meta,
    widths: { ...(meta?.widths ?? {}), [column]: Math.max(60, Math.min(720, Math.round(width))) },
  };
}

export function toggleHidden(meta, column) {
  const hidden = new Set(meta?.hidden ?? []);
  if (!hidden.delete(column)) hidden.add(column);
  return { ...emptyMeta(), ...meta, hidden: [...hidden] };
}

/** Click a heading: sort ascending, then descending, then not at all. Three
 *  states on one control, so putting a sort back is the same gesture as setting
 *  it rather than a second one to find. */
export function nextSort(sort, column) {
  if (sort?.column !== column) return { column, desc: false };
  return sort.desc ? null : { column, desc: true };
}

/** Keep one column beside the key while the table scrolls sideways, or stop. The
 *  key column is not a candidate: it already sticks, being the row's handle, and
 *  offering to freeze it would offer a change that does nothing. */
export function setFrozen(meta, column) {
  const wanted = column && String(column).toLowerCase() !== ID_COLUMN ? String(column) : null;
  return { ...emptyMeta(), ...meta, frozen: meta?.frozen === wanted ? null : wanted };
}

/**
 * Where each column that stays put sits, in pixels from the left edge.
 *
 * The key column sticks because it is the row's handle: on a comparison grid forty
 * columns wide, losing which row you are on is losing the grid. One more column may
 * be frozen beside it — the subject, usually, which is the column that says what the
 * row *is*. Offsets are accumulated in drawn order rather than declared, so a column
 * moved by dragging cannot end up overlapping the one it now follows.
 */
export function stickyOffsets(drawn, meta) {
  const frozen = meta?.frozen ?? null;
  const offsets = {};
  let left = GUTTER_WIDTH;
  for (const column of drawn ?? []) {
    const isKey = String(column.name).toLowerCase() === ID_COLUMN;
    if (!isKey && column.name !== frozen) continue;
    offsets[column.name] = left;
    left += meta?.widths?.[column.name] ?? DEFAULT_WIDTH;
  }
  return offsets;
}

// -- what is selected ---------------------------------------------------------

/**
 * The rectangle between two cells, in table coordinates.
 *
 * Both ends are given as table row and column indices, but the rectangle is walked
 * in **display** order: the analyst who shift-clicks two cells means everything
 * between them on screen, and the file's own order may be nothing like it. Either
 * end having scrolled out of the filter collapses the range to the cursor rather
 * than selecting something nobody pointed at.
 */
export function cellRange(shown, drawn, anchor, cursor) {
  const only = { rows: [cursor?.row].filter((row) => row >= 0), columns: [cursor?.column].filter((column) => column >= 0) };
  if (!anchor || !cursor) return only;
  const columnsOrder = (drawn ?? []).map((column) => column.index);
  const top = shown.indexOf(anchor.row);
  const bottom = shown.indexOf(cursor.row);
  const left = columnsOrder.indexOf(anchor.column);
  const right = columnsOrder.indexOf(cursor.column);
  if (top === -1 || bottom === -1 || left === -1 || right === -1) return only;
  return {
    rows: shown.slice(Math.min(top, bottom), Math.max(top, bottom) + 1),
    columns: columnsOrder.slice(Math.min(left, right), Math.max(left, right) + 1),
  };
}

/** The cells of a range, as rows — what goes on the clipboard when a range is
 *  copied, in the order they are on screen. */
export function rangeValues(table, range) {
  return (range?.rows ?? []).map((row) =>
    (range?.columns ?? []).map((column) => table.rows[row]?.[column] ?? ''),
  );
}

/** The edits that copy a range's top row down over the rest of it. The gesture
 *  every grid has: state one answer, then say "and these too". */
export function fillDownEdits(table, range) {
  const [first, ...rest] = range?.rows ?? [];
  if (first === undefined || !rest.length) return [];
  return (range.columns ?? []).flatMap((column) =>
    fillEdits(table, column, rest, table.rows[first]?.[column] ?? ''),
  );
}

// -- what is ticked -----------------------------------------------------------

/** The keys of the rows on screen, in the order they are drawn. What "tick
 *  everything shown" means, and the answer to "is everything shown ticked". */
export function shownKeys(table, shown) {
  return (shown ?? []).map((index) => rowKey(table.columns, table.rows[index]));
}

/**
 * Every key from one row to another, in display order.
 *
 * Shift-click means "and everything between", and *between* is what the analyst can
 * see — the order the grid draws, not the order the file holds. Handing back the two
 * ends as well makes the gesture read the same whichever end was clicked first.
 */
export function keysBetween(table, shown, fromKey, toKey) {
  const keys = shownKeys(table, shown);
  const from = keys.indexOf(fromKey);
  const to = keys.indexOf(toKey);
  if (from === -1 || to === -1) return to === -1 ? [] : [toKey];
  return keys.slice(Math.min(from, to), Math.max(from, to) + 1);
}

// -- the scrollbars -----------------------------------------------------------
//
// The grid draws its own rather than using the browser's. Two reasons, and the
// second is the one that decided it: the app's chrome sets thin scrollbars
// everywhere, which is right for a panel that hints there is more below and wrong
// for a wide table where the bar *is* how you navigate; and on Linux — one of the
// three platforms shipped — the native bars are overlays that fade out, so half
// the time there is nothing on screen to grab.

/** The smallest thumb still worth aiming at, in pixels. */
const MIN_THUMB = 30;

/**
 * Where a scrollbar's thumb sits and how big it is, or null when nothing overflows.
 *
 * `travel` is how far the thumb may move, which is not the track length once the
 * thumb has a minimum size — the two diverge on a very long sheet, and using the
 * track length there makes the thumb run off the end.
 */
export function scrollThumb(track, content, offset, min = MIN_THUMB) {
  if (!(track > 0) || !(content > track)) return null;
  const size = Math.min(track, Math.max(min, Math.round((track * track) / content)));
  const travel = track - size;
  const maxScroll = content - track;
  const clamped = Math.min(Math.max(offset, 0), maxScroll);
  return {
    size,
    travel,
    maxScroll,
    position: travel > 0 ? Math.round((clamped / maxScroll) * travel) : 0,
  };
}

/** The scroll offset a thumb dragged to `position` pixels along its track means. */
export function scrollFromThumb(thumb, position) {
  if (!thumb || thumb.travel <= 0) return 0;
  const clamped = Math.min(Math.max(position, 0), thumb.travel);
  return Math.round((clamped / thumb.travel) * thumb.maxScroll);
}
