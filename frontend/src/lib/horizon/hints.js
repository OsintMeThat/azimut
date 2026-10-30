/**
 * What the analyst knows about a photo, told to Fit: each optional, each
 * narrowing the search the way a human would.
 *
 * - How zoomed the picture looks, as a phone says it (×0.5, ×1, ×2–3, ×5 and
 *   more) rather than in millimetres: a video from the web says no focal, and
 *   a crop would make one wrong anyway. Each word stands for a range of lenses
 *   across a picture's long side, overlapping so a lens on a border belongs to
 *   both, and is turned into degrees across the picture by its shape: a phone
 *   held upright films the same lens across its short side, so ×1 is about 66°
 *   across a landscape frame and 40° across a portrait one. Several may be
 *   ticked when the analyst is unsure, and the search tries from the narrowest
 *   to the widest ticked; none ticked is any lens.
 * - Roughly which way it faces: a sector about the heading the view looked
 *   along when the analyst said so.
 * - What kind of picture it is: a photo, or a panorama (a phone's sweep, or a
 *   collage Azimut stitched on a cylinder), which is read through the view's
 *   strip, the same degrees per pixel all along. Offered for any image, the
 *   analyst's call: a wide one is pointed to it, and a stitched collage says
 *   how wide it is.
 * - The lens measured on the video: read off the pan around a moment
 *   (`/api/horizon/lens`), it stands for the photo's own, as an EXIF focal would,
 *   and the zoom words give way to it.
 * - How far the photo sees: haze hides ridges the terrain still holds, so the
 *   skyline a photo shows is often a nearer one than the turn's outermost.
 *   Auto lets Fit try each reach the panorama keeps (api/horizon.py
 *   SKYLINE_CUTS) up to `AUTO_REACH` and say the one that explains the trace:
 *   farther ridges are searched only when the analyst says the photo sees them,
 *   since they mostly add places that fit by chance.
 *
 * The words and their ranges live here alone, so the menu, the summary on the
 * band and the request to the app cannot drift apart.
 */
import { headingText } from './geometry.js';

/** The lenses tried when no zoom word is ticked: from a long zoom to a wide angle. */
export const ANY_WITHIN = [1.5, 120];

/**
 * Zoom words, widest first, and the lenses each stands for, in degrees across
 * a picture's long side (`zoomWithin` turns them for its shape).
 */
export const ZOOMS = [
  { id: 'wide', label: '×0.5', within: [80, 120], title: 'A phone’s ultra-wide camera, ×0.5' },
  { id: 'normal', label: '×1', within: [50, 85], title: 'A phone’s main camera, ×1, or a camera’s usual lens' },
  { id: 'zoomed', label: '×2–3', within: [20, 55], title: 'Zoomed in two or three times' },
  { id: 'telephoto', label: '×5+', within: [1, 24], title: 'Zoomed in five times or more, on far ridges' },
];

/** A lens across a picture's long side, as degrees across a picture `aspect` wide (width over height). */
export function acrossFor(lens, aspect) {
  if (!(aspect > 0) || aspect >= 1) return lens;
  return (2 * Math.atan(Math.tan((lens * Math.PI) / 360) * aspect) * 180) / Math.PI;
}

/** The kinds of picture, as the analyst picks them. */
export const PICTURES = [
  { id: 'photo', label: 'Photo', title: 'One shot: straight lines stay straight' },
  { id: 'panorama', label: 'Panorama', title: 'A phone’s panorama or a stitched collage: the same degrees per pixel all along' },
];

/** A picture this many times wider than tall is pointed to Panorama. */
export const PANORAMA_ASPECT = 2.2;

/** The widths a panorama of unknown width is searched across, degrees. */
export const PANORAMA_WITHIN = [60, 360];

/** Degrees a phone's frame spans up the sweep: a panorama's width is about its aspect times this. */
export const PANORAMA_FRAME = 60;

/**
 * The most degrees a panorama spans from top to bottom: a phone's ultra-wide frame held upright. A panorama of
 * unknown width is never searched wider than its aspect times this (the bench's truths stand at 83° at most).
 */
export const PANORAMA_TALL = 110;

/**
 * A lens measured on the video's pan is a reading, not the camera's own (a stabilised video crops): Find searches
 * it this many times either way. Measured on the bench's one such case: the truth explains 0.44 held exact, 0.62 so.
 */
export const MEASURED_GIVE = 1.05;

/**
 * The span a stitch says for its strip is what joining the frames worked out, not the camera's: Find searches it
 * this share either way, as the engine does a stitch's frames (horizon_finds.STITCHED_GIVE, where it is measured).
 */
export const STITCHED_GIVE = 0.2;

/** The reaches the panorama keeps its skyline at, metres: the app's SKYLINE_CUTS. */
export const REACHES = [2_000, 5_000, 10_000, 20_000, 50_000, 100_000];

/** The farthest reach Fit tries when left to itself, metres. */
export const AUTO_REACH = 50_000;

/** Half the sector "roughly this way" stands for, degrees. */
export const FACING_HALF = 30;

/** Nothing known: a photo, any lens, any heading, every reach up to `AUTO_REACH` tried. */
export const NO_HINTS = Object.freeze({ picture: 'photo', zoom: Object.freeze([]), facing: null, reach: 'auto' });

/** A reach as words: "20 km". */
export function reachText(metres) {
  return `${Math.round(metres / 1000)} km`;
}

/**
 * The zoom words ticked, in the menu's order: a list of ids, or one word as
 * views saved before several could be ticked keep it ('any' is none).
 */
export function cleanZoom(zoom) {
  const said = new Set(Array.isArray(zoom) ? zoom : [zoom]);
  return ZOOMS.filter((z) => said.has(z.id)).map((z) => z.id);
}

/** A zoom word ticked or unticked. */
export function toggleZoom(zoom, id) {
  const now = cleanZoom(zoom);
  return cleanZoom(now.includes(id) ? now.filter((one) => one !== id) : [...now, id]);
}

/**
 * The lenses the zoom words ticked stand for, degrees across a picture
 * `aspect` wide, from the narrowest to the widest: any lens when none is.
 */
export function zoomWithin(zoom, aspect = 16 / 9) {
  const ticked = ZOOMS.filter((z) => cleanZoom(zoom).includes(z.id));
  if (!ticked.length) return [...ANY_WITHIN];
  const low = acrossFor(Math.min(...ticked.map((z) => z.within[0])), aspect);
  const high = acrossFor(Math.max(...ticked.map((z) => z.within[1])), aspect);
  return [Math.round(low * 10) / 10, Math.round(high * 10) / 10];
}

/** The zoom words ticked, as words: "Wide or normal", '' when none is. */
export function zoomText(zoom) {
  const labels = ZOOMS.filter((z) => cleanZoom(zoom).includes(z.id)).map((z) => z.label);
  if (!labels.length) return '';
  return labels.join(' or ');
}

/**
 * Hints as the app keeps them, whatever they were handed: an unknown word is
 * left out, a sector needs a heading, a reach is auto, all, or one the panorama keeps.
 */
export function cleanHints(hints) {
  const picture = hints?.picture === 'panorama' ? 'panorama' : 'photo';
  const zoom = cleanZoom(hints?.zoom);
  const heading = Number(hints?.facing?.heading);
  const facing = Number.isFinite(heading) ? { heading: ((heading % 360) + 360) % 360, half: FACING_HALF } : null;
  const reach = hints?.reach === 'all' || REACHES.includes(hints?.reach) ? hints.reach : 'auto';
  const fov = Number(hints?.lens?.fov);
  const at = Number(hints?.lens?.at);
  const lens = fov >= 1 && fov <= 150 ? { fov: Math.round(fov * 100) / 100, at: Number.isFinite(at) && at >= 0 ? at : 0 } : null;
  return { picture, zoom, facing, reach, ...(lens ? { lens } : {}) };
}

/**
 * Whether a picture may be read as a panorama: any image, the analyst's call,
 * a hand-made collage included whatever its shape. A video's frames are photos.
 */
export function panoramaOffered({ kind }) {
  return kind === 'image';
}

/**
 * Whether a picture looks like a panorama, which the choice then says: wide
 * (`aspect`, width over height), or exported from a collage Azimut stitched on a
 * cylinder (`stitched`, the photo route's `panorama`).
 */
export function panoramaLikely({ kind, aspect, stitched }) {
  return kind === 'image' && (Boolean(stitched) || aspect >= PANORAMA_ASPECT);
}

/** How many degrees a panorama spans: what its stitch says, else its aspect times a phone's frame, within reason. */
export function panoramaWidth({ aspect, stitched }) {
  if (stitched?.degrees > 0) return Math.min(PANORAMA_WITHIN[1], stitched.degrees);
  const guess = (aspect > 0 ? aspect : PANORAMA_ASPECT) * PANORAMA_FRAME;
  return Math.min(PANORAMA_WITHIN[1], Math.max(PANORAMA_WITHIN[0], guess));
}

/**
 * The band's words for what is known, or '' when nothing is: "Zoomed · 218° SW
 * · within 20 km". `reach` is the cut the trace is read against now, which Fit
 * found on its own when the analyst left it to Auto.
 */
export function hintsSummary(hints, reach = null) {
  const h = cleanHints(hints);
  const parts = [];
  if (h.picture === 'panorama') parts.push('Panorama');
  else if (h.zoom.length) parts.push(zoomText(h.zoom));
  if (h.facing) parts.push(headingText(h.facing.heading, 60));
  if (Number.isFinite(reach)) parts.push(`within ${reachText(reach)}`);
  else if (h.reach === 'all') parts.push('clear air');
  return parts.join(' · ');
}

/**
 * What the search is told (`/api/horizon/match`): the lenses to try unless the
 * photo says its own (a panorama's widths, for a panorama), and the sector. The
 * reach is the request's turn, chosen in `matchRequest`, and the projection the
 * camera's.
 */
export function searchHints(hints, { lensKnown = false, aspect = 16 / 9 } = {}) {
  const h = cleanHints(hints);
  const out = {};
  if (!lensKnown) out.within = h.picture === 'panorama' ? PANORAMA_WITHIN : zoomWithin(h.zoom, aspect);
  if (h.facing) out.facing = [h.facing.heading, h.facing.half];
  return out;
}
