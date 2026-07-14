/**
 * View-only rotation for the Frame viewer — a Google-Earth-style "grab & turn".
 *
 * The image's accumulated rotation is kept as a 2D affine matrix in the CSS
 * `matrix(a,b,c,d,e,f)` layout, expressed in the stage's own (transform-origin
 * 0 0) coordinate space. Each middle-drag gesture rotates the *current* matrix
 * about a fresh pivot, so any prior zoom / pan / rotate is preserved and every
 * new grab turns the image around exactly the point you clicked.
 *
 *   matrix(a,b,c,d,e,f) maps (x,y) → (a*x + c*y + e, b*x + d*y + f)
 */

export const IDENTITY = [1, 0, 0, 1, 0, 0];

const DEG = Math.PI / 180;

/** Compose two affine matrices: returns `m ∘ n` (n applied first, then m). */
export function matMul(m, n) {
  const [a1, b1, c1, d1, e1, f1] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/** CSS-convention rotation matrix (positive = clockwise, since Y points down). */
export function rotation(deg) {
  const r = deg * DEG;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return [cos, sin, -sin, cos, 0, 0];
}

/** Pure translation matrix. */
export function translation(tx, ty) {
  return [1, 0, 0, 1, tx, ty];
}

/** Map a point through a matrix. */
export function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/**
 * Rotate `base` by `deg` around the pivot (px, py): `T(p)·R(deg)·T(-p)·base`.
 * The pivot is a fixed point of the added rotation, so it stays put while the
 * already-accumulated image turns around it — and because we pre-multiply, the
 * new turn composes on top of `base` instead of replacing it.
 */
export function rotateAbout(base, px, py, deg) {
  return matMul(
    translation(px, py),
    matMul(rotation(deg), matMul(translation(-px, -py), base))
  );
}

/** `matrix(...)` string for a CSS `transform`. */
export function matrixCss(m) {
  return `matrix(${m.join(', ')})`;
}

/** Signed rotation the matrix encodes, in degrees (read from its first column). */
export function matrixAngleDeg(m) {
  return Math.atan2(m[1], m[0]) / DEG;
}

/** Is the matrix (within eps) the identity — i.e. no rotation applied? */
export function isIdentity(m, eps = 1e-6) {
  return IDENTITY.every((v, i) => Math.abs(m[i] - v) < eps);
}

/** Angle (deg) of the spoke from a pivot to a point, in screen space (Y down). */
export function pointerAngleDeg(pivotX, pivotY, x, y) {
  return Math.atan2(y - pivotY, x - pivotX) / DEG;
}
