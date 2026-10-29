/**
 * A photo laid as a search read it, for the view: each point of the photo
 * (`u`, `v`, 0 to 1 across and down the straightened picture) taken to the
 * point of the frame where the search saw it, through the place's camera.
 *
 * - A collage read frame by frame (engine/frames.py `mesh`) lays each frame
 *   where its own camera put it: the mesh says, for a grid over the collage,
 *   where each point stands on the virtual camera's plane, and the place's
 *   heading, tilt and roll turn that camera.
 * - A cut collage (engine/skymatch.py `pieces_of`) lays each piece where its
 *   eased camera put it, so the seams show where the search moved them.
 * - A selfie found mirrored lies flipped left to right.
 *
 * The view is handed the photo already laid (lib/horizon/warpPicture.js
 * `paintLaid`) and the trace drawn over it follows, so what the search scored
 * is what shows. A laid photo is `{ kind, place, us, vs }`: `place(u, v, cell)`
 * gives the frame's point (null where nothing of the photo lies), `cell` the
 * middle of the grid cell a corner belongs to, so a cut's two sides move apart;
 * `us` and `vs` are the grid's edges.
 */
import { rayFor, toScreen } from './camera.js';
import { pieceCameras } from './overlay.js';

/** What the view says of a photo laid as searched, by how it was laid: one line for the button that lays it flat. */
export const AS_SEARCHED = {
  frames: 'Each frame of the collage where the search read it: press to lay the photo flat',
  pieces: 'Each piece where the search eased it: press to lay the photo flat',
  mirrored: 'Flipped, as the search found it: press to lay the photo as taken',
  stretched: 'Taller or flatter, as the search read the strip: press to lay the photo as taken',
};

/** Pixels across the virtual frames the arithmetic runs through: any size will do, the points are shares of it. */
const PLANE = 2000;
/** Cells across and down a cut or mirrored photo is laid on. */
export const LAID_CELLS = { across: 48, down: 16 };

const evenly = (count) => Array.from({ length: count + 1 }, (_, i) => i / count);

/** The point on the virtual camera's plane under a point of the collage, read off the mesh between its four nearest corners; null off every frame. */
export function meshPoint({ across, down, points }, u, v) {
  const fx = Math.min(across, Math.max(0, u * across));
  const fy = Math.min(down, Math.max(0, v * down));
  const i = Math.min(across - 1, Math.floor(fx));
  const j = Math.min(down - 1, Math.floor(fy));
  const a = fx - i;
  const b = fy - j;
  let x = 0;
  let y = 0;
  let weight = 0;
  for (const [di, dj, w] of [[0, 0, (1 - a) * (1 - b)], [1, 0, a * (1 - b)], [0, 1, (1 - a) * b], [1, 1, a * b]]) {
    const point = points[(j + dj) * (across + 1) + i + di];
    if (!point || !(w > 0)) continue;
    x += point[0] * w;
    y += point[1] * w;
    weight += w;
  }
  if (!(weight > 1e-9)) {
    // on a node or an edge whose weighted corners are all empty: the nearest corner, if it holds
    const near = points[Math.round(fy) * (across + 1) + Math.round(fx)];
    return near ? [near[0], near[1]] : null;
  }
  return [x / weight, y / weight];
}

/** A view camera at the frame's shape, for the arithmetic. */
function sized(camera, aspect) {
  return { ...camera, width: PLANE, height: PLANE / aspect };
}

/** The frame's point (0 to 1) where a direction shows through `view`, or null behind it. */
function shownAt(view, direction) {
  const at = toScreen(view, direction.azimuth, direction.elevation);
  return at.visible ? { u: at.x / view.width, v: at.y / view.height } : null;
}

/**
 * The panorama the view looks through from a place found on a collage read frame by frame: the pan's span and
 * middle as the stitch says them, stretched as much as the search found the frames wider or narrower.
 *
 * @param {{ lens: number, span: number, middle?: number }} framed the search's `frames`
 * @param {{ heading: number, tilt?: number, fov?: number }} place
 */
export function framesLook({ lens, span, middle = 0 }, place) {
  const wider = place.fov > 0 && lens > 0 ? place.fov / lens : 1;
  return { projection: 'panorama', heading: place.heading + middle * wider, tilt: place.tilt ?? 0, roll: 0, fov: span * wider };
}

/**
 * A collage read frame by frame, laid where the search read it.
 *
 * @param {{ mesh: {across:number, down:number, points:([number, number]|null)[]}, lens: number }} framed the search's `frames`
 * @param {{ heading:number, tilt:number, roll:number, fov?: number, mirrored?: boolean }} fit the place's camera: the
 *   virtual one, through the lens the search found (the stitch's when it says none); `mirrored` when the place was
 *   found with the trace flipped
 * @param {object} view the camera the view looks through once at the place (a panorama of the collage's span)
 * @param {number} aspect the frame's width over its height
 */
export function framesLaid({ mesh, lens }, fit, view, aspect) {
  const fov = fit.fov > 0 ? fit.fov : lens;
  const through = { heading: fit.heading, tilt: fit.tilt ?? 0, roll: fit.roll ?? 0, fov, projection: 'camera', width: PLANE, height: PLANE };
  const out = sized(view, aspect);
  return {
    kind: 'frames',
    us: evenly(mesh.across),
    vs: evenly(mesh.down),
    place(u, v) {
      const at = meshPoint(mesh, u, v);
      if (!at) return null;
      const x = fit.mirrored ? -at[0] : at[0];
      return shownAt(out, rayFor(through, ((x + 1) * PLANE) / 2, PLANE / 2 - (at[1] * PLANE) / 2));
    },
  };
}

/**
 * A cut collage laid piece by piece where the search eased each, flipped when the place was found mirrored, and a
 * strip laid by hand at the height scale the search read it at. With none of these there is nothing to lay: null.
 *
 * @param {object} camera the place's, as the view looks through it
 * @param {number} aspect the frame's width over its height
 * @param {{ pieces?: {piece:number, turn:number, tilt:number, roll:number}[]|null, pieceOf?: (u:number) => number, cuts?: number[], mirrored?: boolean, stretch?: number }} how
 *   the eased pieces, the piece a point across the photo lies in, the cuts across it (0 to 1), whether it was found
 *   mirrored, and the strip's degrees up per degree across (camera.js `stretch`)
 */
export function piecesLaid(camera, aspect, { pieces = null, pieceOf = () => 0, cuts = [], mirrored = false, stretch = 1 } = {}) {
  const eased = pieces?.length ? pieces : null;
  const scaled = camera.projection === 'panorama' && Number.isFinite(stretch) && stretch !== 1;
  if (!eased && !mirrored && !scaled) return null;
  const view = sized(camera, aspect);
  // the photo read through its own strip, the view drawn through the plain one
  const of = pieceCameras(scaled ? { ...view, stretch } : view, eased);
  // the cuts are edges of the grid, so each side of a seam is laid by its own piece
  const us = [...new Set([...evenly(LAID_CELLS.across), ...(eased ? cuts : [])])].filter((u) => u >= 0 && u <= 1).sort((a, b) => a - b);
  return {
    kind: eased ? 'pieces' : scaled ? 'stretched' : 'mirrored',
    us,
    vs: evenly(LAID_CELLS.down),
    place(u, v, cell = { u, v }) {
      const across = mirrored ? 1 - u : u;
      const through = of(eased ? pieceOf(cell.u) : 0);
      return shownAt(view, rayFor(through, across * PLANE, v * view.height));
    },
  };
}
