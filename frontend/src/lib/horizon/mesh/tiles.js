/**
 * Which tiles a view draws and which it asks for, frame by frame.
 *
 * The tiles are Web Mercator's, each one a mesh (worker.js) with, over
 * satellite ground, its picture. A tile is split while one of its picture's
 * pixels would cover more than `k` screen pixels at its nearest point, so the
 * ground keeps about one picture pixel per screen pixel near and far.
 *
 * Two needs drive the tree:
 *
 * - **All round, at a base detail**: what the eye sees whichever way it turns,
 *   at the lens the view opened with (never narrower than 40°). Loaded once
 *   when the eye lands, behind a progress the view shows; after that, turning
 *   never waits.
 * - **The lens, sharp**: what the camera shows now, at `k` pixels a picture
 *   pixel. Asked for first and drawn as it comes.
 *
 * A tile is drawn only once it is held; until its children all are, it is
 * drawn instead of them, so a view never opens a hole while it sharpens. Asks
 * go to the workers in batches, the frame's own first and coarse before fine,
 * then a margin round it so a small turn finds the ground sharp, and
 * what no frame has used for a while is let go past `budget` tiles. A tile
 * that will surely be split once it comes has its children asked with it, so
 * a deep zoom does not wait for one level after another; and the lens
 * sharpens only the ground its frame shows, from each tile's heights (its
 * parent's until its own come), not the ground under the frame's bottom edge.
 * The margin is 3° round a wide lens and about half the lens round a narrow
 * one: a fixed 3° round a 1° telephoto had it sharpen seven times its frame.
 * The view says it is sharpening (`sharpening`) only while the frame itself
 * waits.
 *
 * Ground a nearer ridge hides is not sharpened either (`setOccluder`): the
 * eye's own turn, marched by the app, says how far each ray meets the ground,
 * and a tile whose top every ray across it meets ground well short of is
 * hidden whole. It keeps the detail it has, which nobody can see.
 *
 * The pictures follow the imagery asked (`setImagery`): the free provider all
 * round, Sentinel-2 on the tiles nearer than its reach. A tile built for other
 * imagery keeps its picture, or the relief, until its new one comes, the tiles
 * on screen first.
 */
import { seenLens } from '../camera.js';
import { depthAt } from '../panorama.js';
import { MERC, RAD, eyeFrame, latToY, lonToX, tileLat, tileLon } from './geo.js';

export const MAX_Z = 18;
export const ROOT_Z = 6;
/** Pixels a picture pixel may cover in the base all round, and at most how many tiles it holds. */
export const BASE_K = 3;
export const BASE_MAX = 900;
/** Degrees sharpened either side of a lens beyond its frame: at most this, about half a narrow lens. */
export const MARGIN_DEG = 3;
/** The margin's share of a narrow lens, and its floor. */
const MARGIN_SHARE = 0.5;
const MARGIN_MIN = 0.25;
/**
 * A tile is called hidden only with room to spare: its top read this many
 * degrees higher, the ground in front this much nearer than the tile (metres,
 * or a share of its distance). Every column of the turn across it is read.
 */
const HIDE_RISE_DEG = 0.15;
const HIDE_SHORT_M = 150;
const HIDE_SHORT_SHARE = 0.1;

/** How far round a lens of `fov` degrees the ground is sharpened beyond its frame, in degrees. */
export function marginFor(fov) {
  return Math.min(MARGIN_DEG, Math.max(MARGIN_MIN, MARGIN_SHARE * fov));
}
const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;

/**
 * @param {object} o
 * @param {number} o.lat the eye's latitude, which the tree is laid round
 * @param {number} o.lon
 * @param {number} o.far metres: no tile farther is asked
 * @param {(list: object[]) => void} o.send asks meshes, `[{ key, z, x, y, provider }]`
 * @param {(list: object[]) => void} o.sendImages asks pictures for meshes held
 * @param {(tile: any) => void} o.release lets a tile's GPU handle go
 * @param {(tile: any, image: any) => void} o.attach gives a held tile its picture
 */
export function createTiles({
  lat,
  lon,
  far,
  send,
  sendImages,
  release,
  attach,
  imagery = null,
  baseK = BASE_K,
  baseMax = BASE_MAX,
  budget = 1400,
  batch = 32,
  loadingMax = 256,
  picturingMax = 128,
}) {
  const frame = eyeFrame({ lat, lon, alt: 0 });
  const records = new Map();
  let roots = [];
  let baseKeys = new Set();
  let basePixel = 0;
  let rise = 0;
  let used = 0;
  let loading = 0;
  let picturing = 0;
  let wanted = imagery;
  // the eye's turn as the app marched it (lib/horizon/panorama.js), while it is this tree's eye
  let occluder = null;

  function geometryOf(z, x, y) {
    const lon0 = tileLon(x, z);
    const lon1 = tileLon(x + 1, z);
    const lat0 = tileLat(y + 1, z);
    const lat1 = tileLat(y, z);
    const [dmin] = frame.inverse(Math.min(Math.max(lat, lat0), lat1), Math.min(Math.max(lon, lon0), lon1));
    const size = (MERC / 2 ** z) * Math.cos(((lat0 + lat1) / 2) * RAD);
    const corners = [
      [lat0, lon0],
      [lat0, lon1],
      [lat1, lon0],
      [lat1, lon1],
    ].map(([la, lo]) => frame.inverse(la, lo));
    const dmax = Math.max(...corners.map(([d]) => d));
    if (lat >= lat0 && lat <= lat1 && lon >= lon0 && lon <= lon1) return { dmin, dmax, size, full: true };
    // the bearings the tile covers: the turn less the largest gap between its corners
    const bearings = corners.map(([, b]) => (((b / RAD) % 360) + 360) % 360).sort((a, b) => a - b);
    let gap = 360 - bearings[3] + bearings[0];
    let start = bearings[0];
    for (let i = 1; i < 4; i += 1) {
      if (bearings[i] - bearings[i - 1] > gap) {
        gap = bearings[i] - bearings[i - 1];
        start = bearings[i];
      }
    }
    return { dmin, dmax, size, full: 360 - gap > 180, middle: start + (360 - gap) / 2, span: 360 - gap };
  }

  function record(z, x, y) {
    const key = `${z}/${x}/${y}`;
    let r = records.get(key);
    if (!r) {
      r = { key, z, x, y, state: 'idle', tile: null, used: 0, kids: null, picture: '', picturing: '', ...geometryOf(z, x, y) };
      records.set(key, r);
    }
    return r;
  }

  const childrenOf = (r) =>
    (r.kids ??= [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].map(([dx, dy]) => Object.assign(record(r.z + 1, 2 * r.x + dx, 2 * r.y + dy), { parent: r }))).filter(
      (c) => c.dmin <= far
    );
  /** The lowest and highest ground a tile holds: its own once built, its nearest built ancestor's before. */
  function rangeOf(r) {
    for (let at = r; at; at = at.parent) if (at.low != null) return at;
    return null;
  }
  /** Radians above the level at which ground `h` metres high, `d` metres away, is seen from `alt`. */
  function elevationOf(d, h, alt) {
    const delta = d / frame.R;
    return Math.atan2((frame.R + h) * Math.cos(delta) - (frame.R + alt), (frame.R + h) * Math.sin(delta));
  }

  /**
   * Whether nearer ground hides the whole tile from an eye `alt` metres up: at
   * the height its top is seen, every ray across it meets ground well short of
   * it. Along one ray a lower look meets ground no farther, so the rest of the
   * tile is hidden too. Worked out once a tile for each turn and each height
   * its top is known by.
   */
  function hiddenBehind(r, alt) {
    if (!occluder || alt == null || r.full || !(r.span < 180)) return false;
    const range = rangeOf(r);
    if (!range) return false;
    if (r.hidBy === occluder && r.hidAt === range.high) return r.hidden;
    const high = range.high + 50;
    let top = Math.max(elevationOf(r.dmin, high, alt), elevationOf(r.dmax, high, alt));
    const horizon = Math.sqrt(Math.max(0, 2 * frame.R * (alt - high)));
    if (horizon > r.dmin && horizon < r.dmax) top = Math.max(top, elevationOf(horizon, high, alt));
    const look = top / RAD + HIDE_RISE_DEG;
    const short = r.dmin - Math.max(HIDE_SHORT_M, HIDE_SHORT_SHARE * r.dmin);
    const step = occluder.azimuth.step;
    let hidden = true;
    for (let a = r.middle - r.span / 2; a <= r.middle + r.span / 2 + 1e-9; a += step) {
      const ground = depthAt(occluder, a, look);
      if (ground == null || ground >= short) {
        hidden = false;
        break;
      }
    }
    r.hidBy = occluder;
    r.hidAt = range.high;
    r.hidden = hidden;
    return hidden;
  }
  // what a tile's picture pixel spans seen from the eye, which stands `rise` over the ground
  const angleOf = (r, shift = 0) => r.size / 256 / Math.max(Math.hypot(Math.max(r.dmin - shift, 0), rise), 1);
  const wantsBase = (r) => r.z < MAX_Z && angleOf(r) > baseK * basePixel;

  /** The imagery a tile's picture should come from, or null for none. */
  function providerOf(r) {
    if (!wanted) return null;
    return wanted.near && r.dmin < wanted.near.reach ? wanted.near.provider : wanted.provider;
  }
  const pictured = (r) => !providerOf(r) || r.picture === providerOf(r);

  /**
   * The tiles the base needs all round for a camera, none fetched yet, the eye
   * standing `lift` metres over the ground; the base coarsens until it fits `baseMax`.
   */
  function land(camera, lift = 0) {
    rise = lift;
    const dLat = far / 111000 + 0.5;
    const dLon = far / (111000 * Math.cos(lat * RAD)) + 0.5;
    roots = [];
    const last = 2 ** ROOT_Z - 1;
    const top = Math.max(0, Math.floor(latToY(Math.min(85, lat + dLat), ROOT_Z)));
    const bottom = Math.min(last, Math.floor(latToY(Math.max(-85, lat - dLat), ROOT_Z)));
    for (let y = top; y <= bottom; y += 1) {
      for (let x = Math.floor(lonToX(lon - dLon, ROOT_Z)); x <= Math.floor(lonToX(lon + dLon, ROOT_Z)); x += 1) {
        const r = record(ROOT_Z, ((x % 2 ** ROOT_Z) + 2 ** ROOT_Z) % 2 ** ROOT_Z, y);
        if (r.dmin <= far && !roots.includes(r)) roots.push(r);
      }
    }
    basePixel = (Math.max(camera.fov, 40) * RAD) / Math.max(camera.width, 1);
    const tree = () => {
      const keys = new Set();
      const stack = [...roots];
      while (stack.length) {
        const r = stack.pop();
        keys.add(r.key);
        if (wantsBase(r)) stack.push(...childrenOf(r));
      }
      return keys;
    };
    baseKeys = tree();
    while (baseKeys.size > baseMax) {
      baseK *= 1.15;
      baseKeys = tree();
    }
  }

  /**
   * What one frame draws, and the asks it leaves. `sharp` is k, pixels a
   * picture pixel may cover; `shift` how far, in metres, the eye has walked
   * from where the tree was laid, which widens what may be in sight; `alt` the
   * eye's height above the sea, which says what the frame shows up and down
   * (null: everything in its bearings).
   */
  function frameFor(camera, sharp, { shift = 0, alt = null } = {}) {
    used += 1;
    const lens = camera.projection === 'panorama' ? camera : { ...camera, ...seenLens(camera) };
    const width = Math.max(camera.width, 1);
    const pixel = (lens.fov * RAD) / width;
    // degrees either side of the heading: the frame's own (`exact`), and with the margin round it (`half`)
    let half;
    let exact;
    // radians above the level the frame spans, a degree over each way
    let up;
    if (camera.projection === 'panorama') {
      half = Math.min(180, camera.fov / 2 + 2);
      exact = half;
      const tall = (camera.fov * camera.height) / width / 2;
      up = [(lens.tilt ?? 0) - tall, (lens.tilt ?? 0) + tall];
    } else {
      const hHalf = (lens.fov / 2) * RAD;
      const vHalf = Math.atan((Math.tan(hHalf) * camera.height) / width);
      const corner = Math.min(89 * RAD, Math.abs((lens.tilt ?? 0) * RAD) + vHalf);
      exact = Math.atan(Math.tan(hHalf) / Math.cos(corner)) / RAD + Math.abs(camera.roll ?? 0);
      half = exact + marginFor(lens.fov);
      // rolled, the frame reaches as far up and down as its corners
      const tall = (Math.abs(camera.roll ?? 0) > 0.5 ? Math.atan(Math.hypot(Math.tan(hHalf), Math.tan(vHalf))) : vHalf) / RAD;
      up = [(lens.tilt ?? 0) - tall, (lens.tilt ?? 0) + tall];
    }
    up = [(up[0] - 1) * RAD, (up[1] + 1) * RAD];
    const within = (r, wide) => {
      if (r.full || wide >= 180) return true;
      const slack = shift > 0 ? (r.dmin <= shift ? 180 : Math.asin(shift / r.dmin) / RAD) : 0;
      return Math.abs(wrap180(r.middle - lens.heading)) <= wide + r.span / 2 + slack;
    };
    const visible = (r) => within(r, half);
    // whether some of the tile's ground can be in the frame up and down; a coarse ancestor's
    // heights may miss a peak, hence the 50 m each way
    const inFrame = (r) => {
      const range = alt == null || r.full || r.dmin <= shift ? null : rangeOf(r);
      if (!range) return true;
      const near = Math.max(r.dmin - shift, 1);
      const far = r.dmax + shift;
      const high = range.high + 50;
      const low = range.low - 50;
      let top = Math.max(elevationOf(near, high, alt), elevationOf(far, high, alt));
      // ground under the eye is seen highest at the distance of its own horizon
      const horizon = Math.sqrt(Math.max(0, 2 * frame.R * (alt - high)));
      if (horizon > near && horizon < far) top = Math.max(top, elevationOf(horizon, high, alt));
      const bottom = Math.min(elevationOf(near, low, alt), elevationOf(far, low, alt));
      return top >= up[0] && bottom <= up[1];
    };
    const seenNow = (r) => visible(r) && inFrame(r);
    // behind a nearer ridge: the turn was marched from where the tree was laid, so not once walked off
    const behind = (r) => shift < 1 && hiddenBehind(r, alt);
    // in the frame itself, not only in the margin round it: asked first, and what the view waits for
    const framed = (r) => within(r, exact) && inFrame(r) && !behind(r);
    const fineFor = (r) => r.z < MAX_Z && seenNow(r) && !behind(r) && angleOf(r, shift) > sharp * pixel;
    const meshes = [];
    const pictures = [];
    const drawn = [];
    let sharpening = 0;
    const want = (r, seen) => {
      if (r.state !== 'idle') return;
      const off = r.full ? 0 : Math.abs(wrap180(r.middle - lens.heading)) / 360;
      const inside = seen && framed(r);
      meshes.push({ r, priority: (inside ? 0 : seen ? 50 : 100) + r.z + off });
      if (inside) sharpening += 1;
    };
    /** A tile not held yet that will be split once it comes: its children are asked with it. */
    const ahead = (r, depth) => {
      r.used = used;
      const base = wantsBase(r);
      if (depth > 3 || !(base || fineFor(r))) return;
      for (const c of base ? childrenOf(r) : childrenOf(r).filter(visible)) {
        if (c.state === 'idle') want(c, seenNow(c));
        if (c.state !== 'failed') ahead(c, depth + 1);
      }
    };
    const visit = (r, drawing) => {
      r.used = used;
      const seen = visible(r);
      const base = wantsBase(r);
      const fine = fineFor(r);
      if (!base && !fine) {
        if (drawing && seen) drawn.push(r);
        return;
      }
      const kids = childrenOf(r);
      const needed = base ? kids : kids.filter(visible);
      const covered = needed.every((c) => !visible(c) || c.state === 'ready');
      const here = drawing && seen && !covered;
      if (here) drawn.push(r);
      for (const c of needed) {
        if (c.state === 'ready') visit(c, drawing && !here);
        else {
          if (c.state === 'idle') want(c, seenNow(c));
          else if (c.state === 'loading' && framed(c)) sharpening += 1;
          if (c.state !== 'failed') ahead(c, 1);
        }
      }
    };
    for (const r of roots) {
      if (r.state === 'ready') visit(r, true);
      else {
        want(r, seenNow(r));
        ahead(r, 1);
      }
    }
    drawn.sort((a, b) => a.dmin - b.dmin);
    // pictures for the imagery asked now: the tiles on screen first, then the rest held
    const onScreen = new Set(drawn);
    for (const r of records.values()) {
      if (r.state !== 'ready' || pictured(r)) continue;
      const seen = onScreen.has(r);
      const inside = seen && framed(r);
      if (inside) sharpening += 1;
      if (r.picturing !== providerOf(r)) pictures.push({ r, priority: (inside ? 0 : seen ? 50 : 100) + r.z + r.dmin / 1e7 });
    }
    askMeshes(meshes);
    askPictures(pictures);
    letGo();
    let meshed = 0;
    let done = 0;
    for (const key of baseKeys) {
      const r = records.get(key);
      if (r?.state === 'ready' || r?.state === 'failed') {
        meshed += 1;
        if (r.state === 'failed' || pictured(r)) done += 1;
      }
    }
    return { drawn: drawn.map((r) => r.tile), sharpening, base: { meshed, done, total: baseKeys.size } };
  }

  function askMeshes(list) {
    if (loading >= loadingMax || !list.length) return;
    list.sort((a, b) => a.priority - b.priority);
    let part = [];
    for (const { r } of list) {
      if (loading >= loadingMax) break;
      r.state = 'loading';
      r.picturing = providerOf(r) ?? '';
      loading += 1;
      part.push({ key: r.key, z: r.z, x: r.x, y: r.y, provider: providerOf(r) });
      if (part.length === batch) {
        send(part);
        part = [];
      }
    }
    if (part.length) send(part);
  }

  function askPictures(list) {
    if (picturing >= picturingMax || !list.length) return;
    list.sort((a, b) => a.priority - b.priority);
    let part = [];
    for (const { r } of list) {
      if (picturing >= picturingMax) break;
      r.picturing = providerOf(r);
      picturing += 1;
      part.push({ key: r.key, z: r.z, x: r.x, y: r.y, provider: r.picturing });
      if (part.length === batch) {
        sendImages(part);
        part = [];
      }
    }
    if (part.length) sendImages(part);
  }

  function letGo() {
    const held = [...records.values()].filter((r) => r.state === 'ready');
    if (held.length <= budget) return;
    held.sort((a, b) => a.used - b.used);
    for (const r of held.slice(0, held.length - budget)) {
      if (r.used >= used - 1) break;
      release(r.tile);
      r.tile = null;
      r.state = 'idle';
      r.picture = '';
    }
  }

  return {
    land,
    frame: frameFor,
    /**
     * A mesh a worker built, now on the GPU (null when it could not be built),
     * the imagery it was built with, and the lowest and highest ground it holds.
     */
    arrived(key, tile, provider = null, range = null) {
      const r = records.get(key);
      loading = Math.max(0, loading - 1);
      if (!r || r.state !== 'loading') {
        if (tile) release(tile);
        return;
      }
      r.state = tile ? 'ready' : 'failed';
      r.tile = tile;
      r.picture = provider ?? '';
      r.picturing = '';
      if (range) {
        r.low = range.low;
        r.high = range.high;
      }
    },
    /** A picture a worker read for a held tile (null when there is none there). */
    imaged(key, provider, image) {
      const r = records.get(key);
      picturing = Math.max(0, picturing - 1);
      if (r?.picturing === provider) r.picturing = '';
      if (!r || r.state !== 'ready' || provider !== providerOf(r)) {
        image?.close?.();
        return;
      }
      attach(r.tile, image);
      r.picture = provider;
    },
    /** The imagery the ground is drawn in: `{ provider, near: { provider, reach } | null }`, or null for none. */
    setImagery(next) {
      wanted = next;
    },
    /**
     * The eye's turn as the app marched it (lib/horizon/panorama.js), which
     * says what nearer ground hides; taken only when it was marched from where
     * this tree stands.
     */
    setOccluder(panorama) {
      const from = panorama?.observer;
      const here = from && Math.abs(from.lat - lat) < 1e-6 && Math.abs(from.lon - lon) < 1e-6;
      occluder = here && panorama.depth && panorama.azimuth?.full !== false ? panorama : null;
    },
    /**
     * What came back empty asked again, after the app refused or was not
     * reached: meshes that failed, pictures a tile holds none of (`tile.texture`).
     */
    retry() {
      for (const r of records.values()) {
        if (r.state === 'ready' && r.tile && !r.tile.texture) r.picture = '';
        if (r.state === 'failed') r.state = 'idle';
      }
    },
    /** Everything let go, for a new eye. */
    dispose() {
      for (const r of records.values()) if (r.tile) release(r.tile);
      records.clear();
    },
    get held() {
      let n = 0;
      for (const r of records.values()) if (r.state === 'ready') n += 1;
      return n;
    },
  };
}
