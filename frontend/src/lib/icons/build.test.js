import { describe, expect, it } from 'vitest';
import { Build, dot, finish } from './build.js';

/** Every corner of a solid on the inner side of each of its face planes. */
// a lofted quad is not quite flat, so a millimetre of slack
const convex = (prim) => prim.faces.every((f) => prim.verts.every((p) => dot(f.n, p) - f.d < 1e-3));

describe('Build', () => {
  it('turns every face normal away from the middle of its solid', () => {
    const b = new Build().box(0, 0, 2, 4, 0, 1);
    const [prim] = b.prims;
    expect(prim.faces).toHaveLength(6);
    expect(convex(prim)).toBe(true);
    const top = prim.faces.find((f) => f.n[2] > 0.99);
    expect(top.d).toBeCloseTo(1);
  });

  it('inks a box\'s sides, top and underside apart, and its front alone when asked', () => {
    const [prim] = new Build().box(0, 0, 2, 4, 0, 1, { top: 'light', front: 'glass' }).prims;
    const front = prim.faces.find((f) => f.n[1] > 0.99);
    const back = prim.faces.find((f) => f.n[1] < -0.99);
    expect(front.ink).toBe('glass');
    expect(back.ink).toBe('body');
    expect(prim.faces.find((f) => f.n[2] > 0.99).ink).toBe('light');
    expect(prim.faces.find((f) => f.n[2] < -0.99).ink).toBe('dark');
  });

  it('keeps tubes, lofts, slabs and pitched boxes convex', () => {
    const b = new Build()
      .tube([0, 0, 1], [0, 3, 1.2], 0.2, { n: 8 })
      .loft([{ y: 2, rx: 0.2, rz: 0.2, z: 1 }, { y: 0, rx: 0.6, rz: 0.6, z: 1 }, { y: -2, rx: 0.3, rz: 0.3, z: 1 }])
      .slab([[0, 0, 1], [1, 0, 1], [1, 1, 1.2], [0, 1, 1.2]], 0.05)
      .pitched([0, 0, 1], 0.4, 3, 0.4, 14);
    for (const prim of b.prims) expect(convex(prim)).toBe(true);
  });

  it('drops a face with no area rather than inventing a normal', () => {
    const b = new Build().raw([[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 1, 0]], [{ i: [0, 1, 2], ink: 'body' }, { i: [0, 1, 3], ink: 'body' }]);
    expect(b.prims[0].faces).toHaveLength(1);
  });

  it('measures a finished model by its longer side in plan', () => {
    const b = new Build().box(0, 1, 2, 6, 0, 1.5).cyl(0, 3, 0.1, 1.5, 2.5);
    const model = finish('model-test', b);
    expect(model.len).toBeCloseTo(6);
    expect(model.width).toBeCloseTo(2);
    expect(model.height).toBeCloseTo(2.5);
    expect(model.centre[1]).toBeCloseTo(1);
    expect(model.R).toBeGreaterThan(4);
  });
});
