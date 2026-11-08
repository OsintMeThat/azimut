/**
 * The Azimut mark a proof can carry beside its signature: the north arrow, with the
 * name after it unless asked otherwise, in a corner of the page.
 *
 * Off unless asked. A proof saved before it existed has no `azimutMark` and draws
 * as it always did. It is part of the look, so a template carries it and a new
 * slide keeps it, like the logo and the handle.
 *
 * It takes its corner and steps inward past whatever already sits there (the logo,
 * the handle), so turning it on never covers the analyst's own signature. In a
 * bottom corner it rides on the footer's last line, or just above the band when
 * the footer's words run along that same side. Its ink answers to what it sits on:
 * the page's colour, or the light one with a dark halo over a picture.
 */
import { INK_ON_DARK, drawSignature, signatureWidth } from './brandMark.js';
import {
  BG, FOOTER_SIZE, SIG_MARGIN, footerBand, isLightColor, layoutPanels, normalizeAzimutMark,
} from './composer.js';

export { MARK_SIZE, newAzimutMark, normalizeAzimutMark } from './composer.js';
/** The ink a pale page takes, the app's own on its light theme. */
export const INK_ON_LIGHT = '#23262b';

/** The ink for a page of this colour, and the halo that keeps it readable over a picture. */
export function markInk(bg) {
  return isLightColor(bg)
    ? { ink: INK_ON_LIGHT, halo: 'rgba(255, 255, 255, 0.55)' }
    : { ink: INK_ON_DARK, halo: 'rgba(0, 0, 0, 0.45)' };
}

/** How wide the mark is at its size, with or without its name. */
export function markWidth(mark) {
  return signatureWidth(mark.size, { tight: true, name: mark.name });
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Where the mark lands on a page `width` × `height`: `{ x, y, w, h }`.
 *
 * - `avoid`: the boxes already drawn there (the logo, the handle). The mark steps
 *   inward past each it would cover.
 * - `footer`: `{ lines, size, pad, align }` when the page prints a footer. A bottom
 *   corner sits on its last line, or above the band when the words run on its side.
 */
export function markBox(mark, width, height, { avoid = [], footer = null } = {}) {
  const w = markWidth(mark);
  const h = mark.size;
  const right = mark.anchor.endsWith('r');
  const bottom = mark.anchor.startsWith('b');
  const gap = Math.max(8, Math.round(h * 0.4));
  let x = right ? width - SIG_MARGIN - w : SIG_MARGIN;
  let y = bottom ? height - SIG_MARGIN - h : SIG_MARGIN;
  if (bottom && footer?.lines > 0) {
    const band = footerBand(footer.size, footer.lines);
    const line = footerBand(footer.size);
    const sameSide = (footer.align === 'right') === right;
    y = sameSide
      ? height - footer.pad - band - gap - h
      : height - footer.pad - line / 2 - h / 2;
  }
  const box = { x, y, w, h };
  // Step past what is there, nearest first, until nothing is covered.
  const taken = avoid.filter(Boolean);
  for (let step = 0; step <= taken.length; step++) {
    const hit = taken.find((other) => overlaps(box, other));
    if (!hit) break;
    box.x = right ? hit.x - gap - w : hit.x + hit.w + gap;
  }
  box.x = Math.max(0, Math.min(width - w, box.x));
  box.y = Math.max(0, Math.min(height - h, box.y));
  return box;
}

/** Draw the mark into its box on a 2D canvas context. */
export function drawMark(ctx, mark, box, bg, { makePath } = {}) {
  const { ink, halo } = markInk(bg);
  return drawSignature(ctx, box.x + box.w, box.y + box.h / 2, {
    height: mark.size, ink, halo, tight: true, name: mark.name, makePath,
  });
}

/**
 * The mark as a Konva shape, for the composer and the template preview alike: it
 * draws through the same canvas code an export runs, and never takes a press.
 */
export function markNode(Konva, mark, box, bg) {
  return new Konva.Shape({
    id: 'azimut-mark',
    x: 0,
    y: 0,
    width: box.x + box.w,
    height: box.y + box.h,
    listening: false,
    sceneFunc: (context) => { drawMark(context._context, mark, box, bg); },
  });
}

/**
 * Lay the proof's mark on its page, last, beside the logo (`#sig-logo`) and the
 * handle (`#sig-text`) already drawn there. `footerLines` is how many lines the
 * footer prints. Nothing is added when the proof carries no mark.
 */
export function addMark(Konva, layer, proof, { width, height, pad, footerLines = 0 }) {
  const mark = normalizeAzimutMark(proof?.azimutMark);
  if (!mark) return null;
  const avoid = ['#sig-logo', '#sig-text']
    .map((id) => layer.findOne(id))
    .filter(Boolean)
    .map((node) => ({ x: node.x(), y: node.y(), w: node.width(), h: node.height() }));
  const footer = footerLines > 0
    ? { lines: footerLines, size: proof.footerSize ?? FOOTER_SIZE, pad, align: proof.footerAlign }
    : null;
  const box = markBox(mark, width, height, { avoid, footer });
  const node = markNode(Konva, mark, box, markGround(proof, box));
  layer.add(node);
  return node;
}

/** What the mark's ink has to read on: the page, or a dark ground when it lies over a picture. */
export function markGround(proof, box) {
  const panels = layoutPanels(proof.panels ?? [], proof.captionSize, proof.layout, proof.space);
  return panels.some((panel) => overlaps(box, panel)) ? BG : (proof.bg ?? BG);
}
