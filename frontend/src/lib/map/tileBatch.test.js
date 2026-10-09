import { describe, expect, it, vi } from 'vitest';
import {
  appTile,
  BATCH_PROTOCOL,
  batchedTemplate,
  batchedTerrainTemplate,
  batchPath,
  createTileBatcher,
  readBatched,
  readFrames,
  singleUrl,
} from './tileBatch.js';

/** One tile of a batch answer, as api/tile_batch.py writes it. */
function frame(index, status, text) {
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(8 + body.length);
  const view = new DataView(out.buffer);
  view.setUint16(0, index, true);
  view.setUint16(2, status, true);
  view.setUint32(4, body.length, true);
  out.set(body, 8);
  return out;
}

const text = (data) => new TextDecoder().decode(data);
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The app's batch route: each request is held until the test writes its tiles,
 * in whatever order and chunks it likes.
 */
function fakeApp() {
  const requests = [];
  const fetch = vi.fn((url, { signal } = {}) => {
    const request = { url, signal, aborted: false };
    requests.push(request);
    return new Promise((resolve, reject) => {
      signal?.addEventListener('abort', () => {
        request.aborted = true;
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
        request.controller?.error(error);
      });
      request.refuse = (status) => resolve({ ok: false, status, body: null, blob: async () => new Blob(['no']) });
      const body = new ReadableStream({ start: (controller) => (request.controller = controller) });
      request.answer = () => resolve({ ok: true, status: 200, body });
      request.write = (...chunks) => chunks.forEach((chunk) => request.controller.enqueue(chunk));
      request.end = () => request.controller.close();
    });
  });
  return { fetch, requests, keys: (request) => new URL(request.url, 'http://app').searchParams.get('t').split(',') };
}

describe('the addresses of batched tiles', () => {
  it('names the map and the source, and reads back', () => {
    expect(batchedTemplate('m2', 'esri-world-imagery')).toBe(
      `${BATCH_PROTOCOL}://m2/imagery/esri-world-imagery/{z}/{x}/{y}`
    );
    expect(batchedTerrainTemplate('m2')).toBe(`${BATCH_PROTOCOL}://m2/terrain/{z}/{x}/{y}`);
    const picture = readBatched(`${BATCH_PROTOCOL}://m2/imagery/sentinel2~TRUE~2026-05-01/14/8001/5002`);
    expect(picture).toEqual({ mapId: 'm2', kind: 'imagery', providerId: 'sentinel2~TRUE~2026-05-01', z: 14, x: 8001, y: 5002 });
    const relief = readBatched(`${BATCH_PROTOCOL}://m2/terrain/11/1068/723`);
    expect(relief).toEqual({ mapId: 'm2', kind: 'terrain', providerId: null, z: 11, x: 1068, y: 723 });
    expect(readBatched('/api/tiles/esri/1/0/0')).toBeNull();
    expect(readBatched(`${BATCH_PROTOCOL}://m2/other/1/0/0`)).toBeNull();
  });

  it('keeps the address a tile always had for asking it alone', () => {
    expect(singleUrl(readBatched(`${BATCH_PROTOCOL}://m1/imagery/esri-world-imagery/5/3/4`))).toBe(
      '/api/tiles/esri-world-imagery/5/3/4'
    );
    expect(singleUrl(readBatched(`${BATCH_PROTOCOL}://m1/terrain/5/3/4`))).toBe('/api/terrain/tiles/5/3/4');
    expect(batchPath({ kind: 'imagery', providerId: 'esri-world-imagery' })).toBe('/api/tiles/batch/esri-world-imagery');
    expect(batchPath({ kind: 'terrain' })).toBe('/api/terrain/batch');
  });
});

describe('reading a batch answer', () => {
  it('hands over each tile once all of it is in, across any chunking', async () => {
    const whole = new Uint8Array([...frame(1, 200, 'second'), ...frame(0, 404, 'none here')]);
    // cut through a head and through a body
    const chunks = [whole.slice(0, 5), whole.slice(5, 11), whole.slice(11)];
    const body = new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    });
    const tiles = [];
    await readFrames(body, (index, status, data) => tiles.push([index, status, text(data)]));
    expect(tiles).toEqual([
      [1, 200, 'second'],
      [0, 404, 'none here'],
    ]);
  });
});

describe('asking tiles many at a time', () => {
  it('sends the asks of one moment as one request per source, the same tile once', async () => {
    const app = fakeApp();
    const batcher = createTileBatcher({ fetch: app.fetch, wait: 0 });
    const a = batcher.get('/api/tiles/batch/esri', 5, 1, 1);
    const b = batcher.get('/api/tiles/batch/esri', 5, 2, 1);
    const again = batcher.get('/api/tiles/batch/esri', 5, 1, 1);
    const relief = batcher.get('/api/terrain/batch', 5, 1, 1);
    await settled();
    expect(app.requests.map((request) => request.url.split('?')[0])).toEqual([
      '/api/tiles/batch/esri',
      '/api/terrain/batch',
    ]);
    expect(app.keys(app.requests[0])).toEqual(['5/1/1', '5/2/1']);
    const [imagery, terrain] = app.requests;
    imagery.answer();
    terrain.answer();
    // each tile is handed over as it arrives, in whatever order the app finishes
    imagery.write(frame(1, 200, 'B'));
    expect(text((await b).data)).toBe('B');
    imagery.write(frame(0, 200, 'A'));
    imagery.end();
    expect(text((await a).data)).toBe('A');
    expect(text((await again).data)).toBe('A');
    terrain.write(frame(0, 200, 'dem'));
    terrain.end();
    expect(await relief).toEqual({ status: 200, data: expect.any(ArrayBuffer) });
  });

  it('carries a failed tile’s status and reason, and fails a tile the app left out', async () => {
    const app = fakeApp();
    const batcher = createTileBatcher({ fetch: app.fetch, wait: 0 });
    const gap = batcher.get('/api/tiles/batch/esri', 5, 1, 1);
    const left = batcher.get('/api/tiles/batch/esri', 5, 2, 1);
    await settled();
    app.requests[0].answer();
    app.requests[0].write(frame(0, 404, 'no imagery'));
    app.requests[0].end();
    const answer = await gap;
    expect(answer.status).toBe(404);
    expect(text(answer.data)).toBe('no imagery');
    await expect(left).rejects.toThrow(/left a tile out/);
  });

  it('says when the app refused the request as a whole, so a tile can be asked alone', async () => {
    const app = fakeApp();
    const batcher = createTileBatcher({ fetch: app.fetch, wait: 0 });
    const tile = batcher.get('/api/tiles/batch/esri', 5, 1, 1);
    await settled();
    app.requests[0].refuse(404);
    await expect(tile).rejects.toMatchObject({ status: 404, batch: true });
  });

  it('keeps to its share of the connections and its size, and sends the rest as they free up', async () => {
    const app = fakeApp();
    const batcher = createTileBatcher({ fetch: app.fetch, wait: 0, max: 2, inFlight: 1 });
    const tiles = [0, 1, 2].map((x) => batcher.get('/api/tiles/batch/esri', 5, x, 0));
    await settled();
    expect(app.requests).toHaveLength(1);
    expect(app.keys(app.requests[0])).toEqual(['5/0/0', '5/1/0']);
    expect(batcher.flying).toBe(1);
    app.requests[0].answer();
    app.requests[0].write(frame(0, 200, 'a'), frame(1, 200, 'b'));
    app.requests[0].end();
    await Promise.all(tiles.slice(0, 2));
    await settled();
    expect(app.requests).toHaveLength(2);
    expect(app.keys(app.requests[1])).toEqual(['5/2/0']);
  });

  it('drops a tile no longer wanted before it goes, and stops a request nobody waits for', async () => {
    const app = fakeApp();
    const batcher = createTileBatcher({ fetch: app.fetch, wait: 0 });
    const early = new AbortController();
    const dropped = batcher.get('/api/tiles/batch/esri', 5, 1, 1, early.signal);
    const kept = new AbortController();
    const flying = batcher.get('/api/tiles/batch/esri', 5, 2, 1, kept.signal);
    early.abort();
    await expect(dropped).rejects.toMatchObject({ name: 'AbortError' });
    await settled();
    expect(app.keys(app.requests[0])).toEqual(['5/2/1']);
    kept.abort();
    await expect(flying).rejects.toMatchObject({ name: 'AbortError' });
    expect(app.requests[0].aborted).toBe(true);
    const gone = new AbortController();
    gone.abort();
    await expect(batcher.get('/api/tiles/batch/esri', 5, 3, 1, gone.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('keeps a request going while one of its tiles is still wanted', async () => {
    const app = fakeApp();
    const batcher = createTileBatcher({ fetch: app.fetch, wait: 0 });
    const gone = new AbortController();
    const dropped = batcher.get('/api/tiles/batch/esri', 5, 1, 1, gone.signal);
    const wanted = batcher.get('/api/tiles/batch/esri', 5, 2, 1);
    await settled();
    gone.abort();
    await expect(dropped).rejects.toMatchObject({ name: 'AbortError' });
    expect(app.requests[0].aborted).toBe(false);
    app.requests[0].answer();
    app.requests[0].write(frame(0, 200, 'late'), frame(1, 200, 'ok'));
    app.requests[0].end();
    expect(text((await wanted).data)).toBe('ok');
  });
});

describe('a tile through the app', () => {
  const asked = { kind: 'imagery', providerId: 'esri-world-imagery', z: 5, x: 3, y: 4 };
  const single = (status, body) =>
    vi.fn(async () => ({
      ok: status === 200,
      status,
      statusText: '',
      blob: async () => new Blob([body]),
      arrayBuffer: async () => new TextEncoder().encode(body).buffer,
    }));

  it('asks a flat map’s tile alone, at the address it always had', async () => {
    const fetch = single(200, 'tile');
    const batcher = { get: vi.fn() };
    const { data } = await appTile(asked, { batched: false, batcher, fetch });
    expect(text(data)).toBe('tile');
    expect(fetch).toHaveBeenCalledWith('/api/tiles/esri-world-imagery/5/3/4', { signal: undefined });
    expect(batcher.get).not.toHaveBeenCalled();
  });

  it('asks a tilted map’s tile in a batch, and hands a failed one over with its status and reason', async () => {
    const reason = new TextEncoder().encode('paused').buffer;
    const batcher = { get: vi.fn(async () => ({ status: 429, data: reason })) };
    const fetch = vi.fn();
    const failure = await appTile(asked, { batched: true, batcher, fetch }).catch((error) => error);
    expect(batcher.get).toHaveBeenCalledWith('/api/tiles/batch/esri-world-imagery', 5, 3, 4, undefined);
    expect(failure.status).toBe(429);
    expect(await failure.body.text()).toBe('paused');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('asks the tile alone when the app refused the batch whole, and never after an abort', async () => {
    const refused = Object.assign(new Error('refused'), { batch: true, status: 404 });
    const fetch = single(200, 'alone');
    const { data } = await appTile(asked, { batched: true, batcher: { get: async () => Promise.reject(refused) }, fetch });
    expect(text(data)).toBe('alone');
    const aborted = Object.assign(new Error('gone'), { name: 'AbortError' });
    const none = vi.fn();
    await expect(
      appTile(asked, { batched: true, batcher: { get: async () => Promise.reject(aborted) }, fetch: none })
    ).rejects.toBe(aborted);
    expect(none).not.toHaveBeenCalled();
  });

  it('hands over a tile that failed alone with its status', async () => {
    const failure = await appTile(asked, { batched: false, batcher: null, fetch: single(502, 'down') }).catch((e) => e);
    expect(failure.status).toBe(502);
  });
});
