/**
 * The rectangle an export is framed to.
 *
 * A comparison is read on a whole browser window, but the thing worth showing
 * is usually a building or a crater in the middle of it. The frame is drawn
 * once on imagery A and kept as two ground corners and the bearing that was up
 * while it was drawn, like a box annotation: the camera can move or turn, the
 * window can be resized, and the same ground comes out, upright as drawn.
 *
 * Cropping happens before composition, on the captured canvases: each side is
 * cut to the same ground box and handed a frame of its own, so the change
 * mask, the annotations and the scale bar land exactly where they did on the
 * whole view.
 */

import {
  apply, compassAngle, fromMercator, frameToFrame, invert, mercatorPerPixel, screenToMercator,
  toMercator, turnedBox,
} from './groundFrame.js';

/**
 * The narrowest frame worth exporting, in CSS pixels.
 *
 * The composed header holds a title, both dated labels and the camera line at
 * a fixed height, so below this they start climbing over each other.
 */
export const MIN_FRAME = 320;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * A drawn box made exportable: grown to the minimum around its own centre,
 * then held inside the view. A frame drawn smaller than the view can always
 * be placed; one drawn on a view narrower than the minimum takes the view.
 */
export function boundedRect(rect, frame) {
  const w = clamp(Math.round(rect.w), Math.min(MIN_FRAME, frame.width), frame.width);
  const h = clamp(Math.round(rect.h), Math.min(MIN_FRAME, frame.height), frame.height);
  return {
    x: Math.round(clamp(rect.x + rect.w / 2 - w / 2, 0, frame.width - w)),
    y: Math.round(clamp(rect.y + rect.h / 2 - h / 2, 0, frame.height - h)),
    w,
    h,
  };
}

/** How much ground the frame spans along the axes of the screen it was drawn on, in metres. */
export function frameSpan(points, bearing = 0) {
  const [first, second] = points.map(([lon, lat]) => toMercator(lon, lat));
  const shrink = Math.cos((((points[0][1] + points[1][1]) / 2) * Math.PI) / 180);
  const turn = (bearing * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const dx = second[0] - first[0];
  const dy = second[1] - first[1];
  return {
    width: Math.abs(cos * dx - sin * dy) * shrink,
    height: Math.abs(-sin * dx - cos * dy) * shrink,
  };
}

function canvasOf(width, height, makeCanvas) {
  const canvas = makeCanvas ? makeCanvas() : document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/** Cut one captured surface down to `rect`, and re-centre its frame on the cut. */
export function cropCapture(capture, rect, makeCanvas) {
  const pixelScale = capture.canvas.width / capture.frame.width;
  const canvas = canvasOf(rect.w * pixelScale, rect.h * pixelScale, makeCanvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('this browser cannot frame the comparison');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(
    capture.canvas,
    Math.round(rect.x * pixelScale),
    Math.round(rect.y * pixelScale),
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height
  );
  const [lng, lat] = fromMercator(
    ...apply(screenToMercator(capture.frame), rect.x + rect.w / 2, rect.y + rect.h / 2)
  );
  return { canvas, frame: { ...capture.frame, lng, lat, width: rect.w, height: rect.h } };
}

/**
 * Cut one captured surface to a frame turned against it: the pixels are
 * resampled through the turn, so the cut comes out upright at its own bearing.
 */
export function turnedCapture(capture, frame, makeCanvas) {
  const pixelScale = capture.canvas.width / capture.frame.width;
  const canvas = canvasOf(frame.width * pixelScale, frame.height * pixelScale, makeCanvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('this browser cannot frame the comparison');
  ctx.imageSmoothingQuality = 'high';
  const m = frameToFrame(capture.frame, frame);
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e * pixelScale, m.f * pixelScale);
  ctx.drawImage(capture.canvas, 0, 0);
  return { canvas, frame };
}

/** Whether two bearings put the same way up, to far under a pixel across any view. */
function sameUp(first, second) {
  const gap = Math.abs(compassAngle(first) - compassAngle(second));
  return Math.min(gap, 360 - gap) < 1e-6;
}

/**
 * One capture cut to the frame's ground: centred on `centre` (Web Mercator),
 * `size` pixels across or the box's own span at the capture's zoom.
 *
 * A frame drawn at the bearing the capture was taken at is cut on whole
 * pixels, so the export holds the screen's own pixels; one drawn at another
 * bearing is turned upright.
 */
function cutOne(capture, box, angle, centre, size, makeCanvas) {
  const view = capture.frame;
  const perPixel = mercatorPerPixel(view.zoom);
  const w = size?.w ?? Math.max(1, Math.round(Math.abs(box.width) / perPixel));
  const h = size?.h ?? Math.max(1, Math.round(Math.abs(box.height) / perPixel));
  const refuse = () => {
    throw new Error('the export frame must be fully visible; move or zoom out, then try again');
  };
  if (sameUp(angle, view.bearing)) {
    const [cx, cy] = apply(invert(screenToMercator(view)), ...centre);
    const rect = { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w, h };
    if (rect.x < 0 || rect.y < 0 || rect.x + w > view.width || rect.y + h > view.height) refuse();
    return cropCapture(capture, rect, makeCanvas);
  }
  const [lng, lat] = fromMercator(...centre);
  const frame = { ...view, lng, lat, width: w, height: h, bearing: angle };
  const toView = frameToFrame(frame, view);
  for (const [x, y] of [[0, 0], [w, 0], [w, h], [0, h]]) {
    const [vx, vy] = apply(toView, x, y);
    if (vx < -0.5 || vy < -0.5 || vx > view.width + 0.5 || vy > view.height + 0.5) refuse();
  }
  return turnedCapture(capture, frame, makeCanvas);
}

/**
 * Both captures cut to the same ground box.
 *
 * A is cut first and its box read back off the ground, so B is placed by where
 * A actually landed rather than by the drawing: the two panes of a side by
 * side then hold the same extent even if the cameras drifted by a pixel.
 */
export function cropSources(sources, frame, makeCanvas) {
  if (!frame?.points) return sources;
  const angle = compassAngle(frame.angle);
  const box = turnedBox(frame.points, angle);
  const a = cutOne(sources.a, box, angle, box.centre, null, makeCanvas);
  const landed = toMercator(a.frame.lng, a.frame.lat);
  const b = cutOne(sources.b, box, angle, landed, { w: a.frame.width, h: a.frame.height }, makeCanvas);
  return { a, b };
}

/** What a saved session carries: nothing, or two ground corners and the bearing they were drawn at. */
export function exportFrameSpec(value) {
  const points = value?.points;
  if (!Array.isArray(points) || points.length !== 2) return null;
  const cleaned = points.map((point) => [Number(point?.[0]), Number(point?.[1])]);
  if (cleaned.some(([lon, lat]) => !Number.isFinite(lon) || !Number.isFinite(lat))) return null;
  if (cleaned.some(([lon, lat]) => Math.abs(lon) > 180 || Math.abs(lat) > 90)) return null;
  if (cleaned[0][0] === cleaned[1][0] && cleaned[0][1] === cleaned[1][1]) return null;
  return { points: cleaned, angle: compassAngle(value.angle) };
}
