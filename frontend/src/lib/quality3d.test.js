import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { GLOBE_QUALITY, HORIZON_PIXELS, QUALITIES_3D, qualityOf } from './quality3d.js';
import { cameraFor } from './globe/camera.js';
import { SEG } from './globe/mesh.js';
import { createPictures, UPLOADS_PER_FRAME as PICTURE_UPLOADS } from './globe/pictures.js';
import { UPLOADS_PER_FRAME as DRAPE_UPLOADS } from './globe/drapes.js';
import { createRenderer } from './globe/renderer.js';
import { createTree, ROUND_SHARPNESS, SHARPNESS } from './globe/tree.js';

const SIZE = { width: 1280, height: 720 };
const LEVELS = QUALITIES_3D.map((one) => one.id);

/** The tiles a tree draws over a tilted view once every ask is answered. */
function drawnAt(sharpness, { sharp } = {}) {
  const asked = [];
  const tree = createTree({ request: (list) => asked.push(...list), release: () => {}, ...(sharpness ? { sharpness } : {}) });
  const camera = cameraFor({ lat: 46.6, lon: 7.9, zoom: 13, pitch: 60 }, SIZE);
  let out = null;
  for (let i = 0; i < 60; i += 1) {
    out = tree.frame(camera, SIZE, sharp ? { sharp } : {});
    if (!asked.length) break;
    for (const t of asked.splice(0)) {
      tree.arrived(t.key, { mesh: { key: t.key }, heights: new Float32Array((SEG + 1) ** 2).fill(100), centre: [0, 0, 0], low: 100, high: 100 });
    }
  }
  return out.drawn.length;
}

describe('how much the 3D views draw on this computer', () => {
  it('draws at Full exactly as the globe always did', () => {
    const full = GLOBE_QUALITY.full;
    expect(full.sharpness).toBe(SHARPNESS);
    expect(full.round).toBe(ROUND_SHARPNESS);
    expect(full.uploads).toBe(PICTURE_UPLOADS);
    // the drapes' own pace is kept at Full (globe.js lays them two ahead of the pictures, at most theirs)
    expect(Math.min(DRAPE_UPLOADS, full.uploads + 2)).toBe(DRAPE_UPLOADS);
    expect(full).toMatchObject({ pixelsMax: 2, antialias: true, pictureBytes: 192 * 1024 * 1024, drapeBytes: 128 * 1024 * 1024, meshes: 700 });
    expect(HORIZON_PIXELS.full).toBe(Infinity);
  });

  it('draws no more at each lighter level than at the one before', () => {
    for (let i = 1; i < LEVELS.length; i += 1) {
      const [was, now] = [GLOBE_QUALITY[LEVELS[i - 1]], GLOBE_QUALITY[LEVELS[i]]];
      expect(now.sharpness).toBeGreaterThanOrEqual(was.sharpness);
      expect(now.round).toBeGreaterThanOrEqual(was.round);
      expect(now.pixelsMax).toBeLessThanOrEqual(was.pixelsMax);
      expect(now.uploads).toBeLessThanOrEqual(was.uploads);
      expect(now.pictureBytes).toBeLessThanOrEqual(was.pictureBytes);
      expect(now.drapeBytes).toBeLessThanOrEqual(was.drapeBytes);
      expect(now.meshes).toBeLessThanOrEqual(was.meshes);
      expect(HORIZON_PIXELS[LEVELS[i]]).toBeLessThanOrEqual(HORIZON_PIXELS[LEVELS[i - 1]]);
    }
    expect(GLOBE_QUALITY.light.antialias).toBe(false);
  });

  it('says each level in a few words, and reads anything else as Full', () => {
    for (const one of QUALITIES_3D) expect(one.title.trim()).toBeTruthy();
    expect(qualityOf('light')).toBe('light');
    expect(qualityOf('ultra')).toBe('full');
    expect(qualityOf(undefined)).toBe('full');
  });

  it('lays fewer tiles of the globe at Light, and a capture as many as Full', () => {
    const full = drawnAt(GLOBE_QUALITY.full.sharpness);
    const light = drawnAt(GLOBE_QUALITY.light.sharpness);
    expect(light).toBeLessThan(full);
    // a capture asks Full's sharpness of a tree made lighter
    expect(drawnAt(GLOBE_QUALITY.light.sharpness, { sharp: GLOBE_QUALITY.full.sharpness })).toBe(full);
  });

  it('lays as few pictures a frame as the level says', async () => {
    const pending = [];
    const pictures = createPictures({
      fetch: (_provider, z, x) => new Promise((resolve) => pending.push({ x, resolve })),
      upload: () => ({ texture: {}, bytes: 1000 }),
      release: () => {},
      uploads: GLOBE_QUALITY.light.uploads,
    });
    const tile = (x) => ({ z: 8, x, y: 90 });
    pictures.setImagery({ provider: 'esri-world-imagery', metered: false, shift: 0, deepest: 19 });
    pictures.begin();
    for (let x = 0; x < 10; x += 1) pictures.pictureFor(tile(x), x);
    pictures.end();
    for (const p of pending) p.resolve({ width: 256, height: 256, close() {} });
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    pictures.begin();
    for (let x = 0; x < 10; x += 1) pictures.pictureFor(tile(x), x);
    pictures.end();
    expect(pictures.bytes).toBe(GLOBE_QUALITY.light.uploads * 1000);
  });

  it('reaches the 3D map and Horizon, never a plate', () => {
    const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
    expect(read('../tools/satellite/GlobeView.svelte')).toContain('quality: prefs.quality3d');
    expect(read('../tools/horizon/HorizonView.svelte')).toContain('Math.min(HORIZON_PIXELS[qualityOf(prefs.quality3d)]');
    expect(read('../tools/plate/PlateMap.svelte')).not.toMatch(/quality/i);
  });

  it('asks the browser for edge smoothing only when the level keeps it', () => {
    const canvas = { getContext: vi.fn(() => null) };
    createRenderer(canvas);
    createRenderer(canvas, { antialias: GLOBE_QUALITY.light.antialias });
    expect(canvas.getContext.mock.calls.map(([, options]) => options.antialias)).toEqual([true, false]);
  });
});
