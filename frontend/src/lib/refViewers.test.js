import { describe, it, expect } from 'vitest';
import {
  createViewer,
  nextZ,
  restack,
  clampWindow,
  clampSize,
  clampPan,
  zoomAt,
  MIN_SCALE,
  MAX_SCALE,
  MIN_W,
  MIN_H,
} from './refViewers.js';

describe('createViewer', () => {
  it('seeds sane defaults and prefers title over filename', () => {
    const v = createViewer('a', { path: 'm/x.jpg', title: 'Shot', filename: 'x.jpg' });
    expect(v.id).toBe('a');
    expect(v.path).toBe('m/x.jpg');
    expect(v.kind).toBe('image');
    expect(v.title).toBe('Shot');
    expect(v.scale).toBe(1);
    expect(v.ox).toBe(0);
    expect(v.collapsed).toBe(false);
  });

  it('falls back to filename, then empty title', () => {
    expect(createViewer('a', { path: 'p', filename: 'x.jpg' }).title).toBe('x.jpg');
    expect(createViewer('a', { path: 'p' }).title).toBe('');
  });

  it('marks videos, defaulting anything else to image', () => {
    expect(createViewer('a', { path: 'p', kind: 'video' }).kind).toBe('video');
    expect(createViewer('a', { path: 'p', kind: 'image' }).kind).toBe('image');
    expect(createViewer('a', { path: 'p' }).kind).toBe('image');
  });

  it('honours spawn overrides', () => {
    const v = createViewer('a', { path: 'p' }, { x: 10, y: 20, z: 4 });
    expect([v.x, v.y, v.z]).toEqual([10, 20, 4]);
  });
});

describe('nextZ', () => {
  it('is one above the top-most window (1 for an empty set)', () => {
    expect(nextZ([])).toBe(1);
    expect(nextZ([{ z: 1 }, { z: 5 }, { z: 3 }])).toBe(6);
  });
});

describe('restack', () => {
  it('puts the focused window on top and re-numbers 1..n gap-free', () => {
    const vs = [
      { id: 'a', z: 2 },
      { id: 'b', z: 5 },
      { id: 'c', z: 9 },
    ];
    const z = restack(vs, 'a');
    expect(z.get('b')).toBe(1);
    expect(z.get('c')).toBe(2);
    expect(z.get('a')).toBe(3); // focused → highest
  });

  it('handles a single window', () => {
    expect(restack([{ id: 'a', z: 7 }], 'a').get('a')).toBe(1);
  });
});

describe('clampWindow', () => {
  const bounds = { w: 1000, h: 600 };
  it('keeps the window inside the bounds', () => {
    expect(clampWindow(-20, -10, 320, 260, bounds)).toEqual({ x: 0, y: 0 });
    expect(clampWindow(9999, 9999, 320, 260, bounds)).toEqual({ x: 680, y: 340 });
  });
  it('pins to 0 when the window is larger than the bounds', () => {
    expect(clampWindow(50, 50, 1200, 800, bounds)).toEqual({ x: 0, y: 0 });
  });
});

describe('clampSize', () => {
  const bounds = { w: 1000, h: 600 };
  it('enforces the minimum size', () => {
    expect(clampSize(10, 10, 0, 0, bounds)).toEqual({ w: MIN_W, h: MIN_H });
  });
  it('caps growth to what fits from (x, y)', () => {
    expect(clampSize(9999, 9999, 700, 400, bounds)).toEqual({ w: 300, h: 200 });
  });
});

describe('clampPan', () => {
  it('pins offset to 0 at fit scale', () => {
    expect(clampPan(-50, -50, 1, 300, 200)).toEqual({ ox: 0, oy: 0 });
    expect(clampPan(50, 50, 1, 300, 200)).toEqual({ ox: 0, oy: 0 });
  });
  it('allows panning up to the overflow when zoomed in', () => {
    // scale 2 over a 300px width overflows by 300px → offset ∈ [-300, 0]
    expect(clampPan(-500, 0, 2, 300, 200).ox).toBe(-300);
    expect(clampPan(100, 0, 2, 300, 200).ox).toBe(0);
    expect(clampPan(-120, -80, 2, 300, 200)).toEqual({ ox: -120, oy: -80 });
  });
});

describe('zoomAt', () => {
  const size = { w: 300, h: 200 };

  it('keeps the point under the cursor fixed while zooming in', () => {
    const view = { scale: 1, ox: 0, oy: 0 };
    const cursor = { x: 150, y: 100 }; // centre
    const r = zoomAt(view, 2, cursor, size);
    expect(r.scale).toBe(2);
    // image point under a centred cursor stays centred: c - f*(c-ox) = 150-2*150=-150
    expect(r.ox).toBe(-150);
    expect(r.oy).toBe(-100);
  });

  it('clamps to the max scale', () => {
    const r = zoomAt({ scale: MAX_SCALE, ox: 0, oy: 0 }, 2, { x: 0, y: 0 }, size);
    expect(r.scale).toBe(MAX_SCALE);
  });

  it('clamps to the min scale and re-pins the offset to 0', () => {
    const r = zoomAt({ scale: 1, ox: 0, oy: 0 }, 0.5, { x: 150, y: 100 }, size);
    expect(r.scale).toBe(MIN_SCALE);
    expect(r).toMatchObject({ ox: 0, oy: 0 });
  });

  it('never opens a gap at the edge (offset stays clamped)', () => {
    // zoom about the top-left corner would push the image right (ox > 0) — clamp to 0
    const r = zoomAt({ scale: 1, ox: 0, oy: 0 }, 2, { x: 0, y: 0 }, size);
    expect(r.ox).toBe(0);
    expect(r.oy).toBe(0);
  });
});
