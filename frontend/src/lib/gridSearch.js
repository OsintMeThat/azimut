// Pure geometry + coverage bookkeeping for the Satellite Grid Search mode. A
// grid overlays an area of interest with metric cells you sweep one by one,
// marking each cleared or flagged. Kept free of Leaflet so it can be
// unit-tested; the component only handles drawing, flying and persistence.
//
// The grid is a fixed metric lattice: cells are addressed by integer (i, j)
// offsets from a stationary `anchor`, so resizing the area of interest never
// shifts a cell out from under the mark already on it. Cell size is
// approximately metric (equirectangular from the area's reference latitude) —
// exact enough for city-scale search work, which is all this mode is for.

const M_PER_DEG_LAT = 111320; // WGS84 mean, good enough for a display grid
const MIN_COS = 0.01; // clamp near the poles so the lattice stays finite

/** Cell size in degrees (lat, lon) at a reference latitude. */
export function degSteps(refLat, cellM) {
  const latStep = cellM / M_PER_DEG_LAT;
  const cos = Math.max(MIN_COS, Math.cos((refLat * Math.PI) / 180));
  const lonStep = cellM / (M_PER_DEG_LAT * cos);
  return { latStep, lonStep };
}

/** Bounding box of an area of interest (rect bounds or polygon vertices). */
export function aoiBounds(aoi) {
  if (aoi.type === 'rect') return aoi.bounds;
  const lats = aoi.vertices.map((v) => v[0]);
  const lons = aoi.vertices.map((v) => v[1]);
  return {
    south: Math.min(...lats),
    west: Math.min(...lons),
    north: Math.max(...lats),
    east: Math.max(...lons),
  };
}

/** Build a fresh grid over `aoi` with `cellM`-metre cells (no marks yet). */
export function createGrid(aoi, cellM) {
  const b = aoiBounds(aoi);
  const refLat = (b.south + b.north) / 2;
  const { latStep, lonStep } = degSteps(refLat, cellM);
  return {
    azimut_grid: 1,
    cell_m: cellM,
    anchor: { lat: b.south, lon: b.west }, // south-west corner pins the lattice
    lat_step: latStep,
    lon_step: lonStep,
    aoi,
    statuses: {}, // "i:j" -> 'cleared' | 'flagged'; absent = unchecked
  };
}

export const cellKey = (i, j) => `${i}:${j}`;
export function parseKey(k) {
  const [i, j] = k.split(':').map(Number);
  return [i, j];
}

/** Integer cell indices spanning the area's bounding box (inclusive). */
export function cellRange(grid) {
  const b = aoiBounds(grid.aoi);
  return {
    iMin: Math.floor((b.south - grid.anchor.lat) / grid.lat_step),
    iMax: Math.ceil((b.north - grid.anchor.lat) / grid.lat_step) - 1,
    jMin: Math.floor((b.west - grid.anchor.lon) / grid.lon_step),
    jMax: Math.ceil((b.east - grid.anchor.lon) / grid.lon_step) - 1,
  };
}

/** Lat/lon bounds of one cell. */
export function cellBounds(grid, i, j) {
  const south = grid.anchor.lat + i * grid.lat_step;
  const west = grid.anchor.lon + j * grid.lon_step;
  return { south, west, north: south + grid.lat_step, east: west + grid.lon_step };
}

/** Centre of one cell. */
export function cellCenter(grid, i, j) {
  const b = cellBounds(grid, i, j);
  return { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 };
}

/** Ray-casting point-in-polygon on [lat, lon] vertices. */
export function pointInPolygon(pt, vertices) {
  let inside = false;
  const x = pt.lon;
  const y = pt.lat;
  for (let a = 0, b = vertices.length - 1; a < vertices.length; b = a++) {
    const xi = vertices[a][1];
    const yi = vertices[a][0];
    const xj = vertices[b][1];
    const yj = vertices[b][0];
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

// Orientation sign of the turn p→q→r (x = lon, y = lat).
function orient(p, q, r) {
  return (q.lon - p.lon) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lon - p.lon);
}

// Do the open segments ab and cd properly cross? (collinear touching → false)
function segsCross(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0;
}

/** Does a cell rectangle touch the polygon at all? Any overlap counts, so the
 *  whole drawn shape gets tiled — no bare strip along a slanted edge. */
export function rectIntersectsPolygon(b, vertices) {
  const corners = [
    { lat: b.south, lon: b.west },
    { lat: b.south, lon: b.east },
    { lat: b.north, lon: b.east },
    { lat: b.north, lon: b.west },
  ];
  // a rect corner inside the polygon
  for (const c of corners) if (pointInPolygon(c, vertices)) return true;
  // a polygon vertex inside the rect
  for (const v of vertices) {
    if (v[0] >= b.south && v[0] <= b.north && v[1] >= b.west && v[1] <= b.east) return true;
  }
  // a polygon edge crossing a rect edge
  for (let i = 0; i < vertices.length; i++) {
    const pa = { lat: vertices[i][0], lon: vertices[i][1] };
    const pb = { lat: vertices[(i + 1) % vertices.length][0], lon: vertices[(i + 1) % vertices.length][1] };
    for (let e = 0; e < 4; e++) {
      if (segsCross(pa, pb, corners[e], corners[(e + 1) % 4])) return true;
    }
  }
  return false;
}

/** Cheap upper bound on cell count (the bounding box), before enumerating. */
export function estimateCells(grid) {
  const { iMin, iMax, jMin, jMax } = cellRange(grid);
  return Math.max(0, iMax - iMin + 1) * Math.max(0, jMax - jMin + 1);
}

/** Refuse a grid that would draw more cells than this (guards huge areas). */
export const MAX_CELLS = 20000;

/** Every cell inside the area, in row-major order. A rectangle keeps its whole
 *  bounding box (edge cells that overhang are included so the selection is
 *  fully covered); a polygon keeps every cell that overlaps it. */
export function cellsInAoi(grid) {
  const { iMin, iMax, jMin, jMax } = cellRange(grid);
  const poly = grid.aoi.type === 'polygon' ? grid.aoi.vertices : null;
  const out = [];
  for (let i = iMin; i <= iMax; i++) {
    for (let j = jMin; j <= jMax; j++) {
      if (poly && !rectIntersectsPolygon(cellBounds(grid, i, j), poly)) continue;
      out.push([i, j]);
    }
  }
  return out;
}

/** Coverage tally over the cells currently inside the area. */
export function coverage(grid) {
  const cells = cellsInAoi(grid);
  let cleared = 0;
  let flagged = 0;
  for (const [i, j] of cells) {
    const s = grid.statuses[cellKey(i, j)];
    if (s === 'cleared') cleared++;
    else if (s === 'flagged') flagged++;
  }
  const total = cells.length;
  const done = cleared + flagged;
  return {
    total,
    cleared,
    flagged,
    unchecked: total - done,
    percent: total ? Math.round((done / total) * 100) : 0,
  };
}

/** Left-click cycle: unchecked -> cleared -> flagged -> unchecked. */
export function cycleStatus(current) {
  if (!current) return 'cleared';
  if (current === 'cleared') return 'flagged';
  return null; // back to unchecked
}

/** Next unchecked cell after `afterKey` (wraps once), or null if all done. */
export function nextUnchecked(grid, afterKey) {
  const cells = cellsInAoi(grid);
  if (!cells.length) return null;
  let start = 0;
  if (afterKey) {
    const at = cells.findIndex(([i, j]) => cellKey(i, j) === afterKey);
    start = at >= 0 ? at + 1 : 0;
  }
  for (let n = 0; n < cells.length; n++) {
    const [i, j] = cells[(start + n) % cells.length];
    if (!grid.statuses[cellKey(i, j)]) return [i, j];
  }
  return null;
}

/** Drop marks that no longer fall inside the area (after a resize). Returns a
 *  new statuses object; the lattice is unchanged, so surviving marks stay put. */
export function pruneStatuses(grid) {
  const valid = new Set(cellsInAoi(grid).map(([i, j]) => cellKey(i, j)));
  const next = {};
  for (const k of Object.keys(grid.statuses)) {
    if (valid.has(k)) next[k] = grid.statuses[k];
  }
  return next;
}

/** Resize a rectangle grid to new bounds, keeping the lattice and every mark
 *  still inside it. The whole new box is covered; marks outside are dropped. */
export function resizeRect(grid, bounds) {
  const next = { ...grid, aoi: { type: 'rect', bounds } };
  next.statuses = pruneStatuses(next);
  return next;
}

/** Reshape a polygon grid to new vertices, keeping the lattice and every mark
 *  still inside it. Marks on cells the new shape no longer touches are dropped. */
export function resizePolygon(grid, vertices) {
  const next = { ...grid, aoi: { type: 'polygon', vertices } };
  next.statuses = pruneStatuses(next);
  return next;
}
