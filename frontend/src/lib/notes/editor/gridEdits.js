/**
 * A table's edits as editor transactions. Every gesture on a grid (a cell typed in,
 * a row added, a column sorted, cells pasted) is one transaction, so one Undo step
 * of its own, and changes only the lines `tableText.js` says it touches. The grid
 * (`editor/tableGrid.js`), the paste (`editor/pasteTable.js`) and a picture put in a
 * cell (`editor/tablePictures.js`) all write through `changeTable`.
 *
 * A table's lines are the ones `tableText.js` reads, never the Markdown parser's
 * `Table` node: it starts after an indent, runs on to a block's closing `:::` and
 * misses a table whose header holds a chip.
 */
import { StateEffect, StateField, Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';

import { lineChanges, serializeTable, tablesIn } from './tableText.js';

const read = new WeakMap();

/** Every table of the note, `{ from, to, line, table }` as `tablesIn` finds them, read once per text. */
export function tablesOf(state) {
  let found = read.get(state.doc);
  if (!found) {
    found = tablesIn(state.doc.toString());
    read.set(state.doc, found);
  }
  return found;
}

/** The table standing at `pos`, its header line to its last row or its settings line, or null. */
export function tableNear(state, pos) {
  return tablesOf(state).find((found) => found.from <= pos && pos <= found.end) ?? null;
}

/** The table whose header line starts at `pos`, or null. */
export function tableStartingAt(state, pos) {
  return tablesOf(state).find((found) => found.from === pos) ?? null;
}

/**
 * Several `tableText.js` changes made one after the other, answered as one: the
 * last table, its text, and the line changes from the first table's text. A step
 * answering null is skipped.
 */
export function chain(table, ...steps) {
  const before = serializeTable(table);
  let current = { table, text: before };
  for (const step of steps) {
    const next = step ? step(current.table) : null;
    if (next) current = next;
  }
  return { table: current.table, text: current.text, changes: lineChanges(before, current.text) };
}

/**
 * Change the table standing at `pos` with `change(table, found)`, which answers what
 * a `tableText.js` change answers, or null for nothing to change. Dispatched as one
 * transaction kept apart in the history, so Undo takes back exactly this gesture.
 * Answers the table as it now stands, `{ from, to, table, text }`, or null when
 * nothing changed.
 */
export function changeTable(view, pos, change, { userEvent = 'input.table' } = {}) {
  if (view.state.readOnly) return null;
  const found = tableNear(view.state, pos);
  if (!found) return null;
  const result = change(found.table, found);
  if (!result || !result.changes?.length || result.text === serializeTable(found.table)) return null;
  view.dispatch({
    changes: result.changes.map((piece) => ({ from: found.from + piece.from, to: found.from + piece.to, insert: piece.insert })),
    annotations: [isolateHistory.of('full'), Transaction.userEvent.of(userEvent)],
  });
  return { from: found.from, to: found.from + result.text.length, table: result.table, text: result.text };
}

// -- which table is which ---------------------------------------------------------

let lastId = 0;

/**
 * Every table of the note with a name of its own that follows it through the
 * typing: `[{ from, id }]`. A grid is drawn again in place only for its own table,
 * never for another one that changed in the same step, so the cell being typed in
 * is never drawn over by a neighbour's; and a long table opened whole stays so.
 */
export const tableIds = StateField.define({
  create: (state) => tablesOf(state).map((found) => ({ from: found.from, id: (lastId += 1) })),
  update(value, transaction) {
    if (!transaction.docChanged) return value;
    const moved = value.map(({ from, id }) => ({ from: transaction.changes.mapPos(from, 1), id }));
    const taken = new Set();
    return tablesOf(transaction.state).map((found) => {
      const same = moved.find((item) => item.from === found.from && !taken.has(item.id));
      const id = same?.id ?? (lastId += 1);
      taken.add(id);
      return { from: found.from, id };
    });
  },
});

/** The name of the table starting at `from`, or null. */
export function tableIdAt(state, from) {
  return state.field(tableIds, false)?.find((item) => item.from === from)?.id ?? null;
}

// -- long tables -----------------------------------------------------------------

/** A table longer than this many rows shows its first `FOLD_SHOWN` until it is opened whole. */
export const FOLD_PAST = 30;
export const FOLD_SHOWN = 20;

const showWhole = StateEffect.define();

/** The long tables shown whole, by their names (`tableIds`). */
export const wholeTables = StateField.define({
  create: () => new Set(),
  update(value, transaction) {
    let next = value;
    for (const effect of transaction.effects) {
      if (!effect.is(showWhole)) continue;
      next = new Set(next);
      if (effect.value.whole) next.add(effect.value.id);
      else next.delete(effect.value.id);
    }
    return next;
  },
});

/** Whether the table named `id` is shown whole. */
export function shownWhole(state, id) {
  return state.field(wholeTables, false)?.has(id) ?? false;
}

/** Show the table named `id` whole, or folded again. */
export function showTableWhole(view, id, whole = true) {
  view.dispatch({ effects: showWhole.of({ id, whole }) });
}

/** How many of a table's rows the grid draws: all of them, or the first few of a long one not opened whole. */
export function rowsShown(rowCount, whole = false) {
  return !whole && rowCount > FOLD_PAST ? FOLD_SHOWN : rowCount;
}
