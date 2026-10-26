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

const masks = new WeakMap();
/** The finest a mask reads, in degrees: the outlines are drawn at 1:110 million, coarser than that. */
const FINEST = 0.02;
/** The most pixels a mask holds along its longer side. */
const MOST_SIDE = 2048;

/**
 * A shape laid flat on longitudes and latitudes, for a map in 3D that reads it point by
 * point where it cannot trace the outline (a ring passing behind the eye or the globe):
 * how much shade each point takes, 0 lit, 0.5 half lit, 1 in the shade. Null where there
 * is no canvas to rasterise on.
 */
export function shapeMask(world, name, shape) {
  const known = world ? masks.get(world) ?? new Map() : null;
  if (known?.has(name)) return known.get(name);
  const mask = maskOf(shape);
  if (known && mask) { known.set(name, mask); masks.set(world, known); }
  return mask;
}

function maskOf(shape) {
  if (!shape || typeof document === 'undefined') return null;
  const [west, south, east, north] = boundsOf([...shape.lit, ...shape.half]).map((value, index) => value + (index < 2 ? -0.5 : 0.5));
  const step = Math.max(FINEST, Math.max(east - west, north - south) / MOST_SIDE);
  const width = Math.max(1, Math.ceil((east - west) / step));
  const height = Math.max(1, Math.ceil((north - south) / step));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const fill = (rings, colour) => {
    ctx.beginPath();
    for (const ring of rings) {
      ring.forEach(([lon, lat], index) => {
        const [x, y] = [(lon - west) / step, (north - lat) / step];
        if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.closePath();
    }
    ctx.fillStyle = colour;
    ctx.fill();
  };
  // the lit areas in red, the half lit ones in green over them, each its own channel
  ctx.globalCompositeOperation = 'lighter';
  fill(shape.lit, '#ff0000');
  fill(shape.half, '#00ff00');
  const { data } = ctx.getImageData(0, 0, width, height);
  canvas.width = 0;
  canvas.height = 0;
  return {
    shadeAt(lon, lat) {
      const x = Math.floor((lon - west) / step);
      const y = Math.floor((north - lat) / step);
      if (x < 0 || y < 0 || x >= width || y >= height) return 1;
      const at = (y * width + x) * 4;
      if (data[at + 1] > 127) return 0.5;
      return data[at] > 127 ? 0 : 1;
    },
  };
}

/** Whether a point stands within reach of a ring's corners. */
const near = ([x, y], ring) => ring.some(([rx, ry]) => Math.abs(rx - x) < REACH && Math.abs(ry - y) < REACH);

/** The shade's colour and strength: darkened toward black, or faded toward the paper. */
export function shadeOf(spotlight, paper = '#ffffff') {
  const strength = Math.max(0.1, Math.min(0.9, spotlight?.dim ?? 0.55));
  return { colour: spotlight?.mode === 'fade' ? paper : '#000000', strength };
}
