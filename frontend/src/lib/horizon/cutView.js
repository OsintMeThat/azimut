/**
 * The terrain drawn as the search read a cut collage: each piece of the frame
 * through the camera the search eased that piece to (lib/horizon/overlay.js
 * `pieceCameras`), so photo and terrain meet piece by piece, seams and all.
 * Side by side shows it, and its picture is saved the same way.
 *
 * The pieces are found by `pieceAt` (state/overlay.svelte.js), the rule the
 * search itself reads them by, so a seam follows the cut wherever the lens's
 * curve or pulled corners bend it across the frame.
 */
import { pieceCameras } from './overlay.js';

/** Frame pixels between two rows a seam is followed at. */
export const SEAM_STEP_PX = 8;
/** Halvings that place a seam on a row: a hair of a pixel on the widest export. */
const BISECTIONS = 20;
/** Two ruler ticks from neighbouring pieces closer than this keep the first. */
const TICK_GAP_PX = 36;
/** Two names from neighbouring pieces this close in height are on one line. */
const NAME_LINE_PX = 16;

/**
 * Where the pieces meet across a frame of `width` × `height` pixels: one seam
 * per cut, left to right, each a line of `{ x, y }` from the top to the
 * bottom, on the column where `pieceAt({ u, v })` moves past that piece.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} count how many pieces: the cuts and one
 * @param {(point: {u:number, v:number}) => number} pieceAt
 */
export function seamsAcross(width, height, count, pieceAt, step = SEAM_STEP_PX) {
  if (!(width > 0 && height > 0) || !(count > 1) || typeof pieceAt !== 'function') return [];
  const rows = [];
  for (let y = 0; y < height; y += step) rows.push(y);
  rows.push(height);
  const crossing = (piece, y) => {
    const v = y / height;
    if (pieceAt({ u: 0, v }) > piece) return 0;
    if (pieceAt({ u: 1, v }) <= piece) return width;
    let low = 0;
    let high = width;
    for (let i = 0; i < BISECTIONS; i += 1) {
      const middle = (low + high) / 2;
      if (pieceAt({ u: middle / width, v }) > piece) high = middle;
      else low = middle;
    }
    return (low + high) / 2;
  };
  return Array.from({ length: count - 1 }, (_, piece) => rows.map((y) => ({ x: crossing(piece, y), y })));
}

/**
 * The names, ticks and marked point each piece's camera placed, kept where
 * that piece lies (`views[k]` is piece k's `{ layers }`), with the trace as
 * traced: on a terrain drawn piece by piece it lies where it was drawn.
 *
 * @param {{ layers: object }[]} views one per piece, left to right
 * @param {(point: {u:number, v:number}) => number} pieceAt
 * @param {{ width:number, height:number }} size the frame, in the layers' pixels
 * @param {object} whole the layers of the whole camera, for the trace
 */
export function pieceLayers(views, pieceAt, size, whole = {}) {
  const { width, height } = size;
  const at = (x, y) => pieceAt({ u: x / width, v: y / height });
  const labels = [];
  const ticks = [];
  let target = null;
  views.forEach((view, piece) => {
    const layers = view?.layers ?? {};
    for (const label of layers.labels ?? []) {
      if (at(label.left + label.width / 2, label.baseline) !== piece) continue;
      const clash = labels.some(
        (kept) =>
          Math.abs(kept.baseline - label.baseline) < NAME_LINE_PX &&
          kept.left < label.left + label.width &&
          label.left < kept.left + kept.width
      );
      if (!clash) labels.push(label);
    }
    for (const tick of layers.ticks ?? []) {
      if (at(tick.x, height / 2) !== piece) continue;
      if (!ticks.some((kept) => Math.abs(kept.x - tick.x) < TICK_GAP_PX)) ticks.push(tick);
    }
    const mark = layers.target;
    if (!target && mark && at(mark.x, mark.y) === piece) target = mark;
  });
  ticks.sort((a, b) => a.x - b.x);
  return { labels, ticks, trace: whole.trace ?? [], target };
}

/**
 * The pieces' pictures laid as one: piece 0 everywhere, then each next piece
 * over everything right of its seam, so each shows between its two seams
 * with no gap where they meet. `frames[k]` is the terrain through piece k's
 * camera; the seams are in CSS pixels of a picture drawn `scale` times as big.
 */
export function composePieces(frames, seams, { scale = 1, makeCanvas } = {}) {
  const [first] = frames;
  if (!first?.width) throw new Error('the pieces must be drawn before they can be laid together');
  const out = makeCanvas ? makeCanvas() : document.createElement('canvas');
  out.width = first.width;
  out.height = first.height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('this browser cannot lay the pieces together');
  ctx.drawImage(first, 0, 0);
  seams.forEach((seam, index) => {
    const next = frames[index + 1];
    if (!next || seam.length < 2) return;
    ctx.save();
    ctx.beginPath();
    seam.forEach((p, i) => (i ? ctx.lineTo(p.x * scale, p.y * scale) : ctx.moveTo(p.x * scale, p.y * scale)));
    ctx.lineTo(out.width + 1, seam[seam.length - 1].y * scale);
    ctx.lineTo(out.width + 1, seam[0].y * scale);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(next, 0, 0);
    ctx.restore();
  });
  return out;
}

/**
 * What an export draws a cut collage's terrain with, after the photo and the
 * whole terrain (HorizonView `exportPicture`): the terrain alone through each
 * piece's eased camera, left to right.
 *
 * @param {number} count how many pieces: the cuts and one
 * @param {{piece:number, turn:number, tilt:number, roll:number}[]} pieces as the search eased them
 */
export function pieceVariants(count, pieces) {
  return Array.from({ length: count }, (_, piece) => ({ photo: 0, through: (camera) => pieceCameras(camera, pieces)(piece) }));
}

/**
 * The pair as the search read a cut collage, out of an export drawn with
 * `[{ photo: 1 }, { photo: 0 }, ...pieceVariants(count, pieces)]`: the photo
 * and the whole terrain as before, and `searched`, the pieces laid as one
 * between their seams with what each piece's camera placed over it, each
 * piece's camera and how the search eased it. The pieces' own pictures are
 * let go once laid.
 */
export function searchedPair(drawn, { count, pieces, pieceAt, makeCanvas }) {
  const parts = drawn.frames.slice(2);
  const views = (drawn.turned ?? []).slice(2);
  const seams = seamsAcross(drawn.camera.width, drawn.camera.height, count, pieceAt);
  const frame = composePieces(parts, seams, { scale: drawn.scale, makeCanvas });
  for (const part of parts) part.width = 0;
  return {
    ...drawn,
    frames: drawn.frames.slice(0, 2),
    turned: (drawn.turned ?? []).slice(0, 2),
    searched: {
      frame,
      seams,
      layers: pieceLayers(views, pieceAt, drawn.camera, drawn.layers),
      cameras: views.map((view) => view?.camera ?? drawn.camera),
      eases: views.map((_, piece) => pieces.find((one) => one.piece === piece) ?? null),
    },
  };
}

const signed = (degrees) => `${degrees < 0 ? '−' : '+'}${Math.abs(degrees).toFixed(1)}°`;

/** How the search eased a piece from the whole's camera, said in a line: `turned +0.6°, tilted −0.3°, rolled +0.4°`. */
export function easeText(piece) {
  if (!piece) return 'as the whole';
  return `turned ${signed(piece.turn ?? 0)}, tilted ${signed(piece.tilt ?? 0)}, rolled ${signed(piece.roll ?? 0)}`;
}
