/**
 * A proof's page drawn still, for the template preview and the starters' cards.
 *
 * The composer draws a page it can be edited on; this draws one to be looked at,
 * from the same measures (`docSize`, `layoutPanels`, `footerLines`, `creditLines`,
 * `legendLines`, `signatureBox`, `signaturePairPositions`) and the same Azimut mark
 * (`proofMark.addMark`), in the same order: the ground, the pictures back to front
 * with their marks and scene time, the captions, the legend, the footer, then the
 * logo, the handle and the mark. What it leaves out is what a template never
 * holds: overlays, callouts, zoom insets, free marks.
 */
import {
  BG, CAPTION_SIZE, FOOTER_SIZE, LEGEND_SIZE, SIG_TEXT_SIZE,
  docSize, footerBand, footerLines, layoutPanels, legendLineHeight, normSpace, panelsBottom,
  signatureBox, signaturePairPositions, anchoredPos, textColors,
} from './composer.js';
import { creditLines } from './creditLines.js';
import { fontStack } from './proofFonts.js';
import { surfaceImageSize } from './proofSurface.js';
import { addMark } from './proofMark.js';

/** The ink a sample mark is drawn with, in page pixels like the composer's. */
const INK = 5;
const ARROW_HEAD = 14;

/**
 * The page's size and what its footer prints, measured as the composer measures it.
 * `measure(text, size, face)` is a line's width.
 */
export function measurePage(proof, { coordFormat = 'dd', measure }) {
  const sizes = {
    captionSize: proof.captionSize ?? CAPTION_SIZE,
    legendSize: proof.legendSize ?? LEGEND_SIZE,
    footerSize: proof.footerSize ?? FOOTER_SIZE,
    footerEnabled: proof.footerEnabled !== false,
  };
  const size = (text) => docSize(
    proof.panels, proof.shapes, proof.notes, text, proof.legendOrder, proof.layout, proof.space,
  );
  // the credit line in the lines the page's width holds, the footer left out of that width
  const cut = (text) => {
    const room = size({ ...sizes, footerEnabled: false }).width - normSpace(proof.space).pad * 2;
    return creditLines(text, room, (line) => measure(line, sizes.footerSize, fontStack(proof.font)));
  };
  const printed = sizes.footerEnabled ? footerLines(proof, coordFormat, cut) : [];
  return { ...size({ ...sizes, footerLines: printed.length }), printed, sizes };
}

/** A picture not loaded yet: a quiet ground the size it will take. */
function placeholder(Konva, image) {
  return new Konva.Rect({
    width: image[0], height: image[1], listening: false,
    fillLinearGradientStartPoint: { x: 0, y: 0 },
    fillLinearGradientEndPoint: { x: image[0], y: image[1] },
    fillLinearGradientColorStops: [0, '#3b4a63', 1, '#1e2637'],
  });
}

/** A sample mark, its ink in page pixels whatever the picture's scale. */
function markOf(Konva, shape, k) {
  const stroke = INK * k;
  if (shape.kind === 'arrow') {
    return new Konva.Arrow({
      points: shape.points, stroke: shape.color, fill: shape.color, strokeWidth: stroke,
      pointerLength: ARROW_HEAD * k, pointerWidth: ARROW_HEAD * k, lineCap: 'round', listening: false,
    });
  }
  return new Konva.Ellipse({
    x: shape.x + shape.w / 2, y: shape.y + shape.h / 2, radiusX: shape.w / 2, radiusY: shape.h / 2,
    stroke: shape.color, strokeWidth: stroke, listening: false,
  });
}

/** The scene's time over a frame, as the composer prints it (`ProofComposer.sceneBadgeNode`). */
function badgeOf(Konva, text, image, scale, proof) {
  const k = 1 / scale;
  const size = Math.round((proof.captionSize ?? CAPTION_SIZE) * 1.1);
  const pad = Math.round(size * 0.45);
  const margin = Math.round(size * 0.6);
  const words = new Konva.Text({
    x: pad * k, y: pad * k, text, fontSize: size * k, fontFamily: fontStack(proof.font),
    fill: '#ffffff', wrap: 'none', ellipsis: true, listening: false,
  });
  const most = image[0] - 2 * (margin + pad) * k;
  if (words.width() > most) words.width(Math.max(0, most));
  const w = words.width() + 2 * pad * k;
  const h = words.height() + 2 * pad * k;
  const badge = new Konva.Group({ x: margin * k, y: image[1] - margin * k - h, listening: false });
  badge.add(new Konva.Rect({ width: w, height: h, cornerRadius: 4 * k, fill: 'rgba(0, 0, 0, 0.62)' }));
  badge.add(words);
  return badge;
}

/**
 * Draw `proof` on `layer`, at page scale. Returns the page's size and the logo and
 * handle nodes, so a preview can let them be dragged.
 *
 * - `logo`: the signature picture, or null to draw where it would go;
 * - `handle`: the account handle the signature prints;
 * - `badges`: panel id → the scene time printed on it.
 */
export function drawPage(Konva, layer, proof, { logo = null, handle = '', coordFormat = 'dd', badges = new Map() } = {}) {
  const probe = new Konva.Text({ text: ' ' });
  const measure = (text, fontSize, fontFamily) => {
    probe.setAttrs({ text, fontSize, fontFamily });
    return probe.width();
  };
  const { width, height, legend, cols, printed } = measurePage(proof, { coordFormat, measure });
  probe.destroy();
  const face = fontStack(proof.font);
  const { pad } = normSpace(proof.space);
  const bg = proof.bg ?? BG;
  const tc = textColors(bg);
  const capSize = proof.captionSize ?? CAPTION_SIZE;
  const boxes = layoutPanels(proof.panels, capSize, proof.layout, proof.space);

  layer.add(new Konva.Rect({ name: 'bg', x: 0, y: 0, width, height, fill: bg }));

  for (let i = proof.panels.length - 1; i >= 0; i--) {
    const panel = proof.panels[i];
    const box = boxes[i];
    const image = surfaceImageSize(panel.sourceNatural ?? panel.natural, panel.crop);
    const group = new Konva.Group({
      x: box.x + box.w / 2, y: box.y + box.h / 2, offsetX: image[0] / 2, offsetY: image[1] / 2,
      scaleX: box.scale, scaleY: box.scale, listening: false,
    });
    const clip = new Konva.Group({ clip: { x: 0, y: 0, width: image[0], height: image[1] }, listening: false });
    clip.add(panel.img
      ? new Konva.Image({
          image: panel.img, width: image[0], height: image[1], listening: false,
          ...(panel.crop ? { crop: { x: panel.crop.x, y: panel.crop.y, width: panel.crop.w, height: panel.crop.h } } : {}),
        })
      : placeholder(Konva, image));
    group.add(clip);
    if (badges.has(panel.id)) group.add(badgeOf(Konva, badges.get(panel.id), image, box.scale, proof));
    for (const shape of proof.shapes.filter((s) => s.panel === panel.id)) group.add(markOf(Konva, shape, 1 / box.scale));
    layer.add(group);
    if (panel.caption?.trim()) {
      layer.add(new Konva.Text({
        x: box.x + 2, y: box.y + box.h + 9, width: box.w - 4, text: panel.caption,
        fontSize: capSize, fontFamily: face, fill: proof.captionColor || tc.dim,
        ellipsis: true, wrap: 'none', listening: false,
      }));
    }
  }

  // the legend, in its columns, as the composer lays it
  const legendSize = proof.legendSize ?? LEGEND_SIZE;
  const lineH = legendLineHeight(legendSize);
  const r = Math.round(legendSize * 0.62);
  const legendTop = panelsBottom(proof.panels, proof.captionSize, proof.layout, proof.space) + 8;
  const colW = (width - pad * 2 - (cols - 1) * pad) / cols;
  legend.filter((line) => line.text).forEach((line, i) => {
    const cx = pad + (i % cols) * (colW + pad);
    const cy = legendTop + Math.floor(i / cols) * lineH + lineH / 2;
    layer.add(new Konva.Circle({ x: cx + r, y: cy, radius: r, fill: line.color, listening: false }));
    layer.add(new Konva.Text({
      x: cx + r * 2 + 8, y: cy - legendSize * 0.62, width: colW - (r * 2 + 8), text: line.text,
      fontSize: legendSize, fill: tc.main, fontFamily: face, ellipsis: true, wrap: 'none', listening: false,
    }));
  });

  if (proof.panels.length && printed.length) {
    const footerSize = proof.footerSize ?? FOOTER_SIZE;
    const band = footerBand(footerSize);
    printed.forEach((line, i) => {
      layer.add(new Konva.Text({
        x: pad, y: height - pad - band * (printed.length - i) + Math.round((band - footerSize) / 2),
        width: width - pad * 2, text: line, align: proof.footerAlign === 'right' ? 'right' : 'left',
        fontSize: footerSize, fill: proof.footerColor || tc.faint, fontFamily: face,
        ellipsis: true, wrap: 'none', listening: false,
      }));
    });
  }

  // the signature: the logo, the handle under it, then the Azimut mark beside them
  const st = proof.signatureText && handle?.trim() ? proof.signatureText : null;
  const handleNode = st ? new Konva.Text({
    id: 'sig-text', text: handle.trim(), fontSize: st.size ?? SIG_TEXT_SIZE, fontStyle: 'bold',
    fontFamily: face, fill: st.color ?? '#ffffff', opacity: st.opacity ?? 1,
  }) : null;
  const natural = logo ? [logo.naturalWidth || logo.width, logo.naturalHeight || logo.height] : [220, 88];
  const logoBox = proof.signature ? signatureBox(proof.signature, width, height, natural) : null;
  const pair = handleNode
    ? signaturePairPositions(proof.signature, st, width, height, logoBox, handleNode.width(), handleNode.height())
    : null;
  let logoNode = null;
  if (proof.signature) {
    const box = pair?.logo ?? logoBox;
    logoNode = new Konva.Group({ id: 'sig-logo', x: box.x, y: box.y, width: box.w, height: box.h, opacity: proof.signature.opacity ?? 1 });
    if (logo) logoNode.add(new Konva.Image({ image: logo, width: box.w, height: box.h }));
    else {
      logoNode.add(new Konva.Rect({
        width: box.w, height: box.h, cornerRadius: Math.min(box.w, box.h) * 0.12,
        stroke: tc.faint, strokeWidth: Math.max(1, box.h * 0.025), dash: [box.h * 0.08, box.h * 0.06],
      }));
      logoNode.add(new Konva.Text({
        width: box.w, height: box.h, align: 'center', verticalAlign: 'middle', text: 'Your logo',
        fontSize: box.h * 0.22, fill: tc.faint, fontFamily: face,
      }));
    }
    layer.add(logoNode);
  }
  if (handleNode) {
    handleNode.position(pair?.handle ?? anchoredPos(st, width, height, handleNode.width(), handleNode.height()));
    layer.add(handleNode);
  }
  addMark(Konva, layer, proof, { width, height, pad, footerLines: proof.panels.length ? printed.length : 0 });
  return { width, height, logo: logoNode, handle: handleNode, logoNatural: natural };
}
