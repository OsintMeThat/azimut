/**
 * A photo or a video laid over the Horizon view: the arithmetic of matching it.
 *
 * The photo stays fixed on screen and the terrain moves under it, so the frame
 * the view draws into takes the photo's shape (`fitFrame`) and the camera's
 * field of view is the photo's own. What the analyst draws along the photo's
 * skyline is kept in the photo's coordinates, 0 to 1 across and down, so it
 * stays on the photo whatever the window does.
 *
 * Every reading here is an assist, never a verdict: the gap is the angle
 * between the traced skyline and the terrain's, in degrees, over how much of
 * the skyline was traced (`traceGap`); a fit turns the view to close that gap
 * from where the analyst left it (`fitToTrace`), it does not decide where the
 * photo was taken.
 *
 * A video adds time. A pin keeps the view's alignment at a moment of it, and
 * between two pins the view turns as the camera did (`cameraAt`).
 */
import { focal, principal, rayFor, toScreen, turnBetween } from './camera.js';
import { headingText } from './geometry.js';
import { farRange, inBent, pieceOf } from './traceMarks.js';
import { distanceWithin, skylineWithin } from './panorama.js';
import { FOV, heightFor } from './view.js';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
/** A point of the photo, 0 to 1, to a millionth: far under a pixel of any photo laid. */
const fraction = (value) => Math.round(clamp(value, 0, 1) * 1e6) / 1e6;

/**
 * The largest box of a photo's shape inside the room there is, centred, in
 * whole CSS pixels: the photo letterboxed.
 *
 * @param {number} aspect width over height of the photo
 * @param {{ width: number, height: number }} room
 */
export function fitFrame(aspect, room) {
  if (!(aspect > 0) || !(room.width > 0) || !(room.height > 0)) return { width: 0, height: 0, left: 0, top: 0 };
  const width = Math.min(room.width, room.height * aspect);
  const height = width / aspect;
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return { width: w, height: h, left: Math.round((room.width - w) / 2), top: Math.round((room.height - h) / 2) };
}

// -- the loupe ------------------------------------------------------------------

/** The most the loupe magnifies: well past a photo's own pixels, for a trace drawn to the pixel. */
export const LOUPE_MAX = 16;
/** The whole photo in the frame. */
export const NO_LOUPE = Object.freeze({ zoom: 1, x: 0.5, y: 0.5 });

/**
 * How far the view may go from the photo: out to this much wider than the
 * photo, and this many photo widths off its middle, where a straight lens
 * still draws the ground without stretching it past reading.
 */
export const LOUPE_MIN = 0.3;
export const LOUPE_REACH = 2;

/** A loupe kept within reach of the photo: the terrain round it shows where the photo leaves the screen. */
export function clampLoupe({ zoom, x, y }) {
  const z = clamp(Number(zoom) || 1, LOUPE_MIN, LOUPE_MAX);
  const within = (value) => clamp(Number.isFinite(value) ? value : 0.5, 0.5 - LOUPE_REACH, 0.5 + LOUPE_REACH);
  return { zoom: z, x: within(x), y: within(y) };
}

/** The point of the photo under a point of the screen (CSS pixels), 0 to 1 across and down. */
export function photoAt(loupe, x, y, size) {
  return { u: loupe.x + (x / size.width - 0.5) / loupe.zoom, v: loupe.y + (y / size.height - 0.5) / loupe.zoom };
}

/** Where a point of the photo is on screen, in CSS pixels. */
export function screenAt(loupe, u, v, size) {
  return { x: ((u - loupe.x) * loupe.zoom + 0.5) * size.width, y: ((v - loupe.y) * loupe.zoom + 0.5) * size.height };
}

/** The loupe magnified by a factor about a point of the screen, which keeps the point of the photo under it. */
export function zoomLoupe(loupe, factor, at, size) {
  const under = photoAt(loupe, at.x, at.y, size);
  const zoom = clamp(loupe.zoom * factor, LOUPE_MIN, LOUPE_MAX);
  return clampLoupe({ zoom, x: under.u - (at.x / size.width - 0.5) / zoom, y: under.v - (at.y / size.height - 0.5) / zoom });
}

/** The loupe moved with the hand: the photo follows a drag of `dx`, `dy` CSS pixels. */
export function panLoupe(loupe, dx, dy, size) {
  return clampLoupe({ ...loupe, x: loupe.x - dx / size.width / loupe.zoom, y: loupe.y - dy / size.height / loupe.zoom });
}

/** Whether a loupe shows anything but the whole photo in the frame. */
export const loupeMoved = (loupe) => Boolean(loupe) && (loupe.zoom !== 1 || loupe.x !== 0.5 || loupe.y !== 0.5);

// -- the photo moved over a terrain that stays put -------------------------------

/**
 * The lens turned so that the ground under a point of the screen is the
 * ground that was there before the loupe moved: `camera` is the view's own
 * lens, `loupe` the one it was seen through, `next` what changes of the lens
 * and `nextLoupe` the loupe it is seen through now. Returns `{ heading, tilt }`.
 */
function groundKept(camera, loupe, next, nextLoupe, at, size) {
  const before = rayFor({ ...camera, width: size.width, height: size.height, loupe }, at.x, at.y);
  const after = { ...camera, ...next, width: size.width, height: size.height, loupe: nextLoupe };
  for (let pass = 0; pass < 8; pass += 1) {
    const seen = rayFor(after, at.x, at.y);
    const turn = turnBetween(seen.azimuth, before.azimuth);
    const lift = before.elevation - seen.elevation;
    after.heading += turn;
    after.tilt += lift;
    if (Math.abs(turn) + Math.abs(lift) < 1e-9) break;
  }
  return { heading: after.heading, tilt: after.tilt };
}

/**
 * The photo slid over the terrain by a drag of `dx`, `dy` CSS pixels, the
 * terrain staying where it is: the loupe follows the hand and the lens turns
 * the other way, so the ground under `at` stays under it. The photo and the
 * lens move together, so where the photo lies on the terrain is all that
 * changes. Returns `{ loupe, heading, tilt }`.
 */
export function slidPhoto(camera, loupe, dx, dy, at, size) {
  const next = panLoupe(loupe, dx, dy, size);
  return { loupe: next, ...groundKept(camera, loupe, {}, next, at, size) };
}

/**
 * The photo grown by `factor` about a point of the screen, the terrain staying
 * where it is: the loupe magnifies, and the photo's lens widens by as much, so
 * the terrain keeps its size on screen while the photo covers more of it (a
 * cropped or zoomed frame is a narrower lens than its file says). Held to
 * the loupe's reach and to `fov`'s `{ min, max }`. Returns `{ loupe, fov,
 * heading, tilt }`.
 */
export function grownPhoto(camera, loupe, factor, at, size, fov = FOV) {
  const tan = (degrees) => Math.tan((degrees * Math.PI) / 360);
  let zoom = clamp(loupe.zoom * factor, LOUPE_MIN, LOUPE_MAX);
  // the screen keeps its scale: a lens tangent grows with the loupe
  let wide = (Math.atan(tan(camera.fov) * (zoom / loupe.zoom)) * 360) / Math.PI;
  const held = clamp(wide, fov.min, fov.max);
  if (held !== wide) {
    zoom = loupe.zoom * (tan(held) / tan(camera.fov));
    wide = held;
  }
  const next = zoomLoupe(loupe, zoom / loupe.zoom, at, size);
  return { loupe: next, fov: wide, ...groundKept(camera, loupe, { fov: wide }, next, at, size) };
}


// -- a lens's curve --------------------------------------------------------------

/** The most a photo's lens curve is undone either way: the curve stays one to one out to the corners. */
export const BEND_MAX = 0.3;

/** A lens's curve undone, said as a number with its kind: "None", "Barrel 0.12", "Pincushion 0.05". */
export function bendText(k) {
  return !k ? 'None' : `${k < 0 ? 'Barrel' : 'Pincushion'} ${Math.abs(k).toFixed(2)}`;
}

/** A photo's half-diagonal in its own coordinates across and down, which the curve is measured in. */
export function bendShape(aspect) {
  const diagonal = Math.hypot(aspect, 1);
  return { across: (2 * aspect) / diagonal, down: 2 / diagonal };
}

const bendRadius = (u, v, shape) => Math.hypot((u - 0.5) * shape.across, (v - 0.5) * shape.down);

/**
 * Where a curving lens put a point a straight one would have put at `point`,
 * both the photo's own (0 to 1): the photo's pixel that belongs there. `k` < 0
 * is a barrel (the edges bowed in, a wide lens, an action camera), `k` > 0 a
 * pincushion; the distance from the middle grows by 1 + k r², r in
 * half-diagonals, so k = −0.1 pulls the corners in by a tenth.
 */
export function bent(point, k, shape) {
  if (!k) return point;
  const r = bendRadius(point.u, point.v, shape);
  const grow = 1 + k * r * r;
  return { u: 0.5 + (point.u - 0.5) * grow, v: 0.5 + (point.v - 0.5) * grow };
}

/** …and back: where a straight lens would have put the photo's pixel at `point`. */
export function straightened(point, k, shape) {
  if (!k) return point;
  const far = bendRadius(point.u, point.v, shape);
  if (!(far > 0)) return point;
  // the radius a straight lens gives, r + k r³ = far, by Newton from the curved one
  let r = far;
  for (let i = 0; i < 12; i += 1) {
    const step = (r + k * r * r * r - far) / (1 + 3 * k * r * r);
    r -= step;
    if (Math.abs(step) < 1e-10) break;
  }
  const shrink = r / far;
  return { u: 0.5 + (point.u - 0.5) * shrink, v: 0.5 + (point.v - 0.5) * shrink };
}

// -- the photo's shape, pulled by its corners ----------------------------------------

/**
 * The photo's four corners where it lies untouched, in the frame's own
 * coordinates (0 to 1 across and down): top left, top right, bottom right,
 * bottom left. A warp is the same four, moved: the photo is drawn between
 * them in perspective, as a collage's piece is, which squares a photo taken
 * at a slant or squeezes a stretched one back.
 */
export const FLAT_CORNERS = Object.freeze([
  Object.freeze({ u: 0, v: 0 }),
  Object.freeze({ u: 1, v: 0 }),
  Object.freeze({ u: 1, v: 1 }),
  Object.freeze({ u: 0, v: 1 }),
]);

/** How far past the frame a corner may be pulled, in frames: far enough to stretch, near enough to find again. */
export const WARP_REACH = 1;

/** A corner kept within reach of the frame. */
export function clampCorner({ u, v }) {
  return { u: clamp(u, -WARP_REACH, 1 + WARP_REACH), v: clamp(v, -WARP_REACH, 1 + WARP_REACH) };
}

/** Whether four corners are where an untouched photo has them. */
export function isFlat(corners) {
  return !corners || corners.every((corner, index) => Math.abs(corner.u - FLAT_CORNERS[index].u) < 1e-9 && Math.abs(corner.v - FLAT_CORNERS[index].v) < 1e-9);
}

/**
 * The 3×3 matrix, row by row, that takes a point of the photo (0 to 1) to
 * where it lies between four corners (Heckbert's square to quad). Null when
 * the corners have folded onto a line.
 */
export function warpMatrix(corners) {
  const [p0, p1, p2, p3] = corners;
  const sx = p0.u - p1.u + p2.u - p3.u;
  const sy = p0.v - p1.v + p2.v - p3.v;
  const dx1 = p1.u - p2.u;
  const dx2 = p3.u - p2.u;
  const dy1 = p1.v - p2.v;
  const dy2 = p3.v - p2.v;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-12) return null;
  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;
  return [
    p1.u - p0.u + g * p1.u, p3.u - p0.u + h * p3.u, p0.u,
    p1.v - p0.v + g * p1.v, p3.v - p0.v + h * p3.v, p0.v,
    g, h, 1,
  ];
}

/** A 3×3 matrix's inverse, row by row; null for one that has none. */
export function invertMatrix(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
}

/** A point through a 3×3 matrix, in perspective. */
export function throughMatrix(m, { u, v }) {
  const w = m[6] * u + m[7] * v + m[8];
  return { u: (m[0] * u + m[1] * v + m[2]) / w, v: (m[3] * u + m[4] * v + m[5]) / w };
}

/** Where a point of the photo lies in the frame once its corners are pulled. */
export function warped(point, corners) {
  const m = corners && !isFlat(corners) ? warpMatrix(corners) : null;
  return m ? throughMatrix(m, point) : point;
}

/** …and back: the point of the photo under a point of the frame. */
export function unwarped(point, corners) {
  const m = corners && !isFlat(corners) ? warpMatrix(corners) : null;
  const back = m && invertMatrix(m);
  return back ? throughMatrix(back, point) : point;
}

/**
 * What the GPU reads a pixel of the photo through: the frame to the photo,
 * as a 3×3 matrix column by column (GLSL's order). The identity for none.
 */
export function warpUniform(corners) {
  const m = corners && !isFlat(corners) ? warpMatrix(corners) : null;
  const back = m ? invertMatrix(m) : null;
  if (!back) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return [back[0], back[3], back[6], back[1], back[4], back[7], back[2], back[5], back[8]];
}

/**
 * The photo's grid as it shows: its edges and `lines` − 1 lines each way
 * between them, each a polyline of `samples` + 1 points of the frame, taken
 * through `through` (a point of the photo to where it shows). A grid drawn
 * over the photo while it is reshaped says what the corners and the curve do
 * to it.
 */
export function photoGrid(through, { lines = 4, samples = 24 } = {}) {
  const polylines = [];
  for (let k = 0; k <= lines; k += 1) {
    const at = k / lines;
    const across = [];
    const down = [];
    for (let i = 0; i <= samples; i += 1) {
      const along = i / samples;
      across.push(through({ u: along, v: at }));
      down.push(through({ u: at, v: along }));
    }
    polylines.push(across, down);
  }
  return polylines;
}

/** The middle of each of the photo's edges where its corners put it: top, right, bottom, left. */
export function edgeMiddles(corners) {
  return [
    { u: 0.5, v: 0 },
    { u: 1, v: 0.5 },
    { u: 0.5, v: 1 },
    { u: 0, v: 0.5 },
  ].map((point) => warped(point, corners));
}

/**
 * The corners with one edge moved by `delta` (`{ x, y }` screen pixels; the
 * photo is `scale` (`{ width, height }`) big on screen): the edge's two
 * corners move together, which stretches or squeezes the photo that way.
 * Unless `free`, only the part of the move across the edge is taken, as a
 * side handle does. Edge 0 is the top, then clockwise.
 */
export function edgeMoved(corners, edge, delta, scale, { free = false } = {}) {
  const a = corners[edge];
  const b = corners[(edge + 1) % 4];
  let { x, y } = delta;
  if (!free) {
    const along = { x: (b.u - a.u) * scale.width, y: (b.v - a.v) * scale.height };
    const length = Math.hypot(along.x, along.y);
    if (length > 0) {
      const normal = { x: -along.y / length, y: along.x / length };
      const across = x * normal.x + y * normal.y;
      x = across * normal.x;
      y = across * normal.y;
    }
  }
  const du = x / scale.width;
  const dv = y / scale.height;
  return corners.map((corner, index) => (index === edge || index === (edge + 1) % 4 ? { u: corner.u + du, v: corner.v + dv } : corner));
}

/** Whether a point of the frame lies inside the four corners. */
export function insideCorners(point, corners) {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i, i += 1) {
    const a = corners[i];
    const b = corners[j];
    if (a.v > point.v !== b.v > point.v && point.u < ((b.u - a.u) * (point.v - a.v)) / (b.v - a.v) + a.u) inside = !inside;
  }
  return inside;
}

/**
 * A stroke drawn in CSS pixels, as the photo's own coordinates (0 to 1), close
 * points dropped; through a loupe, the point of the photo under each.
 */
export function strokeFrom(points, size, { spacing = 1.5, loupe = NO_LOUPE } = {}) {
  const kept = [];
  let last = null;
  for (const point of points) {
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < spacing) continue;
    const at = photoAt(loupe, point.x, point.y, size);
    kept.push({ u: fraction(at.u), v: fraction(at.v) });
    last = point;
  }
  return kept;
}

const between = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function pointToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / length, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function crosses(a, b, c, d) {
  const side = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

function segmentToSegment(a, b, c, d) {
  if (crosses(a, b, c, d)) return 0;
  return Math.min(pointToSegment(a, c, d), pointToSegment(b, c, d), pointToSegment(c, a, b), pointToSegment(d, a, b));
}

/**
 * Strokes with what lies within `radius` screen pixels of a path rubbed out.
 * Strokes and path are in the photo's coordinates; `scale` is the photo's
 * size on screen (through a loupe, its magnified size). A stroke rubbed
 * through the middle becomes two, and a piece too short to be a line goes.
 * The strokes come back as they were when nothing was rubbed.
 */
export function eraseStrokes(strokes, path, radius, scale) {
  return erasedFrom(strokes, path, radius, scale).strokes;
}

/**
 * As `eraseStrokes`, and for each stroke left, the index of the stroke it
 * came from (`from`): the pieces of a rubbed stroke share one.
 */
export function erasedFrom(strokes, path, radius, scale) {
  const untouched = { strokes, from: strokes.map((_, i) => i) };
  if (!path.length || !(radius > 0)) return untouched;
  const toPx = (p) => ({ x: p.u * scale.width, y: p.v * scale.height });
  const toPhoto = (p) => ({ u: fraction(p.x / scale.width), v: fraction(p.y / scale.height) });
  const rub = path.map(toPx);
  const rubs = rub.length > 1 ? rub.slice(1).map((end, i) => [rub[i], end]) : [[rub[0], rub[0]]];
  const near = (p) => rubs.some(([a, b]) => pointToSegment(p, a, b) < radius);
  const touches = (a, b) => rubs.some(([c, d]) => segmentToSegment(a, b, c, d) < radius);
  let changed = false;
  const kept = [];
  const from = [];
  strokes.forEach((stroke, index) => {
    const line = stroke.map(toPx);
    let piece = [];
    const close = () => {
      if (piece.length > 1) {
        kept.push(piece);
        from.push(index);
      }
      piece = [];
    };
    if (near(line[0])) changed = true;
    else piece.push(stroke[0]);
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1];
      const b = line[i];
      if (!touches(a, b)) {
        piece.push(stroke[i]);
        continue;
      }
      // the stretch the rubber crossed, walked finely enough to cut it where it did
      changed = true;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (radius / 3)));
      for (let k = 1; k <= steps; k += 1) {
        const at = k === steps ? b : between(a, b, k / steps);
        if (near(at)) close();
        else piece.push(k === steps ? stroke[i] : toPhoto(at));
      }
    }
    close();
  });
  return changed ? { strokes: kept, from } : untouched;
}

/** The most points a trace is read at: plenty for a skyline, cheap enough per frame. */
export const TRACE_SAMPLES = 480;

/**
 * Points along every stroke, evenly spaced on screen, in CSS pixels of a frame
 * this size: a stroke drawn slowly weighs no more than one drawn fast. Each
 * says the index of the stroke it lies on (`stroke`).
 */
export function traceSamples(strokes, size, { spacing = 4, most = TRACE_SAMPLES } = {}) {
  if (!(size.width > 0) || !(size.height > 0)) return [];
  const lines = strokes.map((stroke) => stroke.map((p) => ({ x: p.u * size.width, y: p.v * size.height })));
  let length = 0;
  for (const line of lines) {
    for (let i = 1; i < line.length; i += 1) length += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
  }
  const step = Math.max(spacing, length / most);
  const samples = [];
  lines.forEach((line, stroke) => {
    if (line.length === 1) {
      samples.push({ ...line[0], stroke });
      return;
    }
    let carried = 0;
    samples.push({ ...line[0], stroke });
    for (let i = 1; i < line.length; i += 1) {
      const a = line[i - 1];
      const b = line[i];
      const span = Math.hypot(b.x - a.x, b.y - a.y);
      let at = step - carried;
      while (at <= span) {
        const t = at / span;
        samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, stroke });
        at += step;
      }
      carried = span - (at - step);
    }
  });
  return samples.slice(0, most * 2);
}

/**
 * How far the terrain's skyline may be off, in cells of its heights seen from
 * the ridge's distance: half a cell, a ridge's crest lying between two samples.
 */
export const MARGIN_CELLS = 0.5;

/**
 * How far the terrain's skyline may be off at an azimuth, degrees: wide on a
 * ridge a few hundred metres off, next to nothing on one far out, as coarse as
 * the heights the panorama was read from (`resolution`). None where the
 * panorama says no distance. It is shown, as a band round the skyline, and
 * never counted: forgiving near ridges was measured to lift wrong places more
 * than the right one (engine/skymatch.py).
 */
export function terrainMargin(panorama, azimuth, reach = null) {
  const detail = panorama?.resolution;
  const distance = distanceWithin(panorama, reach);
  if (!(detail > 0) || !distance?.length) return 0;
  const { start, step, count } = panorama.azimuth;
  const column = Math.round(((((azimuth - start) % 360) + 360) % 360) / step) % count;
  const far = distance[column];
  if (!(far > 0)) return 0;
  return ((MARGIN_CELLS * detail) / Math.max(far, detail)) * (180 / Math.PI);
}

/**
 * How fine the terrain is where a photo is matched, in words for the trace:
 * a near ridge is known only that coarsely, so its rocks need no tracing.
 * Empty while the grain is unknown.
 */
/** Relief known to this many metres or coarser is the planet's model, not a survey: near ridges are rounder in it than in a photo. */
export const COARSE_RELIEF_M = 20;

export function reliefWords(detail) {
  if (!(detail > 0)) return '';
  const metres = Math.round(detail);
  return metres >= COARSE_RELIEF_M
    ? `Relief here is known to ${metres} m: trace a near ridge’s shape, not its rocks or trees.`
    : `Relief here is known to ${metres} m, from a national survey.`;
}

/**
 * The terrain's skyline at an azimuth, between the two columns either side:
 * degrees, or null where no ground stands (open sea, off a window). `reach`
 * reads the skyline as it stands if the air stops that far out (panorama.js `skylineWithin`).
 */
export function skylineBetween(panorama, azimuth, reach = null) {
  const angles = skylineWithin(panorama, reach);
  if (!angles?.length) return null;
  const { start, step, count, full } = panorama.azimuth;
  const x = ((((azimuth - start) % 360) + 360) % 360) / step;
  const c0 = Math.floor(x);
  const turn = full === false ? Infinity : count;
  const i0 = c0 % turn;
  const i1 = (c0 + 1) % turn;
  if (i0 >= count || i1 >= count) return null;
  const a = angles[i0];
  const b = angles[i1];
  if (!Number.isFinite(a) && !Number.isFinite(b)) return null;
  if (!Number.isFinite(a)) return b;
  if (!Number.isFinite(b)) return a;
  return a + (b - a) * (x - c0);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** How each sampled point stands against the terrain's skyline, through a camera: degrees, + above it. */
/**
 * The camera each piece of a cut collage is seen through: the whole's, eased
 * by the turn, tilt and roll the search found for that piece
 * (engine/skymatch.py `pieces_of`). With no pieces, the whole's everywhere.
 *
 * @param {object} camera the whole's
 * @param {{piece:number, turn:number, tilt:number, roll:number, about?:number[]}[]|null} pieces
 * @returns {(piece: number) => object}
 */
export function pieceCameras(camera, pieces) {
  if (!pieces?.length) return () => camera;
  const eased = new Map(
    pieces.map((p) => [
      p.piece,
      // a piece of the strip rolls about its own middle, which the search says (`about`)
      { ...camera, heading: camera.heading + p.turn, tilt: camera.tilt + p.tilt, roll: (camera.roll ?? 0) + p.roll, ...(p.about ? { pivot: { x: p.about[0], y: p.about[1] } } : {}) },
    ])
  );
  return (piece) => eased.get(piece) ?? camera;
}

/** The camera a point of the frame (`{ u, v }`) is seen through, its piece's when the collage is cut and eased. */
function cameraOver(camera, { pieces = null, pieceAt = null } = {}) {
  if (!pieces?.length || !pieceAt) return () => camera;
  const of = pieceCameras(camera, pieces);
  return (point) => of(pieceAt(point));
}

function residuals(samples, camera, skyline, through = () => camera) {
  const out = [];
  for (const sample of samples) {
    const ray = rayFor(through({ u: sample.x / camera.width, v: sample.y / camera.height }), sample.x, sample.y);
    const top = skyline(ray.azimuth);
    if (top == null) continue;
    out.push({ gap: ray.elevation - top, azimuth: ray.azimuth });
  }
  return out;
}

/** Degrees of the turn the trace covers, counted in quarter-degree slices so a back-and-forth counts once. */
function spanOf(found) {
  const slices = new Set(found.map((r) => Math.floor((((r.azimuth % 360) + 360) % 360) * 4)));
  return slices.size / 4;
}

/** A trace reads nothing below this many points against the terrain. */
export const GAP_MIN_POINTS = 6;

/**
 * How far the traced skyline lies from the terrain's: the median of the
 * angle between them, in degrees, over how many degrees of the turn the trace
 * covers, and the median signed offset (+ the trace stands above the terrain).
 * Null while too little of the trace meets ground.
 *
 * @param {{x:number, y:number}[]} samples from `traceSamples`
 * @param {object} camera the view's camera with its frame's width and height
 * @param {(azimuth: number) => number|null} skyline the terrain's, in degrees
 * @param {{pieces?: object[]|null, pieceAt?: (point: {u:number, v:number}) => number}} [pieced]
 *   a cut collage's pieces as the search eased them, and the piece a point lies in
 */
export function traceGap(samples, camera, skyline, pieced = {}) {
  const found = residuals(samples, camera, skyline, cameraOver(camera, pieced));
  if (found.length < GAP_MIN_POINTS) return null;
  return {
    median: median(found.map((r) => Math.abs(r.gap))),
    offset: median(found.map((r) => r.gap)),
    span: spanOf(found),
    points: found.length,
  };
}

/**
 * Screen pixels within which a traced point lies on the terrain's skyline, and
 * past which it is off it: the search's own (engine/skymatch.py `HUBER_PX`,
 * `LOST_PX`), so what the trace's colours show is what the score counts.
 */
export const ON_PX = 3;
export const OFF_PX = 12;

/**
 * How each point of each stroke lies on the terrain through a camera: `on`
 * the skyline, `near` it, or `off` it (no ground under it counts as off), by
 * the thresholds the score counts with.
 *
 * @param {{u:number, v:number}[][]} strokes the trace on the straightened photo
 * @param {object} camera the view's camera with its frame's width and height
 * @param {(azimuth: number) => number|null} skyline the terrain's, in degrees
 * @param {object} [pieced] a cut collage's eased pieces (`traceGap`)
 * @returns {('on'|'near'|'off')[][]}
 */
export function traceFit(strokes, camera, skyline, pieced = {}) {
  const { width, height } = camera;
  if (!(width > 0) || !(height > 0)) return [];
  const perDegree = pixelsPerDegree(camera);
  const through = cameraOver(camera, pieced);
  return strokes.map((stroke) =>
    stroke.map((p) => {
      const ray = rayFor(through(p), p.u * width, p.v * height);
      const top = skyline(ray.azimuth);
      if (top == null) return 'off';
      const px = Math.abs(ray.elevation - top) * perDegree;
      return px <= ON_PX ? 'on' : px <= OFF_PX ? 'near' : 'off';
    })
  );
}

/**
 * The skyline lines that lie off the terrain through a camera, each with by
 * how much: `{ line, at, gap }`, `gap` the median angle between the line and
 * the terrain's skyline in degrees (+ the line stands above the land), or
 * `{ line, at, none: true }` where most of it has no land under it. A line
 * counts as off once that median passes `OFF_PX`, as the score counts it;
 * inner edges and sea lines are read against other lines and left out. `at`
 * is the middle of the line's longest stroke, where its badge goes.
 *
 * @param {{u:number, v:number}[][]} strokes the trace on the straightened photo
 * @param {{lines:number[], inner:number[], sea?:number[]}} marks each stroke's line and the kinds said
 * @param {object} camera the view's camera with its frame's width and height
 * @param {(azimuth: number) => number|null} skyline the terrain's, in degrees
 * @param {object} [pieced] a cut collage's eased pieces (`traceGap`)
 * @returns {{line:number, at:{u:number, v:number}, gap?:number, none?:boolean}[]}
 */
export function lineGaps(strokes, marks, camera, skyline, pieced = {}) {
  const { width, height } = camera;
  if (!(width > 0) || !(height > 0) || !marks) return [];
  const perDegree = pixelsPerDegree(camera);
  const through = cameraOver(camera, pieced);
  const skipped = new Set([...(marks.inner ?? []), ...(marks.sea ?? [])]);
  const byLine = new Map();
  strokes.forEach((stroke, index) => {
    const line = marks.lines?.[index] ?? index;
    if (skipped.has(line)) return;
    const one = byLine.get(line) ?? { gaps: [], bare: 0, longest: null };
    for (const p of stroke) {
      const ray = rayFor(through(p), p.u * width, p.v * height);
      const top = skyline(ray.azimuth);
      if (top == null) one.bare += 1;
      else one.gaps.push(ray.elevation - top);
    }
    if (!one.longest || stroke.length > one.longest.length) one.longest = stroke;
    byLine.set(line, one);
  });
  const off = [];
  for (const [line, one] of byLine) {
    if (one.gaps.length + one.bare < GAP_MIN_POINTS) continue;
    const at = one.longest[Math.floor(one.longest.length / 2)];
    if (one.bare > one.gaps.length) {
      off.push({ line, at, none: true });
      continue;
    }
    const gap = median(one.gaps);
    if (Math.abs(gap) * perDegree > OFF_PX) off.push({ line, at, gap });
  }
  return off;
}

/** What a line's badge says (`lineGaps`): how far above or below the land it lies, or that it has none under it. */
export function gapLabel(one) {
  if (one.none) return 'No land there';
  const size = Math.abs(one.gap);
  const degrees = size < 10 ? size.toFixed(1) : String(Math.round(size));
  return `${degrees}° ${one.gap > 0 ? 'above' : 'below'} the land`;
}

/**
 * A stroke cut where its points change how they lie (`traceFit`), each run
 * sharing its first point with the run before so the line stays whole.
 *
 * @returns {{ kind: string, points: object[] }[]}
 */
export function fitRuns(stroke, kinds) {
  const runs = [];
  for (let i = 0; i < stroke.length; i += 1) {
    const kind = kinds[i] ?? 'off';
    const last = runs[runs.length - 1];
    if (last && last.kind === kind) last.points.push(stroke[i]);
    else runs.push({ kind, points: last ? [last.points[last.points.length - 1], stroke[i]] : [stroke[i]] });
  }
  return runs;
}

/**
 * The trace laid on the terrain as the whole camera draws it, in frame
 * pixels (`{ x, y }`): each point of a cut collage through its piece's eased
 * camera, so a piece lands where the search read it; as traced otherwise.
 *
 * @param {{u:number, v:number}[][]} strokes the trace on the straightened photo
 * @param {object} camera the view's camera with its frame's width and height
 * @param {object} [pieced] a cut collage's eased pieces (`traceGap`)
 */
export function traceOnTerrain(strokes, camera, pieced = {}) {
  const { width, height } = camera;
  const through = cameraOver(camera, pieced);
  return strokes.map((stroke) =>
    stroke.map((p) => {
      const traced = { x: p.u * width, y: p.v * height };
      const own = through(p);
      if (own === camera) return traced;
      const ray = rayFor(own, traced.x, traced.y);
      const at = toScreen(camera, ray.azimuth, ray.elevation);
      return at.visible ? { x: at.x, y: at.y } : traced;
    })
  );
}

/** Frame pixels between two columns the terrain's skyline is drawn at over a photo. */
export const TERRAIN_STEP_PX = 3;

/**
 * The terrain's skyline in the photo's frame, each piece of a cut collage
 * through its own eased camera so it lies where the search read it: runs of
 * points across the frame (`u`, `v`, 0 to 1), each with how far up and down
 * the skyline may be off (`high`, `low` as a `v`, null where it is not known).
 * A run ends where no ground stands or the skyline leaves the camera's sight,
 * and at a cut whose pieces were eased.
 *
 * @param {object} camera the view's camera with its frame's width and height
 * @param {((azimuth: number) => {top: number|null, margin: number})|null} band the terrain's skyline and its margin
 * @param {object} [pieced] a cut collage's eased pieces (`traceGap`), and `step`, frame pixels between columns
 * @returns {{u:number, v:number, high:number|null, low:number|null}[][]}
 */
export function terrainLine(camera, band, { pieces = null, pieceAt = null, step = TERRAIN_STEP_PX } = {}) {
  const { width, height } = camera;
  if (!band || !(width > 0) || !(height > 0)) return [];
  const eased = Boolean(pieces?.length && pieceAt);
  const of = pieceCameras(camera, eased ? pieces : null);
  const runs = [];
  let run = [];
  let last = null;
  const close = () => {
    if (run.length > 1) runs.push(run);
    run = [];
  };
  for (let x = 0; ; x += step) {
    const column = Math.min(x, width);
    const piece = eased ? pieceAt({ u: column / width, v: 0.5 }) : 0;
    if (piece !== last) close();
    last = piece;
    const through = of(piece);
    const { azimuth } = rayFor(through, column, height / 2);
    const at = band(azimuth);
    const seen = Number.isFinite(at?.top) ? toScreen(through, azimuth, at.top) : null;
    if (seen?.visible) {
      const high = at.margin > 0 ? toScreen(through, azimuth, at.top + at.margin) : null;
      const low = at.margin > 0 ? toScreen(through, azimuth, at.top - at.margin) : null;
      run.push({
        u: seen.x / width,
        v: seen.y / height,
        high: high?.visible ? high.y / height : null,
        low: low?.visible ? low.y / height : null,
      });
    } else close();
    if (column >= width) break;
  }
  close();
  return runs;
}

/** The gap's median in degrees as it is written: two decimals under 1°, one under 10°. */
export function gapDegrees(gap) {
  const m = gap.median;
  return m < 1 ? m.toFixed(2) : m < 10 ? m.toFixed(1) : String(Math.round(m));
}

/** How many degrees of skyline the trace covers, as it is written. */
export function gapSpan(gap) {
  return gap.span < 10 ? gap.span.toFixed(1) : String(Math.round(gap.span));
}

/** "Gap 0.41° median over 52° of skyline": the whole reading, for a toast or a label. */
export function gapText(gap) {
  if (!gap) return '';
  return `Gap ${gapDegrees(gap)}° median over ${gapSpan(gap)}° of skyline`;
}

// a robust loss in pixels: square near the line, straight past a few pixels, so
// a stretch traced over a nearer ridge pulls no harder than its length
const HUBER_PX = 3;
function huber(px) {
  const a = Math.abs(px);
  return a <= HUBER_PX ? 0.5 * a * a : HUBER_PX * (a - 0.5 * HUBER_PX);
}

/** Screen pixels a degree spans at the lens's middle: everywhere along a panorama's strip. */
function pixelsPerDegree(camera) {
  if (camera.projection === 'panorama') return camera.width / camera.fov;
  return (focal(camera) * Math.PI) / 180;
}

/**
 * The cost of a camera against the trace, in screen pixels so a narrower lens
 * cannot make every point fit by squeezing the trace into one degree.
 */
function costOf(samples, camera, skyline) {
  const found = residuals(samples, camera, skyline);
  if (found.length < GAP_MIN_POINTS) return Infinity;
  const perDegree = pixelsPerDegree(camera);
  let sum = 0;
  for (const r of found) sum += huber(r.gap * perDegree);
  // points lost off the terrain count as far off, or a fit could drop the hard ones
  const lost = samples.length - found.length;
  return (sum + lost * huber(HUBER_PX * 4)) / samples.length;
}

/** Nelder–Mead over a few numbers: small, derivative-free, enough for four. */
function minimise(cost, start, steps, { iterations = 220, tolerance = 1e-4 } = {}) {
  const n = start.length;
  let simplex = [start, ...steps.map((step, i) => start.map((v, j) => (j === i ? v + step : v)))].map((point) => ({
    point,
    value: cost(point),
  }));
  for (let k = 0; k < iterations; k += 1) {
    simplex.sort((a, b) => a.value - b.value);
    const best = simplex[0];
    const worst = simplex[n];
    if (Math.abs(worst.value - best.value) <= tolerance * (Math.abs(best.value) + 1e-9)) break;
    const centre = start.map((_, j) => simplex.slice(0, n).reduce((sum, s) => sum + s.point[j], 0) / n);
    const toward = (t) => centre.map((c, j) => c + t * (worst.point[j] - c));
    const reflected = toward(-1);
    const r = cost(reflected);
    if (r < best.value) {
      const expanded = toward(-2);
      const e = cost(expanded);
      simplex[n] = e < r ? { point: expanded, value: e } : { point: reflected, value: r };
    } else if (r < simplex[n - 1].value) {
      simplex[n] = { point: reflected, value: r };
    } else {
      const contracted = toward(r < worst.value ? -0.5 : 0.5);
      const c = cost(contracted);
      if (c < Math.min(r, worst.value)) simplex[n] = { point: contracted, value: c };
      else {
        simplex = simplex.map((s, i) =>
          i === 0 ? s : { point: s.point.map((v, j) => best.point[j] + 0.5 * (v - best.point[j])), value: NaN }
        );
        for (const s of simplex) if (Number.isNaN(s.value)) s.value = cost(s.point);
      }
    }
  }
  simplex.sort((a, b) => a.value - b.value);
  return simplex[0];
}

/** A trace shorter than this many degrees of the turn says too little to fit the lens or the roll. */
export const FIT_MIN_SPAN = 4;

/**
 * The camera that brings the terrain's skyline onto the trace, from where the
 * analyst left it: first the heading slid across a third of the lens with the
 * tilt that best centres the trace at each, then heading, tilt, roll (and the
 * lens, unless the photo said it) refined together. Null when the trace meets
 * too little ground to say.
 *
 * @param {{x:number, y:number}[]} samples
 * @param {object} camera with the frame's width and height
 * @param {(azimuth: number) => number|null} skyline
 * @param {{ lens?: boolean }} [options] `lens`: whether the field of view may change too
 */
export function fitToTrace(samples, camera, skyline, { lens = true } = {}) {
  const before = traceGap(samples, camera, skyline);
  if (!before) return null;
  const at = (heading, tilt, roll, fov) => ({ ...camera, heading, tilt, roll, fov });
  // a slide over the heading, the tilt following the trace's median offset
  let slid = { heading: camera.heading, tilt: camera.tilt, value: Infinity };
  const reach = camera.fov / 3;
  const pace = Math.max(0.02, camera.fov / 240);
  for (let turn = -reach; turn <= reach + 1e-9; turn += pace) {
    const heading = camera.heading + turn;
    const tried = traceGap(samples, at(heading, camera.tilt, camera.roll, camera.fov), skyline);
    if (!tried) continue;
    const tilt = camera.tilt - tried.offset;
    // the nearer of two equal fits wins: the analyst's own placing is a hint
    const value = costOf(samples, at(heading, tilt, camera.roll, camera.fov), skyline) * (1 + 0.15 * Math.abs(turn / camera.fov));
    if (value < slid.value) slid = { heading, tilt, value };
  }
  const wide = before.span >= FIT_MIN_SPAN;
  const free = lens && wide;
  // a panorama's strip has no roll to give
  const rolls = wide && camera.projection !== 'panorama';
  const unpack = (p) =>
    at(p[0], p[1], rolls ? p[2] : camera.roll, free ? camera.fov * Math.exp(p[rolls ? 3 : 2]) : camera.fov);
  const start = [slid.heading, slid.tilt, ...(rolls ? [camera.roll] : []), ...(free ? [0] : [])];
  const steps = [pace * 4, pace * 4, ...(rolls ? [1] : []), ...(free ? [0.04] : [])];
  const best = minimise((p) => costOf(samples, unpack(p), skyline), start, steps);
  const fitted = unpack(best.point);
  const after = traceGap(samples, fitted, skyline);
  if (!after || after.median > before.median) return { camera: { ...camera }, gap: before, improved: false };
  return {
    camera: {
      ...camera,
      heading: ((fitted.heading % 360) + 360) % 360,
      tilt: fitted.tilt,
      roll: fitted.roll,
      fov: fitted.fov,
    },
    gap: after,
    improved: true,
  };
}

// -- the whole turn searched -----------------------------------------------------

/**
 * The trace on the picture plane, as the whole-turn search reads it
 * (`/api/horizon/match`, engine/skymatch.py): each point right and up from the
 * lens's middle in half widths of the frame, and that half width on screen.
 * A lens F degrees wide sees a point (x, y) along tangents (x, y)·tan(F/2), so
 * the search can try other lenses on the same points; on a panorama's strip,
 * half a width is half its degrees, across and up.
 */
export function tracePlane(samples, camera) {
  const panorama = camera.projection === 'panorama';
  const half = panorama ? camera.width / 2 : focal(camera) * Math.tan((camera.fov * Math.PI) / 360);
  const centre = panorama ? { x: camera.width / 2, y: camera.height / 2 } : principal(camera);
  return {
    x: samples.map((s) => (s.x - centre.x) / half),
    y: samples.map((s) => -(s.y - centre.y) / half),
    half_width: half,
  };
}

/**
 * The trace on the picture plane with the marks beside it (lib/horizon/traceMarks.js),
 * as the search reads them (api/horizon.py `MarksIn`): the skyline's points
 * as `tracePlane` gives them, the inner edges' apart (`ridge_x`, `ridge_y`),
 * and, when they matter, the stroke each point lies on (for the pairs, the
 * lines' distances, sent as `far`: a stroke, the nearest and farthest it
 * stands, metres, the sea lines, those with only sky above, `clear`, and the key lines, `key`), whether it
 * lies in a part brushed as bent (`bent`, `ridge_bent`, 1 or 0: `bentAt(sample)`, by default read off the marks'
 * brushings with the frame as the photo), a skyline point brushed where far land may be hidden going with the
 * inner edges (`hazyAt(sample)`, read the same way) and the piece of a collage it lies in: `pieceAt(sample)`, by default how many
 * of the marks' cuts stand left of it across the frame. Samples come from
 * `traceSamples`, each saying its stroke. Without marks, the plane alone.
 */
export function markedPlane(samples, camera, marks, pieceAt = null, bentAt = null, hazyAt = null) {
  const cuts = marks?.cuts ?? [];
  const inner = new Set(marks?.inner ?? []);
  const sea = new Set(marks?.sea ?? []);
  const lineOf = (s) => marks?.lines?.[s.stroke] ?? s.stroke;
  const within = (zones) => (s) => inBent(zones, { u: s.x / camera.width, v: s.y / camera.height }, camera.width / camera.height);
  // where far land may be hidden, a skyline line is an edge in front of land the photo does not show: read as a
  // ridge is, on any of the terrain's silhouettes rather than its skyline (a sea line stays one)
  const hidden = marks?.hazy?.length ? (hazyAt ?? within(marks.hazy)) : null;
  const ridgeLike = (s) => inner.has(lineOf(s)) || (hidden !== null && !sea.has(lineOf(s)) && hidden(s));
  const sky = inner.size || hidden ? samples.filter((s) => !ridgeLike(s)) : samples;
  const plane = tracePlane(sky, camera);
  const named = marks?.pairs?.length || marks?.far?.length || marks?.sea?.length || marks?.clear?.length || marks?.key?.length;
  const brushed = marks?.bent?.length ? (bentAt ?? within(marks.bent)) : null;
  if (!inner.size && !cuts.length && !named && !brushed && !hidden) return plane;
  const ridge = samples.filter(ridgeLike);
  const ridges = ridge.length ? tracePlane(ridge, camera) : { x: [], y: [] };
  const out = { ...plane, ridge_x: ridges.x, ridge_y: ridges.y };
  if (named) {
    // the search names strokes 0, 1… in the order they come
    const index = new Map();
    const name = (id) => {
      if (!index.has(id)) index.set(id, index.size);
      return index.get(id);
    };
    out.line = sky.map((s) => name(lineOf(s)));
    out.ridge_line = ridge.map((s) => name(lineOf(s)));
    out.pairs = (marks.pairs ?? []).filter(([f, b]) => index.has(f) && index.has(b)).map(([f, b]) => [index.get(f), index.get(b)]);
    out.far = (marks.far ?? [])
      .filter((one) => index.has(one.line) && farRange(one.bands))
      .map((one) => [index.get(one.line), ...farRange(one.bands)]);
    out.sea = (marks.sea ?? []).filter((id) => index.has(id)).map((id) => index.get(id));
    out.clear = (marks.clear ?? []).filter((id) => index.has(id)).map((id) => index.get(id));
    out.key = (marks.key ?? []).filter((id) => index.has(id)).map((id) => index.get(id));
  }
  if (brushed) {
    const bent = sky.map((s) => (brushed(s) ? 1 : 0));
    const ridgeBent = ridge.map((s) => (brushed(s) ? 1 : 0));
    if (bent.includes(1) || ridgeBent.includes(1)) {
      out.bent = bent;
      out.ridge_bent = ridgeBent;
    }
  }
  if (cuts.length) {
    const piece = pieceAt ?? ((s) => pieceOf(cuts, s.x / camera.width));
    out.piece = sky.map(piece);
    out.ridge_piece = ridge.map(piece);
  }
  return out;
}

/** A skyline as JSON carries it: a column without ground is null. */
const sendable = (angles) => Array.from(angles, (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null));

/**
 * What to ask the search: the trace, the camera it starts from, and the turn
 * the view already marched, so it reads the skyline the analyst sees. Null
 * while that turn is not whole (a window of it), when only a fit from here can.
 *
 * `reach` is how far the photo sees: 'auto' sends the cuts the panorama keeps
 * up to `autoReach`, the farthest as the turn and the nearer ones beside it,
 * for the search to try each (the whole turn when it keeps none); a number
 * sends that cut alone; anything else the whole turn alone. `within` and
 * `facing` are the hints (lib/horizon/hints.js searchHints). `marks` are
 * the trace's (lib/horizon/traceMarks.js), `pieceAt`, `bentAt` and `hazyAt` as `markedPlane` takes them.
 *
 * @param {{ known?: boolean, reach?: 'auto' | number | null, autoReach?: number, within?: number[], facing?: number[] }} [options]
 *   `known`: the photo said its lens, which is then the only one tried
 */
export function matchRequest(samples, camera, panorama, { known = false, reach = null, autoReach = Infinity, within, facing, marks = null, pieceAt = null, bentAt = null, hazyAt = null } = {}) {
  if (!panorama?.skyline?.length || panorama.azimuth?.full === false) return null;
  const tried = reach === 'auto' ? (panorama.cuts ?? []).filter((cut) => cut.reach <= autoReach) : [];
  const outer = Number.isFinite(reach) && skylineWithin(panorama, reach) !== panorama.skyline ? reach : (tried.at(-1)?.reach ?? null);
  return {
    skyline: outer === null ? panorama.skyline : sendable(skylineWithin(panorama, outer)),
    reach: outer,
    cuts: tried.slice(0, -1).map((cut) => ({ reach: cut.reach, skyline: sendable(cut.skyline) })),
    start: panorama.azimuth.start,
    step: panorama.azimuth.step,
    ...markedPlane(samples, camera, marks, pieceAt, bentAt, hazyAt),
    fov: camera.fov,
    known,
    tilt: camera.tilt,
    roll: camera.roll ?? 0,
    ...(within && !known ? { within } : {}),
    ...(facing ? { facing } : {}),
    ...(camera.projection === 'panorama' ? { projection: 'panorama' } : {}),
  };
}

/**
 * Each place the search found, brought onto the trace here as Fit brings the
 * analyst's own placing: `{ camera, gap, explained, close, reach }`, best
 * first. A place lies on a cut of the turn (`reach`, metres, null for the
 * whole), and is refined and measured against that cut: `skyline(azimuth,
 * reach)` reads it. A place the refinement cannot improve stays as the search
 * left it, and so does one whose collage pieces the search eased (`pieces`,
 * kept on the place): they were eased about that camera; and one whose strip the
 * search read at another height scale (`scale`, kept too, read as camera.js `stretch`).
 *
 * @param {{ fits: object[] }} found the search's answer
 * @param {{ lens?: boolean, pieceAt?: Function }} [options] `lens`: whether the field of view may change;
 *   `pieceAt`, the piece of the collage a point of the frame lies in
 */
export function searchedPlaces(found, samples, camera, skyline, { lens = true, pieceAt = null } = {}) {
  return (found?.fits ?? []).map((fit) => {
    const on = Number.isFinite(fit.reach) ? fit.reach : null;
    const along = (azimuth) => skyline(azimuth, on);
    const start = {
      ...camera,
      heading: fit.heading,
      tilt: fit.tilt,
      roll: Number.isFinite(fit.roll) ? fit.roll : camera.roll,
      fov: lens ? fit.fov : camera.fov,
    };
    const pieces = fit.pieces?.length && pieceAt ? fit.pieces : null;
    const scale = Number.isFinite(fit.scale) && fit.scale !== 1 ? fit.scale : null;
    const refined = pieces || scale ? null : fitToTrace(samples, start, along, { lens });
    const placed = refined?.improved ? refined.camera : start;
    const gap = traceGap(samples, scale ? { ...placed, stretch: scale } : placed, along, { pieces, pieceAt });
    return { camera: placed, gap, explained: fit.explained, close: fit.close, reach: on, pieces, ...(scale ? { scale } : {}) };
  });
}

/**
 * What a Fit does with the search's answer: `take`, the place it turns to (-1
 * for none), `here`, the place the view already stands at when it stays (its
 * reach is still the one to read the trace against), `closest`, the place a
 * "Show the closest" offers when it turns to none, and the toast's `text` and
 * `kind`. `before` is the gap the view had; `facing` whether the analyst said
 * which way the photo faces. The place is always the best one: where the view
 * happened to look decides nothing, only what the analyst said (`facing`,
 * which the search already kept to).
 */
export function searchOutcome(found, places, camera, { lens = true, before = null, facing = false } = {}) {
  const at = places.length ? 0 : -1;
  const place = places[at];
  const where = (p) => headingText(p.camera.heading, p.camera.fov);
  // a place on a cut of the turn: the farther ridges are left out, as haze would
  const onCut = (p) => (Number.isFinite(p.reach) ? `, on the ridges within ${Math.round(p.reach / 1000)} km` : '');
  if (found.verdict === 'none' || !place) {
    const [low, high] = found.lenses ?? [];
    const range = lens && low < high ? ` with a lens of ${Math.round(low)}° to ${Math.round(high)}°` : '';
    return { take: -1, here: -1, closest: place ? 0 : -1, text: `Nothing on this horizon matches the trace${range}`, kind: 'warn' };
  }
  // the view already stands at that place, and the fit would not bring the trace closer
  const stay = isSamePlace(camera, place) && !closer(place.gap, before);
  const take = stay ? -1 : at;
  const here = stay ? at : -1;
  if (found.verdict === 'ambiguous') {
    const other = places.find((p, i) => i !== at && p.close);
    // the hint that would settle it: which way it faces, unless the analyst already said
    const also = !other ? '' : facing ? `, and ${where(other)} fits about as well` : `, but ${where(other)} fits as well: say which way it faces`;
    return { take, here, closest: -1, text: `Fitted at ${where(place)}${also}`, kind: 'warn' };
  }
  if (found.verdict === 'loose') {
    return { take, here, closest: -1, text: `Loose fit at ${where(place)}${onCut(place)}: compare the ridges with the photo`, kind: 'warn' };
  }
  if (stay) return { take, here, closest: -1, text: 'The view is already as close to the trace as a fit gets', kind: 'info' };
  const gaps = before && place.gap ? `: gap ${gapDegrees(before)}° to ${gapDegrees(place.gap)}°` : '';
  return { take, here, closest: -1, text: `Fitted at ${where(place)}${gaps}${onCut(place)}`, kind: 'ok' };
}

/** Within a tenth of the lens, and never under a degree: the same place on the turn. */
function isSamePlace(camera, place) {
  return Math.abs(turnBetween(camera.heading, place.camera.heading)) < Math.max(1, camera.fov / 10);
}

/**
 * The view a place arrived at settles on, or null when it would bring the trace no closer: `fitToTrace` from where
 * the search left it, so never round to another heading as the whole-turn Fit may.
 */
export function settledOnTrace(samples, camera, skyline, { lens = true, before = null } = {}) {
  const result = fitToTrace(samples, camera, skyline, { lens });
  return result?.improved && closer(result.gap, before) ? result : null;
}

/** Whether a gap is closer than another by more than a twentieth, which a fit again would not be. */
function closer(gap, before) {
  if (!gap || !before) return true;
  return gap.median < before.median * 0.95;
}

/** Whether the view is at a place: the same heading, tilt and lens to a twentieth of a degree. */
export function isAtPlace(camera, place) {
  const near = (a, b) => Math.abs(a - b) < 0.05;
  return (
    near(turnBetween(camera.heading, place.camera.heading), 0) &&
    near(camera.tilt, place.camera.tilt) &&
    near(camera.fov, place.camera.fov)
  );
}

// -- a video's pins ------------------------------------------------------------

/** Two pins nearer in time than this are the same moment. */
export const PIN_SLACK_S = 0.05;

/** The pins with this camera kept at this moment, replacing one already there; sorted by time. */
export function pinAt(pins, time, camera) {
  const pin = { time, heading: camera.heading, tilt: camera.tilt, roll: camera.roll, fov: camera.fov };
  return [...pins.filter((p) => Math.abs(p.time - time) > PIN_SLACK_S), pin].sort((a, b) => a.time - b.time);
}

/**
 * The camera at a moment of the video, between the pins either side: the
 * heading turns the short way round, the rest moves evenly; before the first
 * pin and after the last the view holds. Null without pins.
 */
export function cameraAt(pins, time) {
  if (!pins.length) return null;
  const pick = ({ heading, tilt, roll, fov }) => ({ heading, tilt, roll, fov });
  if (time <= pins[0].time) return pick(pins[0]);
  const last = pins.at(-1);
  if (time >= last.time) return pick(last);
  const after = pins.findIndex((p) => p.time > time);
  const a = pins[after - 1];
  const b = pins[after];
  const t = (time - a.time) / (b.time - a.time);
  const heading = a.heading + turnBetween(a.heading, b.heading) * t;
  return {
    heading: ((heading % 360) + 360) % 360,
    tilt: a.tilt + (b.tilt - a.tilt) * t,
    roll: a.roll + (b.roll - a.roll) * t,
    // a lens zooms evenly on a log scale, as the eye reads it
    fov: Math.exp(Math.log(a.fov) + (Math.log(b.fov) - Math.log(a.fov)) * t),
  };
}

// -- the eye's height from the wheel ---------------------------------------------

/** How much one notch of the wheel raises or lowers the eye, as a share of its height. */
export const HEIGHT_NOTCH = 0.12;

/**
 * The eye's height after `notches` of the wheel (+ up): by a share of the
 * height, so a walker moves by a hand and an aircraft by a hundred metres,
 * rounded to what each eye is set in, kept within its limits.
 */
export function heightStep(mode, height, notches) {
  const next = height * Math.exp(HEIGHT_NOTCH * notches);
  const grain = mode === 'ground' ? 0.1 : mode === 'drone' ? 1 : 10;
  let rounded = Math.round(next / grain) * grain;
  // a notch always moves the eye, even where rounding would keep it in place
  if (rounded === height && notches) rounded = height + Math.sign(notches) * grain;
  return heightFor(mode, Number(rounded.toFixed(1)));
}

/** What the eye's height is called for each eye, as the inspector names it. */
export const HEIGHT_NAMES = { ground: 'Eye height', drone: 'Height above ground', aircraft: 'Altitude above sea' };

/** "Eye height 1.9 m": the height as the wheel leaves it, in the metres the inspector sets it in. */
export function heightText(mode, height) {
  const shown = mode === 'ground' ? Number(height.toFixed(1)) : Math.round(height);
  return `${HEIGHT_NAMES[mode] ?? HEIGHT_NAMES.ground} ${shown.toLocaleString('en-US')} m`;
}

// -- the photo's own claims ---------------------------------------------------

/**
 * The day and minute a photo says it was taken, on the place's clock, as the
 * sun's day and time are set: `{ date: 'YYYY-MM-DD', time: 'HH:MM' }`, or null.
 *
 * A camera clock with no zone (EXIF) is taken as the local time there, which is
 * what a camera is usually set to. A time with a zone or a Z (a video's
 * container) is turned to the place's clock, which needs its zone's name.
 *
 * @param {string} taken ISO 8601
 * @param {string} [zone] the place's IANA zone
 */
export function localClock(taken, zone) {
  const text = String(taken ?? '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/.exec(text);
  if (!match) return null;
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/i.test(text);
  if (!zoned) return { date: match[1], time: `${match[2]}:${match[3]}`, camera: true };
  if (!zone) return null;
  const moment = new Date(text);
  if (Number.isNaN(moment.getTime())) return null;
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(moment)
        .map((part) => [part.type, part.value])
    );
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, camera: false };
  } catch {
    return null;
  }
}

/** Whether a time names its zone (a video's UTC stamp), so the place's zone is needed to read it. */
export function isZoned(taken) {
  return /(Z|[+-]\d{2}:?\d{2})$/i.test(String(taken ?? '').trim());
}
