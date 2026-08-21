/**
 * The clipboard, as a table operation.
 *
 * There is exactly one CSV parser and one CSV writer in the app and both are in
 * Python (`engine/sheets.py`). That invariant is about **files**: delimiter
 * sniffing, quoting rules, the bytes on disk. A clipboard block is not that case.
 * It is TSV — what every spreadsheet and every browser table puts on the clipboard
 * — and a paste into a selection is not a table, it is a **patch**: where it lands,
 * how far it reaches, whether it makes the sheet longer. That is selection
 * geometry, which only the side holding the selection knows, so it lives here and
 * a paste costs no round trip.
 *
 * Pure on purpose: text in, table out. No DOM, no fetch, no clipboard API — the
 * component reads the event and hands the string over.
 */

import { keyIndex, newKey, urlsIn } from './sheet.js';

/** How many rows one paste may add. The same order as the sheet's own bound: past
 *  this it is an import, and `sheets/import` is the route that exists for it. */
export const MAX_PASTE_ROWS = 20_000;

/**
 * A clipboard block, as rows of cells.
 *
 * Tab splits cells and newline splits rows, except inside a quoted cell — which is
 * how a spreadsheet ships a note holding a line break or a tab, and dropping that
 * rule turns one row of prose into nine rows of fragments. `""` inside a quoted
 * cell is one quote, as in CSV.
 *
 * A quote that opens and never closes is read to the end of the block rather than
 * refused: half the blocks on a clipboard come from somewhere that quotes badly,
 * and the analyst would rather see the text than an error.
 */
export function parseBlock(text) {
  const body = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!body) return [];
  const rows = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  for (let at = 0; at < body.length; at += 1) {
    const char = body[at];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (body[at + 1] === '"') {
        cell += '"';
        at += 1;
      } else quoted = false;
      continue;
    }
    if (char === '"' && cell === '') quoted = true;
    else if (char === '\t') {
      cells.push(cell);
      cell = '';
    } else if (char === '\n') {
      cells.push(cell);
      rows.push(cells);
      cells = [];
      cell = '';
    } else cell += char;
  }
  cells.push(cell);
  rows.push(cells);
  // A block copied out of a spreadsheet ends with a line break; that is a
  // terminator, not an empty row, and pasting it would append a blank line.
  if (rows.length > 1 && rows.at(-1).length === 1 && rows.at(-1)[0] === '') rows.pop();
  return rows;
}

/** A range of cells as a clipboard block, quoted where a reader would otherwise
 *  read one cell as several. Tab-separated because that is what a spreadsheet
 *  expects to receive, whatever delimiter its own files use. */
export function toBlock(rows) {
  return (rows ?? [])
    .map((row) =>
      (row ?? [])
        .map((cell) => {
          const value = String(cell ?? '');
          return /[\t\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join('\t'),
    )
    .join('\n');
}

/**
 * Whether a block reads as a list of links rather than as a table.
 *
 * Two links and no tab: a table has tabs, and one link is a cell someone pasted
 * into a cell. This is the inbox the field binders keep as a "to be sorted" tab —
 * a wall of links dropped out of a chat — and turning it into a row per link is the
 * gesture that replaces an afternoon.
 */
export function looksLikeLinks(text) {
  const body = String(text ?? '');
  return !body.includes('\t') && urlsIn(body).length > 1;
}

/** A block of links as one row per link, for the column it is pasted into. */
export function linkRows(text) {
  return urlsIn(text).map((url) => [url]);
}

/**
 * Paste *block* into *table* with its top-left cell at (row, column).
 *
 * Four rules, and each one is a decision:
 *
 * - **It lands where it looks like it lands.** `view` is the rows and the columns as
 *   they are drawn, and the block walks that order rather than the file's: a sheet
 *   that is filtered, sorted, or has had a column dragged elsewhere would otherwise
 *   copy the three rows on screen and write them into three the analyst cannot see.
 *   Without a view the file's own order is the order.
 * - **Rows grow.** A block longer than what is left below gets the rows it needs,
 *   each with its own key. That is the whole point of pasting a worklist in.
 * - **Columns do not.** A block wider than what is drawn to the right is clipped, and
 *   `clipped` says by how much. Inventing columns would change the file's schema from
 *   a keystroke, and a heading the analyst never chose is worse than a cell lost.
 * - **The key column is never written.** It is the row's handle; a pasted value
 *   landing on it would move every colour and every link to another row.
 *
 * Returns the new table plus what happened, so the grid can say it out loud.
 */
export function pasteBlock(table, block, at = { row: 0, column: 0 }, view = null) {
  const columns = table?.columns ?? [];
  const key = keyIndex(columns);
  const everyRow = table.rows.map((_, index) => index);
  const everyColumn = columns.map((_, index) => index);
  const atRow = Math.max(0, at?.row ?? 0);
  const atColumn = Math.max(0, at?.column ?? 0);
  // A cell the view does not hold — the pinned row, drawn outside the list — is pasted
  // on in the file's order, since there is no place for it in the drawn one.
  let rowOrder = view?.rows?.length ? view.rows : everyRow;
  let columnOrder = view?.columns?.length ? view.columns : everyColumn;
  if (!rowOrder.includes(atRow)) rowOrder = everyRow;
  if (!columnOrder.includes(atColumn)) columnOrder = everyColumn;
  const startRow = Math.max(0, rowOrder.indexOf(atRow));
  const startColumn = Math.max(0, columnOrder.indexOf(atColumn));
  const width = Math.max(0, ...(block ?? []).map((row) => row.length));
  const clipped = Math.max(0, startColumn + width - columnOrder.length);
  const wanted = startRow + (block?.length ?? 0);
  const added = Math.min(Math.max(0, wanted - rowOrder.length), MAX_PASTE_ROWS);

  const rows = table.rows.map((row) => [...row]);
  const order = [...rowOrder];
  for (let index = 0; index < added; index += 1) {
    order.push(rows.length);
    rows.push(columns.map((_, column) => (column === key ? newKey() : '')));
  }

  let written = 0;
  (block ?? []).forEach((cells, down) => {
    const target = rows[order[startRow + down]];
    if (!target) return;
    cells.forEach((value, across) => {
      const column = columnOrder[startColumn + across];
      if (column === undefined || column === key) return;
      target[column] = String(value ?? '');
      written += 1;
    });
  });
  return { table: { ...table, rows }, added, clipped, written };
}
