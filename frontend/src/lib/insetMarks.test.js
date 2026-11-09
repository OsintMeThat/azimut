import { describe, expect, it } from 'vitest';
import { pageToSurface, surfaceFrame, surfaceHitTest, surfaceToPage } from './composer.js';
import { INSET, goingWith, insetSurfaces, isLocked, reframedInsetMarks } from './insetMarks.js';

// A picture at half size, its top left at (100, 50) on a 1000 × 800 page.
const panel = {
  id: 'p1', kind: 'panel',
  item: { id: 'p1', natural: [800, 600] },
  box: { x: 100, y: 50, w: 400, h: 300, scale: 0.5, baseScale: 1, row: 0 },
  index: 0,
};
const frameOf = (id) => (id === 'p1' ? surfaceFrame(panel) : null);
// A frame of 100 × 50 picture pixels at (200, 100), its enlargement 300 page pixels wide,
// 400 to the right of the frame's centre.
const zoom = { id: 'z1', panel: 'p1', kind: 'zoom', color: '#ff5252', x: 200, y: 100, w: 100, h: 50, iw: 300, dx: 400, dy: 0 };

describe('a zoom inset as a surface', () => {
  it('stands where its enlargement is drawn, at the enlargement\'s zoom', () => {
    const [inset] = insetSurfaces([zoom], frameOf, 1000, 800);
    expect(inset).toMatchObject({ id: 'z1', kind: INSET, index: 0 });
    // the frame's centre is (250, 125) on the picture, (225, 112.5) on the page
    expect(inset.box).toMatchObject({ x: 225 + 400 - 150, y: 112.5 - 75, w: 300, h: 150, scale: 3 });
    const frame = surfaceFrame(inset);
    expect(surfaceToPage({ x: 0, y: 0 }, frame)).toEqual({ x: 475, y: 37.5 });
    expect(surfaceToPage({ x: 100, y: 50 }, frame)).toEqual({ x: 775, y: 187.5 });
  });

  it('is found first under the pointer, over the picture it lies on', () => {
    const list = [...insetSurfaces([zoom], frameOf, 1000, 800), panel];
    const hit = surfaceHitTest(list, { x: 490, y: 60 });
    expect(hit.id).toBe('z1');
    expect(hit.nx).toBeCloseTo(5);
    expect(hit.ny).toBeCloseTo(7.5);
    // beside the enlargement, the picture answers
    expect(surfaceHitTest(list, { x: 300, y: 200 }).id).toBe('p1');
  });

  it('turns with a turned picture', () => {
    const turned = { ...panel, item: { ...panel.item, rotation: 90 } };
    const [inset] = insetSurfaces([zoom], (id) => (id === 'p1' ? surfaceFrame(turned) : null), 1000, 800);
    const frame = surfaceFrame(inset);
    expect(frame.rotation).toBe(90);
    const back = pageToSurface(surfaceToPage({ x: 20, y: 10 }, frame), frame);
    expect(back.x).toBeCloseTo(20);
    expect(back.y).toBeCloseTo(10);
  });

  it('lists the last one drawn first, and leaves out an inset whose picture is gone', () => {
    const second = { ...zoom, id: 'z2' };
    const lost = { ...zoom, id: 'z3', panel: 'gone' };
    expect(insetSurfaces([zoom, lost, second, { id: 'r', kind: 'rect' }], frameOf, 1000, 800).map((s) => [s.id, s.index]))
      .toEqual([['z2', 1], ['z1', 0]]);
    expect(insetSurfaces(null, frameOf, 1000, 800)).toEqual([]);
  });
});

describe('the marks of an inset whose frame changes', () => {
  const box = { id: 'b', panel: 'z1', kind: 'rect', x: 10, y: 20, w: 30, h: 10 };
  const line = { id: 'l', panel: 'z1', kind: 'line', points: [0, 0, 50, 25] };
  const other = { id: 'o', panel: 'p1', kind: 'rect', x: 10, y: 20, w: 30, h: 10 };

  it('keep to the pixels they were drawn on when the frame moves or reshapes on its picture', () => {
    const from = { x: 200, y: 100, w: 100, h: 50 };
    const moved = reframedInsetMarks([box, line, other], 'z1', from, { x: 230, y: 90, w: 100, h: 50 });
    expect(moved[0]).toMatchObject({ panel: 'z1', x: -20, y: 30, w: 30, h: 10 });
    expect(moved[1].points).toEqual([-30, 10, 20, 35]);
    expect(moved[2]).toBe(other);
    // pulled from its bottom right corner, the top left stays and so do they
    const grown = reframedInsetMarks([box], 'z1', from, { x: 200, y: 100, w: 140, h: 70 });
    expect(grown[0]).toMatchObject({ x: 10, y: 20, w: 30, h: 10 });
  });

  it('keep their place in the enlargement when the frame goes onto another picture', () => {
    const scaled = reframedInsetMarks([box], 'z1', { x: 200, y: 100, w: 100, h: 50 }, { x: 40, y: 30, w: 200, h: 100 }, false);
    expect(scaled[0]).toMatchObject({ panel: 'z1', x: 20, y: 40, w: 60, h: 20 });
  });

  it('stay as they are when nothing changed', () => {
    const shapes = [box];
    const rect = { x: 200, y: 100, w: 100, h: 50 };
    expect(reframedInsetMarks(shapes, 'z1', rect, { ...rect })).toBe(shapes);
  });
});

describe('what goes with a surface', () => {
  const shapes = [
    { id: 'z1', panel: 'p1', kind: 'zoom' },
    { id: 'm1', panel: 'z1', kind: 'rect' },
    { id: 'm2', panel: 'p1', kind: 'arrow' },
    { id: 'm3', panel: 'page', kind: 'rect' },
    { id: 'z2', panel: 'p2', kind: 'zoom' },
    { id: 'm4', panel: 'z2', kind: 'rect' },
  ];

  it('takes a picture\'s marks, its insets and the marks drawn over them', () => {
    expect([...goingWith(shapes, ['p1'])].sort()).toEqual(['m1', 'm2', 'z1']);
  });

  it('takes an inset deleted with the marks drawn over it', () => {
    expect([...goingWith(shapes, ['z2', 'm3'])].sort()).toEqual(['m3', 'm4', 'z2']);
    expect([...goingWith(shapes, ['m1'])]).toEqual(['m1']);
  });
});

describe('the lock', () => {
  it('holds only what says so', () => {
    expect(isLocked({ locked: true })).toBe(true);
    expect(isLocked({ locked: false })).toBe(false);
    expect(isLocked({})).toBe(false);
    expect(isLocked(null)).toBe(false);
  });
});
