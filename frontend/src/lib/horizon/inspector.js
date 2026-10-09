/**
 * The Horizon inspector's width. Its left edge is a drag handle and the width
 * survives reloads (lib/panelWidth.js); the small map at its top keeps the
 * shape it has at the default width, so widening the inspector grows the map.
 * The pointer glue lives in tools/Horizon.svelte.
 */
import { panelWidth } from '../panelWidth.js';

export const inspectorWidth = panelWidth({
  key: 'azimut:horizonSideW',
  // under 300 the property sheet's names and fields start to collide
  min: 300,
  max: 560,
  def: 340,
  fraction: 0.45,
});

/** The small map's height, px, in an inspector `width` px wide: 250 at the default 340. */
export const mapHeightFor = (width) => Math.round((width * 250) / 340);
