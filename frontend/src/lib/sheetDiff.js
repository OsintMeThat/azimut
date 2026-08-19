/**
 * What changed between the table the grid holds and the table on disk.
 *
 * The conflict banner used to offer two buttons — reload, or overwrite — over one
 * sentence saying the file had moved on. Both are irreversible in the direction that
 * matters and the analyst had nothing to decide *with*: overwriting three rows somebody
 * added in a spreadsheet and overwriting a stray cell they fixed are the same press.
 *
 * So the two tables are compared and the answer is counted before anything is pressed.
 * Rows are matched **by key**, never by position, for the same reason everything else in
 * a sheet is: the file may well have been sorted in the spreadsheet that touched it, and a
 * positional diff would report four hundred changed rows where somebody re-ordered them.
 *
 * Pure: two tables in, a reading out. No fetch, no DOM.
 */

import { keyIndex } from './sheet.js';

/** How many differing cells are listed. The count is the answer; the list is the sample
 *  that makes it believable, and a wall of two hundred rows is neither. */
const SAMPLE = 12;

function byKey(table) {
  const at = keyIndex(table?.columns ?? []);
  const rows = new Map();
  for (const row of table?.rows ?? []) rows.set(String(row?.[at] ?? ''), row);
  return rows;
}

/**
 * The two tables compared, as counts plus a sample.
 *
 * `mine` is what the grid is showing and `theirs` is what the file says. The words are
 * deliberate: every count is phrased from the grid's side, so `rowsAdded` is rows the file
 * has that the grid never saw — the ones an overwrite would delete.
 */
export function diffTables(mine, theirs) {
  const ours = byKey(mine);
  const disk = byKey(theirs);
  const columnsMine = mine?.columns ?? [];
  const columnsDisk = theirs?.columns ?? [];
  const shared = columnsMine.filter((name) => columnsDisk.includes(name));

  const changed = [];
  let cellsChanged = 0;
  for (const [key, row] of ours) {
    const other = disk.get(key);
    if (!other) continue;
    for (const name of shared) {
      const left = String(row[columnsMine.indexOf(name)] ?? '');
      const right = String(other[columnsDisk.indexOf(name)] ?? '');
      if (left === right) continue;
      cellsChanged += 1;
      if (changed.length < SAMPLE) changed.push({ key, column: name, mine: left, theirs: right });
    }
  }

  return {
    rowsAdded: [...disk.keys()].filter((key) => !ours.has(key)).length,
    rowsGone: [...ours.keys()].filter((key) => !disk.has(key)).length,
    cellsChanged,
    columnsAdded: columnsDisk.filter((name) => !columnsMine.includes(name)),
    columnsGone: columnsMine.filter((name) => !columnsDisk.includes(name)),
    changed,
  };
}

/** Whether the two tables say the same thing. A stamp can move without the table moving:
 *  a spreadsheet that opened the file and saved it unchanged rewrote every byte of it. */
export function sameTable(diff) {
  return (
    !diff.rowsAdded &&
    !diff.rowsGone &&
    !diff.cellsChanged &&
    !diff.columnsAdded.length &&
    !diff.columnsGone.length
  );
}

/**
 * The diff in one line, from the file's side.
 *
 * Written as what the *file* holds rather than as a verdict, because that is what the
 * analyst is choosing between: "3 rows and 2 cells this grid has not got" is a reason to
 * reload, and it is the same sentence whether they typed those rows in LibreOffice or a
 * colleague did.
 */
export function describeDiff(diff) {
  if (sameTable(diff)) return 'The file holds the same table, written again.';
  const parts = [];
  const rows = (count, word) => `${count} ${count === 1 ? word : `${word}s`}`;
  if (diff.rowsAdded) parts.push(`${rows(diff.rowsAdded, 'row')} not in this grid`);
  if (diff.rowsGone) parts.push(`${rows(diff.rowsGone, 'row')} gone from the file`);
  if (diff.cellsChanged) parts.push(`${rows(diff.cellsChanged, 'cell')} written differently`);
  if (diff.columnsAdded.length) parts.push(`a new column (${diff.columnsAdded.join(', ')})`);
  if (diff.columnsGone.length) parts.push(`no ${diff.columnsGone.join(', ')} column`);
  return `On disk: ${parts.join(', ')}.`;
}
