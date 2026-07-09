/**
 * Proof composer document logic — pure functions, no Konva/DOM here.
 *
 * Document space: panels share a common height (PANEL_H doc units) and sit in
 * one row. Shape coordinates are stored in each panel's *natural image pixels*
 * so the spec stays valid regardless of layout or zoom (re-editable forever).
 */

export const PANEL_H = 720;
export const PAD = 20;
export const GAP = 16;
export const CAPTION_H = 34;
export const LEGEND_LINE_H = 30;
export const FOOTER_H = 26;

export const ANNO_COLORS = ['#ff5252', '#40c4ff', '#ffd740', '#69f0ae', '#e040fb', '#ff9e40'];

export const BG = '#0d1117';
export const TEXT_MAIN = '#e8edf6';
export const TEXT_DIM = '#94a3b8';
export const TEXT_FAINT = '#64748b';

let idSeq = 0;
export function newId(prefix) {
  return `${prefix}${Date.now().toString(36)}${(idSeq++).toString(36)}`;
}

/** Panel layout boxes in doc space: [{x, y, w, h, scale}] aligned with panels. */
export function layoutPanels(panels) {
  let x = PAD;
  return panels.map((p) => {
    const scale = PANEL_H / p.natural[1];
    const w = p.natural[0] * scale;
    const box = { x, y: PAD, w, h: PANEL_H, scale };
    x += w + GAP;
    return box;
  });
}

/**
 * Distinct colors in order of first use → feature numbering (same color = same
 * feature). Text labels are excluded — they annotate, they aren't features.
 */
export function featureColors(shapes) {
  const seen = [];
  for (const s of shapes) {
    if (s.kind === 'text') continue;
    if (!seen.includes(s.color)) seen.push(s.color);
  }
  return seen;
}

/**
 * Legend lines: one per used color (feature), text taken from the per-color
 * `notes` map. Annotations are written by color, not per element.
 */
export function legendLines(shapes, notes = {}) {
  const colors = featureColors(shapes);
  return colors.map((color, i) => ({
    color,
    n: i + 1,
    text: (notes?.[color] ?? '').trim(),
  }));
}

/**
 * Build a per-color notes map from legacy per-shape comments (old specs stored
 * the legend text on each shape). Used once when opening an old proof.
 */
export function notesFromShapes(shapes) {
  const notes = {};
  for (const s of shapes) {
    const c = s.comment?.trim();
    if (!c) continue;
    const existing = notes[s.color];
    if (!existing) notes[s.color] = c;
    else if (!existing.split(' · ').includes(c)) notes[s.color] = `${existing} · ${c}`;
  }
  return notes;
}

/** Unique attribution strings from panel metadata. */
export function attributionLine(panels) {
  const parts = new Set();
  for (const p of panels) {
    if (p.meta?.attribution) parts.add(`Imagery: ${p.meta.attribution}`);
    else if (p.meta?.source_url) parts.add(`Source: ${p.meta.source_url}`);
  }
  parts.add('Composed with Ozimut');
  return [...parts].join('  ·  ');
}

/** Full document size given panels + shapes (legend grows with features). */
export function docSize(panels, shapes, notes = {}) {
  const boxes = layoutPanels(panels);
  const width = boxes.length
    ? boxes[boxes.length - 1].x + boxes[boxes.length - 1].w + PAD
    : 640;
  const legend = legendLines(shapes, notes).filter((l) => l.text);
  const height =
    PAD + PANEL_H + CAPTION_H + (legend.length ? 10 + legend.length * LEGEND_LINE_H : 0) + FOOTER_H + PAD;
  return { width: Math.max(width, 640), height, legend };
}

/** Serializable spec from runtime state (drops live image objects). */
export function toSpec(proof) {
  return {
    ozimut_proof: 1,
    title: proof.title,
    coords: proof.coords ?? null,
    notes: { ...(proof.notes ?? {}) },
    panels: proof.panels.map((p) => ({
      id: p.id, // kept so shapes stay bound to their panel on reload
      src: p.src,
      caption: p.caption ?? '',
      natural: p.natural,
      meta: p.meta ?? {},
    })),
    shapes: proof.shapes.map((s) => ({ ...s })),
  };
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}
