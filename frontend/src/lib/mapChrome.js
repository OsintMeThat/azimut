/**
 * The map's own controls, as boxes in the map's pixels: what a reference window
 * pinned to a corner keeps clear of (`cornerSpot` in `refViewers.js`).
 *
 * Read off the map's container rather than listed by hand, so a control added to
 * a corner is avoided without anyone remembering to say so. A layer laid over
 * the whole map that lets the pointer through (the status row, the corner
 * clusters) is not a control itself, so its children are read instead. The
 * engine's own buttons (zoom, scale, credits) sit inside the map and are read
 * by their class. Other reference windows are not controls: two pinned to one
 * corner may overlap, as two dropped there would.
 */

const ENGINE_CONTROLS = '.maplibregl-ctrl';
const NOT_CONTROLS = '.map, .globe, .ref-viewer';

/**
 * @param {Element} wrap the map's container, the box the windows are placed in
 * @returns {{ x: number, y: number, w: number, h: number }[]}
 */
export function chromeBoxes(wrap) {
  if (!wrap) return [];
  const origin = wrap.getBoundingClientRect();
  const boxes = [];
  const add = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      boxes.push({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
    }
  };
  const shown = (el) => {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  };
  for (const el of wrap.children) {
    if (el.matches(NOT_CONTROLS) || !shown(el)) continue;
    if (getComputedStyle(el).pointerEvents !== 'none') add(el);
    else for (const child of el.children) if (shown(child) && getComputedStyle(child).pointerEvents !== 'none') add(child);
  }
  for (const el of wrap.querySelectorAll(ENGINE_CONTROLS)) if (shown(el)) add(el);
  return boxes;
}
