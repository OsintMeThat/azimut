/**
 * What the analyst knows about a photo, told to Fit: each optional, each
 * narrowing the search the way a human would.
 *
 * - How zoomed the picture looks, in words rather than millimetres: a video
 *   from the web says no focal, and a crop would make one wrong anyway. Each
 *   word stands for a range of lenses (degrees across), overlapping so a lens
 *   on a border belongs to both.
 * - Roughly which way it faces: a sector about the heading the view looked
 *   along when the analyst said so.
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

/** Zoom words, widest first, and the lenses (degrees across) each stands for. */
export const ZOOMS = [
  { id: 'any', label: 'Any', within: [1.5, 120], title: 'Every lens, from a long zoom to a wide angle' },
  { id: 'wide', label: 'Wide', within: [55, 110], title: '55° to 110° across: a phone’s usual camera, or wider' },
  { id: 'normal', label: 'Normal', within: [30, 65], title: '30° to 65° across: zoomed in a little' },
  { id: 'zoomed', label: 'Zoomed', within: [10, 35], title: '10° to 35° across: a phone at 3× to 5×' },
  { id: 'telephoto', label: 'Very zoomed', within: [1, 12], title: '1° to 12° across: a long zoom on far ridges' },
];

/** The reaches the panorama keeps its skyline at, metres: the app's SKYLINE_CUTS. */
export const REACHES = [5_000, 10_000, 20_000, 50_000, 100_000];

/** The farthest reach Fit tries when left to itself, metres. */
export const AUTO_REACH = 50_000;

/** Half the sector "roughly this way" stands for, degrees. */
export const FACING_HALF = 30;

/** Nothing known: any lens, any heading, every reach up to `AUTO_REACH` tried. */
export const NO_HINTS = Object.freeze({ zoom: 'any', facing: null, reach: 'auto' });

/** A reach as words: "20 km". */
export function reachText(metres) {
  return `${Math.round(metres / 1000)} km`;
}

/**
 * Hints as the app keeps them, whatever they were handed: an unknown word is
 * any, a sector needs a heading, a reach is auto, all, or one the panorama keeps.
 */
export function cleanHints(hints) {
  const zoom = ZOOMS.some((z) => z.id === hints?.zoom) ? hints.zoom : 'any';
  const heading = Number(hints?.facing?.heading);
  const facing = Number.isFinite(heading) ? { heading: ((heading % 360) + 360) % 360, half: FACING_HALF } : null;
  const reach = hints?.reach === 'all' || REACHES.includes(hints?.reach) ? hints.reach : 'auto';
  return { zoom, facing, reach };
}

/** Whether nothing is said: Fit searches everything. */
export function saysNothing(hints) {
  const h = cleanHints(hints);
  return h.zoom === 'any' && !h.facing && h.reach === 'auto';
}

/**
 * The band's words for what is known, or '' when nothing is: "Zoomed · 218° SW
 * · within 20 km". `reach` is the cut the trace is read against now, which Fit
 * found on its own when the analyst left it to Auto.
 */
export function hintsSummary(hints, reach = null) {
  const h = cleanHints(hints);
  const parts = [];
  if (h.zoom !== 'any') parts.push(ZOOMS.find((z) => z.id === h.zoom).label);
  if (h.facing) parts.push(headingText(h.facing.heading, 60));
  if (Number.isFinite(reach)) parts.push(`within ${reachText(reach)}`);
  else if (h.reach === 'all') parts.push('clear air');
  return parts.join(' · ');
}

/**
 * What the search is told (`/api/horizon/match`): the lenses to try unless the
 * photo says its own, and the sector. The reach is the request's turn, chosen
 * in `matchRequest`.
 */
export function searchHints(hints, { lensKnown = false } = {}) {
  const h = cleanHints(hints);
  const out = {};
  if (!lensKnown) out.within = ZOOMS.find((z) => z.id === h.zoom).within;
  if (h.facing) out.facing = [h.facing.heading, h.facing.half];
  return out;
}
