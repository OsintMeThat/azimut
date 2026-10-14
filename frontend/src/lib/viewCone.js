/**
 * The view cone: where a camera stood on a picture, which way it looked and how
 * wide it saw.
 *
 * Stored like any mark of its picture: the camera at `x`, `y` in the picture's
 * own pixels, the line of sight as `rotation` (degrees clockwise from the
 * picture's up), how far it is drawn as `reach`, in the same pixels, and how
 * wide it opens as `fov`, in degrees. So it moves, grows and turns with its
 * panel, and a cone carried onto another panel keeps its bearing on the page.
 *
 * How wide is the part an analyst rarely knows in degrees and usually knows as a
 * phone camera: the main lens, the ultra-wide, a 2× zoom, held upright or not.
 * The lenses below are those, read off their 35 mm equivalent focal length.
 */

/** Horizontal field of view of a 35 mm-equivalent focal length, held landscape. */
export function fovOfFocal(mm) {
  return (2 * Math.atan(36 / (2 * mm)) * 180) / Math.PI;
}

/** Phone lenses, by their usual 35 mm equivalents. */
export const LENSES = [
  { id: '0.5', label: 'Ultra-wide 0.5×', mm: 13 },
  { id: '1', label: 'Main 1×', mm: 26 },
  { id: '2', label: 'Zoom 2×', mm: 52 },
  { id: '3', label: 'Zoom 3×', mm: 77 },
  { id: '5', label: 'Zoom 5×', mm: 120 },
];

export const CONE_FOV_MIN = 4;
export const CONE_FOV_MAX = 170;

/**
 * How wide the camera's badge is drawn, in page pixels: its own size, so the
 * camera reads at any line width and a thin cone can carry a big camera.
 */
export const CONE_BADGE = 34;
export const CONE_BADGE_MIN = 16;
export const CONE_BADGE_MAX = 160;

/**
 * A field of view held upright: a phone filming in portrait sees across the
 * short side of a 16:9 frame.
 */
export function uprightFov(fov) {
  const half = (fov * Math.PI) / 360;
  return (2 * Math.atan(Math.tan(half) * (9 / 16)) * 180) / Math.PI;
}

/** The field of view a lens gives, landscape or upright. */
export function lensFov(id, upright = false) {
  const lens = LENSES.find((l) => l.id === id);
  if (!lens) return null;
  const fov = fovOfFocal(lens.mm);
  return upright ? uprightFov(fov) : fov;
}

/**
 * The lens a field of view is, within `snap` degrees, held either way, or null
 * for a width set by hand. What lets an edge dragged near a lens settle on it.
 */
export function lensOf(fov, snap = 1.5) {
  for (const upright of [false, true]) {
    for (const lens of LENSES) {
      if (Math.abs(lensFov(lens.id, upright) - fov) <= snap) return { id: lens.id, upright };
    }
  }
  return null;
}

/** A unit step along a bearing: degrees clockwise from up, in screen axes (y down). */
export function along(degrees) {
  const r = (degrees * Math.PI) / 180;
  return { x: Math.sin(r), y: -Math.cos(r) };
}

/** The bearing from one point to another, degrees clockwise from up, in (-180, 180]. */
export function bearingTo(from, to) {
  const deg = (Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI;
  return deg <= -180 ? deg + 360 : deg;
}

/** Where the cone's handles stand, in its picture's pixels: the far end and both edges. */
export function coneHandles(shape) {
  const at = (deg, length) => {
    const d = along(deg);
    return { x: shape.x + d.x * length, y: shape.y + d.y * length };
  };
  const turn = shape.rotation ?? 0;
  const half = (shape.fov ?? lensFov('1')) / 2;
  return {
    end: at(turn, shape.reach),
    left: at(turn - half, shape.reach),
    right: at(turn + half, shape.reach),
  };
}

/**
 * The opening an edge handle dragged to `point` asks for: twice its angle off the
 * line of sight, kept between a slit and almost a half-turn, and settled on a
 * phone lens when it comes within a degree and a half of one.
 */
export function fovFromEdge(shape, point) {
  let off = Math.abs(bearingTo(shape, point) - (shape.rotation ?? 0)) % 360;
  if (off > 180) off = 360 - off;
  const fov = Math.min(CONE_FOV_MAX, Math.max(CONE_FOV_MIN, off * 2));
  const lens = lensOf(fov);
  return lens ? { fov: lensFov(lens.id, lens.upright), lens: lens.id, upright: lens.upright } : { fov, lens: null, upright: false };
}
