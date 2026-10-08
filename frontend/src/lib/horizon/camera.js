/**
 * The Horizon tab's camera: from a direction in the world to a pixel and back.
 *
 * Two projections over one panorama:
 *
 * - **Camera** is rectilinear, the way a photo is taken: straight lines stay
 *   straight, and a frame from a phone lies over it once heading, tilt, roll
 *   and field of view agree. This is the one a picture is matched against.
 * - **Panorama** is cylindrical, the strip a summit chart is drawn as: azimuth
 *   along, elevation up, the same number of degrees per pixel both ways. It
 *   holds the whole turn at once, and nothing in it is a photo.
 *
 * A direction is (azimuth, elevation) in degrees, azimuth clockwise from north.
 * The camera is `{ heading, tilt, roll, fov, width, height, projection }`: fov is
 * the horizontal field of view in degrees, tilt is up from level, roll turns the
 * frame clockwise. The shader in `renderer.js` mirrors `rayFor`; what is tested
 * here is the arithmetic both rely on.
 */

const RAD = Math.PI / 180;

function vector(azimuth, elevation) {
  const a = azimuth * RAD;
  const e = elevation * RAD;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** The camera's forward, right and up axes in the world (east, north, up). */
export function basis({ heading, tilt, roll = 0 }) {
  const forward = vector(heading, tilt);
  const level = [Math.cos(heading * RAD), -Math.sin(heading * RAD), 0];
  const up0 = cross(level, forward);
  const r = roll * RAD;
  // roll turns the frame clockwise as seen by the eye
  const right = level.map((v, i) => v * Math.cos(r) - up0[i] * Math.sin(r));
  const up = up0.map((v, i) => v * Math.cos(r) + level[i] * Math.sin(r));
  return { forward, right, up };
}

/** Pixels per unit of tangent: what a horizontal field of view makes of the width. */
export function focal({ fov, width }) {
  return width / 2 / Math.tan((fov * RAD) / 2);
}

/** Degrees per pixel along the panorama strip. */
function stripScale({ fov, width }) {
  return fov / width;
}

/** The signed difference b − a, folded into (−180, 180]. */
export function turnBetween(a, b) {
  const d = (((b - a) % 360) + 540) % 360 - 180;
  return d === -180 ? 180 : d;
}

/**
 * Where a direction lands on screen. `visible` is false behind a camera, or off
 * the panorama strip's turn.
 */
export function toScreen(camera, azimuth, elevation) {
  const { width, height } = camera;
  if (camera.projection === 'panorama') {
    const scale = stripScale(camera);
    const x = width / 2 + turnBetween(camera.heading, azimuth) / scale;
    const y = height / 2 - (elevation - camera.tilt) / scale;
    return { x, y, visible: true };
  }
  const { forward, right, up } = basis(camera);
  const d = vector(azimuth, elevation);
  const ahead = dot(d, forward);
  if (ahead <= 1e-6) return { x: NaN, y: NaN, visible: false };
  const f = focal(camera);
  return {
    x: width / 2 + (f * dot(d, right)) / ahead,
    y: height / 2 - (f * dot(d, up)) / ahead,
    visible: true,
  };
}

/** The direction under a pixel, as `{ azimuth, elevation }` in degrees. */
export function rayFor(camera, x, y) {
  const { width, height } = camera;
  if (camera.projection === 'panorama') {
    const scale = stripScale(camera);
    return {
      azimuth: (((camera.heading + (x - width / 2) * scale) % 360) + 360) % 360,
      elevation: camera.tilt - (y - height / 2) * scale,
    };
  }
  const { forward, right, up } = basis(camera);
  const f = focal(camera);
  const sx = (x - width / 2) / f;
  const sy = -(y - height / 2) / f;
  const d = forward.map((v, i) => v + sx * right[i] + sy * up[i]);
  const length = Math.hypot(...d);
  const azimuth = (Math.atan2(d[0], d[1]) / RAD + 360) % 360;
  return { azimuth, elevation: Math.asin(d[2] / length) / RAD };
}

/** The vertical field of view a horizontal one makes in this frame. */
export function verticalFov({ fov, width, height, projection }) {
  if (projection === 'panorama') return (fov * height) / width;
  return (2 * Math.atan((height / width) * Math.tan((fov * RAD) / 2))) / RAD;
}

/**
 * A 35 mm equivalent focal length as a horizontal field of view, for a frame
 * of this aspect: what a photo's EXIF says about how wide it looked.
 */
export function fovFromFocal35(focalMm, aspect = 4 / 3) {
  // the 35 mm frame is 36 × 24 mm; its diagonal is what "equivalent" holds to
  const diagonal = Math.hypot(36, 24);
  const width = diagonal * (aspect / Math.hypot(aspect, 1));
  return (2 * Math.atan(width / 2 / focalMm)) / RAD;
}

/** …and back: the 35 mm equivalent focal length a horizontal field of view makes. */
export function focal35FromFov(fov, aspect = 4 / 3) {
  const diagonal = Math.hypot(36, 24);
  const width = diagonal * (aspect / Math.hypot(aspect, 1));
  return width / 2 / Math.tan((fov * RAD) / 2);
}
