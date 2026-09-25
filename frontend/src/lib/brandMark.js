/**
 * The Azimut lockup drawn on a canvas, for exports that sign their pictures.
 *
 * The same two flanks as `components/Logo.svelte` and the same seven letter paths
 * as `components/Wordmark.svelte`, laid out as the app's top-left corner shows
 * them: the mark 27 px high, 11 px of air, then AZIMUT 13 px high.
 * `components/brandAssets.test.js` holds them together.
 */

export const MARK = Object.freeze({
  west: 'M12 1.8 5.8 21.4 12 16.4Z',
  east: 'M12 1.8 18.2 21.4 12 16.4Z',
});

/** Each letter's path and its shift along the line, in wordmark units. */
export const LETTERS = Object.freeze([
  { d: 'M0 100 25 0h13.3l25 100', dx: 0 },
  { d: 'M13 69h37.3', dx: 0 },
  { d: 'M0 7.5h58L0 92.5h58', dx: 96.3 },
  { d: 'M0 0v100', dx: 193.3 },
  { d: 'M0 100V0l38 58 38-58v100', dx: 232.3 },
  { d: 'M0 0v69a31 31 0 0 0 62 0V0', dx: 347.3 },
  { d: 'M0 7.5h58M29 7.5V100', dx: 430.3 },
]);

/** The wordmark's box, stroke included: `viewBox="-7.5 -7.5 503.3 115"`. */
const WORD_BOX = { x: -7.5, y: -7.5, width: 503.3, height: 115 };
/** The app's corner, in CSS px: mark, gap, wordmark. */
const MARK_SIZE = 27;
const GAP = 11;
const WORD_HEIGHT = 13;

export const INK_ON_DARK = '#e3e3e3';
export const AMBER = '#e8a33d';

/** How wide the lockup is when drawn `height` px high. */
export function signatureWidth(height) {
  const unit = height / MARK_SIZE;
  return (MARK_SIZE + GAP + (WORD_HEIGHT * WORD_BOX.width) / WORD_BOX.height) * unit;
}

/**
 * Draw the lockup with its right edge at `right`, centred on `middle`.
 *
 * Nothing is drawn where the canvas has no `Path2D` to trace the paths with,
 * so a signature never costs an export its picture.
 *
 * @returns {number} the width drawn, 0 when nothing was
 */
export function drawSignature(ctx, right, middle, { height, ink = INK_ON_DARK, makePath } = {}) {
  const pathOf = makePath ?? (typeof Path2D === 'function' ? (d) => new Path2D(d) : null);
  if (!pathOf || !(height > 0)) return 0;
  const unit = height / MARK_SIZE;
  const width = signatureWidth(height);
  const left = right - width;
  ctx.save();
  // The mark: a 24-unit viewBox drawn MARK_SIZE px square.
  ctx.translate(left, middle - height / 2);
  ctx.scale(height / 24, height / 24);
  ctx.fillStyle = ink;
  ctx.fill(pathOf(MARK.west));
  ctx.fillStyle = AMBER;
  ctx.fill(pathOf(MARK.east));
  ctx.restore();

  ctx.save();
  const wordScale = (WORD_HEIGHT * unit) / WORD_BOX.height;
  ctx.translate(left + (MARK_SIZE + GAP) * unit - WORD_BOX.x * wordScale, middle - (WORD_HEIGHT * unit) / 2 - WORD_BOX.y * wordScale);
  ctx.scale(wordScale, wordScale);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 15;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  for (const letter of LETTERS) {
    ctx.save();
    ctx.translate(letter.dx, 0);
    ctx.stroke(pathOf(letter.d));
    ctx.restore();
  }
  ctx.restore();
  return width;
}
