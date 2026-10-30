// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEM_TILE } from './geo.js';

const EYE = { type: 'eye', id: 1, lat: 45.94, lon: 7.82, mode: 'ground', height: 1.7 };
const TILES = [
  { key: '8/133/90', z: 8, x: 133, y: 90, provider: null },
  { key: '8/134/90', z: 8, x: 134, y: 90, provider: null },
];

/** The app's batch answer: a little-endian u32 length a tile, then its bytes. */
function batchAnswer(url) {
  const keys = new URL(url, 'http://app').searchParams.get('t').split(',');
  const body = new DataView(new ArrayBuffer(keys.length * 5));
  keys.forEach((_, i) => {
    body.setUint32(i * 5, 1, true);
    body.setUint8(i * 5 + 4, 1);
  });
  return { ok: true, status: 200, arrayBuffer: async () => body.buffer };
}

/** The worker's module on its own, in a stand-in for the worker's globals; `fetch` is the test's to change. */
async function startWorker({ fetch = vi.fn(async (url) => batchAnswer(url)), failing = () => false } = {}) {
  vi.resetModules();
  const posted = [];
  const self = { postMessage: (message) => posted.push(message), onmessage: null };
  vi.stubGlobal('self', self);
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('createImageBitmap', async () => ({ close() {} }));
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      getContext() {
        return { drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(DEM_TILE * DEM_TILE * 4) }) };
      }
    }
  );
  vi.doMock('./build.js', async (original) => {
    const real = await original();
    return {
      ...real,
      buildMesh: (frame, terrain, t, zd) => {
        if (failing(t)) throw new Error(`no mesh for ${t.key}`);
        return real.buildMesh(frame, terrain, t, zd);
      },
    };
  });
  await import('./worker.js');
  const send = (data) => self.onmessage({ data });
  const answers = (type) => posted.filter((message) => message.type === type);
  return { send, answers, fetch };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('./build.js');
});

describe('the worker that builds the tiles', () => {
  it('builds every tile asked', async () => {
    const w = await startWorker();
    await w.send(EYE);
    expect(w.answers('eye')[0].alt).not.toBeNull();
    await w.send({ type: 'tiles', id: 1, tiles: TILES });
    expect(w.answers('tile').map((t) => [t.key, Boolean(t.failed)])).toEqual([
      ['8/133/90', false],
      ['8/134/90', false],
    ]);
  });

  it('answers every tile asked when the app can no longer be reached', async () => {
    const w = await startWorker();
    await w.send(EYE);
    w.fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    await w.send({ type: 'tiles', id: 1, tiles: TILES });
    expect(w.answers('tile').map((t) => [t.key, t.failed])).toEqual([
      ['8/133/90', true],
      ['8/134/90', true],
    ]);
  });

  it('answers every tile asked when the app refuses, and builds them once asked again', async () => {
    const w = await startWorker();
    await w.send(EYE);
    w.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ detail: 'Oops' }) });
    await w.send({ type: 'tiles', id: 1, tiles: TILES });
    expect(w.answers('tile').every((t) => t.failed)).toBe(true);
    const before = w.answers('tile').length;
    await w.send({ type: 'tiles', id: 1, tiles: TILES });
    expect(w.answers('tile').slice(before).some((t) => t.failed)).toBe(false);
  });

  it('loses only the tile it could not build, the rest of its batch comes', async () => {
    const w = await startWorker({ failing: (t) => t.key === TILES[0].key });
    await w.send(EYE);
    await w.send({ type: 'tiles', id: 1, tiles: TILES });
    expect(w.answers('tile').filter((t) => t.failed).map((t) => t.key)).toEqual([TILES[0].key]);
    expect(w.answers('tile').filter((t) => !t.failed).map((t) => t.key)).toEqual([TILES[1].key]);
    expect(w.answers('error')[0].message).toContain(TILES[0].key);
  });

  it('reads the ground again when it could not the first time, one read for the batches waiting', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch'));
    fetch.mockImplementation(async (url) => batchAnswer(url));
    const w = await startWorker({ fetch });
    await w.send(EYE);
    expect(w.answers('eye')[0].alt).toBeNull();
    await Promise.all([w.send({ type: 'tiles', id: 1, tiles: [TILES[0]] }), w.send({ type: 'tiles', id: 1, tiles: [TILES[1]] })]);
    expect(w.answers('tile')).toHaveLength(2);
    expect(w.answers('tile').some((t) => t.failed)).toBe(false);
  });

  it('says nothing of a tile for an eye the page has left', async () => {
    const w = await startWorker();
    await w.send(EYE);
    const late = w.send({ type: 'tiles', id: 1, tiles: TILES });
    await w.send({ ...EYE, id: 2 });
    await late;
    expect(w.answers('tile')).toEqual([]);
  });
});
