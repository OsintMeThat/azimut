/**
 * The colours the Horizon tab marks its map with. The view reads the same
 * values as `--hz-*` custom properties (tools/Horizon.svelte), which a map's
 * shapes cannot; a test keeps the two in step.
 *
 * Amber is the lens (the eye, its cone, the strip's bracket, the caret), as
 * it is the selection everywhere else; the marked point says in sight or
 * hidden in green or red, grey while the app is still working it out; the
 * ground clicked in the view is a yellow crosshair.
 */
export const HZ = {
  lens: '#e8a33d',
  mark: '#ffd740',
  seen: '#69f0ae',
  hidden: '#ff5252',
  pending: '#c8c8c8',
};
