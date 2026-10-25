/**
 * Sentinel-2 as a plate's ground: one pass, on the day it was taken, never the
 * mosaic of whatever passes cover each tile. The map asks for that day alone, in the
 * layer picked and under the ceiling its pass was picked by
 * (`sentinel2~LAYER~day~day~CCnn`, `lib/sentinel.js`), so where the pass did not
 * reach, the page shows a gap rather than another day's picture.
 *
 * The day, the layer and the ceiling are picked with Satellite's own calendar
 * (`SentinelPicker`), over the map's middle.
 */
import { DEFAULT_LAYER, DEFAULT_MAXCC, SENTINEL_ID, variantId } from '../sentinel.js';

export { SENTINEL_ID };

/** The ceiling a plate's map looks for its pass under until another is set: the newest pass under 30% cloud. */
export const PLATE_MAXCC = 30;

/** The provider id a map on Sentinel-2 draws from: its pass's day alone, or none until one is picked. */
export function passId({ acquired = null, product = '', maxcc = null } = {}) {
  if (!acquired) return null;
  return variantId(SENTINEL_ID, { layer: product || DEFAULT_LAYER, from: acquired, to: acquired, maxcc: maxcc ?? DEFAULT_MAXCC });
}

/** What `{imagery}` and the credits write for a map on it: its layer when not true colour, and its day. */
export function passCredit({ acquired = null, product = '' } = {}) {
  if (!acquired) return '';
  const layer = product && product !== DEFAULT_LAYER ? ` ${product.replace(/_/g, ' ').toLowerCase()}` : '';
  return `Sentinel-2${layer} pass of ${acquired}`;
}
