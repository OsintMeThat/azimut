import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  toCanvasPoint,
  visibleRect,
  within,
  zoomAround,
  ZOOM_MAX,
  ZOOM_MIN,
} from './graphViewport.js';

describe('clampZoom', () => {
  it('leaves a scale inside the range alone', () => {
    expect(clampZoom(1)).toBe(1);
  });

  it('stops at both bounds rather than letting the canvas run away', () => {
    expect(clampZoom(50)).toBe(ZOOM_MAX);
    expect(clampZoom(0.0001)).toBe(ZOOM_MIN);
  });
});

describe('toCanvasPoint', () => {
  it('undoes the group offset and the scale', () => {
    expect(toCanvasPoint({ x: 130, y: 60 }, { x: 30, y: 20, scale: 2 })).toEqual({ x: 50, y: 20 });
  });

  it('is the identity when the camera has not moved', () => {
    expect(toCanvasPoint({ x: 7, y: 9 }, { x: 0, y: 0, scale: 1 })).toEqual({ x: 7, y: 9 });
  });

  it('treats a zero scale as one, rather than dividing by it', () => {
    expect(toCanvasPoint({ x: 4, y: 4 }, { x: 0, y: 0, scale: 0 })).toEqual({ x: 4, y: 4 });
  });
});

describe('zoomAround', () => {
  it('leaves the anchor pointing at the same canvas point', () => {
    const camera = { x: 40, y: -15, scale: 0.8 };
    const anchor = { x: 220, y: 130 };
    const before = toCanvasPoint(anchor, camera);
    const after = zoomAround(1.12, anchor, camera);
    expect(toCanvasPoint(anchor, after).x).toBeCloseTo(before.x, 9);
    expect(toCanvasPoint(anchor, after).y).toBeCloseTo(before.y, 9);
  });

  it('holds the anchor zooming out as well as in', () => {
    const camera = { x: -300, y: 220, scale: 2.1 };
    const anchor = { x: 15, y: 480 };
    const before = toCanvasPoint(anchor, camera);
    const after = zoomAround(1 / 1.12, anchor, camera);
    expect(toCanvasPoint(anchor, after).x).toBeCloseTo(before.x, 9);
    expect(toCanvasPoint(anchor, after).y).toBeCloseTo(before.y, 9);
  });

  it('applies the factor to the scale', () => {
    expect(zoomAround(2, { x: 0, y: 0 }, { x: 0, y: 0, scale: 1 }).scale).toBe(2);
  });

  it('says nothing when the canvas is already at the bound', () => {
    expect(zoomAround(2, { x: 0, y: 0 }, { x: 0, y: 0, scale: ZOOM_MAX })).toBeNull();
    expect(zoomAround(0.5, { x: 0, y: 0 }, { x: 0, y: 0, scale: ZOOM_MIN })).toBeNull();
  });

  it('still moves when the factor only partly fits, and stops at the bound', () => {
    const near = ZOOM_MAX / 1.05;
    const moved = zoomAround(1.5, { x: 100, y: 100 }, { x: 0, y: 0, scale: near });
    expect(moved.scale).toBe(ZOOM_MAX);
  });
});

describe('visibleRect', () => {
  it('states the window in canvas units', () => {
    const rect = visibleRect({ x: 0, y: 0, scale: 1 }, 800, 600);
    expect(rect.left).toBeCloseTo(0);
    expect(rect.top).toBeCloseTo(0);
    expect(rect.right).toBe(800);
    expect(rect.bottom).toBe(600);
  });

  it('shrinks with the zoom, because a zoomed-in window sees less of the case', () => {
    const rect = visibleRect({ x: 0, y: 0, scale: 2 }, 800, 600);
    expect(rect.right).toBe(400);
    expect(rect.bottom).toBe(300);
  });

  it('follows a pan', () => {
    const rect = visibleRect({ x: -200, y: -100, scale: 1 }, 800, 600);
    expect(rect.left).toBe(200);
    expect(rect.top).toBe(100);
  });

  it('grows by the margin on every side', () => {
    const rect = visibleRect({ x: 0, y: 0, scale: 1 }, 800, 600, 50);
    expect(rect).toEqual({ left: -50, top: -50, right: 850, bottom: 650 });
  });
});

describe('within', () => {
  const rect = visibleRect({ x: 0, y: 0, scale: 1 }, 800, 600, 20);

  it('keeps a node in the window', () => {
    expect(within(rect, 400, 300)).toBe(true);
  });

  it('keeps a node just off screen, so a pan reveals a card and not a dot', () => {
    expect(within(rect, 810, 300)).toBe(true);
  });

  it('drops a node past the margin', () => {
    expect(within(rect, 900, 300)).toBe(false);
    expect(within(rect, 400, -100)).toBe(false);
  });
});
