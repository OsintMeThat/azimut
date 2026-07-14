import { describe, it, expect } from 'vitest';
import {
  IDENTITY, matMul, rotation, translation, apply,
  rotateAbout, matrixCss, matrixAngleDeg, isIdentity, pointerAngleDeg,
} from './frameRotate.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const pointNear = (p, x, y, eps = 1e-9) => near(p[0], x, eps) && near(p[1], y, eps);

describe('matMul', () => {
  it('is a no-op against the identity', () => {
    const m = rotation(30);
    expect(matMul(IDENTITY, m)).toEqual(m);
    expect(matMul(m, IDENTITY)).toEqual(m);
  });
  it('applies the right-hand matrix first', () => {
    // translate-then-scale vs scale-then-translate differ
    const t = translation(10, 0);
    const s = [2, 0, 0, 2, 0, 0];
    // matMul(s, t): translate first, then scale → the offset gets scaled
    expect(matMul(s, t)).toEqual([2, 0, 0, 2, 20, 0]);
    // matMul(t, s): scale first, then translate → offset unscaled
    expect(matMul(t, s)).toEqual([2, 0, 0, 2, 10, 0]);
  });
});

describe('rotation', () => {
  it('turns +x toward +y (clockwise, Y down) at 90°', () => {
    expect(pointNear(apply(rotation(90), 1, 0), 0, 1)).toBe(true);
  });
  it('is the identity at 0° and 360°', () => {
    expect(isIdentity(rotation(0))).toBe(true);
    expect(isIdentity(rotation(360))).toBe(true);
  });
});

describe('rotateAbout', () => {
  it('leaves the pivot itself fixed', () => {
    const m = rotateAbout(IDENTITY, 50, 30, 37);
    expect(pointNear(apply(m, 50, 30), 50, 30, 1e-6)).toBe(true);
  });

  it('rotates a point around the pivot, not the origin', () => {
    // pivot (10,10); the point (20,10) is 10px to its right → +90° puts it below
    const m = rotateAbout(IDENTITY, 10, 10, 90);
    expect(pointNear(apply(m, 20, 10), 10, 20, 1e-6)).toBe(true);
  });

  it('accumulates: two turns about one pivot equal their sum', () => {
    const pivotX = 12, pivotY = -7;
    const step = rotateAbout(rotateAbout(IDENTITY, pivotX, pivotY, 30), pivotX, pivotY, 60);
    const once = rotateAbout(IDENTITY, pivotX, pivotY, 90);
    step.forEach((v, i) => expect(near(v, once[i], 1e-6)).toBe(true));
  });

  it('composes on top of a prior rotation, pivoting in the output space', () => {
    // Grab a fresh pivot after the image already carries a rotation: the new
    // turn must (a) keep the grabbed point — a point in the matrix's *output*
    // space — fixed, and (b) leave the prior rotation intact (pre-multiplied).
    const base = rotation(25);
    const turned = rotateAbout(base, 40, 60, 50);
    const addedOnly = rotateAbout(IDENTITY, 40, 60, 50);
    // the grabbed pivot is a fixed point of the freshly-added rotation
    expect(pointNear(apply(addedOnly, 40, 60), 40, 60, 1e-6)).toBe(true);
    // and the accumulated matrix is exactly "added ∘ base" — base preserved
    matMul(addedOnly, base).forEach((v, i) => expect(near(v, turned[i], 1e-6)).toBe(true));
  });
});

describe('matrixAngleDeg', () => {
  it('reads back the encoded rotation', () => {
    expect(near(matrixAngleDeg(rotation(45)), 45, 1e-6)).toBe(true);
    expect(near(matrixAngleDeg(rotation(-120)), -120, 1e-6)).toBe(true);
  });
  it('is unaffected by the pivot translation', () => {
    expect(near(matrixAngleDeg(rotateAbout(IDENTITY, 99, 33, 15)), 15, 1e-6)).toBe(true);
  });
});

describe('isIdentity', () => {
  it('is true only for the (near) identity', () => {
    expect(isIdentity(IDENTITY)).toBe(true);
    expect(isIdentity(rotation(0.0000001))).toBe(true);
    expect(isIdentity(rotation(5))).toBe(false);
  });
});

describe('pointerAngleDeg', () => {
  it('measures the spoke angle in screen space (Y down)', () => {
    expect(near(pointerAngleDeg(0, 0, 1, 0), 0)).toBe(true);
    expect(near(pointerAngleDeg(0, 0, 0, 1), 90)).toBe(true);
    expect(near(Math.abs(pointerAngleDeg(0, 0, -1, 0)), 180)).toBe(true);
  });
});

describe('matrixCss', () => {
  it('serialises to a CSS matrix() string', () => {
    expect(matrixCss(IDENTITY)).toBe('matrix(1, 0, 0, 1, 0, 0)');
  });
});
