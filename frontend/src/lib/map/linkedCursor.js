/**
 * Side by side, the pointer over one map is echoed on the other as a cross
 * (Compare's `LinkedCursor`). The echo goes through the ground, not the
 * screen: the point under the pointer in the source map is placed where that
 * same ground lies in the target, so two panes of different sizes still agree.
 */

/**
 * Where the target map shows the ground under the pointer.
 *
 * @param {{ container: Element, containerPointToLatLng: Function }} source
 * @param {{ container: Element, latLngToContainerPoint: Function }} target
 * @param {{ x: number, y: number }} client the pointer, in viewport px
 * @returns {{ x: number, y: number } | null} px in the target's container, or
 *   null when the pointer is off the source or the ground is off the target
 */
export function mirrorPointer(source, target, client) {
  const from = source?.container?.getBoundingClientRect?.();
  const to = target?.container?.getBoundingClientRect?.();
  if (!from?.width || !from?.height || !to?.width || !to?.height || !client) return null;
  const x = client.x - from.left;
  const y = client.y - from.top;
  if (x < 0 || y < 0 || x > from.width || y > from.height) return null;
  const ground = source.containerPointToLatLng({ x, y });
  if (!Number.isFinite(ground?.lat) || !Number.isFinite(ground?.lon)) return null;
  const at = target.latLngToContainerPoint(ground);
  if (!Number.isFinite(at?.x) || !Number.isFinite(at?.y)) return null;
  if (at.x < 0 || at.y < 0 || at.x > to.width || at.y > to.height) return null;
  return { x: at.x, y: at.y };
}
