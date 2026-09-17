/** Geographic analyzer inputs have no dependency on a screen or camera. */
export const clone = (value) => JSON.parse(JSON.stringify(value));

export function zoneMarks(zones) {
  return zones.map((zone) => ({ ...zone, side: 'both', colour: '#38bdf8',
    stroke_width: 2, fill_opacity: 0.08, font_size: 12, text: zone.name }));
}

export function marksToZones(marks, previous = []) {
  return marks.filter((mark) => ['rect', 'polygon', 'ellipse'].includes(mark.kind)).map((mark, i) => ({
    id: mark.id, name: previous.find((zone) => zone.id === mark.id)?.name || `Area ${i + 1}`,
    kind: mark.kind, points: clone(mark.points),
  }));
}

export function mapSource(side) {
  if (!side || !['esri-wayback', 'sentinel2'].includes(side.provider)) return null;
  return { provider: side.provider, date: side.sentinel?.date || '',
    release: side.wayback_release ?? null, layer: side.sentinel?.layer || 'TRUE_COLOR',
    maxcc: side.sentinel?.maxcc ?? 30 };
}

/** Display clustering changes only marker layout; persisted candidates stay intact. */
export function displayGroups(rows, project, radius = 24) {
  const groups = [];
  for (const row of rows) {
    const at = project(row.coordinates);
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) continue;
    const near = groups.find((group) => Math.hypot(group.x - at.x, group.y - at.y) < radius);
    if (near) near.rows.push(row);
    else groups.push({ ...at, rows: [row] });
  }
  return groups;
}

export function sourceLabel(source) {
  return source.provider === 'sentinel2'
    ? `Sentinel-2 · ${source.date} · ${source.layer}`
    : `Wayback · release ${source.release}`;
}

/** A zone's outline, the way the engine reads it: `Zone.ring()` in JavaScript. */
export function zoneRing(zone) {
  if (zone.kind === 'polygon') return zone.points;
  const [[x1, y1], [x2, y2]] = zone.points;
  if (zone.kind === 'rect') return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
  const [cx, cy, rx, ry] = [(x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2];
  return Array.from({ length: 64 }, (_, i) => {
    const angle = (i * Math.PI * 2) / 64;
    return [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)];
  });
}

const mercator = (lon, lat) => [
  (lon + 180) / 360,
  (1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2,
];

/**
 * What a run will cost, before anything is fetched: ground area, and how many
 * native tiles the areas touch. The tile count enumerates each zone's bounding
 * box, where the engine masks the outline, so a diagonal polygon is counted
 * high rather than low — a pre-flight number should never promise less work
 * than the run does. The grid comes from the catalogue, so this cannot drift
 * away from the engine's own levels.
 */
export function coverage(zones, grid) {
  let metres = 0;
  const tiles = new Set();
  for (const zone of zones) {
    const ring = zoneRing(zone);
    if (ring.length < 3) continue;
    // Shoelace on a local equirectangular plane: metres per degree of longitude
    // shrink with latitude, and over one area that factor is near enough flat.
    const mid = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
    const scale = Math.cos((mid * Math.PI) / 180) * 111_320;
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      sum += x1 * scale * (y2 * 111_320) - x2 * scale * (y1 * 111_320);
    }
    metres += Math.abs(sum) / 2;
    if (!grid) continue;
    const [zoom, size] = grid;
    const count = 2 ** zoom;
    const xs = ring.map(([lon, lat]) => mercator(lon, lat)[0]);
    const ys = ring.map(([lon, lat]) => mercator(lon, lat)[1]);
    const left = Math.floor(Math.min(...xs) * count);
    const right = Math.ceil(Math.max(...xs) * count) - 1;
    const top = Math.floor(Math.min(...ys) * count);
    const bottom = Math.ceil(Math.max(...ys) * count) - 1;
    if ((right - left + 1) * (bottom - top + 1) > 1e6) return { km2: Infinity, tiles: Infinity, size };
    for (let y = Math.max(0, top); y <= Math.min(count - 1, bottom); y++) {
      for (let x = Math.max(0, left); x <= Math.min(count - 1, right); x++) tiles.add(`${x}/${y}`);
    }
  }
  return { km2: metres / 1e6, tiles: grid ? tiles.size : 0, size: grid?.[1] ?? 0 };
}

/**
 * What a sweep costs in provider requests and in waiting.
 *
 * One frame is one request, and the request is what the run spends its time
 * on — the detection itself is a few milliseconds a tile. The rate below is a
 * round number for a network round trip, so the answer is an order of
 * magnitude, and the panel says "about". Nobody should discover that an area
 * meant forty minutes by starting it.
 */
export const SECONDS_PER_FRAME = 0.35;

/** Frames fetched per tile: the picture reviewed, plus any bands measured. */
export function framesPerTile({ single = false, bands = false } = {}) {
  const pictures = single ? 1 : 2;
  return bands ? pictures * 2 : pictures;
}

export function readableDuration(seconds) {
  if (!Number.isFinite(seconds)) return 'a long time';
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

/**
 * The rectangle the camera is looking at, as a zone. Ids match the annotation
 * marks the drawing canvas makes, because a zone and its mark are the same
 * object seen from the panel and from the map.
 */
export function viewZone(bounds, name = 'Current view') {
  const { west, south, east, north } = bounds;
  return {
    id: crypto.randomUUID(),
    name,
    kind: 'rect',
    points: [[west, north], [east, south]],
  };
}
