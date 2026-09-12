/**
 * Reactive props for `PlaceMap.render.test.js`.
 *
 * What the test is about is the second read: the same case answered again must not
 * move the camera, and a different set of points must. That only happens if the
 * props are reactive, runes only work in `.svelte.js`, so they live here.
 */
export const mapProps = $state({ pins: [], total: 0, imperial: false, onopen: () => {} });

/** Put the props back the way every test starts. */
export function resetMapProps(over = {}) {
  mapProps.pins = [];
  mapProps.total = 0;
  mapProps.imperial = false;
  mapProps.onopen = () => {};
  Object.assign(mapProps, over);
}
