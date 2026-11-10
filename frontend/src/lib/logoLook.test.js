import { describe, expect, it } from 'vitest';
import {
  LONGEST, PLAIN, SHORTEST, drawLogo, isPlain, logoLayout, normaliseLook, outputScale, renderLogo,
} from './logoLook.js';

/** A 2D context that writes down what it is asked to do. */
function recorder() {
  const calls = [];
  const state = {};
  const ctx = new Proxy(state, {
    get(target, key) {
      if (key === 'calls') return calls;
      if (key in target) return target[key];
      return (...args) => calls.push([key, ...args]);
    },
    set(target, key, value) {
      target[key] = value;
      calls.push([`=${String(key)}`, value]);
      return true;
    },
  });
  return ctx;
}

const names = (ctx) => ctx.calls.map(([name]) => name);
const picture = (width, height) => ({ naturalWidth: width, naturalHeight: height });

describe('a look within bounds', () => {
  it('fills what is missing from the plain look', () => {
    expect(normaliseLook(undefined)).toEqual({ ...PLAIN });
    expect(normaliseLook({ shape: 'circle' })).toEqual({ ...PLAIN, shape: 'circle' });
  });

  it('holds every number to the bounds the server checks', () => {
    const look = normaliseLook({ radius: 2, border: -1, padding: 1, zoom: 99, x: -5, y: 'a' });
    expect(look).toMatchObject({ radius: 0.5, border: 0, padding: 0.25, zoom: 4, x: -1, y: 0 });
  });

  it('reads colours as lowercase codes and drops what is no colour', () => {
    const look = normaliseLook({ shape: 'star', colour: '#E8A33D', fill: 'red' });
    expect(look).toMatchObject({ shape: 'rectangle', colour: '#e8a33d', fill: '' });
  });
});

describe('a plain look', () => {
  it('is the picture as picked', () => {
    expect(isPlain(null)).toBe(true);
    expect(isPlain(PLAIN)).toBe(true);
  });

  it('ignores a corner radius or a frame colour that draws nothing', () => {
    expect(isPlain({ radius: 0.4, colour: '#000000' })).toBe(true);
  });

  it.each([
    ['a rounded shape', { shape: 'rounded' }],
    ['a circle', { shape: 'circle' }],
    ['a frame', { border: 0.02 }],
    ['a background', { fill: '#ffffff' }],
    ['a margin', { padding: 0.05 }],
    ['a zoom', { zoom: 1.2 }],
    ['a move', { y: 0.1 }],
  ])('is no longer plain with %s', (_, change) => {
    expect(isPlain({ ...PLAIN, ...change })).toBe(false);
  });
});

describe('where the parts of a framed logo sit', () => {
  it('leaves a plain picture exactly where it was', () => {
    const layout = logoLayout(300, 120, PLAIN);
    expect(layout).toMatchObject({ width: 300, height: 120, border: 0, radius: 0 });
    expect(layout.picture).toEqual({ x: 0, y: 0, w: 300, h: 120 });
  });

  it('cuts a circle as wide as the picture, the picture whole in its middle', () => {
    const layout = logoLayout(400, 100, { shape: 'circle' });
    expect(layout).toMatchObject({ width: 400, height: 400, radius: 200 });
    expect(layout.picture).toEqual({ x: 0, y: 150, w: 400, h: 100 });
  });

  it('counts the frame and the margin in shares of the logo short side', () => {
    const layout = logoLayout(200, 100, { border: 0.1, padding: 0.1 });
    expect(layout.height).toBeCloseTo(100 / 0.6);
    expect(layout.width).toBeCloseTo(200 + layout.height - 100);
    expect(layout.border).toBeCloseTo(layout.height * 0.1);
    expect(layout.content.x).toBeCloseTo(layout.height * 0.2);
    expect(layout.picture.w).toBe(200);
  });

  it('rounds the corners in shares of the short side', () => {
    expect(logoLayout(200, 100, { shape: 'rounded', radius: 0.25 }).radius).toBe(25);
  });

  it('zooms the picture about its box and moves it in shares of that box', () => {
    const { picture: p } = logoLayout(100, 100, { zoom: 2, x: 0.25, y: -0.5 });
    expect(p).toEqual({ x: -25, y: -100, w: 200, h: 200 });
  });

  it('draws a framed logo between the shortest and the longest size', () => {
    expect(outputScale(logoLayout(64, 32, PLAIN)) * 64).toBe(SHORTEST);
    expect(outputScale(logoLayout(4000, 1000, PLAIN)) * 4000).toBe(LONGEST);
    expect(outputScale(logoLayout(800, 400, PLAIN))).toBe(1);
  });
});

describe('drawing the logo', () => {
  it('cuts the picture to the inside of the frame before drawing it', () => {
    const ctx = recorder();
    const image = picture(100, 100);
    drawLogo(ctx, image, logoLayout(100, 100, { shape: 'rounded' }), { shape: 'rounded' });
    const order = names(ctx);
    expect(order.indexOf('clip')).toBeLessThan(order.indexOf('drawImage'));
    expect(order).toContain('arcTo');
    expect(order).not.toContain('stroke');
    expect(order).not.toContain('fillRect');
  });

  it('paints the background under the picture and the frame over its edge', () => {
    const look = { shape: 'circle', border: 0.05, colour: '#e8a33d', fill: '#ffffff' };
    const ctx = recorder();
    drawLogo(ctx, picture(100, 100), logoLayout(100, 100, look), look);
    const order = names(ctx);
    expect(order).toContain('arc');
    expect(order.indexOf('fillRect')).toBeLessThan(order.indexOf('drawImage'));
    expect(order.indexOf('drawImage')).toBeLessThan(order.indexOf('stroke'));
    expect(ctx.calls).toContainEqual(['=strokeStyle', '#e8a33d']);
    expect(ctx.calls).toContainEqual(['=fillStyle', '#ffffff']);
  });

  it('strokes the frame along the middle of its width', () => {
    const look = { border: 0.1 };
    const layout = logoLayout(100, 100, look);
    const ctx = recorder();
    drawLogo(ctx, picture(100, 100), layout, look);
    const moves = ctx.calls.filter(([name]) => name === 'moveTo');
    expect(moves[0][1]).toBeCloseTo(layout.border);
    expect(moves[1][1]).toBeCloseTo(layout.border / 2);
    expect(ctx.calls).toContainEqual(['=lineWidth', layout.border]);
  });
});

describe('the framed logo as a PNG', () => {
  function canvases(sizeOf) {
    const made = [];
    const makeCanvas = (width, height) => {
      const canvas = { width, height, getContext: () => recorder(), toBlob: (done) => done({ size: sizeOf(width, height) }) };
      made.push(canvas);
      return canvas;
    };
    return { made, makeCanvas };
  }

  it('draws it at its output size', async () => {
    const { made, makeCanvas } = canvases(() => 10);
    await renderLogo(picture(800, 400), { shape: 'circle' }, { maxBytes: 100, makeCanvas });
    expect(made.map(({ width, height }) => [width, height])).toEqual([[800, 800]]);
  });

  it('draws it smaller while it comes out too heavy', async () => {
    const { made, makeCanvas } = canvases((width) => width);
    const blob = await renderLogo(picture(1000, 1000), { border: 0.05 }, { maxBytes: 600, makeCanvas });
    expect(made.length).toBeGreaterThan(1);
    expect(blob.size).toBeLessThanOrEqual(600);
  });

  it('gives up with a reason rather than saving a logo the server would refuse', async () => {
    const { makeCanvas } = canvases(() => 10_000);
    await expect(renderLogo(picture(500, 500), { border: 0.05 }, { maxBytes: 1, makeCanvas })).rejects.toThrow(/too large/);
  });

  it('refuses a picture with no size', async () => {
    await expect(renderLogo(picture(0, 0), PLAIN, { makeCanvas: canvases(() => 1).makeCanvas })).rejects.toThrow(/no size/);
  });
});
