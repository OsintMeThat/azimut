/**
 * The globe draws what the flat map holds.
 *
 * While the 3D view is on, the flat map stays up under the globe with every
 * layer the tools gave it: the overlays, the case's places, the analyst's
 * layers, a measure, the sun's bearing. Rather than each of those learning to
 * draw on the globe, this reads the flat map's style as it stands and draws it
 * there, in its order:
 *
 * - **On the ground** go its rasters, lines and areas, painted per tile over
 *   the imagery (drape.js, drapes.js);
 * - **Standing** are its dots, icons and names, drawn upright on the screen at
 *   their ground (standing.js), on a canvas over the globe;
 * - **Its markers and cards**, the page's own elements, are placed by the
 *   flat map itself, which is told where the globe shows a point: its
 *   `project` and `unproject` answer from the globe, and it is told to place
 *   them again each time the globe moves.
 *
 * And the other way: a press on the globe is handed to the flat map as one of
 * its own mouse events, at the ground under it, and the flat map's hit test
 * answers from what the globe drew. So a click opens the same card, a tool
 * hears it the same way, and a layer that claims its clicks claims them here.
 *
 * Nothing is told about the globe. A change to the style (a layer added, a
 * paint changed) or to a source's data is heard from the flat map's events and
 * repainted where it falls.
 */
import { LngLat, MapMouseEvent, Point } from 'maplibre-gl';
import { featureFilter } from '@maplibre/maplibre-gl-style-spec';
import { DRAPE_SIZE, paintTile } from './drape.js';
import { tileBounds, overlaps } from './drapes.js';
import { createGlyphs } from './glyphs.js';
import { coveringTile, createTileSources, describeSource, readOnce } from './sources.js';
import { drawStanding, markedAt, placeStanding, shiftMark, shiftStanding } from './standing.js';
import { DRAPED, STANDING, compileLayer, evaluable } from './style.js';

/** Of a tile's span, the margin a line just outside it may still paint into. */
const LINE_MARGIN = 0.04;
/** Features in a source past which a change repaints all of its ground, not each feature's. */
const DIFFED = 3000;
/** ms between two placements of the standing marks while the view moves; between them they only move with it. */
const PLACE_MS = 250;
/** Pixels round a press a line is still under it. */
const LINE_REACH = 4;
/**
 * Vector tiles whose features are kept read (`readOnce`): enough for the finer
 * tiles a view paints out of each, few enough that a dense road tile, about a
 * megabyte read, never adds up to much.
 */
const READ_KEPT = 24;
/** The flat map's own handlers, held still while the globe draws so a press on a marker moves nothing under it. */
const HANDLERS = ['dragPan', 'scrollZoom', 'boxZoom', 'dragRotate', 'keyboard', 'doubleClickZoom', 'touchZoomRotate', 'touchPitch'];

const RAD = Math.PI / 180;

/** A box of degrees grown by a share of its size each way. */
function grown(b, share) {
  const dx = (b.east - b.west) * share;
  const dy = (b.north - b.south) * share;
  return { west: b.west - dx, east: b.east + dx, south: b.south - dy, north: b.north + dy };
}

/** The box a geometry's coordinates span, in degrees. */
export function boundsOf(geometry) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const visit = (c) => {
    if (typeof c[0] === 'number') {
      west = Math.min(west, c[0]);
      east = Math.max(east, c[0]);
      south = Math.min(south, c[1]);
      north = Math.max(north, c[1]);
    } else for (const inner of c) visit(inner);
  };
  if (geometry?.type === 'GeometryCollection') return (geometry.geometries ?? []).reduce((box, g) => union(box, boundsOf(g)), null);
  if (geometry?.coordinates) visit(geometry.coordinates);
  return Number.isFinite(west) ? { west, south, east, north } : null;
}

/** Two boxes as the one that holds both; either may be null. */
function union(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { west: Math.min(a.west, b.west), south: Math.min(a.south, b.south), east: Math.max(a.east, b.east), north: Math.max(a.north, b.north) };
}

/** A source's GeoJSON as features the globe reads: one geometry each, its type by name, its box. */
export function featuresOf(data) {
  const list = data?.type === 'FeatureCollection' ? data.features : data?.type === 'Feature' ? [data] : data?.type ? [{ type: 'Feature', geometry: data, properties: {} }] : [];
  const out = [];
  for (const f of list ?? []) {
    if (!f?.geometry) continue;
    const bounds = boundsOf(f.geometry);
    if (!bounds) continue;
    out.push({ type: f.geometry.type, geometry: f.geometry, properties: f.properties ?? {}, id: f.id, bounds });
  }
  return out;
}

/**
 * Where two readings of a source differ: the box of the features that changed
 * between them, or of all of both when there are too many to compare.
 */
export function changedBounds(before, after) {
  if (before.length > DIFFED || after.length > DIFFED) {
    return [...before, ...after].reduce((box, f) => union(box, f.bounds), null);
  }
  const sign = (f) => JSON.stringify([f.geometry, f.properties]);
  let box = null;
  const n = Math.max(before.length, after.length);
  for (let i = 0; i < n; i += 1) {
    const a = before[i];
    const b = after[i];
    if (a && b && (a === b || sign(a) === sign(b))) continue;
    box = union(box, a?.bounds ?? null);
    box = union(box, b?.bounds ?? null);
  }
  return box;
}

/** Longitude and latitude of a point of a vector tile. */
function vectorPoint(p, extent, tile) {
  const n = 2 ** tile.z;
  const x = (tile.x + p.x / extent) / n;
  const y = (tile.y + p.y / extent) / n;
  return { lon: x * 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) / RAD };
}

/** Metres between a point and a segment, near enough flat over a few pixels. */
function metresToSegment(p, a, b) {
  const k = Math.cos(p.lat * RAD) * 111320;
  const ax = (a[0] - p.lon) * k;
  const ay = (a[1] - p.lat) * 111320;
  const bx = (b[0] - p.lon) * k;
  const by = (b[1] - p.lat) * 111320;
  const dx = bx - ax;
  const dy = by - ay;
  const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

/** Whether a point lies inside a polygon's rings (holes taken out). */
function insideRings(p, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > p.lat !== yj > p.lat && p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/**
 * @param {object} map the flat map (MapLibre)
 * @param {object} globe the globe (globe.js)
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas where the standing marks are drawn, over the globe
 * @param {(layerId: string) => boolean} [o.exclude] layers the globe leaves out (its own imagery)
 */
export function createMirror(map, globe, { canvas, exclude = () => false, tiles = createTileSources(), makeCanvas = defaultCanvas } = {}) {
  // the layers drawn, lowest first: { id, order, layer, signature, sourceType, standing }
  let entries = [];
  const bySource = new Map(); // geojson source id → { features, version }
  const reading = new Map(); // geojson source id → the read on its way
  const descriptions = new Map(); // tiled source id → describeSource
  const pointsCache = new Map(); // `${entryId}|${tileKey}` → candidates read off a vector tile
  const sourceCandidates = new Map(); // `${entryId}` → candidates of a GeoJSON source
  const sourcePoints = new Map(); // geojson source id → { version, points } its standing layers share
  const readTiles = new Map(); // vector tile → its features read once, the most recently used last
  let placed = [];
  // the unseen dots (click targets) left where they were placed while the view moved
  let unseenBehind = false;
  let dirty = true;
  // a number per compiled layer, which the points read off its tiles are kept under
  let stamps = 0;
  let synced = false;
  let destroyed = false;
  const glyphs = createGlyphs({ image: (name) => map.getImage?.(name) ?? null, canvas: makeCanvas });
  const patterns = new Map();
  let painter = null;

  // -- the style, read ---------------------------------------------------------------

  /** The flat map's layers as they stand: changes repainted where they fall. */
  function sync() {
    if (destroyed) return;
    const previous = new Map(entries.map((e) => [e.id, e]));
    const next = [];
    let everywhere = !synced;
    let where = null;
    const touched = (entry) => {
      if (entry.standing) {
        sourceCandidates.delete(entry.id);
        dirty = true;
        return;
      }
      if (entry.sourceType === 'geojson') {
        const data = bySource.get(entry.layer.source);
        where = union(where, data?.features.reduce((box, f) => union(box, f.bounds), null) ?? null);
      } else everywhere = true;
    };
    const order = map.getLayersOrder?.() ?? [];
    order.forEach((id, index) => {
      if (exclude(id)) return;
      const styleLayer = map.getLayer(id);
      const spec = styleLayer?.serialize?.();
      if (!spec || (!DRAPED.has(spec.type) && !STANDING.has(spec.type))) return;
      const signature = JSON.stringify(spec);
      const old = previous.get(id);
      previous.delete(id);
      const source = map.getSource(spec.source);
      const entry =
        old?.signature === signature
          ? { ...old, order: index }
          : { id, order: index, layer: compileLayer(spec), signature, sourceType: source?.type, standing: STANDING.has(spec.type), stamp: (stamps += 1) };
      if (!entry.layer) return;
      if (old?.signature !== signature) touched(entry);
      next.push(entry);
      if (source?.type === 'geojson' && !bySource.has(spec.source)) read(spec.source);
      else if (source && source.type !== 'geojson' && !descriptions.get(spec.source)) {
        const description = describeSource(source);
        if (description) {
          descriptions.set(spec.source, description);
          if (!entry.standing) everywhere = true;
          dirty = true;
        }
      }
    });
    for (const gone of previous.values()) touched(gone);
    // the ground's layers in another order paint every tile differently
    const groundOrder = (list) => list.filter((e) => !e.standing).map((e) => e.id).join('|');
    if (groundOrder(next) !== groundOrder(entries)) everywhere = true;
    entries = next;
    synced = true;
    if (everywhere) globe.invalidate();
    else if (where) globe.invalidate(where);
    globe.redraw();
  }

  /** A GeoJSON source read again: the ground repainted where its features changed. */
  function read(sourceId) {
    const source = map.getSource(sourceId);
    if (!source?.getData) return;
    const ticket = {};
    reading.set(sourceId, ticket);
    Promise.resolve(source.getData()).then(
      (data) => {
        if (destroyed || reading.get(sourceId) !== ticket) return;
        reading.delete(sourceId);
        const before = bySource.get(sourceId)?.features ?? [];
        const features = featuresOf(data);
        bySource.set(sourceId, { features, version: (bySource.get(sourceId)?.version ?? 0) + 1 });
        const users = entries.filter((e) => e.layer.source === sourceId);
        for (const e of users) if (e.standing) sourceCandidates.delete(e.id);
        if (users.some((e) => !e.standing)) {
          const box = changedBounds(before, features);
          if (box) globe.invalidate(box);
        }
        dirty = true;
        globe.redraw();
      },
      () => reading.delete(sourceId)
    );
  }

  let syncQueued = false;
  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    queueMicrotask(() => {
      syncQueued = false;
      sync();
    });
  }
  const onStyle = () => queueSync();
  const onSource = (event) => {
    const id = event?.sourceId;
    if (!id) return;
    const source = map.getSource(id);
    if (source?.type === 'geojson' && event.sourceDataType === 'content') {
      if (entries.some((e) => e.layer.source === id)) read(id);
      return;
    }
    // a vector source learns its tiles' address once its TileJSON is in
    if (event.sourceDataType === 'metadata' && source && !descriptions.get(id)) queueSync();
  };
  map.on('styledata', onStyle);
  map.on('sourcedata', onSource);

  // -- the ground, painted -----------------------------------------------------------

  /** A fill's pattern, as the flat map holds it. */
  function pattern(name) {
    const held = map.getImage?.(name);
    if (!held?.data) return null;
    const key = `${name}@${held.version ?? 0}`;
    if (!patterns.has(key)) {
      const { width, height, data } = held.data;
      const picture = makeCanvas(width, height);
      const pixels = new Uint8ClampedArray(data.buffer.slice(data.byteOffset, data.byteOffset + width * height * 4));
      picture.getContext('2d').putImageData(new ImageData(pixels, width, height), 0, 0);
      patterns.set(key, picture);
    }
    return patterns.get(key);
  }

  /** A vector tile read once for the ground it is painted on and the names it holds. */
  function readOf(vector) {
    let read = readTiles.get(vector);
    if (read) readTiles.delete(vector);
    else read = readOnce(vector);
    readTiles.set(vector, read);
    if (readTiles.size > READ_KEPT) readTiles.delete(readTiles.keys().next().value);
    return read;
  }

  /** One tile's picture of what lies on its ground, or null when nothing does. */
  async function compose(tile, signal) {
    const zoom = tile.z - 1;
    const ground = entries.filter((e) => !e.standing && e.layer.visible && e.layer.inRange(zoom));
    if (!ground.length) return null;
    const bounds = grown(tileBounds(tile), LINE_MARGIN);
    const fetched = new Map();
    const prepared = [];
    for (const entry of ground) {
      const { layer } = entry;
      if (entry.sourceType === 'geojson') {
        const features = (bySource.get(layer.source)?.features ?? []).filter((f) => overlaps(f.bounds, bounds));
        if (features.length) prepared.push({ layer, features });
        continue;
      }
      const description = descriptions.get(layer.source);
      const cover = description && coveringTile(description, tile.z, tile.x, tile.y);
      if (!cover) continue;
      if (!fetched.has(layer.source)) fetched.set(layer.source, tiles.get(description, cover));
      const value = await fetched.get(layer.source);
      if (signal?.aborted) throw new DOMException('dropped', 'AbortError');
      if (!value) continue;
      prepared.push(layer.type === 'raster' ? { layer, image: value, from: cover } : { layer, vector: readOf(value), from: cover });
    }
    if (!prepared.length || destroyed) return null;
    painter ??= makeCanvas(DRAPE_SIZE, DRAPE_SIZE);
    const ctx = painter.getContext('2d');
    ctx.clearRect(0, 0, DRAPE_SIZE, DRAPE_SIZE);
    if (!paintTile(ctx, tile, prepared, { images: pattern })) return null;
    if (typeof painter.transferToImageBitmap === 'function') return painter.transferToImageBitmap();
    return createImageBitmap(painter);
  }

  // -- what stands, placed -------------------------------------------------------------

  /**
   * A GeoJSON source's points, read once a version. Each carries the spot its
   * marks share: a layer's dot, its icon and its click target stand on one
   * point, which is projected once a frame for all of them (`project`).
   */
  function pointsOf(sourceId) {
    const data = bySource.get(sourceId);
    if (!data) return [];
    const held = sourcePoints.get(sourceId);
    if (held?.version === data.version) return held.points;
    const points = [];
    for (const f of data.features) {
      const coordinates = f.type === 'Point' ? [f.geometry.coordinates] : f.type === 'MultiPoint' ? f.geometry.coordinates : [];
      if (!coordinates.length) continue;
      const read = evaluable(f.type, f.properties, f.id);
      for (const [lon, lat] of coordinates) points.push({ f, lon, lat, read, spot: {} });
    }
    sourcePoints.set(sourceId, { version: data.version, points });
    return points;
  }

  /** The points of a GeoJSON source a standing layer draws. */
  function geojsonCandidates(entry) {
    let list = sourceCandidates.get(entry.id);
    if (list) return list;
    list = [];
    const { layer } = entry;
    for (const { f, lon, lat, read, spot } of pointsOf(layer.source)) {
      // one the filter refuses at every zoom is never weighed
      if (layer.zoomFree && !layer.accepts(0, read)) continue;
      list.push({ layer, order: entry.order, lat, lon, type: f.type, properties: f.properties, id: f.id, geometry: f.geometry, read, spot });
    }
    sourceCandidates.set(entry.id, list);
    return list;
  }

  /** The points a vector tile holds inside one globe tile, for a standing layer; fetched when not held. */
  function tileCandidates(entry, tile) {
    const description = descriptions.get(entry.layer.source);
    const cover = description && coveringTile(description, tile.z, tile.x, tile.y);
    if (!cover) return [];
    const key = `${entry.stamp}|${tile.z}/${tile.x}/${tile.y}`;
    const cached = pointsCache.get(key);
    if (cached) return cached;
    const vector = tiles.peek(description, cover);
    if (vector === undefined) {
      tiles.get(description, cover).then(() => {
        dirty = true;
        globe.redraw();
      });
      return [];
    }
    const layer = vector ? readOf(vector).layers[entry.layer.sourceLayer] : null;
    const list = [];
    if (layer) {
      const b = tileBounds(tile);
      for (let i = 0; i < layer.length; i += 1) {
        const feature = layer.feature(i);
        if (feature.type !== 1) continue;
        const read = evaluable('Point', feature.properties, feature.id);
        if (entry.layer.zoomFree && !entry.layer.accepts(0, read)) continue;
        for (const ring of feature.loadGeometry()) {
          for (const p of ring) {
            const at = vectorPoint(p, layer.extent, cover);
            // each globe tile keeps its own ground's points, so a point in two tiles' margins is drawn once
            if (at.lon < b.west || at.lon >= b.east || at.lat <= b.south || at.lat > b.north) continue;
            list.push({ layer: entry.layer, order: entry.order, ...at, type: 'Point', properties: feature.properties, id: feature.id, read });
          }
        }
      }
    }
    pointsCache.set(key, list);
    if (pointsCache.size > 4000) pointsCache.clear();
    return list;
  }

  function candidates() {
    const out = [];
    const drawn = globe.drawnTiles();
    for (const entry of entries) {
      if (!entry.standing || !entry.layer.visible) continue;
      if (entry.sourceType === 'geojson') {
        for (const c of geojsonCandidates(entry)) {
          c.order = entry.order;
          out.push(c);
        }
      } else if (entry.sourceType === 'vector') {
        for (const tile of drawn) {
          for (const c of tileCandidates(entry, tile)) {
            c.order = entry.order;
            out.push(c);
          }
        }
      }
    }
    return out;
  }

  function fit() {
    const { width, height } = globe.size();
    const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
    const w = Math.round(width * ratio);
    const h = Math.round(height * ratio);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    return { width, height, ratio };
  }

  // a number a frame: a point's projection is kept on its spot for the frame it was made in
  let pass = 0;
  const project = (lat, lon, memo) => {
    const spot = memo?.spot;
    if (!spot) return globe.standingAt(lat, lon, memo);
    if (spot.pass !== pass) {
      spot.pass = pass;
      spot.at = globe.standingAt(lat, lon, spot);
    }
    return spot.at;
  };
  let placedAt = -Infinity;
  let placeLater = null;

  /**
   * The flat map's markers and cards placed again, through `project`. The flat
   * map answers a `move` by drawing itself again, under the globe where none of
   * it shows, so that repaint is held off for this one.
   */
  function moveMarkers() {
    const own = Object.prototype.hasOwnProperty.call(map, '_update');
    const update = map._update;
    if (typeof update === 'function') map._update = () => map;
    try {
      map.fire('move');
    } finally {
      if (own) map._update = update;
      else delete map._update;
    }
  }

  /**
   * A frame of the globe was drawn: the marks placed again if it moved, and
   * the flat map's markers told. Placing them is the costly part (every name
   * in view weighed against every other), so a moving view places them at
   * most every `PLACE_MS` and only moves them in between, and places them once
   * more after it stops.
   */
  function frame({ moved }) {
    if (destroyed || (!moved && !dirty)) return;
    pass += 1;
    const { width, height, ratio } = fit();
    const now = performance.now();
    if (dirty || now - placedAt >= PLACE_MS) {
      dirty = false;
      placedAt = now;
      clearTimeout(placeLater);
      placeLater = null;
      glyphs.begin();
      placed = placeStanding(
        candidates(),
        { project, zoomAt: (lat, d) => globe.zoomAt(lat, d), width, height, bearing: globe.heading() },
        glyphs
      );
      unseenBehind = false;
      // names still to be written are placed again next frame, a share each frame
      if (placed.waiting) {
        dirty = true;
        requestAnimationFrame(() => globe.redraw());
      }
    } else {
      placed = shiftStanding(placed, project);
      unseenBehind = true;
      placeLater ??= setTimeout(() => {
        placeLater = null;
        dirty = true;
        globe.redraw();
      }, PLACE_MS);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    drawStanding(ctx, placed);
    if (moved) moveMarkers();
  }

  // -- the flat map's questions, answered from the globe ------------------------------

  /** The features drawn under a point or within a box of the screen, top first, as the flat map's hit test answers. */
  function query(geometryOrOptions, maybeOptions) {
    const isGeometry = geometryOrOptions && (Array.isArray(geometryOrOptions) || typeof geometryOrOptions.x === 'number');
    const options = (isGeometry ? maybeOptions : geometryOrOptions) ?? {};
    const size = globe.size();
    let box;
    if (!isGeometry) box = { x0: 0, y0: 0, x1: size.width, y1: size.height };
    else if (Array.isArray(geometryOrOptions) && typeof geometryOrOptions[0] === 'object') {
      const [a, b] = geometryOrOptions.map((p) => Point.convert(p));
      box = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
    } else {
      const p = Point.convert(geometryOrOptions);
      box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    }
    const layers = options.layers ? new Set(options.layers) : null;
    const filter = options.filter ? featureFilter(options.filter, 'filter').filter : null;
    const found = [];
    const take = (layer, feature, geometry, order) => {
      const read = evaluable(feature.type, feature.properties, feature.id);
      if (filter && !filter({ zoom: globe.getZoom() - 1 }, read)) return;
      found.push({
        order,
        feature: {
          type: 'Feature',
          id: feature.id,
          properties: feature.properties,
          geometry,
          layer: { id: layer.id, type: layer.type, source: layer.source },
          source: layer.source,
          sourceLayer: layer.sourceLayer ?? undefined,
          state: {},
        },
      });
    };
    // a click finds the unseen dots where their ground is now, not where the view left them
    if (unseenBehind) {
      const caught = placed.map((mark) => (mark.unseen ? shiftMark(mark, project) : mark)).filter(Boolean);
      caught.waiting = placed.waiting;
      placed = caught;
      unseenBehind = false;
    }
    for (const mark of markedAt(placed, box, layers)) {
      const c = mark.candidate;
      take(c.layer, c, { type: 'Point', coordinates: [c.lon, c.lat] }, c.order + 0.5);
    }
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const at = globe.containerPointToLatLng({ x: cx, y: cy });
    if (at) {
      const zoom = globe.getZoom() - 1;
      const reach = (LINE_REACH + Math.max(box.x1 - box.x0, box.y1 - box.y0) / 2) * globe.metresPerPixelAt(at);
      for (const entry of entries) {
        if (entry.standing || entry.sourceType !== 'geojson' || entry.layer.type === 'raster') continue;
        if (layers && !layers.has(entry.id)) continue;
        if (!entry.layer.visible || !entry.layer.inRange(zoom)) continue;
        const pad = reach / 111320 / Math.max(Math.cos(at.lat * RAD), 0.01);
        const near = { west: at.lon - pad, east: at.lon + pad, south: at.lat - reach / 111320, north: at.lat + reach / 111320 };
        for (const f of bySource.get(entry.layer.source)?.features ?? []) {
          if (!overlaps(f.bounds, near)) continue;
          if (!entry.layer.accepts(zoom, evaluable(f.type, f.properties, f.id))) continue;
          let hit = false;
          if (entry.layer.type === 'fill') {
            const areas = f.type === 'Polygon' ? [f.geometry.coordinates] : f.type === 'MultiPolygon' ? f.geometry.coordinates : [];
            hit = areas.some((rings) => insideRings(at, rings));
          } else {
            const width = Number(entry.layer.paint('line-width', zoom, evaluable(f.type, f.properties, f.id)) ?? 1);
            const lines = f.type === 'LineString' ? [f.geometry.coordinates] : f.type === 'MultiLineString' || f.type === 'Polygon' ? f.geometry.coordinates : f.type === 'MultiPolygon' ? f.geometry.coordinates.flat() : [];
            const tolerance = reach + (width / 2) * globe.metresPerPixelAt(at);
            hit = lines.some((line) => line.some((p, i) => i > 0 && metresToSegment(at, line[i - 1], p) <= tolerance));
          }
          if (hit) take(entry.layer, f, f.geometry, entry.order);
        }
      }
    }
    found.sort((a, b) => b.order - a.order);
    return found.map((f) => f.feature);
  }

  // -- the flat map, answering from the globe ---------------------------------------

  const offscreen = new Point(-1e5, -1e5);
  const overrides = {
    project(lngLat) {
      const ll = LngLat.convert(lngLat);
      const at = globe.standingAt(ll.lat, ll.lng);
      return at ? new Point(at.x, at.y) : offscreen;
    },
    unproject(point) {
      const p = Point.convert(point);
      const at = globe.containerPointToLatLng({ x: p.x, y: p.y }) ?? globe.camera();
      return new LngLat(at.lon, at.lat);
    },
    // the engine's bearing and tilt, which turn and lean a marker laid on the ground
    getBearing: () => globe.heading(),
    getPitch: () => globe.camera().pitch,
    queryRenderedFeatures: query,
  };
  const own = {};
  for (const [name, fn] of Object.entries(overrides)) {
    own[name] = Object.prototype.hasOwnProperty.call(map, name) ? map[name] : undefined;
    map[name] = fn;
  }
  const held = HANDLERS.filter((name) => map[name]?.isEnabled?.());
  for (const name of held) map[name].disable();

  // The flat map's markers stand over the globe, and its own wheel is held
  // still: a wheel over a measure's point or a place's pin is the globe's.
  const container = map.getContainer?.();
  const onWheel = (event) => {
    if (!destroyed && !globe.onSurface(event.target)) globe.wheel(event);
  };
  container?.addEventListener('wheel', onWheel, { passive: false });

  const offPointer = globe.on('pointer', ({ type, event }) => {
    if (!event || destroyed) return;
    map.fire(new MapMouseEvent(type, map, event));
    globe.setCursor(map.getCanvas?.().style.cursor);
  });

  /**
   * What stands on the ground, drawn onto a capture of the globe at `ratio`
   * device pixels per CSS pixel: placed as the screen shows it, its names
   * written afresh at that ratio, all of them at once, so a print is sharp.
   */
  function paintMarks(ctx, ratio) {
    if (destroyed) return;
    const { width, height } = globe.size();
    const sharp = createGlyphs({
      image: (name) => map.getImage?.(name) ?? null,
      canvas: makeCanvas,
      ratio: () => ratio,
      sharpest: Math.min(4, ratio),
      perFrame: Infinity,
      measuredPerFrame: Infinity,
      size: 4096,
    });
    sharp.begin();
    // the capture's own projections: the camera may have moved since the last frame
    pass += 1;
    const marks = placeStanding(
      candidates(),
      { project, zoomAt: (lat, d) => globe.zoomAt(lat, d), width, height, bearing: globe.heading() },
      sharp
    );
    ctx.save();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawStanding(ctx, marks);
    ctx.restore();
  }

  globe.setLaid({ compose, frame, paintMarks });
  sync();
  // placed again once the flat map's markers are where the globe shows them
  map.fire('move');

  return {
    /** For a test: the layers read, lowest first. */
    get entries() {
      return entries;
    },
    get placed() {
      return placed;
    },
    query,
    paintMarks,
    destroy() {
      destroyed = true;
      clearTimeout(placeLater);
      offPointer();
      container?.removeEventListener('wheel', onWheel);
      map.off('styledata', onStyle);
      map.off('sourcedata', onSource);
      globe.setLaid(null);
      for (const [name, value] of Object.entries(own)) {
        if (value === undefined) delete map[name];
        else map[name] = value;
      }
      for (const name of held) map[name]?.enable?.();
      canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      tiles.dispose();
      readTiles.clear();
      // the flat map's markers go back where the flat map shows them
      map.fire('move');
    },
  };
}

function defaultCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(Math.max(1, width), Math.max(1, height));
  const element = document.createElement('canvas');
  element.width = Math.max(1, width);
  element.height = Math.max(1, height);
  return element;
}
