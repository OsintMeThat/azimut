/**
 * Which tiles of the globe are drawn, and which are asked for, frame by frame.
 *
 * The tiles form a tree over the Web Mercator grid, from the four of zoom 1
 * down. A tile is split while one of its picture's pixels would cover more than
 * `sharpness` screen pixels at its nearest point, so the ground keeps about a
 * picture pixel per screen pixel near and far, whatever the tilt. A tile out of
 * the frame, or behind the curve of the Earth, is neither drawn nor split.
 *
 * Nothing ever opens a hole. A tile is drawn only once its mesh is held, and
 * over the quarter of each child in view not held yet it is drawn in that
 * child's place (`quarters`, a bit a child): the ground sharpens where it
 * stands, a quarter at a time, and a coarse tile never covers more than the
 * ground still waiting for a finer one. The asks go coarse first,
 * the frame's own before its margin, and a tile that will be split as soon as
 * it comes has its children asked with it, a few levels down, so a deep zoom
 * does not wait one level after another.
 *
 * What no frame has used for a while is let go past `budget` meshes, the
 * deepest first, so a tile is never let go while a child of it is held.
 *
 * The ground all round the eye is kept too, coarser (`ROUND_SHARPNESS`), so
 * what a quick turn or pan shows is already held a few levels short of sharp;
 * its tiles are asked after all of the frame's own (`round` lists the held
 * ones, whose pictures the caller may ask ahead the same way).
 *
 * Some ground has to be known though it is not in view: the ground under the
 * eye, which says how low it may go, and while an orbit lasts the ground round
 * its pivot that the eye can swing over (`knowGround`). Their tiles are asked
 * and kept like the frame's own, never drawn for it.
 *
 * Pure: the meshes are asked of `request` and handed back to `arrived`, and a
 * test drives it with a camera and no GPU.
 */
import { EARTH, MERC_LAT, RAD, dot, ecef, geodetic, length, sub } from './earth.js';
import { axes, focalOf } from './camera.js';
import { tileLat, tileLon } from '../horizon/mesh/geo.js';

/** The tree's roots: the four tiles of zoom 1. */
export const ROOT_Z = 1;
/** The deepest a tile may be split, whatever the imagery. */
export const MAX_Z = 21;
/** Picture pixels a screen pixel may show before a tile is split. */
export const SHARPNESS = 1.25;
/**
 * …and all round the eye, in view or not: the ground a quick turn or pan
 * brings into view is already held this sharp, a few levels short of the
 * frame's own, never a tile the size of a country.
 */
export const ROUND_SHARPNESS = 6;
/** Asks for the ground all round come after every ask for the frame's own. */
const ROUND_RANK = 1e12;
/** Heights a tile is assumed to span before its own are known: the Dead Sea to Everest. */
const UNKNOWN_LOW = -500;
const UNKNOWN_HIGH = 8900;
/** Below this zoom a tile is too big for the horizon test: it bulges between its points. */
const HORIZON_FROM_Z = 4;
/** Every quarter of a tile, a bit each in the order of its children. */
export const ALL = 15;
/** Levels a tile that will surely be split has its children asked ahead. */
const AHEAD = 3;
/** The finest ground kept known out of view, and the frames an orbit's ground is kept known for. */
const KNOWN_Z = 16;
const KNOWN_FRAMES = 600;

const keyOf = (z, x, y) => `${z}/${x}/${y}`;

/**
 * @param {object} o
 * @param {(asks: { key: string, z: number, x: number, y: number }[]) => void} o.request
 *   meshes to build, most wanted first
 * @param {(tile: object) => void} o.release a mesh let go (its GPU handle)
 * @param {number} [o.budget] meshes held at most
 * @param {number} [o.inFlight] meshes asked and not back yet, at most
 */
export function createTree({ request, release, budget = 700, inFlight = 48, maxZ = MAX_Z, sharpness = SHARPNESS }) {
  const nodes = new Map();
  let loading = 0;
  let frameNo = 0;
  let held = 0;

  function node(z, x, y, parent = null) {
    const key = keyOf(z, x, y);
    let n = nodes.get(key);
    if (!n) {
      n = {
        key,
        z,
        x,
        y,
        parent,
        kids: null,
        state: 'idle',
        mesh: null,
        heights: null,
        low: null,
        high: null,
        used: 0,
        lat0: tileLat(y + 1, z),
        lat1: tileLat(y, z),
        lon0: tileLon(x, z),
        lon1: tileLon(x + 1, z),
        bound: null,
      };
      nodes.set(key, n);
    }
    return n;
  }

  const roots = [];
  for (let y = 0; y < 2 ** ROOT_Z; y += 1) for (let x = 0; x < 2 ** ROOT_Z; x += 1) roots.push(node(ROOT_Z, x, y));

  // areas whose ground must be known out of view: `{ lat, lon, radius, until }`
  const kept = [];

  const kidsOf = (n) =>
    (n.kids ??= [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].map(([dx, dy]) => node(n.z + 1, 2 * n.x + dx, 2 * n.y + dy, n)));

  /** The heights a tile spans: its own once built, else its nearest built ancestor's. */
  function rangeOf(n) {
    for (let at = n; at; at = at.parent) if (at.low != null) return [at.low, at.high];
    return [UNKNOWN_LOW, UNKNOWN_HIGH];
  }

  /**
   * Points that hold the tile between them, at its lowest and highest ground:
   * its corners, the middle of its edges and its centre. Cached per range.
   */
  function boundOf(n, exaggeration) {
    const [low, high] = rangeOf(n);
    const lo = low * exaggeration;
    const hi = high * exaggeration;
    if (n.bound && n.bound.lo === lo && n.bound.hi === hi) return n.bound;
    const lats = [n.lat0, (n.lat0 + n.lat1) / 2, n.lat1];
    const lons = [n.lon0, (n.lon0 + n.lon1) / 2, n.lon1];
    const top = [];
    const points = [];
    for (const la of lats) {
      for (const lo2 of lons) {
        const p = ecef(la, lo2, hi);
        top.push(p);
        points.push(p, ecef(la, lo2, lo));
      }
    }
    const mid = ecef((n.lat0 + n.lat1) / 2, (n.lon0 + n.lon1) / 2, (lo + hi) / 2);
    let radius = 0;
    for (const p of points) radius = Math.max(radius, length(sub(p, mid)));
    // a big tile curves away between its points; its sphere grows by how much
    if (n.z < HORIZON_FROM_Z) radius += EARTH * (1 - Math.cos(((n.lon1 - n.lon0) / 4) * RAD));
    n.bound = { lo, hi, mid, radius, top };
    return n.bound;
  }

  /** The ground of the tile nearest the eye, and how far it is in metres. */
  function nearest(n, eyeAt, eye, exaggeration) {
    const [low, high] = rangeOf(n);
    const lat = Math.min(Math.max(eyeAt.lat, n.lat0), n.lat1);
    // the eye's longitude taken round to the tile's side of the antimeridian
    const mid = (n.lon0 + n.lon1) / 2;
    const lonEye = eyeAt.lon + Math.round((mid - eyeAt.lon) / 360) * 360;
    const lon = Math.min(Math.max(lonEye, n.lon0), n.lon1);
    const h = Math.min(Math.max(eyeAt.h, low * exaggeration), high * exaggeration);
    return { d: length(sub(ecef(lat, lon, h), eye)), lat, lon };
  }

  /** Whether the line from the eye to `p` passes through the sphere of radius `r` before reaching it. */
  function hidden(eye, p, r) {
    const d = sub(p, eye);
    const t = -dot(eye, d) / dot(d, d);
    if (t <= 0 || t >= 1) return false;
    const c = [eye[0] + d[0] * t, eye[1] + d[1] * t, eye[2] + d[2] * t];
    return length(c) < r;
  }

  /**
   * The frame's view: the camera's axes, its lens and the planes it is cut by.
   * `size` in CSS pixels.
   */
  function viewOf(camera, size, exaggeration) {
    const ax = axes(camera);
    const f = focalOf(size.height);
    const halfX = Math.atan(size.width / 2 / f);
    const halfY = Math.atan(size.height / 2 / f);
    const eyeAt = geodetic(camera.eye);
    return { ...ax, eye: camera.eye, eyeAt, f, halfX, halfY, exaggeration, occluder: EARTH - 1000 };
  }

  function inFrustum(n, v) {
    const b = boundOf(n, v.exaggeration);
    const rel = sub(b.mid, v.eye);
    const z = dot(rel, v.forward);
    if (z < -b.radius) return false;
    const x = dot(rel, v.right);
    const y = dot(rel, v.up);
    const side = (along, half) => along * Math.cos(half) - z * Math.sin(half) <= b.radius;
    return side(x, v.halfX) && side(-x, v.halfX) && side(y, v.halfY) && side(-y, v.halfY);
  }

  /**
   * Whether the curve of the Earth hides the whole tile: its corners, the
   * middles of its edges, its centre and its ground nearest the eye, all at
   * its highest, each behind the sphere a kilometre under the sea. The nearest
   * ground counts because a big tile can hold the eye's own ground while all
   * its other points lie past the horizon.
   */
  function behindHorizon(n, v, from = HORIZON_FROM_Z) {
    if (n.z < from) return false;
    const b = boundOf(n, v.exaggeration);
    if (!b.top.every((p) => hidden(v.eye, p, v.occluder))) return false;
    const { lat, lon } = nearest(n, v.eyeAt, v.eye, v.exaggeration);
    return hidden(v.eye, ecef(lat, lon, b.hi), v.occluder);
  }

  const seen = (n, v) => inFrustum(n, v) && !behindHorizon(n, v);

  /** Screen pixels a picture pixel of the tile covers at its nearest point. */
  function pixelsOf(n, v) {
    const { d, lat } = nearest(n, v.eyeAt, v.eye, v.exaggeration);
    const texel = (2 * Math.PI * EARTH * Math.cos(lat * RAD)) / (256 * 2 ** n.z);
    return { pixels: (texel * v.f) / Math.max(d, 1), d };
  }

  /**
   * One frame: the tiles to draw, and the asks it leaves. `limit` caps how deep
   * tiles are split (the imagery's own last level, a terrain-only view…).
   */
  function frame(camera, size, { exaggeration = 1, limit = maxZ } = {}) {
    frameNo += 1;
    const v = viewOf(camera, size, exaggeration);
    const ceiling = Math.min(limit, maxZ);
    const drawn = [];
    const wanted = [];
    let waiting = 0;

    const want = (n, d, inside, depth = 0) => {
      if (n.state !== 'idle') return;
      wanted.push({ n, priority: n.z * 1e9 + (inside ? 0 : 5e8) + d + depth });
    };
    const splits = (n) => {
      if (n.z >= ceiling) return false;
      return pixelsOf(n, v).pixels > sharpness;
    };
    /** The children of a tile not held yet that will be split as soon as it comes, asked with it. */
    const ahead = (n, depth) => {
      n.used = frameNo;
      if (depth > AHEAD || !splits(n)) return;
      for (const c of kidsOf(n)) {
        if (!seen(c, v)) continue;
        c.used = frameNo;
        if (c.state === 'idle') want(c, pixelsOf(c, v).d, true, depth);
        if (c.state !== 'failed') ahead(c, depth + 1);
      }
    };
    const draw = (n, quarters) => {
      n.quarters = quarters;
      drawn.push(n);
    };
    const visit = (n) => {
      n.used = frameNo;
      if (!splits(n)) {
        draw(n, ALL);
        return;
      }
      // each child in view is drawn once held; until then, and for good where
      // it could not be built, this tile is drawn over its quarter alone
      let quarters = 0;
      kidsOf(n).forEach((c, q) => {
        c.used = frameNo;
        if (!seen(c, v)) return;
        if (c.state === 'ready') {
          visit(c);
          return;
        }
        quarters |= 1 << q;
        if (c.state === 'idle') {
          want(c, pixelsOf(c, v).d, true);
          waiting += 1;
        } else if (c.state === 'loading') waiting += 1;
        if (c.state !== 'failed') ahead(c, 1);
      });
      if (quarters) draw(n, quarters);
    };
    for (const r of roots) {
      r.used = frameNo;
      if (!seen(r, v)) continue;
      if (r.state === 'ready') visit(r);
      else {
        want(r, 0, true);
        waiting += 1;
        if (r.state !== 'failed') ahead(r, 1);
      }
    }
    // roots are asked whether in view or not: they are the ground everything stands on
    for (const r of roots) if (r.state === 'idle') want(r, 0, false);
    // the ground all round, coarser, after everything the frame itself asks
    const round = [];
    const roundSplits = (n) => n.z < ceiling && pixelsOf(n, v).pixels > ROUND_SHARPNESS;
    const aroundEye = (n) => {
      n.used = frameNo;
      if (!roundSplits(n)) {
        round.push(n);
        return;
      }
      for (const c of kidsOf(n)) {
        // a big tile can bulge past its points, but ground merely asked ahead may be missed
        if (behindHorizon(c, v, 2)) continue;
        c.used = frameNo;
        if (c.state === 'ready') aroundEye(c);
        else if (c.state === 'idle') wanted.push({ n: c, priority: ROUND_RANK + c.z * 1e9 + pixelsOf(c, v).d });
      }
    };
    for (const r of roots) if (r.state === 'ready') aroundEye(r);
    // and the ground under the eye, and round an orbit's pivot, down to its level
    const above = Math.max(0, v.eyeAt.h - (groundAt(v.eyeAt.lat, v.eyeAt.lon)?.h ?? 0) * exaggeration);
    const areas = [{ lat: v.eyeAt.lat, lon: v.eyeAt.lon, radius: Math.max(300, above) }];
    for (let i = kept.length - 1; i >= 0; i -= 1) {
      if (kept[i].until < frameNo) kept.splice(i, 1);
      else areas.push(kept[i]);
    }
    for (const area of areas) keepKnown(area, want);
    ask(wanted);
    letGo();
    return { drawn, waiting, view: v, round };
  }

  /**
   * The tiles under an area, at the level whose tiles are about its radius
   * wide (at most three a side), asked with every tile above them: the ground
   * is read down from the roots, through held tiles only.
   */
  function keepKnown({ lat, lon, radius }, want) {
    if (Math.abs(lat) > MERC_LAT) return;
    const width = 2 * Math.PI * EARTH * Math.cos(lat * RAD);
    const z = Math.max(ROOT_Z, Math.min(KNOWN_Z, maxZ, Math.floor(Math.log2(width / Math.max(radius, 1)))));
    const dLat = radius / 111320;
    const dLon = radius / (111320 * Math.max(Math.cos(lat * RAD), 0.01));
    const n = 2 ** z;
    const toX = (lo) => Math.floor((((lo + 180) / 360) % 1 + 1) % 1 * n);
    const toY = (la) => {
      const s = Math.sin(Math.max(-MERC_LAT, Math.min(MERC_LAT, la)) * RAD);
      return Math.min(n - 1, Math.max(0, Math.floor((0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n)));
    };
    const xs = new Set([toX(lon - dLon), toX(lon), toX(lon + dLon)]);
    for (let y = toY(lat + dLat); y <= toY(lat - dLat); y += 1) {
      for (const x of xs) {
        // down from the root over it, each tile on the way kept and asked
        let at = nodes.get(keyOf(ROOT_Z, x >> (z - ROOT_Z), y >> (z - ROOT_Z)));
        while (at) {
          at.used = frameNo;
          if (at.state === 'idle') want(at, 0, true);
          if (at.z >= z) break;
          const up = z - at.z - 1;
          at = kidsOf(at).find((c) => c.x === x >> up && c.y === y >> up);
        }
      }
    }
  }

  function ask(list) {
    if (!list.length || loading >= inFlight) return;
    list.sort((a, b) => a.priority - b.priority);
    const asks = [];
    for (const { n } of list) {
      if (loading >= inFlight) break;
      if (n.state !== 'idle') continue;
      n.state = 'loading';
      loading += 1;
      asks.push({ key: n.key, z: n.z, x: n.x, y: n.y });
    }
    if (asks.length) request(asks);
  }

  /**
   * Past the budget, down to nine tenths of it: leaves first, since a tile
   * with a held child stays or the child could not be reached, the least
   * recently used and deepest first. A tile let go forgets its children that
   * hold nothing, so the tree itself stays the size of what is held.
   */
  function letGo() {
    if (held <= budget) return;
    const leaves = [];
    for (const n of nodes.values()) {
      if (n.state === 'ready' && n.z > ROOT_Z && n.used < frameNo && !(n.kids ?? []).some((c) => c.state === 'ready')) leaves.push(n);
    }
    leaves.sort((a, b) => a.used - b.used || b.z - a.z);
    const floor = Math.floor(budget * 0.9);
    for (const n of leaves) {
      if (held <= floor) break;
      release(n);
      n.mesh = null;
      n.heights = null;
      n.state = 'idle';
      held -= 1;
      forgetKids(n);
    }
  }

  /** The children of a tile, gone from the tree when nothing of theirs is held or on its way. */
  function forgetKids(n) {
    if (!n.kids || n.kids.some((c) => c.state === 'ready' || c.state === 'loading' || c.kids)) return;
    for (const c of n.kids) nodes.delete(c.key);
    n.kids = null;
  }

  /**
   * The ground's height at a point, from the finest held tile over it, and that
   * tile's zoom; null where no tile is held yet. Heights at their real scale.
   */
  function groundAt(lat, lon) {
    if (Math.abs(lat) > MERC_LAT) return null;
    const X = (lon + 180) / 360 - Math.floor((lon + 180) / 360);
    const s = Math.sin(lat * RAD);
    const Y = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
    let best = null;
    let z = ROOT_Z;
    let n = nodes.get(keyOf(z, Math.floor(X * 2 ** z), Math.floor(Y * 2 ** z)));
    while (n && n.state === 'ready') {
      best = n;
      z += 1;
      n = n.kids ? nodes.get(keyOf(z, Math.floor(X * 2 ** z), Math.floor(Y * 2 ** z))) : null;
    }
    if (!best?.heights) return null;
    const side = Math.round(Math.sqrt(best.heights.length));
    const seg = side - 1;
    const fx = Math.min(Math.max((X * 2 ** best.z - best.x) * seg, 0), seg);
    const fy = Math.min(Math.max((Y * 2 ** best.z - best.y) * seg, 0), seg);
    const i = Math.min(Math.floor(fx), seg - 1);
    const j = Math.min(Math.floor(fy), seg - 1);
    const tx = fx - i;
    const ty = fy - j;
    const h = (a, b) => best.heights[b * side + a];
    const top = h(i, j) * (1 - tx) + h(i + 1, j) * tx;
    const bottom = h(i, j + 1) * (1 - tx) + h(i + 1, j + 1) * tx;
    return { h: top * (1 - ty) + bottom * ty, z: best.z };
  }

  return {
    frame,
    groundAt,
    /** Keep the ground within `radius` metres of a point known for a while, though it is out of view. */
    knowGround(lat, lon, radius) {
      kept.push({ lat, lon, radius, until: frameNo + KNOWN_FRAMES });
    },
    /** A mesh a worker built (null when it could not be), with its heights. */
    arrived(key, built) {
      const n = nodes.get(key);
      loading = Math.max(0, loading - 1);
      if (!n || n.state !== 'loading') {
        if (built?.mesh) release({ mesh: built.mesh });
        return;
      }
      if (!built) {
        n.state = 'failed';
        return;
      }
      held += 1;
      n.state = 'ready';
      n.mesh = built.mesh;
      n.heights = built.heights;
      n.centre = built.centre;
      n.low = built.low;
      n.high = built.high;
      n.bound = null;
      // the children measured against this tile's range know it better now
      for (const c of n.kids ?? []) c.bound = null;
    },
    /** Tiles that failed are asked again (the app was not reached). */
    retry() {
      for (const n of nodes.values()) if (n.state === 'failed') n.state = 'idle';
    },
    /** Everything let go. */
    dispose() {
      for (const n of nodes.values()) if (n.state === 'ready') release(n);
      nodes.clear();
      held = 0;
    },
    get loading() {
      return loading;
    },
    get held() {
      return held;
    },
    /** A tile by key, for a test. */
    node: (key) => nodes.get(key) ?? null,
  };
}
