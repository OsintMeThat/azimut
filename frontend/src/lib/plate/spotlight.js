/**
 * One country lit on a map, the rest of the world drawn back: darkened, or faded
 * toward the paper. Drawn on the page over the map from the same Natural Earth
 * countries as the globe inset (`world.json`, 1:110 million), with a soft edge, so
 * the outline, coarse at that scale, reads as a light falling off and never as a
 * border laid beside the ground's own.
 *
 * The areas whose sovereignty is disputed and that touch the country (Crimea for
 * Ukraine as for Russia) stand half lit, dotted round: neither in nor out.
 */
import { areaAt, ringsOf } from './globe2d.js';

function inside([x, y], ring) {
  let hit = false;
  for (let index = 0, last = ring.length - 1; index < ring.length; last = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[last];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const boundsOf = (rings) => {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings) for (const [lon, lat] of ring) {
    box[0] = Math.min(box[0], lon); box[1] = Math.min(box[1], lat);
    box[2] = Math.max(box[2], lon); box[3] = Math.max(box[3], lat);
  }
  return box;
};
/** How far apart, in degrees, an area may stand from a country and still touch it at this scale. */
const REACH = 0.3;
const touching = (a, b) => a[0] <= b[2] + REACH && b[0] <= a[2] + REACH && a[1] <= b[3] + REACH && b[1] <= a[3] + REACH;

/** The countries a map can light, by name, A to Z. */
export const countryNames = (world) => [...new Set((world?.countries ?? []).map((country) => country.n))].sort((a, b) => a.localeCompare(b));

/** The country under a point, by name, or '' at sea or in a disputed area. */
export function countryAt(world, lon, lat) {
  const area = areaAt(world, lon, lat);
  return area && world.countries.includes(area) ? area.n : '';
}

const shapes = new WeakMap();
/**
 * What lighting `name` draws: `lit`, the country's rings and the disputed areas just
 * outside it, left out of the shade; `half`, every disputed area touching it, shaded
 * half. Null for a name the world does not hold.
 */
export function spotlightShape(world, name) {
  // worked out once a country: a page drawn again for a drag reads the same
  const known = world ? shapes.get(world) ?? new Map() : null;
  if (known?.has(name)) return known.get(name);
  const shape = shapeOf(world, name);
  if (known) { known.set(name, shape); shapes.set(world, known); }
  return shape;
}

function shapeOf(world, name) {
  const country = world?.countries?.find((entry) => entry.n === name);
  if (!country) return null;
  const rings = ringsOf(country, world.scale);
  const box = boundsOf(rings);
  const lit = [...rings];
  const half = [];
  for (const area of world.disputed ?? []) {
    const own = ringsOf(area, world.scale);
    if (!touching(boundsOf(own), box)) continue;
    // an area inside the country's outline is lit with it already; one beside it is taken out of the shade
    const within = rings.some((ring) => inside(own[0][0], ring));
    if (!within && !own.some((ring) => ring.some((point) => rings.some((other) => near(point, other))))) continue;
    if (!within) lit.push(...own);
    half.push(...own);
  }
  return { lit, half };
}

/** Whether a point stands within reach of a ring's corners. */
const near = ([x, y], ring) => ring.some(([rx, ry]) => Math.abs(rx - x) < REACH && Math.abs(ry - y) < REACH);

/** The shade's colour and strength: darkened toward black, or faded toward the paper. */
export function shadeOf(spotlight, paper = '#ffffff') {
  const strength = Math.max(0.1, Math.min(0.9, spotlight?.dim ?? 0.55));
  return { colour: spotlight?.mode === 'fade' ? paper : '#000000', strength };
}
