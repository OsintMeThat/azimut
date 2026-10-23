/**
 * The flat map's tiled sources, fetched for the globe.
 *
 * A raster overlay (roads, railways, night lights…) and a vector one (borders,
 * place names, power lines) are asked of the same servers at the same
 * addresses the flat map asks, by the tile that covers a piece of the globe:
 * the globe's tiles count zoom on 256 px tiles, a source of 512 px tiles is
 * read a level up, and past a source's last level its deepest tile is read and
 * enlarged, as the flat map overzooms it.
 *
 * What came back is kept, the least recently read let go past a count; a tile
 * that failed is asked again after a while, never in a loop.
 */
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

/** Tiles kept, the least recently read let go first. */
const KEEP = 160;
/** ms before a tile that failed is asked again. */
const RETRY_MS = 30000;

/**
 * Where one source's tiles are fetched from, read off the engine's source:
 * `{ type, tiles, minzoom, maxzoom, tileSize, scheme }`.
 */
export function describeSource(source) {
  if (!source?.tiles?.length) return null;
  return {
    type: source.type,
    tiles: [...source.tiles],
    minzoom: source.minzoom ?? 0,
    maxzoom: source.maxzoom ?? 22,
    tileSize: source.tileSize ?? 512,
    tms: source.scheme === 'tms',
  };
}

/**
 * The source's tile that covers globe tile `z/x/y`, or null where the source
 * has none (shallower than its least zoom). `up` is how many levels up it is.
 */
export function coveringTile(description, z, x, y) {
  const shift = Math.round(Math.log2(description.tileSize / 256));
  const wanted = z - shift;
  if (wanted < description.minzoom) return null;
  const level = Math.max(0, Math.min(wanted, description.maxzoom));
  const up = z - level;
  return { z: level, x: x >> up, y: y >> up, up };
}

/** One tile's address: the template picked by the tile, its place filled in. */
export function tileUrl(description, { z, x, y }) {
  const templates = description.tiles;
  const template = templates[Math.abs(x + y) % templates.length];
  const row = description.tms ? 2 ** z - 1 - y : y;
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(row));
}

/**
 * A vector tile whose features are read once. One source tile covers many of
 * the globe's finer tiles, and is painted into each and read for its names in
 * each, while the library reads a feature and its geometry afresh on every ask.
 * The geometry it hands back is shared: never changed by whoever reads it.
 */
export function readOnce(tile) {
  const layers = {};
  for (const [name, layer] of Object.entries(tile?.layers ?? {})) {
    const features = new Array(layer.length);
    layers[name] = {
      name,
      extent: layer.extent,
      length: layer.length,
      feature(i) {
        let feature = features[i];
        if (!feature) {
          const raw = layer.feature(i);
          let geometry = null;
          feature = { type: raw.type, id: raw.id, properties: raw.properties, extent: raw.extent, loadGeometry: () => (geometry ??= raw.loadGeometry()) };
          features[i] = feature;
        }
        return feature;
      },
    };
  }
  return { layers };
}

/**
 * @param {object} [o]
 * @param {(url: string, signal?: AbortSignal) => Promise<Response>} [o.fetch]
 * @param {(blob: Blob) => Promise<ImageBitmap>} [o.decodeImage]
 * @param {(buffer: ArrayBuffer) => object} [o.decodeVector]
 * @param {() => number} [o.now]
 */
export function createTileSources({
  fetch: get = (url, signal) => globalThis.fetch(url, { signal }),
  decodeImage = (blob) => createImageBitmap(blob),
  decodeVector = (buffer) => new VectorTile(new PbfReader(new Uint8Array(buffer))),
  now = () => Date.now(),
  keep = KEEP,
} = {}) {
  // url → { promise, value, failedAt, used }
  const held = new Map();
  let clock = 0;

  function letGo() {
    if (held.size <= keep) return;
    const settled = [...held.entries()].filter(([, e]) => e.value !== undefined || e.failedAt != null);
    settled.sort((a, b) => a[1].used - b[1].used);
    // not closed: a tile let go may still be in the middle of being drawn, and the collector frees it
    for (const [url] of settled.slice(0, held.size - keep)) held.delete(url);
  }

  async function load(url, kind) {
    const answer = await get(url);
    if (answer.status === 204 || answer.status === 404) return null;
    if (!answer.ok) throw new Error(`tile answered ${answer.status}`);
    if (kind === 'raster') return decodeImage(await answer.blob());
    return decodeVector(await answer.arrayBuffer());
  }

  return {
    /**
     * A source tile, decoded: a picture for a raster source, a vector tile
     * otherwise; null where the server has none or could not answer.
     */
    get(description, tile) {
      const url = tileUrl(description, tile);
      let e = held.get(url);
      if (e?.failedAt != null && now() - e.failedAt > RETRY_MS) {
        held.delete(url);
        e = null;
      }
      if (!e) {
        e = { value: undefined, failedAt: null, used: 0 };
        e.promise = load(url, description.type).then(
          (value) => {
            e.value = value;
            return value;
          },
          () => {
            e.failedAt = now();
            return null;
          }
        );
        held.set(url, e);
        letGo();
      }
      e.used = ++clock;
      return e.promise;
    },
    /** A tile already held, or undefined. */
    peek(description, tile) {
      const e = held.get(tileUrl(description, tile));
      if (!e) return undefined;
      e.used = ++clock;
      return e.value;
    },
    get size() {
      return held.size;
    },
    dispose() {
      held.clear();
    },
  };
}
