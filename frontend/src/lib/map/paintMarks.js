/**
 * The case's marks painted onto a capture of the map.
 *
 * A place, a placed file and a lead are the page's own elements laid over the map
 * (`lib/map/surface.js` markers), so the map's canvas does not hold them. A capture
 * taken with its layers paints them on where the screen shows them, in the looks
 * `lib/mapMarkers.js` states for both, and grouped the way the map groups them at
 * this zoom (`lib/savedMarkers.js`).
 */
import { paths } from '../../components/Icon.svelte';
import { paintLeadDrop, paintName, paintPlaceDrop, paintTeardrop } from '../mapMarkers.js';
import { groupSavedMarkers, markLook, markName, markerPrecision } from '../savedMarkers.js';

/** How far past the frame a mark's point may be and its drop still reach into it, in CSS pixels. */
const REACH = 48;

/**
 * A colour as a canvas paints it: a theme variable (`var(--anno-3)`, a scene's
 * colour) read off the page, anything else as it is.
 */
export function resolvePaint(colour, root = globalThis.document?.documentElement) {
  const value = String(colour ?? '').trim();
  const name = /^var\((--[a-z0-9-]+)\)$/i.exec(value)?.[1];
  if (!name) return value;
  const read = root && globalThis.getComputedStyle ? globalThis.getComputedStyle(root).getPropertyValue(name).trim() : '';
  return read || '#e5484d';
}

/**
 * Paint the marks onto `ctx`, a crop of the map `rect` (CSS pixels of the map's
 * box) drawn at `scale` canvas pixels to a CSS pixel.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} o
 * @param {object[]} [o.saved] the case's points the map draws (`casePoints`)
 * @param {number} [o.zoom] the map's zoom, which decides how tightly they are grouped
 * @param {boolean} [o.names] whether each place's name is written under it
 * @param {{n: number, lat: number, lon: number}[]} [o.leads] the scene's leads drawn
 * @param {string} [o.leadColour] the scene's colour
 * @param {(at: {lat: number, lon: number}) => ({x: number, y: number}|null)} o.project
 *   where the screen shows a point, or null where it shows none
 * @param {{x: number, y: number, w: number, h: number}} o.rect
 * @param {number} [o.scale]
 */
export function paintCaseMarks(ctx, { saved = [], zoom, names = false, leads = [], leadColour, project, rect, scale = 1 }) {
  const place = (at) => {
    const p = project(at);
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    if (p.x < rect.x - REACH || p.x > rect.x + rect.w + REACH || p.y < rect.y - REACH || p.y > rect.y + rect.h + REACH) return null;
    return { x: (p.x - rect.x) * scale, y: (p.y - rect.y) * scale };
  };
  const accent = resolvePaint('var(--accent)');
  const ink = resolvePaint('var(--accent-text)');
  const marks = groupSavedMarkers(saved, markerPrecision(zoom));
  const named = [];
  for (const mark of marks) {
    const at = place(mark);
    if (!at) continue;
    const look = markLook(mark);
    if (look.kind === 'place') paintPlaceDrop(ctx, at.x, at.y, { colour: look.colour, count: look.count, worked: look.worked, scale });
    else {
      paintTeardrop(ctx, at.x, at.y, {
        fill: accent,
        ring: look.kind === 'media' ? '#fff' : 'rgba(0,0,0,0.55)',
        ink,
        glyph: paths[look.glyph] ?? '',
        count: look.count,
        scale,
      });
    }
    const name = names ? markName(mark) : '';
    if (name) named.push([at, name]);
  }
  // the names over every mark, as the map writes them over the marks around
  for (const [at, name] of named) paintName(ctx, at.x, at.y, name, { scale });
  const colour = resolvePaint(leadColour);
  for (const lead of leads) {
    const at = place(lead);
    if (at) paintLeadDrop(ctx, at.x, at.y, { n: lead.n, colour, scale });
  }
}
