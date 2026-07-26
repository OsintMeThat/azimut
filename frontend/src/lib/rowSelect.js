/**
 * Multi-select for the sidebar's entity rows: ctrl/cmd-click toggles one row,
 * shift-click extends from the anchor, and a drag carries whatever is selected.
 * Folders are never part of it — a folder is a drop target, not cargo.
 */

/** Ctrl/cmd-click: add or remove one row. */
export function toggleSelected(selected, id) {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** Shift-click: every row between the anchor and the clicked one, in the order
 *  they are displayed. An anchor that scrolled out of the list selects alone. */
export function rangeSelected(ids, anchorId, targetId) {
  const a = ids.indexOf(anchorId);
  const b = ids.indexOf(targetId);
  if (a === -1 || b === -1) return new Set(targetId == null ? [] : [targetId]);
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return new Set(ids.slice(lo, hi + 1));
}

/** What a drag actually moves: the whole selection when the dragged row belongs
 *  to it, otherwise that row alone (dragging elsewhere doesn't take it along). */
export function dragPayload(rows, selected, entity) {
  if (!selected.has(entity.id)) return [entity];
  return rows.filter((r) => selected.has(r.id));
}
