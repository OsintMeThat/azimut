/**
 * One row of a sheet pointing at another row of the same sheet.
 *
 * The binders wrote an order of battle in a column called `Links with others`: a brigade
 * listing its companies, each company naming its brigade back, held together by a
 * spreadsheet validation. That validation cannot survive a row being moved, and in the
 * real file it had **already** decayed — half the cells read `#REF!`.
 *
 * So nothing here stores a pointer. The cell keeps the **words** it always held, exactly
 * like every other cell in this app, and the link is re-read from those words every time:
 * a name points at a row when exactly one other row spells it that way in the naming
 * column. A word that names no row, or names two, is *reported* rather than guessed —
 * which turns the same decay the binders suffered into a list of what to fix.
 *
 * The other half is the reading the binders could not have at all: **who points at me**.
 * A brigade's row shows its companies without anybody having to keep two columns in step.
 *
 * Pure: a table and a role in, readings out. Mirrors `engine/sheetroles.row_targets`,
 * which is the copy promotion reads before it draws `part-of` edges into the graph.
 */

import { ID_COLUMN } from './sheet.js';
import { splitValues } from './sheetRoles.js';

/** Which column's words name a row, for a given `row` role: the one it declares, else
 *  the first column that is not the key — which is the subject column on every sheet
 *  anyone builds, and the one a reader would have used. */
export function namingColumn(columns, role) {
  const declared = role?.of;
  if (declared && (columns ?? []).includes(declared)) return declared;
  return (columns ?? []).find((name) => String(name).toLowerCase() !== ID_COLUMN) ?? null;
}

function keyAt(columns) {
  const at = (columns ?? []).findIndex((name) => String(name).toLowerCase() === ID_COLUMN);
  return at === -1 ? 0 : at;
}

/**
 * What each row's `row` column points at, by row key.
 *
 * `{ keys, missing }` per row: the rows it reached, and the words that reached none or
 * reached more than one. Both are wanted — `missing` is what the column's badge counts,
 * and a column where it is high is a column somebody renamed a row out from under.
 */
export function rowTargets(table, columnIndex, role) {
  const columns = table?.columns ?? [];
  const named = namingColumn(columns, role);
  if (named === null || columnIndex === -1) return new Map();
  const nameAt = columns.indexOf(named);
  const at = keyAt(columns);
  const rows = table?.rows ?? [];

  // Every word the naming column holds, and the rows holding it. A word two rows share
  // names neither of them: that is a finding about the file, not a coin toss.
  const holders = new Map();
  for (const row of rows) {
    const word = String(row[nameAt] ?? '').trim().toLowerCase();
    if (!word) continue;
    if (!holders.has(word)) holders.set(word, []);
    holders.get(word).push(String(row[at] ?? ''));
  }

  const found = new Map();
  for (const row of rows) {
    const key = String(row[at] ?? '');
    const keys = [];
    const missing = [];
    for (const word of splitValues(row[columnIndex], role)) {
      const held = (holders.get(word.toLowerCase()) ?? []).filter((other) => other !== key);
      if (held.length === 1) {
        if (!keys.includes(held[0])) keys.push(held[0]);
      } else {
        missing.push(word);
      }
    }
    if (keys.length || missing.length) found.set(key, { keys, missing });
  }
  return found;
}

/**
 * The other direction: for each row, the rows whose column points **at it**.
 *
 * The reading the binders kept by hand in a second column and could not keep in step. It
 * is derived rather than stored for the same reason the forward direction is: one truth,
 * re-read, so it cannot disagree with itself.
 */
export function backLinks(targets) {
  const back = new Map();
  for (const [key, found] of targets ?? []) {
    for (const other of found.keys) {
      if (!back.has(other)) back.set(other, []);
      if (!back.get(other).includes(key)) back.get(other).push(key);
    }
  }
  return back;
}

/** How a row reads when it is named somewhere else: its own naming cell, or its key when
 *  that cell is empty. A blank chip would be a pointer nobody could follow back. */
export function rowLabel(table, key, role) {
  const columns = table?.columns ?? [];
  const named = namingColumn(columns, role);
  const at = keyAt(columns);
  const row = (table?.rows ?? []).find((entry) => String(entry[at] ?? '') === key);
  if (!row) return key;
  return String(row[columns.indexOf(named)] ?? '').trim() || key;
}

/** How many of a column's words reach no single row. What the heading badge says, and
 *  the number that goes up the moment somebody renames a row in a spreadsheet. */
export function unresolved(targets) {
  let count = 0;
  for (const found of (targets ?? new Map()).values()) count += found.missing.length;
  return count;
}
