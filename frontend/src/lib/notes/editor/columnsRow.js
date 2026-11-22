/**
 * Where the rows of columns are in a note's editor state (`lib/notes/columns.js` reads
 * their text): the row a position stands in and the column whose words it is in. Read
 * by the row itself (`editor/columnsBlock.js`), the `/` menu, the block handle and a
 * picture's bar, so it registers nothing.
 */
import { COLUMNS_CLOSE, COLUMNS_OPEN, readColumns, rowOf, withColumnAdded } from '../columns.js';
import { PICTURE_LINE } from '../pictureSize.js';

/**
 * The row over the lines `first`–`last` (1-based) of `state`: `{ from, to, source,
 * columns }`, each column with its fence lines (`openLine`, `closeLine`) and where its
 * words are (`contentFrom`–`contentTo`, null when no line stands between its fences).
 */
export function rowOver(state, first, last) {
  const { doc } = state;
  const lines = [];
  for (let number = first; number <= last; number += 1) lines.push(doc.line(number).text);
  const columns = readColumns(lines).columns.map((column) => {
    const openLine = first + column.open;
    const closeLine = column.close >= 0 ? first + column.close : last;
    const lined = closeLine - openLine > 1;
    return {
      ...column, openLine, closeLine,
      contentFrom: lined ? doc.line(openLine + 1).from : null,
      contentTo: lined ? doc.line(closeLine - 1).to : null,
    };
  });
  return { from: doc.line(first).from, to: doc.line(last).to, first, last, source: lines.join('\n'), columns };
}

/** How far up and down from a position a row's fences are looked for. */
const REACH = 600;

/** The row of columns `pos` stands in, or null. */
export function rowAround(state, pos) {
  const { doc } = state;
  const at = doc.lineAt(Math.max(0, Math.min(pos, doc.length))).number;
  let first = 0;
  for (let number = at; number >= Math.max(1, at - REACH); number -= 1) {
    const text = doc.line(number).text;
    if (COLUMNS_OPEN.test(text)) {
      first = number;
      break;
    }
    if (number !== at && COLUMNS_CLOSE.test(text)) return null;
  }
  if (!first) return null;
  for (let number = Math.max(first + 1, at); number <= Math.min(doc.lines, first + REACH); number += 1) {
    if (COLUMNS_CLOSE.test(doc.line(number).text)) return rowOver(state, first, number);
    if (number > first && COLUMNS_OPEN.test(doc.line(number).text)) return null;
  }
  return null;
}

/** The column whose words `pos` stands in, `{ row, index, column }`, or null. */
export function columnAt(state, pos) {
  const row = rowAround(state, pos);
  if (!row) return null;
  const index = row.columns.findIndex((column) => column.contentFrom !== null && pos >= column.contentFrom && pos <= column.contentTo);
  return index < 0 ? null : { row, index, column: row.columns[index] };
}

/**
 * The picture `dragged` (a drawn block) let go against the `side` edge of `target`, a
 * picture or a row of fewer than three columns: the two in one row, the picture's line
 * gone from where it stood. A transaction, or null when it makes no row.
 */
export function besideSpec(state, dragged, target, side) {
  const { doc } = state;
  const picture = state.sliceDoc(dragged.from, dragged.to).trim();
  if (!PICTURE_LINE.test(picture) || dragged.from === target.from) return null;
  let at = { from: target.from, to: target.to };
  let row;
  if (target.kind === 'columns') {
    const now = rowAround(state, target.from);
    row = now ? withColumnAdded(now.source, picture, side) : null;
    if (now) at = { from: now.from, to: now.to };
  } else {
    const other = state.sliceDoc(target.from, target.to).trim();
    row = PICTURE_LINE.test(other) ? (side === 'left' ? rowOf(picture, other) : rowOf(other, picture)) : null;
  }
  if (!row) return null;
  // the picture's line goes with a blank line beside it, so no gap is left doubled
  const first = doc.lineAt(dragged.from);
  const last = doc.lineAt(dragged.to);
  const after = last.number < doc.lines ? doc.line(last.number + 1) : null;
  const before = first.number > 1 ? doc.line(first.number - 1) : null;
  let from = first.from;
  let to = last.to;
  if (after && !after.text.trim()) to = after.number < doc.lines ? doc.line(after.number + 1).from : after.to;
  else if (after) to = after.from;
  else if (before) from = before.to;
  if (from < at.to && to > at.from) return null;
  const changes = state.changes([{ from: at.from, to: at.to, insert: row }, { from, to }]);
  return { changes, selection: { anchor: changes.mapPos(at.from, -1) }, scrollIntoView: true, userEvent: 'input.columns' };
}
