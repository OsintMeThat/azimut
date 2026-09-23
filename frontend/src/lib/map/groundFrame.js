/**
 * A map view as a rectangle on the ground, and the affine maps between them.
 *
 * On Web Mercator a screen is an exact affine image of the ground: a scale, a
 * turn and a shift. So a picture computed for one camera can be laid over any
 * later camera with one CSS matrix, and a Sentinel Hub frame fetched as an
 * axis-aligned box can be drawn into a turned view the same way. Matrices use
 * the canvas convention: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`.
 *
 * A frame is the engine's raw camera (`facade.frame()`) plus the container's
 * size in CSS pixels. Its `bearing` is the engine's: the compass direction
 * that is up.
 */

const EARTH_RADIUS = 6378137;
const WORLD = 2 * Math.PI * EARTH_RADIUS;
const MAX_LAT = 85.05112878;

export function toMercator(lon, lat) {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  return [
    EARTH_RADIUS * ((lon * Math.PI) / 180),
    EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360)),
  ];
}

export function fromMercator(x, y) {
  return [
    (x / EARTH_RADIUS) * (180 / Math.PI),
    (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI),
  ];
}

/** Ground metres per CSS pixel at an engine zoom (512 px tiles), along the projection. */
export function mercatorPerPixel(zoom) {
  return WORLD / (512 * 2 ** zoom);
}

/** Metres on the ground per CSS pixel at the frame's centre. */
export function groundPerPixel(frame) {
  return mercatorPerPixel(frame.zoom) * Math.cos((frame.lat * Math.PI) / 180);
}

export const apply = (m, x, y) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];

/** `outer ∘ inner`: first inner, then outer. */
export function compose(outer, inner) {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

export function invert(m) {
  const det = m.a * m.d - m.b * m.c;
  if (!det) throw new Error('this frame cannot be inverted');
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

export const scale = (s) => ({ a: s, b: 0, c: 0, d: s, e: 0, f: 0 });

/** Container pixel → Web Mercator metres for this frame. */
export function screenToMercator(frame) {
  const mpp = mercatorPerPixel(frame.zoom);
  const turn = (frame.bearing * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const [cx, cy] = toMercator(frame.lng, frame.lat);
  const halfW = frame.width / 2;
  const halfH = frame.height / 2;
  return {
    a: mpp * cos,
    b: -mpp * sin,
    c: -mpp * sin,
    d: -mpp * cos,
    e: cx + mpp * (-halfW * cos + halfH * sin),
    f: cy + mpp * (halfW * sin + halfH * cos),
  };
}

/** The axis-aligned Web Mercator box that covers the whole (possibly turned) view. */
export function frameBox(frame) {
  const toGround = screenToMercator(frame);
  const corners = [
    [0, 0], [frame.width, 0], [0, frame.height], [frame.width, frame.height],
  ].map(([x, y]) => apply(toGround, x, y));
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  return { west: Math.min(...xs), south: Math.min(...ys), east: Math.max(...xs), north: Math.max(...ys) };
}

/** Pixel (column, row) of an image covering `box` → Web Mercator metres. */
export function imageToMercator(box, width, height) {
  return {
    a: (box.east - box.west) / width,
    b: 0,
    c: 0,
    d: -(box.north - box.south) / height,
    e: box.west,
    f: box.north,
  };
}

/** A container pixel of frame `from` → the container pixel of frame `to` on the same ground. */
export function frameToFrame(from, to) {
  return compose(invert(screenToMercator(to)), screenToMercator(from));
}

/**
 * A box on the ground drawn on a turned screen: two opposite corners, and the
 * bearing that was up while it was drawn. Its sides run along that screen, so
 * the box keeps its shape when the camera turns on, and turns with the ground.
 *
 * Returned in Web Mercator metres: the centre, the unit vectors the screen's
 * right and down pointed along, and the signed extent along each.
 */
export function turnedBox([first, second], bearing = 0) {
  const p = toMercator(...first);
  const q = toMercator(...second);
  const turn = (bearing * Math.PI) / 180;
  const right = [Math.cos(turn), -Math.sin(turn)];
  const down = [-Math.sin(turn), -Math.cos(turn)];
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  return {
    centre: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2],
    right,
    down,
    width: dx * right[0] + dy * right[1],
    height: dx * down[0] + dy * down[1],
  };
}

/** The `[lon, lat]` of a box at fractions `s` across and `t` down, from -0.5 to 0.5. */
export function boxPoint(box, s, t) {
  return fromMercator(
    box.centre[0] + s * box.width * box.right[0] + t * box.height * box.down[0],
    box.centre[1] + s * box.width * box.right[1] + t * box.height * box.down[1]
  );
}

/** The four `[lon, lat]` corners, from the first one drawn, round to the far one and back. */
export const boxCorners = (box) =>
  [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([s, t]) => boxPoint(box, s, t));

/** A ground point turned clockwise about another by `degrees`, as the screen shows a turn. */
export function turnAbout(point, pivot, degrees) {
  const [x, y] = toMercator(...point);
  const [px, py] = toMercator(...pivot);
  const turn = (degrees * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const dx = x - px;
  const dy = y - py;
  return fromMercator(px + dx * cos + dy * sin, py - dx * sin + dy * cos);
}

/** An angle folded into [0, 360), or 0 for anything that is not a number. */
export function compassAngle(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const folded = ((number % 360) + 360) % 360;
  return folded >= 360 - 1e-9 ? 0 : folded;
}

/**
 * The ground corners of a view, as `[lon, lat]`, clockwise from top-left.
 * What a computed overlay remembers about where it lies.
 */
export function frameCorners(frame) {
  const toGround = screenToMercator(frame);
  return [[0, 0], [frame.width, 0], [frame.width, frame.height], [0, frame.height]].map(
    ([x, y]) => fromMercator(...apply(toGround, x, y))
  );
}

export const cssMatrix = (m) => `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.e}, ${m.f})`;
