/**
 * The pictures the globe lays over its imagery, one a tile (drape.js).
 *
 * Kept like the imagery's (pictures.js), with one difference: what is laid
 * changes while the view stands still. A measure gains a point, a layer is
 * switched on, an area is edited. A change says where it falls (`invalidate`),
 * and the tiles under it are painted again; until each one's new picture is
 * in, the one it had stays drawn, so nothing flickers bare while it comes.
 * A tile with nothing on it holds no picture at all.
 */

/** Pictures laid on the GPU in one frame, at most. */
export const UPLOADS_PER_FRAME = 8;
/** Tiles being painted at once, at most. */
const IN_FLIGHT = 8;
/** Changes remembered one by one; past this they fold into one that touches everything. */
const CHANGES_KEPT = 48;

const keyOf = (z, x, y) => `${z}/${x}/${y}`;

/** A tile's bounds in degrees: `{ west, south, east, north }`. */
export function tileBounds({ z, x, y }) {
  const n = 2 ** z;
  const lat = (row) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * row) / n))) * 180) / Math.PI;
  return { west: (x / n) * 360 - 180, east: ((x + 1) / n) * 360 - 180, north: lat(y), south: lat(y + 1) };
}

/**
 * A tile's bounds and the margin round it a line just outside may paint into,
 * a twenty-fifth of its span each way: a change there repaints it too.
 */
function reach(t) {
  const b = tileBounds(t);
  const dx = (b.east - b.west) / 25;
  const dy = (b.north - b.south) / 25;
  return { west: b.west - dx, east: b.east + dx, south: b.south - dy, north: b.north + dy };
}

/** Whether two bounds share any ground. */
export function overlaps(a, b) {
  return a.west <= b.east && b.west <= a.east && a.south <= b.north && b.south <= a.north;
}

/**
 * @param {object} o
 * @param {(tile: { z: number, x: number, y: number }, signal: AbortSignal) => Promise<object|null>} o.compose
 *   a tile's picture, or null when nothing lies on it
 * @param {(picture: object) => { texture: any, bytes: number }} o.upload
 * @param {(handle: object) => void} o.release
 */
export function createDrapes({ compose, upload, release, budget = 128 * 1024 * 1024, uploads = UPLOADS_PER_FRAME }) {
  const held = new Map();
  const arrivals = [];
  const asked = [];
  let changes = [];
  let version = 0;
  let frameNo = 0;
  let bytes = 0;
  let flying = 0;
  // pictures replaced this frame, let go at the next: the frame being drawn still reads them
  let retired = [];

  function entry(t) {
    const key = keyOf(t.z, t.x, t.y);
    let e = held.get(key);
    if (!e) {
      e = { key, z: t.z, x: t.x, y: t.y, bounds: reach(t), state: 'idle', handle: null, built: -1, used: 0, controller: null };
      held.set(key, e);
    }
    return e;
  }

  /** Whether a change since the tile was painted falls on it. */
  function stale(e) {
    if (e.built < 0) return true;
    for (const change of changes) {
      if (change.version > e.built && (!change.bounds || overlaps(change.bounds, e.bounds))) return true;
    }
    return false;
  }

  function drop(e) {
    if (e.handle) {
      bytes -= e.handle.bytes;
      release(e.handle);
      e.handle = null;
    }
  }

  function send() {
    asked.sort((a, b) => a.priority - b.priority);
    for (const { e } of asked) {
      if (flying >= IN_FLIGHT) break;
      if (e.state === 'loading' || held.get(e.key) !== e || !stale(e)) continue;
      e.state = 'loading';
      e.controller = new AbortController();
      const built = version;
      flying += 1;
      compose(e, e.controller.signal).then(
        (picture) => {
          flying -= 1;
          e.controller = null;
          if (held.get(e.key) !== e || e.state !== 'loading') {
            picture?.close?.();
            return;
          }
          arrivals.push({ e, picture, built });
        },
        () => {
          flying -= 1;
          e.controller = null;
          // dropped or refused: asked again by the next frame that wants it
          if (e.state === 'loading') e.state = e.handle ? 'ready' : 'idle';
        }
      );
    }
    asked.length = 0;
  }

  function letGo() {
    if (bytes <= budget) return;
    const ready = [...held.values()].filter((e) => e.handle && e.used < frameNo);
    ready.sort((a, b) => a.used - b.used || b.z - a.z);
    for (const e of ready) {
      if (bytes <= budget * 0.9) break;
      drop(e);
      e.controller?.abort();
      held.delete(e.key);
    }
  }

  return {
    /**
     * What tile `t` is draped with now: `{ handle, box }`, the box the part of
     * the picture it reads (an ancestor's while its own is not in), or null.
     */
    drapeFor(t, priority) {
      const e = entry(t);
      e.used = frameNo;
      if (e.state !== 'loading' && stale(e)) asked.push({ e, priority });
      if (e.handle) return { handle: e.handle, box: [1, 1, 0, 0] };
      if (e.state === 'none' && !stale(e)) return null;
      for (let z = t.z - 1; z >= 0; z -= 1) {
        const up = t.z - z;
        const above = held.get(keyOf(z, t.x >> up, t.y >> up));
        if (!above) continue;
        if (above.handle) {
          above.used = frameNo;
          const s = 1 / 2 ** up;
          return { handle: above.handle, box: [s, s, (t.x - (t.x >> up) * 2 ** up) * s, (t.y - (t.y >> up) * 2 ** up) * s] };
        }
        // a painted ancestor with nothing on it says this tile has nothing either
        if (above.state === 'none' && !stale(above)) return null;
      }
      return null;
    },
    begin() {
      frameNo += 1;
      for (const handle of retired) release(handle);
      retired = [];
    },
    /** Lay a few arrivals, send the asks, let go what is past the budget. True while arrivals wait or one was laid. */
    end() {
      let laid = 0;
      while (arrivals.length && laid < uploads) {
        const { e, picture, built } = arrivals.shift();
        if (held.get(e.key) !== e) {
          picture?.close?.();
          continue;
        }
        if (e.handle) {
          bytes -= e.handle.bytes;
          retired.push(e.handle);
          e.handle = null;
        }
        if (picture) {
          e.handle = upload(picture);
          picture.close?.();
          bytes += e.handle.bytes;
          laid += 1;
        }
        e.state = picture ? 'ready' : 'none';
        e.built = built;
      }
      send();
      for (const e of held.values()) {
        if (e.state === 'loading' && e.used < frameNo - 2) e.controller?.abort();
        else if (!e.handle && e.state !== 'loading' && e.used < frameNo - 120) held.delete(e.key);
      }
      letGo();
      // what was laid this frame is drawn by the next one, since this one picked its pictures already
      return laid > 0 || arrivals.length > 0;
    },
    /**
     * Something laid on the ground changed over `bounds` (degrees), or
     * everywhere: the tiles under it are painted again.
     */
    invalidate(bounds = null) {
      version += 1;
      changes.push({ version, bounds });
      if (changes.length > CHANGES_KEPT) changes = [{ version, bounds: null }];
    },
    /** Tiles the last frame wanted that are not painted as they should be yet. */
    get waiting() {
      let n = arrivals.length;
      for (const e of held.values()) if (e.used === frameNo && (e.state === 'loading' || stale(e))) n += 1;
      return n;
    },
    get bytes() {
      return bytes;
    },
    dispose() {
      for (const e of held.values()) {
        e.controller?.abort();
        drop(e);
      }
      held.clear();
      for (const handle of retired) release(handle);
      retired = [];
      for (const { picture } of arrivals) picture?.close?.();
      arrivals.length = 0;
    },
  };
}
