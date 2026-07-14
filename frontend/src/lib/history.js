/**
 * Bounded snapshot history for undo/redo. Snapshots are JSON strings (cheap
 * equality checks); the caller decides what to serialize and how to restore.
 * `push` drops the redo tail — a new edit after an undo forks the timeline —
 * and evicts the oldest entry past `limit`.
 */
export function createHistory(limit = 60) {
  let stack = [];
  let index = -1;
  return {
    get canUndo() {
      return index > 0;
    },
    get canRedo() {
      return index >= 0 && index < stack.length - 1;
    },
    /** Start a fresh timeline anchored at `snapshot` (undo stops here). */
    reset(snapshot) {
      stack = [snapshot];
      index = 0;
    },
    /** Record `snapshot` unless it equals the current entry. */
    push(snapshot) {
      if (index >= 0 && stack[index] === snapshot) return false;
      stack = stack.slice(0, index + 1);
      stack.push(snapshot);
      if (stack.length > limit) stack.shift();
      index = stack.length - 1;
      return true;
    },
    /** Step back; returns the snapshot to restore, or null at the anchor. */
    undo() {
      if (index <= 0) return null;
      index -= 1;
      return stack[index];
    },
    /** Step forward; returns the snapshot to restore, or null at the tip. */
    redo() {
      if (index < 0 || index >= stack.length - 1) return null;
      index += 1;
      return stack[index];
    },
  };
}
