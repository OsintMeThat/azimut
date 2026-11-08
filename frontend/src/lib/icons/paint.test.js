import { describe, expect, it, vi } from 'vitest';
import { Build, finish } from './build.js';
import { HALO, drawModel, frameOf, inksOf, modelSvg, paintOps, rgbOf } from './paint.js';
import { solved } from './solve.js';

const car = finish('model-paint-test', new Build()
  .box(0, 0, 2, 4.6, 0.3, 0.9)
  .box(0, -0.2, 1.7, 2.6, 0.9, 1.4, { tx: 0.15, tf: 0.6, side: 'glass', top: 'light' })
  .cyl(0, 3, 0.8, 1.6, 1.61, { alpha: 0.2 }));

describe('inks', () => {
  it('derives every ink from the one colour, and keeps glass its own', () => {
    const inks = inksOf('#0072b2');
    expect(inks.body).toEqual([0, 114, 178]);
    expect(inks.light[2]).toBeGreaterThan(inks.body[2]);
    expect(inks.metal[2]).toBeLessThan(inks.body[2]);
    expect(inks.dark[2]).toBeLessThan(inks.metal[2]);
    expect(inksOf('#ff5252').glass).toEqual(inks.glass);
  });

  it('reads a colour it cannot parse as the default red', () => {
    expect(rgbOf('teal')).toEqual([255, 82, 82]);
  });
});

describe('paint operations', () => {
  it('lays the halo under the model and leaves a see-through solid sheer', () => {
    const { ops } = paintOps(car, { tilt: 55, heading: 130, halo: 1, ppm: 10 });
    expect(ops[0].fill).toBe(HALO);
    expect(ops[0].width).toBeCloseTo(0.2);
    expect(ops.some((op) => op.alpha === 0.2)).toBe(true);
  });

  it('cuts the glass out of a badge silhouette in the disc colour', () => {
    const { ops } = paintOps(car, { tilt: 55, mode: 'ink', disc: '#009e73', paper: '#ffffff', ppm: 10 });
    expect(ops.some((op) => op.fill === '#009e73')).toBe(true);
    expect(ops.some((op) => op.fill === '#ffffff')).toBe(true);
    expect(ops.some((op) => op.alpha != null && op.alpha < 1)).toBe(false);
  });

  it('shades a preview from the theme colour alone', () => {
    const { ops } = paintOps(car, { tilt: 55, mode: 'mono', ppm: 10 });
    expect(ops.every((op) => !op.fill || op.fill.includes('currentColor'))).toBe(true);
  });

  it('casts a shadow only when a sun is given', () => {
    expect(paintOps(car, { ppm: 10 }).ops.some((op) => op.alpha === 0.42)).toBe(false);
    expect(paintOps(car, { ppm: 10, sun: [0.46, -0.34] }).ops[0].alpha).toBe(0.42);
  });
});

describe('fitting', () => {
  it('makes the model\'s length the side of a stamp, so a turn never resizes it', () => {
    const a = frameOf(car, solved(car, 0, 0), 56, 'length');
    const b = frameOf(car, solved(car, 70, 55), 56, 'length');
    expect(a.ppm).toBeCloseTo(56 / car.len);
    expect(b.ppm).toBeCloseTo(a.ppm);
  });

  it('fills the box with the drawing when fitted to it', () => {
    const frame = frameOf(car, solved(car, 0, 0), 40, 'bbox', 1);
    expect(frame.side).toBeCloseTo(car.len, 1);
  });
});

describe('drawings', () => {
  it('writes an SVG with its name, or hidden without one', () => {
    expect(modelSvg(car, { px: 40, label: 'Car' })).toMatch(/^<svg width="40" height="40" viewBox="[^"]+" role="img" aria-label="Car"/);
    expect(modelSvg(car, { px: 40 })).toContain('aria-hidden="true"');
    expect(modelSvg(car, { px: 40, mode: 'mono' })).toContain('style="fill:');
  });

  it('draws into a canvas context, its middle on the origin', () => {
    const calls = [];
    const ctx = new Proxy({}, {
      get: (target, key) => (key in target ? target[key] : (...args) => calls.push([key, ...args])),
      set: (target, key, value) => { target[key] = value; return true; },
    });
    const frame = drawModel(ctx, car, { px: 56, colour: '#d55e00', heading: 30, tilt: 55, halo: 1, line: 0.5 });
    expect(frame.ppm).toBeCloseTo(56 / car.len);
    expect(calls.filter(([k]) => k === 'fill').length).toBeGreaterThan(5);
    expect(calls[0][0]).toBe('save');
    expect(calls.at(-1)[0]).toBe('restore');
    expect(vi.isMockFunction(ctx.fill)).toBe(false);
  });
});
