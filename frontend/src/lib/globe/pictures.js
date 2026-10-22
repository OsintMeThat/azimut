/**
 * The pictures the globe's ground is drawn in, apart from its meshes.
 *
 * A mesh tile (tree.js) is drawn with the imagery tile of its own place at the
 * level the imagery's grid asks (a 512 px picture covers four 256 px tiles, so
 * it is read a level up), or, while that one is on its way, with the nearest
 * level above it already held, through the part of it the tile covers. A tile
 * deeper than the provider goes keeps its last picture, enlarged. So the
 * ground is never bare once its first coarse picture is in: it sharpens.
 *
 * Billed imagery stops where a flat view would, as on the tilted map
 * (`quotaGuard.js`): a tile past that reach is asked of the free provider.
 *
 * The pictures are read from the app in batches (api/tile_batch.py), decoded
 * by the browser off the page's thread, and laid on the GPU a few a frame so a
 * burst of arrivals never stalls one. Past `budget` bytes on the GPU, the
 * pictures no frame used for longest are let go.
 */
import { FREE_FAR_PROVIDER, farTile } from '../map/quotaGuard.js';

/** Pictures laid on the GPU in one frame, at most. */
export const UPLOADS_PER_FRAME = 6;
/** Pictures asked and not back yet, at most. */
const IN_FLIGHT = 48;

const keyOf = (z, x, y) => `${z}/${x}/${y}`;

/**
 * The imagery tile a mesh tile at zoom `z` is drawn with: `shift` levels up for
 * a grid of bigger pictures, never deeper than `deepest`.
 */
export function pictureTile({ z, x, y }, shift, deepest) {
  const level = Math.max(0, Math.min(z - shift, deepest));
  const up = z - level;
  return { z: level, x: Math.floor(x / 2 ** up), y: Math.floor(y / 2 ** up) };
}

/**
 * The part of picture tile `p` that mesh tile `t` covers, as the shader reads
 * it: scale then offset of its picture coordinates.
 */
export function boxWithin(t, p) {
  const up = t.z - p.z;
  const s = 1 / 2 ** up;
  return [s, s, (t.x - p.x * 2 ** up) * s, (t.y - p.y * 2 ** up) * s];
}

/**
 * @param {object} o
 * @param {(provider: string, z: number, x: number, y: number, signal: AbortSignal) => Promise<ImageBitmap|null>} o.fetch
 *   one picture; null where the provider has none
 * @param {(bitmap: ImageBitmap) => { texture: any, bytes: number }} o.upload
 * @param {(handle: { texture: any }) => void} o.release
 * @param {(provider: string) => void} [o.onMetered] a billed picture came, which the meter counts
 * @param {(provider: string, error: Error) => void} [o.onFailed] a picture of the chosen imagery was refused
 */
export function createPictures({ fetch, upload, release, onMetered = () => {}, onFailed = () => {}, budget = 192 * 1024 * 1024 }) {
  const held = new Map();
  // the last picture held for a place, whatever its provider: shown while another provider's comes
  const lastFor = new Map();
  const arrivals = [];
  let bytes = 0;
  let flying = 0;
  let frameNo = 0;
  let imagery = null;
  const asked = [];

  const entryKey = (provider, t) => `${provider}|${keyOf(t.z, t.x, t.y)}`;

  /** The provider a picture tile is asked of: the chosen one, or the free one past a billed provider's reach. */
  function providerOf(t) {
    if (!imagery) return null;
    // ground coarser than the provider can render at all comes from the free one
    if (t.z < (imagery.shallowest ?? 0)) return FREE_FAR_PROVIDER;
    if (imagery.metered && imagery.view && farTile(t, imagery.view)) return FREE_FAR_PROVIDER;
    return imagery.provider;
  }

  function ask(provider, t, priority) {
    const key = entryKey(provider, t);
    let e = held.get(key);
    if (!e) {
      e = { key, provider, ...t, state: 'idle', handle: null, used: 0, controller: null };
      held.set(key, e);
    }
    e.used = frameNo;
    if (e.state === 'idle') asked.push({ e, priority });
    return e;
  }

  /**
   * What mesh tile `t` is drawn with now: `{ handle, box }`, or null for none
   * yet. Asks for the picture it should have; `priority` orders those asks.
   */
  function pictureFor(t, priority) {
    if (!imagery) return null;
    const own = pictureTile(t, imagery.shift, imagery.deepest);
    const provider = providerOf(own);
    const e = ask(provider, own, priority);
    if (e.state === 'ready') return { handle: e.handle, box: boxWithin(t, own) };
    // the nearest level up already held, of this provider or the last one shown there
    for (let z = own.z - 1; z >= 0; z -= 1) {
      const up = { z, x: Math.floor(own.x / 2 ** (own.z - z)), y: Math.floor(own.y / 2 ** (own.z - z)) };
      const mine = held.get(entryKey(providerOf(up), up));
      const found = mine?.state === 'ready' ? mine : lastFor.get(keyOf(up.z, up.x, up.y));
      if (found?.state === 'ready' && found.handle) {
        found.used = frameNo;
        return { handle: found.handle, box: boxWithin(t, up) };
      }
    }
    const last = lastFor.get(keyOf(own.z, own.x, own.y));
    if (last?.state === 'ready' && last.handle) {
      last.used = frameNo;
      return { handle: last.handle, box: boxWithin(t, own) };
    }
    return null;
  }

  function send() {
    asked.sort((a, b) => a.priority - b.priority);
    for (const { e } of asked) {
      if (flying >= IN_FLIGHT) break;
      if (e.state !== 'idle') continue;
      e.state = 'loading';
      e.controller = new AbortController();
      flying += 1;
      const provider = e.provider;
      fetch(provider, e.z, e.x, e.y, e.controller.signal).then(
        (bitmap) => {
          flying -= 1;
          e.controller = null;
          if (e.state !== 'loading' || held.get(e.key) !== e) {
            bitmap?.close?.();
            return;
          }
          if (imagery?.metered && provider === imagery.provider) onMetered(provider);
          if (!bitmap) {
            e.state = 'none';
            return;
          }
          arrivals.push({ e, bitmap });
        },
        (error) => {
          flying -= 1;
          e.controller = null;
          if (e.state !== 'loading') return;
          // a picture nobody wants any more goes back to waiting; a refusal of the
          // chosen imagery is said, while the free ground under it keeps its coarser picture
          e.state = error?.name === 'AbortError' ? 'idle' : 'failed';
          if (e.state === 'failed' && provider === imagery?.provider) onFailed(provider, error);
        }
      );
    }
    asked.length = 0;
  }

  /** Past the budget, down to nine tenths of it, the least recently used first; the coarsest are kept. */
  function letGo() {
    if (bytes <= budget) return;
    const ready = [...held.values()].filter((e) => e.state === 'ready' && e.used < frameNo && e.z > 1);
    ready.sort((a, b) => a.used - b.used || b.z - a.z);
    const floor = budget * 0.9;
    for (const e of ready) {
      if (bytes <= floor) break;
      drop(e);
    }
  }

  function drop(e) {
    if (e.handle) {
      bytes -= e.handle.bytes;
      release(e.handle);
    }
    e.controller?.abort();
    held.delete(e.key);
    const place = keyOf(e.z, e.x, e.y);
    if (lastFor.get(place) === e) lastFor.delete(place);
  }

  return {
    pictureFor,
    /** Start a frame: what it asks is weighed against what the frame before asked. */
    begin() {
      frameNo += 1;
    },
    /**
     * End a frame: lay a few arrivals on the GPU, send the asks, drop asks no
     * frame wants any more and the pictures past the budget. True while
     * arrivals wait to be laid or one was laid, which means another frame is wanted.
     */
    end() {
      let laid = 0;
      while (arrivals.length && laid < UPLOADS_PER_FRAME) {
        const { e, bitmap } = arrivals.shift();
        if (held.get(e.key) !== e) {
          bitmap.close?.();
          continue;
        }
        e.handle = upload(bitmap);
        bitmap.close?.();
        bytes += e.handle.bytes;
        e.state = 'ready';
        lastFor.set(keyOf(e.z, e.x, e.y), e);
        laid += 1;
      }
      send();
      // pictures still on their way that the last frames no longer ask for, and
      // asks long forgotten
      for (const e of [...held.values()]) {
        if (e.state === 'loading' && e.used < frameNo - 2) e.controller?.abort();
        else if (e.state !== 'ready' && e.state !== 'loading' && e.used < frameNo - 120) held.delete(e.key);
      }
      letGo();
      // what was laid this frame is drawn by the next one, since this one picked its pictures already
      return laid > 0 || arrivals.length > 0;
    },
    /**
     * The imagery to draw: `{ provider, metered, shift, deepest, shallowest, view }`, the
     * view (`farTile`'s) saying where billed pictures stop. Null draws none.
     */
    setImagery(next) {
      imagery = next;
    },
    /** Pictures that failed are asked again. */
    retry() {
      for (const e of held.values()) if (e.state === 'failed') e.state = 'idle';
    },
    /** Pictures the last frame asked for that are not drawn yet. */
    get waiting() {
      let n = 0;
      for (const e of held.values()) if (e.used === frameNo && (e.state === 'loading' || e.state === 'idle')) n += 1;
      return n + arrivals.length;
    },
    get bytes() {
      return bytes;
    },
    dispose() {
      for (const e of [...held.values()]) drop(e);
      for (const { bitmap } of arrivals) bitmap.close?.();
      arrivals.length = 0;
    },
  };
}
