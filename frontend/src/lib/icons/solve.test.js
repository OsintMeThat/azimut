import { describe, expect, it } from 'vitest';
import { Build, finish } from './build.js';
import { cachedViews, project, solve, solved, viewAxes } from './solve.js';

const hullAndBarrel = () => finish('model-hull', new Build()
  .box(0, 0, 3, 7, 0, 2)
  .tube([0, 1, 2.3], [0, 7, 2.3], 0.15, { n: 8 }));

describe('views', () => {
  it('puts the nose up at heading 0 and to the right at heading 90', () => {
    expect(project([0, 1, 0], viewAxes(0, 0))[1]).toBeCloseTo(-1);
    expect(project([0, 1, 0], viewAxes(90, 0))[0]).toBeCloseTo(1);
  });

  it('shows only what faces the viewer: the roof from above, a side at tilt 90', () => {
    const box = finish('model-box', new Build().box(0, 0, 2, 4, 0, 1));
    const top = solve(box, 0, 0).order[0].faces;
    expect(top).toHaveLength(1);
    const side = solve(box, 90, 90).order[0].faces;
    expect(side).toHaveLength(1);
    expect(side[0].poly.every(([x]) => Number.isFinite(x))).toBe(true);
  });

  it('paints a barrel lying over a hull after the hull, whatever the turn', () => {
    const model = hullAndBarrel();
    for (const heading of [0, 45, 130, 270]) {
      for (const tilt of [0, 55, 84]) {
        const order = solve(model, heading, tilt).order.map((it) => it.pr);
        expect(order.indexOf(model.prims[1])).toBeGreaterThan(order.indexOf(model.prims[0]));
      }
    }
  });

  it('keeps solved views to the degree, and no more than 256 of them', () => {
    const model = hullAndBarrel();
    expect(solved(model, 10.2, 30.4)).toBe(solved(model, 9.8, 29.6));
    expect(solved(model, 370, 0)).toBe(solved(model, 10, 0));
    for (let h = 0; h < 360; h++) solved(model, h, 45);
    expect(cachedViews()).toBeLessThanOrEqual(256);
  });
});
