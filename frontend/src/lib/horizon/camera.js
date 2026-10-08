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
 *
 * A rectilinear camera can also be looked at through a loupe, `loupe: { zoom,
 * x, y }`: the frame magnified `zoom` times about its point (x, y), 0 to 1
 * across and down, which then sits in the middle of the screen. The lens is
 * the same, so a photo matched through the loupe stays matched without it.
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

/** Pixels per unit of tangent: what a horizontal field of view makes of the width, through the loupe. */
export function focal({ fov, width, loupe }) {
  return ((loupe?.zoom ?? 1) * width) / 2 / Math.tan((fov * RAD) / 2);
}

/** Where the lens's own axis lands on screen: the middle, unless a loupe looks at another point. */
export function principal({ width, height, loupe }) {
  if (!loupe) return { x: width / 2, y: height / 2 };
  return { x: width / 2 + loupe.zoom * width * (0.5 - loupe.x), y: height / 2 + loupe.zoom * height * (0.5 - loupe.y) };
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
  const centre = principal(camera);
  return {
    x: centre.x + (f * dot(d, right)) / ahead,
    y: centre.y - (f * dot(d, up)) / ahead,
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
  const centre = principal(camera);
  const sx = (x - centre.x) / f;
  const sy = -(y - centre.y) / f;
  const d = forward.map((v, i) => v + sx * right[i] + sy * up[i]);
  const length = Math.hypot(...d);
  const azimuth = (Math.atan2(d[0], d[1]) / RAD + 360) % 360;
  return { azimuth, elevation: Math.asin(d[2] / length) / RAD };
}

/** The vertical field of view a horizontal one makes in this frame, through the loupe. */
export function verticalFov({ fov, width, height, projection, loupe }) {
  if (projection === 'panorama') return (fov * height) / width;
  return (2 * Math.atan(((height / width) * Math.tan((fov * RAD) / 2)) / (loupe?.zoom ?? 1))) / RAD;
}

/**
 * What a loupe shows of a camera, as a lens of its own: facing the point in
 * the middle of the screen, as wide as the loupe leaves it. Returns
 * `{ heading, tilt, fov }`.
 *
 * A loupe let free past the frame (a photo pinned to the terrain, zoomed out
 * or moved off its edges) looks at the lens off its axis: it is then as wide
 * as the screen's farther edge from its middle, either way, so the ground
 * picked to draw covers all of the screen.
 */
export function seenLens(camera) {
  const loupe = camera.loupe;
  const zoom = loupe?.zoom ?? 1;
  const own = { heading: camera.heading, tilt: camera.tilt, fov: camera.fov };
  if (camera.projection === 'panorama' || !loupe) return own;
  const inside = (at) => Math.abs(at - 0.5) <= 0.5 - 0.5 / zoom + 1e-9;
  const onFrame = zoom >= 1 && inside(loupe.x) && inside(loupe.y);
  if (onFrame && !(zoom > 1)) return own;
  const middle = rayFor(camera, camera.width / 2, camera.height / 2);
  if (onFrame) {
    const fov = (2 * Math.atan(Math.tan((camera.fov * RAD) / 2) / zoom)) / RAD;
    return { heading: middle.azimuth, tilt: middle.elevation, fov };
  }
  const { width: w, height: h } = camera;
  const across = Math.max(
    Math.abs(turnBetween(middle.azimuth, rayFor(camera, 0, h / 2).azimuth)),
    Math.abs(turnBetween(middle.azimuth, rayFor(camera, w, h / 2).azimuth))
  );
  const down = Math.max(
    Math.abs(rayFor(camera, w / 2, 0).elevation - middle.elevation),
    Math.abs(rayFor(camera, w / 2, h).elevation - middle.elevation)
  );
  // the width whose height, in this frame, reaches the farther of top and bottom
  const fromDown = Math.atan((Math.tan(Math.min(89, down) * RAD) * w) / h) / RAD;
  return { heading: middle.azimuth, tilt: middle.elevation, fov: Math.min(178, 2 * Math.max(across, fromDown)) };
}

function turnVector(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = cross(axis, v);
  const along = dot(axis, v) * (1 - c);
  return v.map((each, i) => each * c + k[i] * s + axis[i] * along);
}

/**
 * The camera turned about the direction under a pixel, which stays where it
 * is, so that the picture turns `angle` degrees clockwise on screen around
 * it: a roll about any point rather than the lens's middle. Returns
 * `{ heading, tilt, roll }`.
 */
export function turnAbout(camera, x, y, angle) {
  const { azimuth, elevation } = rayFor(camera, x, y);
  const axis = vector(azimuth, elevation);
  const { forward, up } = basis(camera);
  // the picture turns clockwise when the camera turns the other way about the line of sight
  const a = -angle * RAD;
  const f = turnVector(forward, axis, a);
  const u = turnVector(up, axis, a);
  const heading = (Math.atan2(f[0], f[1]) / RAD + 360) % 360;
  const tilt = Math.asin(Math.max(-1, Math.min(1, f[2]))) / RAD;
  const level = [Math.cos(heading * RAD), -Math.sin(heading * RAD), 0];
  const up0 = cross(level, f);
  const roll = Math.atan2(dot(u, level), dot(u, up0)) / RAD;
  return { heading, tilt, roll };
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
