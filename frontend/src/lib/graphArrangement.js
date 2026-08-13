/**
 * Where the analyst put the nodes, as the undo stack has to see it.
 *
 * A pin is presentation, not a fact about the case: it says the analyst decided
 * this node belongs *there*, and the layout arranges everything else around it.
 * Two sources hold pins at once — the ones the server sent with the drawing, and
 * the ones a drag has moved but not filed yet — and the undo stack needs the one
 * merged answer. Getting that merge wrong is invisible until an undo silently
 * drops a node the analyst had placed, or resurrects one they let go of.
 *
 * `graph.js` already owns `arrangementDiff`, which turns two of these into the
 * pins to write and the pins to drop. This owns the reading side.
 */

/**
 * Every pin in the active arrangement, as a sorted list of `{ id, x, y }`.
 *
 * `held` is the set that is actually pinned right now, and it is the filter
 * rather than a hint: a node whose pin was dropped can still be sitting in either
 * source, and carrying it into a snapshot would put it back on the next undo.
 *
 * A named view retains its own off-screen pins, so when it owns the arrangement
 * the drawn nodes contribute nothing — the case-wide undo stays limited to what
 * is on screen, and a view's pins are not rewritten by an undo taken in it.
 */
export function mergedArrangement({ nodes = [], pins = [], held = [], fromView = false }) {
  const at = new Map();
  if (!fromView) {
    for (const node of nodes) {
      if (Array.isArray(node?.pin)) at.set(node.id, { x: node.pin[0], y: node.pin[1] });
    }
  }
  for (const [id, spot] of pins) at.set(id, { x: spot.x, y: spot.y });
  const keep = new Set(held);
  return [...at.entries()]
    .filter(([id]) => keep.has(id))
    .map(([id, spot]) => ({ id, x: spot.x, y: spot.y }));
}

/**
 * The pins a snapshot can be trusted with, as a Map.
 *
 * A snapshot is JSON that has been round-tripped through the history stack and,
 * for a saved view, through the server and back. A spot with a missing id or a
 * coordinate that is not finite would place a node at `NaN`, which Konva draws
 * nowhere and no later drag can recover — so it is dropped rather than repaired.
 */
export function validPins(wanted) {
  const pins = new Map();
  for (const spot of wanted ?? []) {
    if (typeof spot?.id !== 'string') continue;
    if (!Number.isFinite(spot.x) || !Number.isFinite(spot.y)) continue;
    pins.set(spot.id, { x: spot.x, y: spot.y });
  }
  return pins;
}
