// The shape of a lit moon, shared by everything that draws one: the compass
// rosette (inside an SVG), the phase glyph in a table, the map's own readout.
// Geometry lives here once; each caller renders it in its own context.

/**
 * Path of the lit part of a disc of `radius`, with the lit side towards +x.
 *
 * The terminator is a half-ellipse whose width follows the phase angle: as wide
 * as the disc at new and full moon, flat at a quarter. It bulges away from the
 * lit side when the moon is gibbous and is carved into it when it is a crescent,
 * which is the whole difference between the two.
 *
 * At new moon the two arcs retrace each other, so the path encloses nothing and
 * the moon draws as a bare outline. That is the right answer, not a special case.
 */
export function litPath(radius, illuminated, phaseAngle) {
  const bulge = Math.abs(Math.cos((phaseAngle * Math.PI) / 180)) * radius;
  const gibbous = illuminated > 0.5 ? 1 : 0;
  return (
    `M0,${-radius} A${radius},${radius} 0 0 1 0,${radius}` +
    ` A${bulge.toFixed(2)},${radius} 0 0 ${gibbous} 0,${-radius} Z`
  );
}

/**
 * Degrees to rotate the lit shape by, clockwise, as SVG counts rotations.
 *
 * With a bright-limb angle the lit side ends up where it really is in the sky:
 * that angle turns anticlockwise from the vertical, the opposite way to an SVG
 * rotation, hence the sign. Without one the lit side falls to the right for a
 * waxing moon — the convention almanac tables use, and a northern one, which is
 * why a view of the actual sky passes the real angle instead.
 */
export function glyphRotation(waxing, limb = null) {
  if (limb === null || limb === undefined) return waxing ? 0 : 180;
  return -(limb + 90);
}
