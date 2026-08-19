/**
 * The rewrites a sheet needs because its rows came from somewhere else.
 *
 * A binder that arrives by import is never in the shape the work wants: the city and the
 * country are in one cell, the coordinates are pasted with the label still attached, half
 * the names carry a trailing space that makes two values out of one, and the word the
 * analyst has decided to stop using is in four hundred cells. None of that is a filter,
 * a role or an edit — it is a **pass over the column**, and doing it by hand is how an
 * afternoon disappears.
 *
 * Six passes, and they are all the same shape underneath: given a table and which cells
 * to touch, hand back either a list of cell edits or a whole table. Which of the two says
 * everything about the pass — replacing a word changes cells, splitting a column changes
 * the table — and it is also what decides how the undo stack records it, so the caller
 * never has to guess.
 *
 * Nothing here reads a role and nothing here writes the file. A pass is the analyst
 * asking for an edit by name, which is the one thing that separates it from a lens: a
 * role never improves the file, and every one of these does.
 */

import { freeColumnName, insertColumn, keyIndex, linkLabel, removeColumn, urlsIn } from './sheet.js';

/** How many columns one split may produce. A cell that breaks into more parts than this
 *  is prose with punctuation in it, not a record with fields. */
export const MAX_PARTS = 8;

/**
 * One cell cut on a separator, into at most `MAX_PARTS` pieces.
 *
 * The last piece keeps whatever is left, separators and all, the way every maxsplit in
 * every language does it. Dropping the tail instead is what a split of a twelve-segment
 * cell used to do: four segments went nowhere, and with "keep this column too" unticked the
 * original was deleted after them, so the words were gone from the file with nothing said.
 * Nothing is lost now, and the preview's samples show the fat last cell.
 */
function pieces(cell, cut) {
  const parts = String(cell ?? '').split(cut);
  const held =
    parts.length <= MAX_PARTS
      ? parts
      : [...parts.slice(0, MAX_PARTS - 1), parts.slice(MAX_PARTS - 1).join(cut)];
  return held.map((piece) => piece.trim());
}

/** The ways a column's words can be recased. `title` is the one an imported binder wants
 *  most: a column of SHOUTED place names is unreadable beside the analyst's own. */
export const CASINGS = ['upper', 'lower', 'title'];

/** The cells a pass may write: everything but the row's handle, which is the case's. */
function writableColumns(table, columns) {
  const key = keyIndex(table.columns);
  return [...new Set(columns ?? [])].filter(
    (index) => index !== key && index >= 0 && index < table.columns.length,
  );
}

/** One edit per cell that actually changes, which is what keeps an undo step honest:
 *  a pass over four hundred rows that rewrote two of them undoes those two. */
function edits(table, columns, rows, rewrite) {
  const made = [];
  for (const column of writableColumns(table, columns)) {
    for (const row of rows ?? []) {
      const before = table.rows[row]?.[column];
      if (before === undefined) continue;
      const after = rewrite(String(before), row, column);
      if (after !== undefined && after !== before) made.push({ row, column, before, after });
    }
  }
  return made;
}

/**
 * Find a word and write another in its place.
 *
 * Plain text rather than a pattern, deliberately: a regular expression in a box with no
 * preview is how a sheet loses a column, and the analyst reaching for one is reaching past
 * what this is for — `OK en cours` becoming `in progress` on the four hundred rows an
 * import arrived with.
 *
 * `wholeCell` is the difference between renaming a value and rewriting a substring:
 * `done` inside `undone` is not the value `done`, and a status column has to be able to
 * say so.
 */
export function replaceEdits(table, { columns, rows, find, replace = '', matchCase = false, wholeCell = false }) {
  const needle = String(find ?? '');
  if (!needle) return [];
  const written = String(replace ?? '');
  const compare = matchCase ? (text) => text : (text) => text.toLowerCase();
  const wanted = compare(needle);
  return edits(table, columns, rows, (before) => {
    if (wholeCell) return compare(before.trim()) === wanted ? written : before;
    const body = compare(before);
    if (!body.includes(wanted)) return before;
    let out = '';
    let at = 0;
    for (;;) {
      const found = body.indexOf(wanted, at);
      if (found === -1) break;
      out += before.slice(at, found) + written;
      at = found + needle.length;
    }
    return out + before.slice(at);
  });
}

/**
 * Take the spacing out.
 *
 * The pass that fixes the bug nobody sees: `Kherson ` and `Kherson` are two values in
 * every menu, two chips in every cell and two rows in every count, and the difference is
 * a character the grid cannot draw. Line breaks inside a cell survive — a note column is
 * why a cell may hold sentences.
 */
export function tidyEdits(table, columns, rows) {
  return edits(table, columns, rows, (before) =>
    before
      .split('\n')
      .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
      .join('\n')
      .trim(),
  );
}

/** A word with its first letter up and the rest down, applied per word. Hyphens and
 *  apostrophes start a word too, so `saint-jean` and `o'brien` come back right. */
function titleCase(text) {
  return text
    .toLowerCase()
    .replace(/(^|[\s\-–—'’(/.])(\p{L})/gu, (whole, lead, letter) => lead + letter.toUpperCase());
}

export function caseEdits(table, columns, rows, casing) {
  if (!CASINGS.includes(casing)) return [];
  return edits(table, columns, rows, (before) => {
    if (casing === 'upper') return before.toUpperCase();
    if (casing === 'lower') return before.toLowerCase();
    return titleCase(before);
  });
}

/**
 * What a split would produce, without producing it.
 *
 * Read before it is done, because a separator chosen wrong is a column turned into
 * confetti: the preview says how many parts the widest cell breaks into and shows the
 * first few, which is the difference between `Kherson, Ukraine` splitting on `,` and a
 * column of prose doing the same.
 *
 * `over` is how many cells hold more than `MAX_PARTS` segments, so the screen can say that
 * their tail lands in the last column instead of in one of its own.
 */
export function splitPreview(table, index, separator) {
  const cut = String(separator ?? '');
  if (!cut) return { parts: 0, rows: 0, samples: [], over: 0 };
  let parts = 0;
  let touched = 0;
  let over = 0;
  const samples = [];
  for (const row of table.rows ?? []) {
    const cell = String(row[index] ?? '');
    if (!cell.trim()) continue;
    const held = pieces(cell, cut);
    if (held.length > 1) {
      touched += 1;
      parts = Math.max(parts, held.length);
      if (cell.split(cut).length > MAX_PARTS) over += 1;
      if (samples.length < 3) samples.push(held);
    }
  }
  return { parts, rows: touched, samples, over };
}

/**
 * One column broken into several on a separator.
 *
 * The original is kept unless the analyst says otherwise, and that default is the whole
 * safety of the pass: the file is the artifact, a split is a guess about how it was
 * written, and a guess that deletes what it was reading is not one the analyst can check
 * afterwards.
 */
export function splitTable(table, meta, index, { separator, keep = true } = {}) {
  const name = table.columns[index];
  const cut = String(separator ?? '');
  if (name === undefined || !cut) return { table, meta, names: [] };
  const { parts } = splitPreview(table, index, cut);
  if (parts < 2) return { table, meta, names: [] };

  const cells = (table.rows ?? []).map((row) => pieces(row[index], cut));
  let grown = table;
  const names = [];
  for (let part = 0; part < parts; part += 1) {
    const at = index + 1 + part;
    grown = insertColumn(
      grown,
      at,
      `${name} ${part + 1}`,
      cells.map((row) => row[part] ?? ''),
    );
    names.push(grown.columns[at]);
  }
  if (keep) return { table: grown, meta, names };
  // Dropping the original is a delete like any other, so it goes through the grid's own
  // one: it moves the sidecar with it, and a second implementation here is a second
  // answer to what a deleted column takes with it.
  const dropped = removeColumn(grown, meta, index);
  return { table: dropped.table, meta: dropped.meta, names };
}

/**
 * Several columns written into one.
 *
 * The other half of the import chore: a file that arrives with `Street`, `Number` and
 * `City` in three columns is one address the analyst has to read three cells to know. The
 * empties are left out rather than joined, so `Kherson` does not come back as `, Kherson,`
 * because two of the three cells were blank.
 */
export function mergeTable(table, meta, indices, { joiner = ' ', name = '', keep = true } = {}) {
  const wanted = [...new Set(indices ?? [])]
    .filter((index) => table.columns[index] !== undefined)
    .sort((a, b) => a - b);
  if (wanted.length < 2) return { table, meta, name: null };
  const heading = String(name ?? '').trim() || wanted.map((index) => table.columns[index]).join(' + ');
  const at = wanted[wanted.length - 1] + 1;
  const values = table.rows.map((row) =>
    wanted
      .map((index) => String(row[index] ?? '').trim())
      .filter(Boolean)
      .join(String(joiner ?? '')),
  );
  let grown = insertColumn(table, at, heading, values);
  const made = grown.columns[at];
  let next = meta;
  if (!keep) {
    // Right to left, so an index still points at the column it named after the one
    // before it has gone.
    for (const index of [...wanted].reverse()) {
      const dropped = removeColumn(grown, next, index);
      grown = dropped.table;
      next = dropped.meta;
    }
  }
  return { table: grown, meta: next, name: made };
}

/**
 * The links a column holds, lifted into a column of their own.
 *
 * A source column in a real binder is a sentence with a URL in it, sometimes three. What
 * an analyst wants out of it is either the addresses — to promote them into bookmarks —
 * or just the hosts, which is a reading of the case: eleven rows sourced to one Telegram
 * channel is a finding, and it is invisible while the hosts are buried in prose.
 */
export function extractTable(table, meta, index, { what = 'url', name = '', separator = ', ' } = {}) {
  const from = table.columns[index];
  if (from === undefined) return { table, meta, name: null, filled: 0 };
  const heading = String(name ?? '').trim() || `${from} ${what === 'host' ? 'hosts' : 'links'}`;
  let filled = 0;
  const values = table.rows.map((row) => {
    const found = urlsIn(row[index]);
    if (!found.length) return '';
    const written = what === 'host' ? [...new Set(found.map((url) => host(url)))] : found;
    filled += 1;
    return written.join(separator);
  });
  if (!filled) return { table, meta, name: null, filled: 0 };
  const at = index + 1;
  const grown = insertColumn(table, at, freeColumnName(table.columns, heading), values);
  return { table: grown, meta, name: grown.columns[at], filled };
}

/** A URL's host, without the `www.` — `linkLabel` says the same thing but adds a mark
 *  when the path carries more, and a cell of hosts is a value to be counted. */
function host(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return linkLabel(url);
  }
}
