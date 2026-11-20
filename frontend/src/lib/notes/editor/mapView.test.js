import { describe, expect, it } from 'vitest';

import {
  LEAST, MOST, between, clampView, fitScale, isWhole, panBy, rulerOf, toFrame, toStage, wheelFactor, wholeView, windowOf, zoomAbout,
} from './mapView.js';

/**
 * Where a map on its card looks while Draw is open: the whole frame undistorted in the middle
 * of its stage, zoomed about the pointer, moved with it, and every press read back to the very
 * point of the map it was made over, whatever the zoom.
 */

const FRAME = [1600, 1000];
const WIDE = [900, 420];
const close = (a, b, digits = 6) => a.forEach((value, index) => expect(value).toBeCloseTo(b[index], digits));

describe('the whole map', () => {
  it('is the frame whole and undistorted in the middle of a stage of another shape', () => {
    const whole = wholeView(FRAME);
    expect(isWhole(whole, FRAME)).toBe(true);
    const scale = fitScale(FRAME, WIDE);
    expect(scale).toBeCloseTo(0.42, 9);
    // the frame's corners land in the stage's middle, as tall as the stage, a band beside each side
    close(toStage(whole, FRAME, WIDE, [0, 0]), [(900 - 1600 * 0.42) / 2, 0]);
    close(toStage(whole, FRAME, WIDE, [1600, 1000]), [(900 + 1600 * 0.42) / 2, 420]);
    close(windowOf(whole, FRAME, WIDE), [-(900 / 0.42 - 1600) / 2, 0, 900 / 0.42, 1000]);
  });

  it('fills a stage of its own shape, its window the frame itself', () => {
    close(windowOf(wholeView(FRAME), FRAME, [800, 500]), [0, 0, 1600, 1000]);
    expect(isWhole({ k: 1.01, cx: 800, cy: 500 }, FRAME)).toBe(false);
    expect(isWhole({ k: 1, cx: 820, cy: 500 }, FRAME)).toBe(false);
  });
});

describe('a press read back at any zoom', () => {
  const views = [wholeView(FRAME), { k: 3.7, cx: 412.5, cy: 733.2 }, { k: 41, cx: 1599, cy: 1 }, { k: 0.5, cx: 800, cy: 500 }];
  it.each(views)('lands on the point of the map it was made over (%o)', (view) => {
    for (const stage of [WIDE, [672, 560], [1600, 1000]]) {
      for (const point of [[0, 0], [123.4, 56.7], [stage[0], stage[1]], [stage[0] / 2, stage[1] / 3]]) {
        close(toStage(view, FRAME, stage, toFrame(view, FRAME, stage, point)), point, 6);
      }
      // the window is what the stage's corners read
      const [x, y, width, height] = windowOf(view, FRAME, stage);
      close(toFrame(view, FRAME, stage, [0, 0]), [x, y]);
      close(toFrame(view, FRAME, stage, stage), [x + width, y + height]);
    }
  });
});

describe('zooming and moving', () => {
  it('zooms about the pointer, which stays over the same point of the map', () => {
    let view = wholeView(FRAME);
    const pointer = [210, 95];
    const under = toFrame(view, FRAME, WIDE, pointer);
    for (const factor of [1.25, 1.25, 2, 0.8, 3]) {
      view = zoomAbout(view, factor, FRAME, WIDE, pointer);
      close(toFrame(view, FRAME, WIDE, pointer), under, 6);
    }
    expect(view.k).toBeCloseTo(1.25 * 1.25 * 2 * 0.8 * 3, 9);
  });

  it('zooms about the middle when no pointer is said', () => {
    const view = zoomAbout(wholeView(FRAME), 2, FRAME, WIDE);
    expect(view).toEqual({ k: 2, cx: 800, cy: 500 });
  });

  it('keeps the zoom between its least and its most, and its middle on the frame', () => {
    expect(zoomAbout(wholeView(FRAME), 0.01, FRAME, WIDE).k).toBe(LEAST);
    expect(zoomAbout(wholeView(FRAME), 1000, FRAME, WIDE).k).toBe(MOST);
    expect(zoomAbout(wholeView(FRAME), 1000, FRAME, WIDE, null, { most: 40 }).k).toBe(40);
    expect(clampView({ k: 2, cx: -50, cy: 1200 }, FRAME)).toEqual({ k: 2, cx: 0, cy: 1000 });
  });

  it('moves with a drag, the point under the pointer following it', () => {
    const view = { k: 4, cx: 800, cy: 500 };
    const from = [300, 200];
    const under = toFrame(view, FRAME, WIDE, from);
    const moved = panBy(view, -120, 45, FRAME, WIDE);
    close(toStage(moved, FRAME, WIDE, under), [from[0] - 120, from[1] + 45], 6);
  });

  it('flies its zoom at an even pace from one view to another', () => {
    const from = { k: 1, cx: 800, cy: 500 };
    const to = { k: 16, cx: 400, cy: 900 };
    expect(between(from, to, 0)).toEqual(from);
    expect(between(from, to, 1)).toEqual(to);
    expect(between(from, to, 0.5).k).toBeCloseTo(4, 9);
  });

  it('turns a wheel notch into a quarter, a trackpad step smoothly, and never a leap', () => {
    expect(wheelFactor({ deltaY: -100 })).toBeCloseTo(Math.exp(0.22), 9);
    expect(wheelFactor({ deltaY: 100 })).toBeCloseTo(Math.exp(-0.22), 9);
    expect(wheelFactor({ deltaY: -3, deltaMode: 1 })).toBeCloseTo(Math.exp(0.1056), 9);
    expect(wheelFactor({ deltaY: -4 })).toBeCloseTo(Math.exp(0.0088), 9);
    expect(wheelFactor({ deltaY: -5000 })).toBe(2);
    expect(wheelFactor({ deltaY: 1, deltaMode: 2 })).toBe(0.5);
  });
});

describe('the scale on the map', () => {
  it('is a round length at most 110 pixels long, in metres or kilometres', () => {
    expect(rulerOf(10)).toEqual({ px: 100, words: '1 km' });
    expect(rulerOf(45.5)).toEqual({ px: 110, words: '5 km' });
    expect(rulerOf(1)).toEqual({ px: 100, words: '100 m' });
    expect(rulerOf(0.3)).toEqual({ px: 67, words: '20 m' });
    expect(rulerOf(0)).toBeNull();
    expect(rulerOf(Number.NaN)).toBeNull();
  });
});
