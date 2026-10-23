/**
 * Which personal-layer feature sits under the pointer, and which ones a drawn
 * loop encloses, worked out on screen from the editor's own features.
 *
 * On screen, because what the analyst aims at is a picture: a badge is a disc
 * round its point, a plain pin stands above the ground it claims, a line is
 * grabbed within a few pixels of its stroke. The engine's own hit test would
 * answer with tiles' copies, rounded to their grid; these are the features the
 * editor saves.
 */
import { isBadge } from './markerGlyphs.js';

/** How far, in pixels at size 1, a badge reaches round its point… */
const BADGE_REACH = 14;
/** …and how high a plain pin's head stands above its tip, and how wide it is. */
const PIN_HEAD = 20;
const PIN_REACH = 12;
/** How close to a line's stroke a press still takes it. */
const LINE_REACH = 7;

/** Every ring or line of a geometry, as `[lon, lat]` lists. */
export function linesOf(geometry) {
  const type = geometry?.type;
  const coordinates = geometry?.coordinates ?? [];
  if (type === 'LineString') return [coordinates];
  if (type === 'MultiLineString' || type === 'Polygon') return coordinates;
  if (type === 'MultiPolygon') return coordinates.flat();
  return [];
}

/** The outer ring of every part of an area, for the inside test. */
function outerRings(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates[0] ?? []];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.map((polygon) => polygon[0] ?? []);
  return [];
}

export function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = [ring[i].x, ring[i].y], [xj, yj] = [ring[j].x, ring[j].y];
    if ((yi > point.y) !== (yj > point.y) && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function segmentDistance(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/**
 * Where a point feature's picture is centred on screen, and how far it reaches.
 *
 * A marker wearing one of the analyst's icons is centred on its point as a badge
 * is, whatever symbol it keeps underneath. `own(properties)` says, for one drawn
 * as it is, where its painted part sits and how far it reaches, `{ dx, dy, reach }`
 * in screen pixels at size 1; null for a disc, or a picture not read yet, which
 * reach as far as a badge.
 */
export function markerDisc(feature, project, own = null) {
  const [lon, lat] = feature.geometry.coordinates;
  const at = project(lon, lat);
  const scale = Number(feature.properties?.icon_scale) || 1;
  if (feature.properties?.icon) {
    const look = own?.(feature.properties);
    return look ? { x: at.x + look.dx * scale, y: at.y + look.dy * scale, r: look.reach * scale, tip: at }
      : { x: at.x, y: at.y, r: BADGE_REACH * scale, tip: at };
  }
  return isBadge(feature.properties?.symbol)
    ? { x: at.x, y: at.y, r: BADGE_REACH * scale, tip: at }
    : { x: at.x, y: at.y - PIN_HEAD * scale, r: PIN_REACH * scale, tip: at };
}

/** The key of the feature under `at`, or null (`hitPart`). */
export function hitFeature(features, project, at, own = null) {
  return hitPart(features, project, at, own)?.key ?? null;
}

/**
 * The feature under `at` and the part of it pressed, `{ key, part }` with part
 * 'mark', 'stroke' (a line, or the edge of an area) or 'inside' (an area's fill),
 * or null.
 *
 * A mark beats a stroke and a stroke beats an area, since the smaller target
 * is the one aimed at. Among marks, the one drawn on top: `features` come in
 * drawing order, and the last one under the pointer is the one the eye sees
 * there. Among strokes, the nearest; among areas, the smallest.
 */
export function hitPart(features, project, at, own = null) {
  let point = null, line = null, area = null;
  for (const feature of features) {
    const geometry = feature.geometry;
    if (geometry?.type === 'Point') {
      const disc = markerDisc(feature, project, own);
      const distance = Math.min(Math.hypot(at.x - disc.x, at.y - disc.y),
        Math.hypot(at.x - disc.tip.x, at.y - disc.tip.y) + disc.r / 2);
      if (distance <= disc.r) point = { key: feature.properties.key, distance };
      continue;
    }
    for (const ring of linesOf(geometry)) {
      const screen = ring.map(([lon, lat]) => project(lon, lat));
      for (let i = 1; i < screen.length; i += 1) {
        const distance = segmentDistance(at, screen[i - 1], screen[i]);
        if (distance <= LINE_REACH && (!line || distance < line.distance)) line = { key: feature.properties.key, distance };
      }
    }
    for (const ring of outerRings(geometry)) {
      const screen = ring.map(([lon, lat]) => project(lon, lat));
      if (!pointInRing(at, screen)) continue;
      const size = Math.abs(screen.reduce((sum, a, i) => {
        const b = screen[(i + 1) % screen.length];
        return sum + a.x * b.y - b.x * a.y;
      }, 0));
      if (!area || size < area.size) area = { key: feature.properties.key, size };
    }
  }
  if (point) return { key: point.key, part: 'mark' };
  if (line) return { key: line.key, part: 'stroke' };
  return area ? { key: area.key, part: 'inside' } : null;
}

/**
 * The keys of the features a loop drawn on screen encloses: a mark whose point
 * is inside, a line or an area with any of its corners inside.
 */
export function featuresInLoop(features, project, loop) {
  if (loop.length < 3) return [];
  const keys = [];
  for (const feature of features) {
    const geometry = feature.geometry;
    const points = geometry?.type === 'Point' ? [geometry.coordinates] : linesOf(geometry).flat();
    if (points.some(([lon, lat]) => pointInRing(project(lon, lat), loop))) keys.push(feature.properties.key);
  }
  return keys;
}

/** Whether the features selected can be merged: two or more, all lines or all areas. */
export function mergeable(features) {
  if (features.length < 2) return false;
  const kinds = new Set(features.map((feature) => {
    const type = String(feature.geometry?.type ?? '');
    return type.includes('Line') ? 'line' : type.includes('Polygon') ? 'area' : 'point';
  }));
  return kinds.size === 1 && !kinds.has('point');
}

/** Whether one feature splits on its own: it is made of several parts. */
export function splittable(feature) {
  return ['MultiLineString', 'MultiPolygon'].includes(feature?.geometry?.type)
    && (feature.geometry.coordinates?.length ?? 0) > 1;
}
