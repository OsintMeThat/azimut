/**
 * Horizon's three modes, one switch in the tab's header: View, the terrain
 * from the viewpoint; Overlay, a photo laid over it there and matched by hand;
 * Find, an area of the map searched for where the photo was taken.
 *
 * The photo and its trace are the same in all three: View hides the photo, it
 * never removes it. The mode is in the address as `md`, View writing nothing,
 * so a reload and Back come back to it.
 */

export const MODES = Object.freeze([
  { id: 'view', label: 'View', icon: 'horizon', hint: 'The terrain from the viewpoint' },
  { id: 'overlay', label: 'Overlay', icon: 'image', hint: 'Lay a photo over the view and match it' },
  { id: 'find', label: 'Find', icon: 'search', hint: 'Search an area of the map for where a photo was taken' },
]);

const known = (id) => MODES.some((one) => one.id === id);

/** The mode an address names, View when it names none or one it does not know. */
export function modeOf(params) {
  const raw = params instanceof URLSearchParams ? params.get('md') : params?.md;
  return known(raw) ? raw : 'view';
}

/** What the address holds for a mode: nothing for View. */
export function modeParams(mode) {
  return mode === 'view' || !known(mode) ? {} : { md: mode };
}

/** The mode a saved view opens in: Overlay when its photo came back with it, View when not. */
export function modeOfView(photoLaid) {
  return photoLaid ? 'overlay' : 'view';
}
