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

import {
  ROW_COLOURS,
  cellChips,
  compareSortKeys,
  isChipped,
  parseNumber,
  parseWhen,
  readsCell,
  sortKey,
  sortsByRole,
  valueTotals,
} from './sheetRoles.js';

/** The column holding each row's identity. Mirrors `engine/sheets.ID_COLUMN`. */
export const ID_COLUMN = 'id';

/**
 * What one sheet may hold. Mirrors `engine/sheets.MAX_ROWS` and `MAX_COLUMNS`, which
 * are the bounds that actually hold — these are here so the grid can refuse the gesture
 * instead of letting the save carry the news.
 *
 * It used to only be the server's business, and the failure that produced was the worst
 * shape available: the analyst pasted eight hundred rows onto a full sheet, the grid took
 * them, and then every autosave from that moment on answered 422. The work was on screen,
 * unsaved, and the only way out was to guess how much to delete.
 */
export const MAX_ROWS = 20_000;
export const MAX_COLUMNS = 64;

/**
 * Whether a table with this much more in it would still be one the file can hold.
 *
 * Returns null when there is room, and otherwise the sentence to say. Asked *before* the
 * edit, by every gesture that grows the sheet, because the honest moment to refuse a
 * paste is while the analyst still has it on the clipboard.
 */
export function tooBigBy(table, { rows = 0, columns = 0 } = {}) {
  const willRows = (table?.rows?.length ?? 0) + rows;
  const willColumns = (table?.columns?.length ?? 0) + columns;
  if (willColumns > MAX_COLUMNS) {
    return `A sheet holds ${MAX_COLUMNS} columns, and this one already has ${table.columns.length}.`;
  }
  if (willRows > MAX_ROWS) {
    const room = Math.max(0, MAX_ROWS - (table?.rows?.length ?? 0));
    return room
      ? `A sheet holds ${MAX_ROWS.toLocaleString()} rows, so there is room for ${room.toLocaleString()} more.`
      : `This sheet is full at ${MAX_ROWS.toLocaleString()} rows.`;
  }
  return null;
}

/** The colours the grid offers, for a row and for a value's chip alike. Defined next door
 *  because the vocabulary editor validates against it and this module is the one that
 *  imports that one; re-exported here so every existing caller is unaffected. */
export { ROW_COLOURS } from './sheetRoles.js';

/** Past this many distinct values a column is prose, not a set of answers: no
 *  chips, no value menu. Same idea as the Board's bound on offered facet values. */
const MAX_CHOICE_VALUES = 40;

/** The sidecar shape written today. Mirrors `engine/sheets.META_VERSION`: version 2 is
 *  where roles arrive, the first thing the sidecar knows that changes what a cell
 *  *means* rather than how it looks; version 3 adds what a cell said when the case took
 *  it, which is what lets a promoted row say it has moved on since; version 4 adds the
 *  **question** — the search and the filters — with the colour legend, the pinned row and
 *  the row height, so a sheet reopens on the reading it was left on. */
export const META_VERSION = 4;

export function emptyMeta() {
  return {
    version: META_VERSION,
    widths: {},
    hidden: [],
    sort: null,
    colours: {},
    links: {},
    frozen: null,
    roles: {},
    notes: {},
    progress: null,
    promoted: {},
    query: '',
    filters: {},
    legend: {},
    pinned: null,
    tall: false,
  };
}

/** How tall a row is drawn, in pixels: one line, or the four a note needs. Fixed either
 *  way, because only the rows on screen are in the DOM and the arithmetic that decides
 *  which those are is one division. */
export const ROW_HEIGHTS = { short: 30, tall: 78 };

export function rowHeight(meta) {
  return meta?.tall ? ROW_HEIGHTS.tall : ROW_HEIGHTS.short;
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
/**
 * The collator the whole grid sorts words with, built once.
 *
 * `localeCompare(other, undefined, options)` builds one of these **per call**. A sort
 * asks around a quarter of a million comparisons on a full sheet, and almost all of them
 * land here: a status column holds four words over twenty thousand rows, so the role
 * settles nothing and the words decide. Measured at 3.8 s of collator building per pass
 * against 92 ms once it is shared.
 */
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function compareCells(a, b) {
  const left = String(a ?? '');
  const right = String(b ?? '');
  // Cheap and by far the commonest exit: two rows agreeing on the key being sorted.
  if (left === right) return 0;
  const [x, y] = [asNumber(left), asNumber(right)];
  if (x !== null && y !== null) return x === y ? 0 : x < y ? -1 : 1;
  return COLLATOR.compare(left, right);
}

/**
 * One row as the lowercase text the search reads, cached against the row itself.
 *
 * The cache is what makes a search over twenty thousand rows typeable rather than a
 * stutter per keystroke: joining and folding a fourteen-column row allocates two strings,
 * and the old code did that for every row on every letter. A `WeakMap` keyed on the row
 * array needs no invalidation — every edit in this module builds a **new** row array, so
 * an edited row simply misses and a deleted one is collected.
 */
const HAYSTACK = new WeakMap();

function rowText(row) {
  if (!row) return '';
  const held = HAYSTACK.get(row);
  if (held !== undefined) return held;
  const text = row.join('\n').toLowerCase();
  HAYSTACK.set(row, text);
  return text;
}

/** A typed query cut into the words every row has to answer. Split once by the
 *  caller that sweeps a column, rather than once per row: on twenty thousand rows
 *  it was twenty thousand regex splits per keystroke. */
export function searchTerms(query) {
  return String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** Whether one row answers the typed terms. Every term has to appear somewhere in the
 *  row, matching the Board's rule so one box does not behave two ways. Takes the terms
 *  already split, because the caller sweeping a column splits them once. */
export function answersTerms(row, terms) {
  if (!terms.length) return true;
  const text = rowText(row);
  return terms.every((term) => text.includes(term));
}

/**
 * One cell cut into the parts the search matched and the parts it did not.
 *
 * A grid that filters to 23 rows out of 1 204 and then leaves the analyst to find the
 * word in each of them has done half the job — on a fourteen-column binder the match is
 * often in a column that is off screen. Every term is marked, overlaps included, which is
 * why this walks a mask rather than splitting on a pattern: `quai` and `quais` both
 * matching one word must not produce two nested marks.
 */
export function highlightParts(value, query) {
  const text = String(value ?? '');
  const terms = String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!text || !terms.length) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const marked = new Array(text.length).fill(false);
  for (const term of terms) {
    let at = lower.indexOf(term);
    while (at !== -1) {
      for (let index = at; index < at + term.length; index += 1) marked[index] = true;
      at = lower.indexOf(term, at + 1);
    }
  }
  const parts = [];
  let start = 0;
  for (let index = 1; index <= text.length; index += 1) {
    if (index === text.length || marked[index] !== marked[start]) {
      parts.push({ text: text.slice(start, index), hit: marked[start] });
      start = index;
    }
  }
  return parts;
}

// -- what is asked of a column ------------------------------------------------
//
// A chosen value answers "which ones say this". The other questions an analyst asks
// of a worklist are "which ones have nothing here yet", "which ones mention this"
// and "which ones do not", and none of them is a value: `To be found`, `-`, `?` and
// an empty cell all mean the same thing to the person filtering, and no list of
// values catches them. So a column's filter is a small record rather than a set, and
// the four parts read together.
//
// `contains` is the one a prose column has nothing else to offer. Past
// `MAX_CHOICE_VALUES` distinct values there is no list to tick, so a column of
// sources or of notes could be *excluded* by a word and never *kept* by one — the
// half of the question that was missing.

/** What a column can be asked about its cells, beyond which values they hold. `unreadable`
 *  is the one a permissive role owes the analyst: a column that accepts `about 12` has to
 *  be able to show which cells that is. */
const FILL_ASKS = ['blank', 'filled', 'unreadable'];

/** One column's filter, in the one shape the rest of this module reads. A bare Set
 *  is accepted because chosen values are the common case and the caller that only
 *  has those should not have to build a record; a plain **array** is accepted because
 *  that is the shape the sidecar holds, JSON having no set. */
export function normalizeFilter(entry) {
  if (!entry) return null;
  if (entry instanceof Set) {
    return { ...noFilter(), values: entry.size ? entry : null };
  }
  const held = Array.isArray(entry.values) ? new Set(entry.values) : entry.values;
  const values = held instanceof Set && held.size ? held : null;
  const fill = FILL_ASKS.includes(entry.fill) ? entry.fill : null;
  return {
    values,
    fill,
    contains: String(entry.contains ?? ''),
    without: String(entry.without ?? ''),
    from: String(entry.from ?? ''),
    to: String(entry.to ?? ''),
  };
}

/** The blank filter every editing function starts from, so none of them has to
 *  restate the parts a column can be asked about. */
function noFilter() {
  return { values: null, fill: null, contains: '', without: '', from: '', to: '' };
}

export function isFilterActive(entry) {
  const filter = normalizeFilter(entry);
  return Boolean(
    filter &&
      (filter.values || filter.fill || filter.contains || filter.without || filter.from || filter.to),
  );
}

/**
 * A cell as the one number a range is compared on, or null when it holds nothing a
 * range can order.
 *
 * The column's own lens decides what that number is: a date column compares moments, a
 * number column compares numbers, and a column that declares nothing still answers when
 * its cells are plainly numbers — a distance typed into a fresh column is a distance
 * before anybody gets around to declaring it one.
 */
function rangeValue(cell, role) {
  const body = String(cell ?? '').trim();
  if (!body) return null;
  if (role?.kind === 'when') return parseWhen(body, role)?.key ?? null;
  return parseNumber(body);
}

/**
 * Whether one cell answers one column's filter. Every part has to hold: they are
 * clauses of one question, not alternatives.
 *
 * The role is what makes a **list** column filterable at all. `Buk-M2E, ZU23-2` is two
 * answers in one cell, and comparing the whole cell against a chosen value found neither
 * of them — so clicking a chip in the grid narrowed the sheet to nothing. With the role,
 * a cell matches when *any* of its values was asked for, which is what a chip means. A
 * quantity is not part of the value: `2x S-125` answers `S-125`.
 */
export function matchesFilter(cell, entry, role = null) {
  const filter = normalizeFilter(entry);
  if (!filter) return true;
  const value = String(cell ?? '');
  if (filter.values) {
    const held = isChipped(role)
      ? cellChips(value, role).map((chip) => chip.value)
      : [value];
    // A cell holding nothing answers the blank entry of the value list, which is what
    // the menu offers it as.
    const answers = held.length ? held : [''];
    if (!answers.some((held_) => filter.values.has(held_))) return false;
  }
  if (filter.fill === 'blank' && !isBlank(value)) return false;
  if (filter.fill === 'filled' && isBlank(value)) return false;
  if (filter.fill === 'unreadable' && (isBlank(value) || readsCell(role, value))) return false;
  // Both read the cell as it is written, not as the role reads it: a word asked for
  // in a column of sources is looked for in what the file says.
  if (filter.contains && !value.toLowerCase().includes(filter.contains.toLowerCase())) return false;
  if (filter.without && value.toLowerCase().includes(filter.without.toLowerCase())) return false;
  // A bound is the question a list of values cannot ask: *before this date*, *under
  // five kilometres*. A cell the column cannot read as a quantity is out — including an
  // empty one, because "no answer yet" is not below a bound, it is unknown.
  if (filter.from || filter.to) {
    const held = rangeValue(value, role);
    if (held === null) return false;
    const low = rangeValue(filter.from, role);
    const high = rangeValue(filter.to, role);
    if (low !== null && held < low) return false;
    if (high !== null && held > high) return false;
  }
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
  const filter = normalizeFilter(filters?.[column]) ?? noFilter();
  const values = new Set(filter.values ?? []);
  if (!values.delete(value)) values.add(value);
  return withFilter(filters, column, { ...filter, values });
}

/** Keep only the rows holding this value, whatever else was asked of the column.
 *  What a cell offers: the answer under the pointer is the whole question, so a
 *  second value ticked in the menu is not carried along with it. */
export function onlyFilterValue(filters, column, value) {
  return withFilter(filters, column, { ...noFilter(), values: new Set([value]) });
}

/** Ask for blank or for filled, or ask again to stop asking. */
export function toggleFilterFill(filters, column, fill) {
  const filter = normalizeFilter(filters?.[column]) ?? noFilter();
  return withFilter(filters, column, { ...filter, fill: filter.fill === fill ? null : fill });
}

export function setFilterContains(filters, column, term) {
  const filter = normalizeFilter(filters?.[column]) ?? noFilter();
  return withFilter(filters, column, { ...filter, contains: String(term ?? '').trim() });
}

export function setFilterWithout(filters, column, term) {
  const filter = normalizeFilter(filters?.[column]) ?? noFilter();
  return withFilter(filters, column, { ...filter, without: String(term ?? '').trim() });
}

/** Ask a column for what falls between two bounds. Either end alone is a question of
 *  its own — *after March*, *under 5* — so neither is required. */
export function setFilterRange(filters, column, { from, to } = {}) {
  const filter = normalizeFilter(filters?.[column]) ?? noFilter();
  return withFilter(filters, column, {
    ...filter,
    from: from === undefined ? filter.from : String(from ?? '').trim(),
    to: to === undefined ? filter.to : String(to ?? '').trim(),
  });
}

export function clearFilter(filters, column) {
  const next = { ...(filters ?? {}) };
  delete next[column];
  return next;
}

/** Ask nothing of any column. One press, because a reading built out of six clauses took
 *  six presses to put down and the analyst who wants the whole sheet back wants it now. */
export function clearFilters() {
  return {};
}

// -- the question, written down -----------------------------------------------
//
// The sort and the hidden columns were always in the sidecar and the filters were not,
// which made the sheet reopen showing all four hundred rows: half a reading survived and
// the half that decides what is on screen died with the tab.
//
// The only difference between the two shapes is the chosen values: a `Set` while the grid
// is matching cells against it, a list in the file, because JSON has no set. Both
// directions are here, next to each other, so neither can be written from memory.

/** The filters as the sidecar holds them: lists rather than sets, empty clauses dropped. */
export function serializeFilters(filters) {
  const out = {};
  for (const [column, entry] of Object.entries(filters ?? {})) {
    const filter = normalizeFilter(entry);
    if (!filter || !isFilterActive(filter)) continue;
    out[column] = {
      values: [...(filter.values ?? [])],
      fill: filter.fill,
      contains: filter.contains,
      without: filter.without,
      from: filter.from,
      to: filter.to,
    };
  }
  return out;
}

/** And back: what the grid matches rows against, out of what the file held. Columns the
 *  table no longer has are dropped here rather than left to fail per cell. */
export function readFilters(stored, columns) {
  const known = new Set(columns ?? []);
  const out = {};
  for (const [column, entry] of Object.entries(stored ?? {})) {
    if (columns && !known.has(column)) continue;
    const filter = normalizeFilter(entry);
    if (filter && isFilterActive(filter)) out[column] = filter;
  }
  return out;
}

/** Move what is asked of one column onto its new name, or drop it. What a rename owes a
 *  filter: the rows on screen must not change because a heading was spelled again. */
export function renameFilterColumn(filters, from, to) {
  if (!(from in (filters ?? {}))) return { ...(filters ?? {}) };
  const next = { ...filters };
  const entry = next[from];
  delete next[from];
  if (to) next[to] = entry;
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
        label: { blank: 'empty', filled: 'not empty', unreadable: 'to check' }[filter.fill],
      });
    }
    if (filter.contains) {
      chips.push({
        column,
        part: 'contains',
        value: filter.contains,
        label: `with ${filter.contains}`,
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
    if (filter.from) {
      chips.push({ column, part: 'from', value: filter.from, label: `from ${filter.from}` });
    }
    if (filter.to) {
      chips.push({ column, part: 'to', value: filter.to, label: `to ${filter.to}` });
    }
    return chips;
  });
}

/** Remove exactly what one chip shows, leaving the column's other clauses alone. */
export function dropChip(filters, chip) {
  if (chip?.part === 'value') return toggleFilterValue(filters, chip.column, chip.value);
  if (chip?.part === 'fill') return toggleFilterFill(filters, chip.column, chip.value);
  if (chip?.part === 'contains') return setFilterContains(filters, chip.column, '');
  if (chip?.part === 'without') return setFilterWithout(filters, chip.column, '');
  if (chip?.part === 'from') return setFilterRange(filters, chip.column, { from: '' });
  if (chip?.part === 'to') return setFilterRange(filters, chip.column, { to: '' });
  return filters;
}

/** How one column's filter reads in a line, or an empty string when nothing is asked
 *  of it. The setup panel says this rather than offering the filter a second time. */
export function filterSummary(entry) {
  return filterChips({ column: entry })
    .map((chip) => chip.label)
    .join(' · ');
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
  const { query = '', filters = {}, sort = null, roles = null } = view;
  // Compiled once per column rather than once per cell. `matchesFilter` normalises
  // whatever it is handed, and handing it a raw record for each of twenty thousand rows
  // rebuilt the same six-field object twenty thousand times.
  const active = Object.entries(filters)
    .filter(([, entry]) => isFilterActive(entry))
    .map(([name, entry]) => ({
      at: columns.indexOf(name),
      filter: normalizeFilter(entry),
      role: roles?.[name] ?? null,
    }))
    .filter((asked) => asked.at !== -1);

  const terms = searchTerms(query);
  let indices = rows
    .map((row, index) => index)
    .filter((index) => answersTerms(rows[index], terms))
    .filter((index) =>
      active.every((asked) => matchesFilter(rows[index][asked.at], asked.filter, asked.role)),
    );

  // One key, then the one under it. "By status, then by date" is how a worklist is read,
  // and with a single key the analyst re-sorted by hand every time the first one tied.
  const keys = [sort, sort?.then]
    .filter(Boolean)
    .map((key) => ({
      at: columns.indexOf(key.column),
      direction: key.desc ? -1 : 1,
      // What the column knows, when it knows anything. A declared role is the whole
      // reason a `dd/MM/yyyy` column stops sorting `01/02` before `31/01`, and it is the
      // most visible thing a role buys — so the comparison asks the role first and falls
      // back to reading the words only where the role has nothing to say.
      role: roles?.[key.column] ?? null,
    }))
    .filter((key) => key.at !== -1);

  if (keys.length) {
    // What each key is worth, read **once per row** before anything is compared.
    //
    // The comparison used to read the cell itself, which put `parseWhen` inside the
    // comparator: two calls per comparison, so a hundred and twelve thousand on a full
    // sheet — and again on every keystroke, because this view is derived from the table
    // and every edit rebuilds it. Measured at 802 ms per pass on twenty thousand rows,
    // 1.1 s with a second key; reading the keys first brings it to 46 ms.
    //
    // Only the roles that order anything are read. A `choice` column has no ranking, so
    // decorating it would be a pass over the sheet whose answer is thrown away.
    const decorated = keys.map((key) =>
      sortsByRole(key.role) ? rows.map((row) => sortKey(key.role, row[key.at])) : null,
    );
    indices = indices
      .map((index, order) => ({ index, order }))
      .sort((a, b) => {
        for (let at = 0; at < keys.length; at += 1) {
          const key = keys[at];
          const left = rows[a.index][key.at];
          const right = rows[b.index][key.at];
          // Blank sinks whichever way the arrow points, and two blanks fall through to
          // the next key: "no answer yet" is not a tie worth stopping on.
          if (isBlank(left) || isBlank(right)) {
            if (isBlank(left) && isBlank(right)) continue;
            return isBlank(left) ? 1 : -1;
          }
          const read = decorated[at];
          const byRole = read ? compareSortKeys(read[a.index], read[b.index]) : null;
          const cells = byRole ?? compareCells(left, right);
          if (cells !== 0) return cells * key.direction;
        }
        // Stable: two rows equal on every key keep the order the file has them in.
        return a.order - b.order;
      })
      .map((entry) => entry.index);
  }
  return indices;
}

/**
 * The distinct values of one column with their counts, commonest first, narrowed to a
 * typed word and cut to a page.
 *
 * A column that is a **list** is counted value by value: `Buk-M2E, ZU23-2` is two
 * answers, and a menu offering the pair as one entry offers something no other row will
 * ever match. `rows` is how many rows hold the value, which is what the filter hands
 * back.
 *
 * A column of a hundred and twenty cities used to answer **nothing at all** past forty
 * distinct values — the menu said "too many to list" and the analyst was left with a
 * word box. So the cut is now a page rather than a wall: the commonest are listed, the
 * total says how many there are, and typing narrows the list against the whole column
 * rather than against the page.
 */
export function columnValues(table, name, role = null, { term = '', limit = MAX_CHOICE_VALUES } = {}) {
  const at = (table?.columns ?? []).indexOf(name);
  if (at === -1) return null;
  const all = isChipped(role)
    ? valueTotals(table, at, role)
    : (() => {
        const counts = new Map();
        for (const row of table.rows ?? []) {
          const value = String(row[at] ?? '');
          counts.set(value, (counts.get(value) ?? 0) + 1);
        }
        return [...counts.entries()]
          .map(([value, rows]) => ({ value, rows }))
          .sort((a, b) => b.rows - a.rows || compareCells(a.value, b.value));
      })();
  const wanted = String(term ?? '').trim().toLowerCase();
  const matching = wanted
    ? all.filter((entry) => entry.value.toLowerCase().includes(wanted))
    : all;
  return {
    values: matching.slice(0, Math.max(1, limit)),
    matching: matching.length,
    total: all.length,
    capped: matching.length > Math.max(1, limit),
  };
}

// -- edits --------------------------------------------------------------------
//
// Every one of these returns a new table (and a new sidecar where a rename moves
// what the sidecar keyed on a column name). Nothing mutates: the undo stack
// snapshots what these return, and a mutating edit would rewrite its own history.

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

/** A blank row placed *at* an index rather than at the end. What "insert above" means,
 *  and the reason it exists: a worklist gets a line added where the analyst is reading,
 *  and a row appended four hundred rows below is a row they then have to drag back. */
export function insertRow(table, at, key = newKey()) {
  const cells = table.columns.map((_, index) => (index === keyIndex(table.columns) ? key : ''));
  const rows = [...table.rows];
  rows.splice(Math.max(0, Math.min(at, rows.length)), 0, cells);
  return { ...table, rows };
}

/**
 * Copy rows, each one landing right under the row it came from, with a key of its own.
 *
 * The gesture behind it is a candidate that turns out to be two: the same address checked
 * against two hypotheses, the same photo geolocated twice. The copy carries the cells and
 * nothing the sidecar hangs on the original — a colour is a mark on *that* row's work, and
 * a link is the case's answer about it, so a duplicate that inherited both would claim
 * work that was never done on it.
 */
export function duplicateRows(table, indices) {
  const wanted = [...new Set(indices ?? [])].filter((index) => table.rows[index]).sort((a, b) => a - b);
  if (!wanted.length) return { table, keys: [] };
  const rows = [...table.rows];
  const keys = [];
  const at = keyIndex(table.columns);
  for (const index of [...wanted].reverse()) {
    const key = newKey();
    const copy = [...table.rows[index]];
    copy[at] = key;
    rows.splice(index + 1, 0, copy);
    keys.unshift(key);
  }
  return { table: { ...table, rows }, keys };
}

export function removeRows(table, indices) {
  const drop = new Set(indices);
  return { ...table, rows: table.rows.filter((_, index) => !drop.has(index)) };
}

/**
 * Fold several rows into the first of them, cell by cell.
 *
 * The other half of "this value is said twice". The grid could already *find* the rows
 * holding one value and paint them, and then left the analyst to retype one row out of
 * three and delete two — on an imported inbox where the same address arrives from three
 * channels, that is the whole job.
 *
 * The rule is **the fullest answer wins**, per column: the longest text of the rows being
 * folded, which is what "one of these three actually wrote the city down" looks like. It
 * is not a merge of *facts* — nothing here decides that `Kherson` and `Cherson` are one
 * place — so what it can lose is only a shorter version of a cell that already agreed.
 * The surviving row keeps its own key, and with it its colour, its links and its promotion
 * record; the rows folded into it go.
 */
export function mergeRows(table, indices) {
  const wanted = [...new Set(indices ?? [])].filter((index) => table.rows[index]).sort((a, b) => a - b);
  if (wanted.length < 2) return { table, key: null, folded: 0 };
  const [keep, ...rest] = wanted;
  const at = keyIndex(table.columns);
  const merged = table.columns.map((_, column) => {
    if (column === at) return table.rows[keep][column];
    let best = '';
    for (const index of wanted) {
      const cell = String(table.rows[index][column] ?? '');
      if (cell.trim().length > best.trim().length) best = cell;
    }
    return best;
  });
  const drop = new Set(rest);
  return {
    table: {
      ...table,
      rows: table.rows
        .map((row, index) => (index === keep ? merged : row))
        .filter((_, index) => !drop.has(index)),
    },
    key: rowKey(table.columns, table.rows[keep]),
    folded: rest.length,
  };
}

/**
 * One cell's values as one row each, the rest of the row copied down.
 *
 * The inverse of the merge and the shape every "to be sorted" inbox arrives in: one row
 * holding five links, or a cell reading `Buk-M2E, ZU23-2, S-300` in a worklist that wants
 * a line per system. Splitting a column into *columns* was already here and answers a
 * different question — a column of `city, country` is two columns, a cell of five sources
 * is five rows.
 *
 * The first value stays on the original row, so its colour, its links and its key survive;
 * the rest are fresh rows with fresh keys, placed directly under it, carrying no sidecar
 * of their own — none of that work has been done on them yet.
 */
export function explodeRow(table, rowIndex, columnIndex, separator = '\n') {
  const row = table.rows[rowIndex];
  if (!row || columnIndex === keyIndex(table.columns)) return { table, keys: [] };
  const parts = String(row[columnIndex] ?? '')
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return { table, keys: [] };
  const at = keyIndex(table.columns);
  const first = row.map((cell, index) => (index === columnIndex ? parts[0] : cell));
  const keys = [];
  const made = parts.slice(1).map((part) => {
    const key = newKey();
    keys.push(key);
    return row.map((cell, index) => {
      if (index === at) return key;
      return index === columnIndex ? part : cell;
    });
  });
  const rows = [...table.rows];
  rows.splice(rowIndex, 1, first, ...made);
  return { table: { ...table, rows }, keys };
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
 * A column placed *at* an index, cells and all.
 *
 * The one the grid was missing: a sheet grows a column beside the one being worked on —
 * a verdict next to the claim it judges — and the only way to get one there was to add it
 * at the far right and drag it back across twelve headings.
 */
export function insertColumn(table, at, name, values = []) {
  const heading = freeColumnName(table.columns, name || 'Column');
  const where = Math.max(0, Math.min(at, table.columns.length));
  const columns = [...table.columns];
  columns.splice(where, 0, heading);
  return {
    columns,
    rows: table.rows.map((row, index) => {
      const cells = [...row];
      cells.splice(where, 0, String(values[index] ?? ''));
      return cells;
    }),
  };
}

/**
 * A column copied beside itself, with what the sidecar knows about it.
 *
 * The width, the role and the note travel because they are what the column *is*, and a
 * copy made to be rewritten wants the same lens as the original. The links do not: a link
 * is the case's answer about one cell, and two cells claiming the same entity would be one
 * `mentions` edge stated twice by a copy nobody has read yet.
 */
export function duplicateColumn(table, meta, index) {
  const previous = table.columns[index];
  if (previous === undefined) return { table, meta, name: null };
  const grown = insertColumn(
    table,
    index + 1,
    `${previous} copy`,
    table.rows.map((row) => row[index]),
  );
  const name = grown.columns[index + 1];
  const next = { ...emptyMeta(), ...meta };
  const width = meta?.widths?.[previous];
  if (width !== undefined) next.widths = { ...(next.widths ?? {}), [name]: width };
  const role = meta?.roles?.[previous];
  if (role) next.roles = { ...(next.roles ?? {}), [name]: { ...role } };
  const note = meta?.notes?.[previous];
  if (note) next.notes = { ...(next.notes ?? {}), [name]: note };
  return { table: grown, meta: next, name };
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

/**
 * Move everything the sidecar keyed on `from` onto `to`, or drop it when `to` is null.
 *
 * *Everything* is the word that cost something. This moved five of the nine keys — the
 * width, the hidden flag, the sort, the frozen column and the links — and silently left
 * behind the four that say what the column **is**: its role, its note, whether the sheet
 * counts its progress there, and what its cells said when the case took them. So renaming
 * `Status` to `État` lost its type, the panel then offered a *detected* one from the
 * cells, and the analyst read that as the type having changed by itself. On the next save
 * the four were cleaned away for good, and the read reported the role as dropped — a
 * message written for a column renamed in a spreadsheet, fired by a rename made here.
 *
 * One helper per shape, because there are only three: a table keyed by column name, a
 * table of rows each keyed by column name, and a lone name.
 */
function remapColumn(meta, from, to) {
  const next = { ...emptyMeta(), ...meta };

  // Keyed by column name: width, role, note, and what is asked of the column.
  for (const key of ['widths', 'roles', 'notes', 'filters']) {
    next[key] = moveKey(next[key], from, to);
  }
  // Keyed by row, then by column name: the promotion's record of what a cell said.
  next.promoted = Object.fromEntries(
    Object.entries(next.promoted ?? {})
      .map(([key, cells]) => [key, moveKey(cells, from, to)])
      .filter(([, cells]) => Object.keys(cells).length),
  );
  next.links = Object.fromEntries(
    Object.entries(next.links ?? {})
      .map(([key, cells]) => [key, moveKey(cells, from, to)])
      .filter(([, cells]) => Object.keys(cells).length),
  );

  const hidden = (next.hidden ?? []).filter((name) => name !== from);
  if (to && (meta?.hidden ?? []).includes(from)) hidden.push(to);
  next.hidden = hidden;
  if (next.sort?.column === from) {
    next.sort = to ? { ...next.sort, column: to } : null;
  }
  if (next.sort?.then?.column === from) {
    if (to) next.sort = { ...next.sort, then: { ...next.sort.then, column: to } };
    else {
      const { then: _dropped, ...rest } = next.sort;
      next.sort = rest;
    }
  }
  if (next.frozen === from) next.frozen = to ?? null;
  // Which column the footer counts the work on. Lost on a rename, it left the sheet with
  // no progress reading and no sign of why.
  if (next.progress === from) next.progress = to ?? null;
  return next;
}

/** One table keyed by column name, with `from`'s entry moved to `to` or dropped. */
function moveKey(table, from, to) {
  const next = { ...(table ?? {}) };
  if (!(from in next)) return next;
  const held = next[from];
  delete next[from];
  if (to) next[to] = held;
  return next;
}

/** A heading with its spelling taken out of it, for lining two sheets up. */
function foldHeading(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Which column of this sheet belongs in which column of that one.
 *
 * The opening proposal of a move, and every line of it is a select the analyst can
 * overrule. The server used to match on the name alone and drop the rest, so a column
 * written `local_time` at one end and `Local time` at the other was a silent loss the
 * analyst read about in the toast, after the rows had left.
 *
 * An exact name is taken as an answer. A name that differs only in how it is written —
 * case, accents, the space against the underscore — is proposed as a **guess** and says
 * so, because a guess that looks like a match is worse than no proposal. Nothing further
 * is attempted: `Time` onto `Local time` is right about as often as it is wrong, and that
 * one is the analyst's to point. One target is taken once, since two columns poured into
 * one would lose the second.
 */
export function suggestMapping(mine, theirs) {
  const ours = (mine ?? []).filter((name) => String(name).toLowerCase() !== ID_COLUMN);
  const free = (theirs ?? []).filter((name) => String(name).toLowerCase() !== ID_COLUMN);
  const taken = new Set();
  const pairs = ours.map((name) => ({ name, to: '', guessed: false }));

  for (const pair of pairs) {
    const exact = free.find((name) => name === pair.name && !taken.has(name));
    if (exact) {
      pair.to = exact;
      taken.add(exact);
    }
  }
  // A second pass, so an exact match is never spent on a fold: `Address` and `Adresse`
  // both fold to the same thing, and the one spelled the same way has first claim.
  for (const pair of pairs) {
    if (pair.to) continue;
    const folded = foldHeading(pair.name);
    if (!folded) continue;
    const near = free.find((name) => !taken.has(name) && foldHeading(name) === folded);
    if (!near) continue;
    pair.to = near;
    pair.guessed = true;
    taken.add(near);
  }
  return pairs;
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

/** Every entity this sidecar points at: the cells that link, the words a column means
 *  in the case, the files rows carry. Mirrors `engine/sheets.linked_entity_ids`. */
export function linkedEntityIds(meta) {
  const found = [];
  for (const cells of Object.values(meta?.links ?? {})) found.push(...Object.values(cells ?? {}));
  for (const words of Object.values(meta?.values ?? {})) found.push(...Object.values(words ?? {}));
  for (const held of Object.values(meta?.attachments ?? {})) found.push(...(held ?? []));
  return [...new Set(found.filter(Boolean).map(String))];
}

/**
 * The sidecar with every pointer at one of `gone` removed, or the same object back when
 * it held none.
 *
 * The delete already cleared the file (`engine/sheets.forget_entities`); this clears the
 * copy on screen, which is the copy the next save would otherwise write the dead ids
 * back from. Same three places, so a cell, a column's vocabulary and a row's files all
 * stop pointing at material the case no longer holds.
 */
export function withoutEntities(meta, gone) {
  if (!gone?.size) return meta;
  const held = (value) => !gone.has(String(value));
  let hit = false;

  const links = {};
  for (const [key, cells] of Object.entries(meta?.links ?? {})) {
    const kept = Object.fromEntries(Object.entries(cells ?? {}).filter(([, id]) => held(id)));
    if (Object.keys(kept).length !== Object.keys(cells ?? {}).length) hit = true;
    if (Object.keys(kept).length) links[key] = kept;
  }

  const values = {};
  for (const [name, words] of Object.entries(meta?.values ?? {})) {
    const kept = Object.fromEntries(Object.entries(words ?? {}).filter(([, id]) => held(id)));
    if (Object.keys(kept).length !== Object.keys(words ?? {}).length) hit = true;
    if (Object.keys(kept).length) values[name] = kept;
  }

  const attachments = {};
  for (const [key, list] of Object.entries(meta?.attachments ?? {})) {
    const kept = (list ?? []).filter(held);
    if (kept.length !== (list ?? []).length) hit = true;
    if (kept.length) attachments[key] = kept;
  }

  return hit ? { ...emptyMeta(), ...meta, links, values, attachments } : meta;
}

/**
 * What a colour means in this sheet.
 *
 * Six colours with nothing written against them is six colours whose meaning lives in one
 * analyst's head — and a case is handed over. Kept in the sidecar rather than in the file
 * because the colour is: losing both together costs presentation, which is the deal the
 * sidecar is under.
 */
export function setLegend(meta, colour, label) {
  const legend = { ...(meta?.legend ?? {}) };
  const text = String(label ?? '').trim();
  if (text && ROW_COLOURS.includes(colour)) legend[colour] = text;
  else delete legend[colour];
  return { ...emptyMeta(), ...meta, legend };
}

/**
 * Keep one row under the heading while the rest scrolls, or let it go.
 *
 * The reference candidate a comparison grid is read *against*: the confirmed sighting the
 * other eleven are being compared to, which otherwise scrolls away at row twelve and takes
 * the point of the grid with it. Keyed like a colour, so a re-sort cannot move it onto
 * somebody else's row.
 */
export function setPinned(meta, key) {
  const wanted = key && meta?.pinned !== key ? String(key) : null;
  return { ...emptyMeta(), ...meta, pinned: wanted };
}

/** One line per row, or the four a note needs. A grid of thirty-pixel rows is right for a
 *  worklist and wrong for the column the reasoning is written in. */
export function setTall(meta, tall) {
  return { ...emptyMeta(), ...meta, tall: Boolean(tall) };
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
 *  it rather than a second one to find. A second key already in place survives the
 *  cycle and goes with the sort when it is turned off — it is a tiebreak, not a sort. */
export function nextSort(sort, column) {
  if (sort?.column !== column) return { column, desc: false, ...(sort?.then ? { then: sort.then } : {}) };
  return sort.desc ? null : { ...sort, desc: true };
}

/**
 * Break the first key's ties with a second column: ascending, then descending, then not
 * at all.
 *
 * The same three states as a heading's own click, because it is the same question asked
 * one level down — and it is a **menu row** rather than a fourth state on the heading,
 * since "sort by this" and "sort by this too" one gesture apart would be a trap. Naming
 * the column the sort is already on clears the second key: one column cannot break its
 * own tie.
 */
export function nextSecondSort(sort, column) {
  if (!sort?.column) return sort ?? null;
  const drop = () => {
    const { then: _dropped, ...rest } = sort;
    return rest;
  };
  if (!column || column === sort.column) return drop();
  if (sort.then?.column !== column) return { ...sort, then: { column, desc: false } };
  return sort.then.desc ? drop() : { ...sort, then: { column, desc: true } };
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
