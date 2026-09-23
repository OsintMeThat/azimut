/**
 * The wheel belongs to the map, wherever the pointer happens to be.
 *
 * Everything we draw over a map — marks, watched areas, candidates — is a
 * sibling of the map element rather than a child of it, so a wheel over one of
 * those shapes stops there and the view does not zoom until the pointer is
 * moved off whatever was drawn. A press can be the shape's; the wheel is always
 * handed down to the picture under it.
 */

/** Relay `event` to the map element under the pointer. `root` is the overlay. */
export function relayWheel(event, { engine, root }) {
  const container = engine?.container;
  if (!container) return;
  const below = document
    .elementsFromPoint(event.clientX, event.clientY)
    .find((element) => !root?.contains(element) && container.contains(element));
  if (!below) return;
  event.preventDefault();
  below.dispatchEvent(new WheelEvent('wheel', {
    deltaX: event.deltaX, deltaY: event.deltaY, deltaZ: event.deltaZ,
    deltaMode: event.deltaMode,
    clientX: event.clientX, clientY: event.clientY,
    ctrlKey: event.ctrlKey, shiftKey: event.shiftKey,
    altKey: event.altKey, metaKey: event.metaKey,
    bubbles: true, cancelable: true,
  }));
}
