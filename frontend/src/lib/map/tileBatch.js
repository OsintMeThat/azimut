/**
 * A tilted map's tiles, asked of the app many at a time (the 3D map, SPEC v3).
 *
 * Every tile of the live map comes through the app, over the six connections a
 * browser keeps to one host. Tilted toward the horizon, a view asks for a
 * hundred tiles at once and each one used to wait for a free connection before
 * the app even heard of it. So with relief on, the tiles the engine asks for in
 * one go are sent as one request per source (api/tile_batch.py), at most
 * `BATCH_IN_FLIGHT` at a time so the app's other calls keep a connection. The
 * app fetches them side by side and writes each one as it is done, and each is
 * handed to the engine as it arrives: a slow tile holds up none of the others.
 *
 * A flat map asks one tile at a time, exactly as it always has: the same
 * address, the same browser cache.
 *
 * The engine reaches the tiles through a protocol of ours (`BATCH_PROTOCOL`),
 * whose addresses name the map, so the handler can tell a tilted map from a
 * flat one, and the source: a provider's imagery or the relief.
 */

export const BATCH_PROTOCOL = 'azimut-tiles';
/** Tiles one request carries (api/tile_batch.py allows 64). */
export const BATCH_MAX = 32;
/** Requests in flight at once, of the browser's six connections to the app. */
export const BATCH_IN_FLIGHT = 4;
/** ms a request waits for the rest of the engine's asks before it goes. */
export const BATCH_WAIT = 4;
/** Bytes of a frame's head: index (u16), status (u16), length (u32). */
const HEAD = 8;

/** The address an imagery source asks for its tiles at, on one map. */
export function batchedTemplate(mapId, providerId) {
  return `${BATCH_PROTOCOL}://${mapId}/imagery/${providerId}/{z}/{x}/{y}`;
}

/** …and the relief's. */
export function batchedTerrainTemplate(mapId) {
  return `${BATCH_PROTOCOL}://${mapId}/terrain/{z}/{x}/{y}`;
}

const READ = new RegExp(`^${BATCH_PROTOCOL}://([^/]+)/(?:imagery/([^/]+)|terrain)/(\\d+)/(\\d+)/(\\d+)$`);

/** One of those addresses read back, or null for anything that is not one. */
export function readBatched(url) {
  const found = READ.exec(url ?? '');
  if (!found) return null;
  const [, mapId, providerId, z, x, y] = found;
  return {
    mapId,
    kind: providerId ? 'imagery' : 'terrain',
    providerId: providerId ?? null,
    z: Number(z),
    x: Number(x),
    y: Number(y),
  };
}

/** Where one such tile is asked for on its own: the address it always had. */
export function singleUrl({ kind, providerId, z, x, y }) {
  return kind === 'terrain' ? `/api/terrain/tiles/${z}/${x}/${y}` : `/api/tiles/${providerId}/${z}/${x}/${y}`;
}

/** Where a batch of one source's tiles is asked for. */
export function batchPath({ kind, providerId }) {
  return kind === 'terrain' ? '/api/terrain/batch' : `/api/tiles/batch/${providerId}`;
}

function abortError() {
  const error = new Error('The tile is no longer wanted');
  error.name = 'AbortError';
  return error;
}

/**
 * Read a batch answer as it arrives, handing over each tile as soon as all of
 * it is in.
 *
 * @param {ReadableStream<Uint8Array>} body
 * @param {(index: number, status: number, data: ArrayBuffer) => void} onTile
 */
export async function readFrames(body, onTile) {
  const reader = body.getReader();
  let held = new Uint8Array(0);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const joined = new Uint8Array(held.length + value.length);
    joined.set(held);
    joined.set(value, held.length);
    let at = 0;
    while (joined.length - at >= HEAD) {
      const view = new DataView(joined.buffer, joined.byteOffset + at, HEAD);
      const index = view.getUint16(0, true);
      const status = view.getUint16(2, true);
      const length = view.getUint32(4, true);
      if (joined.length - at - HEAD < length) break;
      const start = at + HEAD;
      onTile(index, status, joined.slice(start, start + length).buffer);
      at = start + length;
    }
    held = joined.slice(at);
  }
}

/**
 * A failed tile as the engine's own loader hands one over, its status and body
 * with it, so the imagery panel reads every failure alike.
 */
function tileError(status, body, statusText = '') {
  const error = new Error(statusText || `tile answered ${status}`);
  error.status = status;
  error.body = body;
  return error;
}

/**
 * One tile through the app, as the engine wants it back (`{ data }`, or an
 * error carrying the status and the reason): in a batch when `batched`, at the
 * address it always had otherwise, or when the app refused the batch whole.
 *
 * @param {{ kind: string, providerId: string|null, z: number, x: number, y: number }} asked
 * @param {object} opts
 * @param {boolean} opts.batched whether the map is tilted over relief
 * @param {ReturnType<typeof createTileBatcher>} opts.batcher
 * @param {AbortSignal} [opts.signal]
 * @param {typeof fetch} [opts.fetch]
 */
export async function appTile(asked, { batched, batcher, signal, fetch: fetcher = (...args) => globalThis.fetch(...args) }) {
  if (batched) {
    try {
      const { status, data } = await batcher.get(batchPath(asked), asked.z, asked.x, asked.y, signal);
      if (status !== 200) throw tileError(status, new Blob([data], { type: 'text/plain' }));
      return { data };
    } catch (error) {
      // a request refused whole is no reason to leave a hole: ask this tile alone
      if (!error?.batch) throw error;
    }
  }
  const response = await fetcher(singleUrl(asked), { signal });
  if (!response.ok) throw tileError(response.status, await response.blob(), response.statusText);
  return { data: await response.arrayBuffer() };
}

/**
 * The requests that carry a map's tiles in batches.
 *
 * `get` answers `{ status, data }` for one tile of one source, or rejects with
 * an AbortError once its signal says the engine no longer wants it, or with an
 * error marked `batch` when the app refused the request as a whole. Asks for the
 * same source made within `wait` ms share a request; the same tile asked twice
 * before it goes is asked once.
 *
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch]
 * @param {number} [opts.max]
 * @param {number} [opts.inFlight]
 * @param {number} [opts.wait]
 */
export function createTileBatcher({
  fetch: fetcher = (...args) => globalThis.fetch(...args),
  max = BATCH_MAX,
  inFlight = BATCH_IN_FLIGHT,
  wait = BATCH_WAIT,
} = {}) {
  // path → Map(key → [asks]), not sent yet, oldest first
  const pending = new Map();
  let flying = 0;
  let timer = null;

  function settle(ask, fn, value) {
    if (ask.done) return;
    ask.done = true;
    ask.signal?.removeEventListener?.('abort', ask.onAbort);
    fn(value);
  }

  function schedule(now = false) {
    if (now) {
      clearTimeout(timer);
      timer = null;
      flush();
      return;
    }
    if (timer == null) {
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, wait);
    }
  }

  function flush() {
    while (flying < inFlight) {
      const path = [...pending.keys()][0];
      if (path == null) return;
      const asks = pending.get(path);
      const batch = new Map();
      for (const [key, list] of asks) {
        if (batch.size >= max) break;
        batch.set(key, list);
      }
      for (const key of batch.keys()) asks.delete(key);
      if (!asks.size) pending.delete(path);
      // a source with more waiting goes to the back, so one busy source cannot starve another
      else {
        pending.delete(path);
        pending.set(path, asks);
      }
      send(path, batch);
    }
  }

  async function send(path, batch) {
    const keys = [...batch.keys()];
    const lists = [...batch.values()];
    const controller = new AbortController();
    const live = () => lists.some((list) => list.some((ask) => !ask.done));
    for (const list of lists) {
      for (const ask of list) {
        ask.flying = () => {
          if (!live()) controller.abort();
        };
      }
    }
    flying += 1;
    try {
      const response = await fetcher(`${path}?t=${keys.join(',')}`, { signal: controller.signal });
      if (!response.ok || !response.body) {
        const failure = new Error(`The app answered ${response.status}`);
        failure.status = response.status;
        // the whole request refused, as opposed to one of its tiles
        failure.batch = true;
        failure.body = await response.blob?.().catch?.(() => null);
        for (const list of lists) for (const ask of list) settle(ask, ask.reject, failure);
        return;
      }
      await readFrames(response.body, (index, status, data) => {
        for (const ask of lists[index] ?? []) settle(ask, ask.resolve, { status, data });
      });
      const missing = new Error('The app left a tile out of its answer');
      for (const list of lists) for (const ask of list) settle(ask, ask.reject, missing);
    } catch (error) {
      for (const list of lists) for (const ask of list) settle(ask, ask.reject, error);
    } finally {
      flying -= 1;
      if (pending.size) schedule(true);
    }
  }

  return {
    /**
     * @param {string} path the source's batch route (`batchPath`)
     * @param {AbortSignal} [signal]
     */
    get(path, z, x, y, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(abortError());
          return;
        }
        const key = `${z}/${x}/${y}`;
        const ask = { resolve, reject, signal, done: false, flying: null };
        ask.onAbort = () => {
          settle(ask, ask.reject, abortError());
          const waiting = pending.get(path)?.get(key);
          if (waiting) {
            const left = waiting.filter((other) => other !== ask);
            if (left.length) pending.get(path).set(key, left);
            else pending.get(path).delete(key);
            if (!pending.get(path).size) pending.delete(path);
          }
          ask.flying?.();
        };
        signal?.addEventListener?.('abort', ask.onAbort);
        if (!pending.has(path)) pending.set(path, new Map());
        const asks = pending.get(path);
        asks.set(key, [...(asks.get(key) ?? []), ask]);
        schedule(asks.size >= max);
      });
    },
    /** Requests in flight right now, for a test. */
    get flying() {
      return flying;
    },
  };
}
