/**
 * Side by side in Horizon: the photo alone above (PhotoAbove), the terrain
 * alone under it, drawn live by the view's one engine (HorizonView).
 *
 * Locked, the terrain is seen through the view's own camera and the photo
 * through its loupe, so a hill in one stands straight under it in the other,
 * and a zoom or a move in either is the loupe's, which never parts the photo
 * from its match. Unlocked, each moves alone, the terrain turning and zooming
 * from the same eye, and locking again puts it back under the photo.
 *
 * The camera arithmetic is the view's own: HorizonView turns and zooms itself
 * with `dragLook` and `keepUnder` too.
 */
import { rayFor, toScreen, turnBetween, verticalFov } from './camera.js';
import { fitFrame, photoAt, screenAt } from './overlay.js';
import { looked } from './view.js';

/** CSS pixels between the two halves, where the bar that links them sits. */
export const SEAM = 36;

/**
 * The photo's frame in the upper half of the room and the seam under it, the
 * terrain's frame the same size a seam lower: `{ frame, seam }`, the frame as
 * `fitFrame` gives it and the seam as `{ top, height }`, the pair centred.
 */
export function splitFrames(aspect, room, seam = SEAM) {
  const fit = fitFrame(aspect, { width: room.width, height: Math.max(0, (room.height - seam) / 2) });
  const top = Math.max(0, Math.round((room.height - (fit.height * 2 + seam)) / 2));
  return { frame: { ...fit, top }, seam: { top: top + fit.height, height: seam } };
}

/** Where a drag of `dx`, `dy` CSS pixels turns a camera that stood at `start` when the hand pressed: `{ heading, tilt }`. */
export function dragLook(start, dx, dy) {
  const across = start.fov / start.width / (start.loupe?.zoom ?? 1);
  const up = start.projection === 'panorama' ? across : verticalFov(start) / start.height;
  return { heading: start.heading - dx * across, tilt: start.tilt + dy * up };
}

/** The heading and tilt that bring the direction `before` back under the pixel `at` once a camera's lens has changed. */
export function keepUnder(camera, before, at) {
  const next = { ...camera };
  for (let pass = 0; pass < 2; pass += 1) {
    const after = rayFor(next, at.x, at.y);
    next.heading += turnBetween(after.azimuth, before.azimuth);
    next.tilt += before.elevation - after.elevation;
  }
  return { heading: next.heading, tilt: next.tilt };
}

/** A camera whose lens is widened `scale` times about a pixel, the ground under it staying put, in the lens's range. */
export function zoomedAbout(camera, scale, at) {
  const before = rayFor(camera, at.x, at.y);
  const wider = { ...camera, ...looked(camera, { fov: camera.fov * scale }) };
  return { ...wider, ...looked(wider, keepUnder(wider, before, at)) };
}

/** Strokes in a camera's frame pixels as the directions they stand at, for another camera to draw. */
export function traceRays(strokes, camera) {
  return strokes.map((stroke) => stroke.map((p) => rayFor(camera, p.x, p.y)));
}

/**
 * Directions drawn through a camera: each stroke as runs of frame pixels,
 * broken where it leaves the camera's sight, with the stroke each came from
 * (`{ points, of }`).
 */
export function throughCamera(rays, camera) {
  const runs = [];
  rays.forEach((stroke, of) => {
    let run = [];
    const end = () => {
      if (run.length > 1) runs.push({ points: run, of });
      run = [];
    };
    for (const ray of stroke) {
      const at = toScreen(camera, ray.azimuth, ray.elevation);
      if (at.visible && Number.isFinite(at.x) && Number.isFinite(at.y)) run.push({ x: at.x, y: at.y });
      else end();
    }
    end();
  });
  return runs;
}

/** Where a direction stands across a camera's frame, at the height of its middle: x in CSS pixels, or null out of sight. */
export function crossAt(camera, azimuth) {
  if (azimuth == null || !(camera?.width > 0)) return null;
  const middle = rayFor(camera, camera.width / 2, camera.height / 2);
  const at = toScreen(camera, azimuth, middle.elevation);
  return at.visible && at.x >= 0 && at.x <= camera.width ? at.x : null;
}

/**
 * The direction a column of the photo looks at: `camera` is the photo's, at
 * its frame's size and with no loupe, and `loupe` how the photo is looked at.
 */
export function photoAzimuth(camera, loupe, x) {
  const { u } = photoAt(loupe, x, camera.height / 2, camera);
  return rayFor(camera, u * camera.width, camera.height / 2).azimuth;
}

/** Where a direction stands across the photo as `loupe` shows it: x in CSS pixels, or null out of sight. */
export function photoColumn(camera, loupe, azimuth) {
  if (azimuth == null || !(camera?.width > 0)) return null;
  const middle = rayFor(camera, camera.width / 2, camera.height / 2);
  const at = toScreen(camera, azimuth, middle.elevation);
  if (!at.visible || !Number.isFinite(at.x)) return null;
  const { x } = screenAt(loupe, at.x / camera.width, 0.5, camera);
  return x >= 0 && x <= camera.width ? x : null;
}
