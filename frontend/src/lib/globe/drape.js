/**
 * One tile of the globe's ground, painted with what the flat map lays on it.
 *
 * The globe drapes a picture over each of its tiles on top of the imagery: the
 * overlays' own tiles (roads, night lights…), and the lines and areas of every
 * layer drawn on the ground (borders, the analyst's areas, a measured line),
 * in the flat map's order. Painted on a canvas of the tile's own, square on
 * the Web Mercator grid like the imagery, so it lies on the relief exactly as
 * the picture under it does.
 *
 * A stroke keeps its width in pixels of the tile, which the globe draws at
 * about one pixel of the screen near and less far: lines thin out toward the
 * horizon, as lines on the ground do.
 *
 * Pure but for the canvas it is handed: `entries` carry what was fetched, so a
 * test paints a tile with a recording context.
 */
import { evaluable, withOpacity } from './style.js';

const RAD = Math.PI / 180;

/** Pixels across a tile's picture. */
export const DRAPE_SIZE = 256;

/** Where a longitude and latitude fall on tile `z/x/y` painted `size` pixels across. */
export function tilePixel(lon, lat, { z, x, y }, size = DRAPE_SIZE) {
  const n = 2 ** z;
  const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * RAD);
  const my = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  return [(((lon + 180) / 360) * n - x) * size, (my * n - y) * size];
}

/** The engine zoom a globe tile's ground is read at: its own, on 512 px tiles. */
export const engineZoom = (z) => z - 1;

/** A geometry's lines as lists of points: a line, the parts of a multi-line, or the rings of areas. */
function linesOf(geometry) {
  switch (geometry?.type) {
    case 'LineString':
      return [geometry.coordinates];
    case 'MultiLineString':
    case 'Polygon':
      return geometry.coordinates;
    case 'MultiPolygon':
      return geometry.coordinates.flat();
    default:
      return [];
  }
}

/** A geometry's areas as lists of rings, or nothing for a geometry that encloses none. */
function areasOf(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

/** A vector tile's geometry type by name, as the style's filters read it. */
const VECTOR_TYPES = [null, 'Point', 'LineString', 'Polygon'];

function lineStyle(layer, zoom, feature) {
  const width = Number(layer.paint('line-width', zoom, feature) ?? 1);
  const opacity = Number(layer.paint('line-opacity', zoom, feature) ?? 1);
  const colour = layer.paint('line-color', zoom, feature);
  if (!(width > 0) || !(opacity > 0) || !colour) return null;
  const dash = layer.paint('line-dasharray', zoom, feature);
  return {
    stroke: withOpacity(colour, opacity),
    width,
    // the engine counts a dash in line widths
    dash: Array.isArray(dash) && dash.length ? dash.map((d) => Math.max(0, d) * width) : [],
    cap: layer.layout('line-cap', zoom, feature) ?? 'butt',
    join: layer.layout('line-join', zoom, feature) ?? 'miter',
  };
}

function fillStyle(layer, zoom, feature, images, ctx) {
  const opacity = Number(layer.paint('fill-opacity', zoom, feature) ?? 1);
  if (!(opacity > 0)) return null;
  const pattern = layer.paint('fill-pattern', zoom, feature);
  if (pattern) {
    const image = images?.(pattern);
    if (!image) return null;
    return { fill: ctx.createPattern(image, 'repeat'), alpha: opacity };
  }
  const colour = layer.paint('fill-color', zoom, feature);
  return colour ? { fill: withOpacity(colour, opacity), alpha: 1 } : null;
}

function strokePath(ctx, style) {
  ctx.globalAlpha = 1;
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.width;
  ctx.lineCap = style.cap;
  ctx.lineJoin = style.join;
  ctx.setLineDash(style.dash);
  ctx.stroke();
}

function fillPath(ctx, style) {
  ctx.globalAlpha = style.alpha;
  ctx.fillStyle = style.fill;
  ctx.fill('evenodd');
  ctx.globalAlpha = 1;
}

/** Pixels past the tile's edge a line is still traced, beside its own width, so a join or a cap reaches across whole. */
export const LINE_MARGIN = 8;
/** A point nearer than this to the last one kept, in pixels across and down, adds nothing a tile can show. */
const MIN_STEP = 0.25;

/**
 * The parts of a line, in the tile's pixels, that may show on a tile `size` across: runs of the
 * segments that come within `margin` of it, each with how far along the line it starts (`from`),
 * so a dash keeps its place from one tile to the next. A tile read from an ancestor holds the
 * ancestor's whole line, most of it far off this tile, and tracing it all is what slowed the 3D.
 */
export function visibleRuns(points, size, margin) {
  const low = -margin;
  const high = size + margin;
  const runs = [];
  let run = null;
  let along = 0;
  const close = () => {
    if (run.points.at(-1) !== run.end) run.points.push(run.end);
    delete run.end;
    run = null;
  };
  for (let i = 1; i < points.length; i += 1) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const meets = Math.max(ax, bx) >= low && Math.min(ax, bx) <= high && Math.max(ay, by) >= low && Math.min(ay, by) <= high;
    if (meets) {
      if (!run) {
        run = { from: along, points: [points[i - 1]], end: null };
        runs.push(run);
      }
      const last = run.points.at(-1);
      if (Math.abs(bx - last[0]) + Math.abs(by - last[1]) >= MIN_STEP) run.points.push(points[i]);
      run.end = points[i];
    } else if (run) close();
    along += Math.hypot(bx - ax, by - ay);
  }
  if (run) close();
  return runs;
}

/** Stroke what of `lines` may show on the tile; false when none of it does. A dash starts each run where the whole line has it. */
function strokeLines(ctx, lines, style, size) {
  const runs = lines.flatMap((points) => visibleRuns(points, size, LINE_MARGIN + style.width));
  if (!runs.length) return false;
  if (style.dash.length) {
    for (const run of runs) {
      trace(ctx, [run.points], false);
      ctx.lineDashOffset = run.from;
      strokePath(ctx, style);
    }
    ctx.lineDashOffset = 0;
  } else {
    trace(ctx, runs.map((run) => run.points), false);
    strokePath(ctx, style);
  }
  return true;
}

/** Trace lists of points (already in pixels) as one path. */
function trace(ctx, lines, close) {
  ctx.beginPath();
  for (const points of lines) {
    if (points.length < 2) continue;
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i][0], points[i][1]);
    if (close) ctx.closePath();
  }
}

/** A raster overlay's tile, or the part of an ancestor's that covers this one. */
function paintRaster(ctx, size, tile, { layer, image, from }, zoom) {
  if (!image) return 0;
  const opacity = Number(layer.paint('raster-opacity', zoom, null) ?? 1);
  if (!(opacity > 0)) return 0;
  const up = tile.z - from.z;
  const span = (image.width ?? size) / 2 ** up;
  const sx = (tile.x - from.x * 2 ** up) * span;
  const sy = (tile.y - from.y * 2 ** up) * span;
  ctx.globalAlpha = opacity;
  ctx.drawImage(image, sx, sy, span, span, 0, 0, size, size);
  ctx.globalAlpha = 1;
  return 1;
}

/** The features of one layer from a GeoJSON source, in longitude and latitude. */
function paintGeoJson(ctx, size, tile, { layer, features }, zoom, images) {
  let drawn = 0;
  const px = ([lon, lat]) => tilePixel(lon, lat, tile, size);
  for (const feature of features ?? []) {
    const read = evaluable(feature.type, feature.properties, feature.id);
    if (!layer.accepts(zoom, read)) continue;
    if (layer.type === 'fill') {
      const areas = areasOf(feature.geometry);
      if (!areas.length) continue;
      const style = fillStyle(layer, zoom, read, images, ctx);
      if (!style) continue;
      trace(ctx, areas.flat().map((ring) => ring.map(px)), true);
      fillPath(ctx, style);
      drawn += 1;
    } else {
      const lines = linesOf(feature.geometry);
      if (!lines.length) continue;
      const style = lineStyle(layer, zoom, read);
      if (!style) continue;
      if (strokeLines(ctx, lines.map((line) => line.map(px)), style, size)) drawn += 1;
    }
  }
  return drawn;
}

/** The features of one layer from a vector tile, which may be an ancestor of this tile. */
function paintVector(ctx, size, tile, { layer, vector, from }, zoom, images) {
  const source = vector?.layers?.[layer.sourceLayer];
  if (!source) return 0;
  const up = tile.z - from.z;
  const scale = (size * 2 ** up) / source.extent;
  const ox = (tile.x - from.x * 2 ** up) * size;
  const oy = (tile.y - from.y * 2 ** up) * size;
  const wanted = layer.type === 'fill' ? 3 : null;
  let drawn = 0;
  for (let i = 0; i < source.length; i += 1) {
    const feature = source.feature(i);
    if (feature.type === 1 || (wanted && feature.type !== wanted)) continue;
    const read = evaluable(VECTOR_TYPES[feature.type], feature.properties, feature.id);
    if (!layer.accepts(zoom, read)) continue;
    const style = layer.type === 'fill' ? fillStyle(layer, zoom, read, images, ctx) : lineStyle(layer, zoom, read);
    if (!style) continue;
    const rings = feature.loadGeometry().map((ring) => ring.map((p) => [p.x * scale - ox, p.y * scale - oy]));
    if (layer.type === 'fill') {
      trace(ctx, rings, true);
      fillPath(ctx, style);
      drawn += 1;
    } else if (strokeLines(ctx, rings, style, size)) drawn += 1;
  }
  return drawn;
}

/**
 * Paint one tile. `entries` are the ground layers, lowest first, each with
 * what it is drawn from: `{ layer, image, from }` for a raster overlay,
 * `{ layer, vector, from }` for a vector one, `{ layer, features }` for a
 * GeoJSON source. `images(name)` answers a pattern a fill asks for.
 *
 * @returns how many things were painted: none leaves the tile bare
 */
export function paintTile(ctx, tile, entries, { size = DRAPE_SIZE, images = null } = {}) {
  const zoom = engineZoom(tile.z);
  let drawn = 0;
  for (const entry of entries) {
    const { layer } = entry;
    if (!layer.visible || !layer.inRange(zoom)) continue;
    ctx.save();
    if (layer.type === 'raster') drawn += paintRaster(ctx, size, tile, entry, zoom);
    else if (entry.vector) drawn += paintVector(ctx, size, tile, entry, zoom, images);
    else drawn += paintGeoJson(ctx, size, tile, entry, zoom, images);
    ctx.restore();
  }
  return drawn;
}
