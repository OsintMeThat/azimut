// Zone search over Inspect's viewer: the geometry, kept pure so it tests.
//
// A zone is a fractional {x, y, w, h} of the picture as it reads on screen (the
// video at its turn, a frame after its crop), the same shape as a crop, so the
// server cuts it with the crop op it already has. Rectangles here are pixels in
// the overlay laid over the viewer.
import { timecode } from './inspect.js';

/** Under this many pixels on a side, the zone says engines may find little in it. */
export const SMALL_ZONE_PX = 100;

/** Room kept between the bar, the zone and the viewer's edges. */
const GAP = 8;

/** Where the picture stands in the overlay, from both boxes on screen. */
export function pictureRect(picture, overlay) {
  return {
    left: picture.left - overlay.left,
    top: picture.top - overlay.top,
    width: picture.width,
    height: picture.height,
  };
}

/** The zone's own rectangle in the overlay. */
export function zoneRect(zone, picture) {
  return {
    left: picture.left + zone.x * picture.width,
    top: picture.top + zone.y * picture.height,
    width: zone.w * picture.width,
    height: zone.h * picture.height,
  };
}

/**
 * Where the engines' bar goes: under the zone, centred on it, else over it, else
 * inside its foot; at the top of the viewer while no zone is drawn. Always kept
 * inside the viewer.
 */
export function barPlace(zone, bar, view) {
  const fitX = (x) => Math.min(Math.max(GAP, x), Math.max(GAP, view.width - bar.width - GAP));
  const fitY = (y) => Math.min(Math.max(GAP, y), Math.max(GAP, view.height - bar.height - GAP));
  if (!zone) return { left: fitX((view.width - bar.width) / 2), top: GAP };
  const left = fitX(zone.left + (zone.width - bar.width) / 2);
  const below = zone.top + zone.height + GAP;
  if (below + bar.height <= view.height - GAP) return { left, top: below };
  const above = zone.top - GAP - bar.height;
  if (above >= GAP) return { left, top: above };
  return { left, top: fitY(zone.top + zone.height - bar.height - GAP) };
}

/** The zone's size in the picture's own pixels, which is what the engines get. */
export function zonePixels(zone, width, height) {
  if (!zone || !width || !height) return null;
  return { w: Math.max(1, Math.round(zone.w * width)), h: Math.max(1, Math.round(zone.h * height)) };
}

/** The file a drag engine is given: the source, the moment for a video, and "zone". */
export function zoneFileName(stem, time = null) {
  const safe = String(stem || 'picture').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'picture';
  return `reverse-${safe}${time == null ? '' : `-${timecode(time)}`}-zone.png`;
}
