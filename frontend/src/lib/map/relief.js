/**
 * The 3D view's settings, shared by what draws relief: Satellite's globe
 * (`lib/globe`) and a plate's 3D map (`tools/plate/PlateMap.svelte`).
 *
 * Real scale is the default. An exaggeration is offered for reading a gentle
 * slope, and the tool says on screen when one is on: a picture of the ground
 * at twice its height is a reading aid, never evidence of how it looks.
 */

/** What the analyst may pick; 1 is the ground as it is. */
export const EXAGGERATIONS = [1, 1.5, 2, 3];
/**
 * The tilt the 3D switch and the Tilt button lean a flat view to: enough for the
 * relief to show, little enough that the view stays on one or two imagery
 * levels. At 60° a view mixed four or five, each its own Esri picture.
 */
export const READING_TILT = 20;
/** Levels the view's zoom must move over relief before the imagery is chosen again. */
export const STEADY_LEVELS = 2;

/**
 * The zoom a tilted map chooses its imagery at.
 *
 * Over relief the zoom is the centre's, and the centre is seated on the ground
 * under the middle of the view at the end of every move: a fraction of a level
 * either way, which rounds to the next whole level as often as not. A billed
 * basemap steps aside for free imagery below a zoom (eco) and changes its grid
 * at z17 (the detail bracket), and each change rebuilds the whole imagery layer:
 * every tile on screen dropped and asked again for a view that barely moved. So
 * the choice holds until the zoom has moved `STEADY_LEVELS` from where it was
 * made.
 */
export function steadyZoom(held, next) {
  if (!Number.isFinite(held) || !Number.isFinite(next)) return next;
  return Math.abs(next - held) >= STEADY_LEVELS ? next : held;
}

/** An exaggeration the engine may be handed: one of the offered steps, else 1. */
export function exaggerationOf(value) {
  const n = Number(value);
  return EXAGGERATIONS.includes(n) ? n : 1;
}
