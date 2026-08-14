/**
 * Undo for a table, sized for the table's real weight.
 *
 * `lib/history.js` keeps whole serialised snapshots, which is right for the tools
 * that use it — a collage, a graph layout, a proof — where a step *is* the document.
 * A sheet is different: it holds up to twenty thousand rows of sixty-four columns,
 * so one snapshot per keystroke is megabytes of JSON per edit, and bounding that
 * stack by size leaves an undo three steps deep on exactly the sheet where undo
 * matters most.
 *
 * So a cell edit records **what changed** — the cells, their before and their after
 * — and only a structural edit, where the shape moves and no list of cells could
 * describe it, records the table on both sides. A hundred typed cells cost a hundred
 * small entries; adding a column costs one big one.
 *
 * Every entry carries both sides, which is what makes the stack a stack of reversible
 * steps rather than a stack of states: undo walks one step back, redo walks it
 * forward, and the oldest entries can be dropped without the floor drifting into a
 * state the sheet was never in.
 *
 * Pure: entries are plain data and this module never applies them. The caller owns
 * the applying, because the caller owns the table.
 */

/** What the stack may hold, in characters of recorded state. Generous enough for a
 *  long afternoon of cell edits, small enough that a sheet reworked all day does
 *  not keep every version of itself in memory. */
export const DEFAULT_BUDGET = 4_000_000;

/** Roughly what one recorded cell costs. A fixed figure rather than a measurement:
 *  this only has to rank entries against one budget, not report memory. */
const CELL_COST = 64;

/** One or more cell edits, each `{ row, column, before, after }`. */
export function cellsEntry(edits) {
  return { kind: 'cells', edits: edits ?? [] };
}

/** A whole-table entry, for a change no list of cells describes: a column added,
 *  removed, renamed or moved, rows deleted, a paste that grew the sheet. Both sides
 *  are kept, so the step reverses like any other. */
export function snapshotEntry(before, after) {
  return { kind: 'snapshot', before: String(before ?? ''), after: String(after ?? '') };
}

/** Roughly what an entry costs to keep. */
export function weigh(entry) {
  if (entry?.kind === 'snapshot') return entry.before.length + entry.after.length;
  return (entry?.edits?.length ?? 0) * CELL_COST;
}

/**
 * A bounded undo/redo stack of reversible entries.
 *
 * `undo()` and `redo()` hand back `{ entry, direction }`. Backward means the sheet
 * goes to each edit's `before`; forward means it goes to its `after`. What that does
 * to the table is the caller's business.
 */
export function createSheetHistory({ budget = DEFAULT_BUDGET } = {}) {
  /** @type {{ entry: object, weight: number }[]} */
  let stack = [];
  let index = -1;
  let spent = 0;

  /** Drop the oldest steps until the stack is inside its budget. What is dropped is
   *  undo depth, never correctness: the steps that remain still reverse exactly. */
  function trim() {
    while (stack.length > 1 && spent > budget) {
      spent -= stack.shift().weight;
      index -= 1;
    }
    if (index < -1) index = -1;
  }

  return {
    get canUndo() {
      return index >= 0;
    },
    get canRedo() {
      return index < stack.length - 1;
    },
    /** How many steps are kept, for a test that wants the bound to be real. */
    get size() {
      return stack.length;
    },
    /** Forget everything: a different sheet, or the same one reloaded from disk. */
    reset() {
      stack = [];
      index = -1;
      spent = 0;
    },
    /** Record one step, dropping any redone tail: a new edit forks the timeline. */
    record(entry) {
      if (entry?.kind === 'cells' && !entry.edits.length) return false;
      if (entry?.kind === 'snapshot' && entry.before === entry.after) return false;
      for (const dropped of stack.slice(index + 1)) spent -= dropped.weight;
      stack = stack.slice(0, index + 1);
      const weight = weigh(entry);
      stack.push({ entry, weight });
      spent += weight;
      index = stack.length - 1;
      trim();
      return true;
    },
    undo() {
      if (index < 0) return null;
      const { entry } = stack[index];
      index -= 1;
      return { entry, direction: 'backward' };
    },
    redo() {
      if (index >= stack.length - 1) return null;
      index += 1;
      return { entry: stack[index].entry, direction: 'forward' };
    },
  };
}
