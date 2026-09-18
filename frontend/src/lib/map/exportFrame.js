/**
 * The rectangle an export is framed to.
 *
 * A comparison is read on a whole browser window, but the thing worth showing
 * is usually a building or a crater in the middle of it. The frame is drawn
 * once on imagery A and kept as two ground corners, like an annotation: the
 * camera can move, the window can be resized, the same ground comes out.
 *
 * Cropping happens before composition, on the captured canvases: each side is
 * cut to the same ground box and handed a frame of its own, so the change
 * mask, the annotations and the scale bar land exactly where they did on the
 * whole view.
 */

import { apply, fromMercator, invert, screenToMercator, toMercator } from './groundFrame.js';

/**
 * The narrowest frame worth exporting, in CSS pixels.
 *
 * The composed header holds a title, both dated labels and the camera line at
 * a fixed height, so below this they start climbing over each other.
 */
export const MIN_FRAME = 320;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Ground pair → the pixel box of `frame` that covers it. */
export function screenRect(points, frame) {
  const toScreen = invert(screenToMercator(frame));
  const corners = points.map(([lon, lat]) => apply(toScreen, ...toMercator(lon, lat)));
  const xs = corners.map((point) => point[0]);
  const ys = corners.map((point) => point[1]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
}

/** Pixel box of `frame` → the two ground corners it spans. */
export function groundRect(rect, frame) {
  const toGround = screenToMercator(frame);
  return [
    fromMercator(...apply(toGround, rect.x, rect.y)),
    fromMercator(...apply(toGround, rect.x + rect.w, rect.y + rect.h)),
  ];
}

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

/** How much ground the frame spans along the current screen axes, in metres. */
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
 * Both captures cut to the same ground box.
 *
 * A is cut first and its box read back off the ground, so B is placed by where
 * A actually landed rather than by the drawing: the two panes of a side by
 * side then hold the same extent even if the cameras drifted by a pixel.
 */
export function cropSources(sources, frame, makeCanvas) {
  if (!frame?.points) return sources;
  const fitted = (rect, captureFrame, size = null) => {
    const cut = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: size?.w ?? Math.max(1, Math.round(rect.w)),
      h: size?.h ?? Math.max(1, Math.round(rect.h)),
    };
    if (cut.x < 0 || cut.y < 0 || cut.x + cut.w > captureFrame.width || cut.y + cut.h > captureFrame.height) {
      throw new Error('the export frame must be fully visible; move or zoom out, then try again');
    }
    return cut;
  };
  const rectA = fitted(screenRect(frame.points, sources.a.frame), sources.a.frame);
  const ground = groundRect(rectA, sources.a.frame);
  const onB = screenRect(ground, sources.b.frame);
  const rectB = fitted(onB, sources.b.frame, rectA);
  return {
    a: cropCapture(sources.a, rectA, makeCanvas),
    b: cropCapture(sources.b, rectB, makeCanvas),
  };
}

/** What a saved session carries: nothing, or two ground corners. */
export function exportFrameSpec(value) {
  const points = value?.points;
  if (!Array.isArray(points) || points.length !== 2) return null;
  const cleaned = points.map((point) => [Number(point?.[0]), Number(point?.[1])]);
  if (cleaned.some(([lon, lat]) => !Number.isFinite(lon) || !Number.isFinite(lat))) return null;
  if (cleaned.some(([lon, lat]) => Math.abs(lon) > 180 || Math.abs(lat) > 90)) return null;
  if (cleaned[0][0] === cleaned[1][0] && cleaned[0][1] === cleaned[1][1]) return null;
  return { points: cleaned };
}
