/**
 * Proof composer document logic — pure functions, no Konva/DOM here.
 *
 * Document space: panels share a common height (PANEL_H doc units) within a
 * row, and rows stack vertically. Each panel carries a `row` index (default 0);
 * panels of the same row sit side by side (array order = left→right), rows are
 * centered and stacked top→bottom. A single-row document (all row 0) is exactly
 * the classic side-by-side strip. Stacking rows keeps the composite closer to a
 * square so it survives a tweet's centre-crop instead of being a wide bandeau.
 *
 * Shape coordinates are stored in each panel's *natural image pixels* so the
 * spec stays valid regardless of layout or zoom (re-editable forever).
 */

import { formatCoords as renderCoords } from './coords.js';

export const PANEL_H = 720;
export const PAD = 20;
export const GAP = 16;
export const ROW_GAP = 18;
export const LEGEND_COL_MIN = 340; // min px width before the legend splits columns

// Tweet centre-crop aspect guides (width / height): X shows a single image with
// object-fit: cover into a box of this aspect, cropping whatever overflows.
export const TWEET_GUIDES = {
  '16:9': 16 / 9,
  '4:5': 4 / 5,
};

export const ANNO_COLORS = ['#ff5252', '#40c4ff', '#ffd740', '#69f0ae', '#e040fb', '#ff9e40', '#ffffff'];
export const MAX_ANNO_COLORS = ANNO_COLORS.length;
export const MAX_EXPORT_DIMENSION = 16_384;
export const MAX_EXPORT_PIXELS = 64_000_000;

/** Ordered drawing palette, with invalid/duplicate colours removed. */
export function normalizePreferredColors(colors) {
  const source = Array.isArray(colors) && colors.length ? colors : ANNO_COLORS;
  const seen = new Set();
  const palette = [];
  for (const value of source) {
    const color = String(value ?? '').trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(color) || seen.has(color)) continue;
    seen.add(color);
    palette.push(color);
    if (palette.length === MAX_ANNO_COLORS) break;
  }
  return palette.length ? palette : [...ANNO_COLORS];
}

/** Replace one palette slot; choosing an existing colour swaps the two slots. */
export function replacePreferredColor(colors, index, value) {
  const color = String(value ?? '').trim().toLowerCase();
  const palette = normalizePreferredColors(colors);
  if (!Number.isInteger(index) || index < 0 || index >= palette.length) return palette;
  if (!/^#[0-9a-f]{6}$/.test(color)) return palette;
  const existing = palette.indexOf(color);
  if (existing >= 0 && existing !== index) {
    [palette[index], palette[existing]] = [palette[existing], palette[index]];
  } else {
    palette[index] = color;
  }
  return palette;
}

export const BG = '#0d1117';
export const TEXT_MAIN = '#e8edf6';
export const TEXT_DIM = '#94a3b8';
export const TEXT_FAINT = '#64748b';

// Text palette for a light proof background, so captions/legend/footer stay
// legible when the analyst picks a pale backdrop. textColors() chooses between
// this and the dark palette from the background's luminance — one `bg` field
// drives both, no second colour to keep in sync.
export const TEXT_MAIN_LIGHT = '#0d1117';
export const TEXT_DIM_LIGHT = '#475569';
export const TEXT_FAINT_LIGHT = '#64748b';

/** True when `hex` (#rgb or #rrggbb) is light enough to want dark text on it. */
export function isLightColor(hex) {
  const c = String(hex || '').trim().replace('#', '');
  const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
  if (full.length !== 6) return false;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return false;
  // relative luminance (sRGB weights); above ~0.6 reads as a light backdrop
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
}

/** Caption/legend/footer colours for a proof background (auto dark-on-light). */
export function textColors(bg = BG) {
  return isLightColor(bg)
    ? { main: TEXT_MAIN_LIGHT, dim: TEXT_DIM_LIGHT, faint: TEXT_FAINT_LIGHT }
    : { main: TEXT_MAIN, dim: TEXT_DIM, faint: TEXT_FAINT };
}

function boundedNumber(value, fallback, min, max) {
  return Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function normalizedColor(value, fallback) {
  const color = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^#[0-9a-f]{6}$/.test(color) ? color : fallback;
}

/** Panel spacing in doc px; malformed fields fall back to shipped defaults. */
export function normSpace(space) {
  return {
    pad: boundedNumber(space?.pad, PAD, 0, 200),
    gap: boundedNumber(space?.gap, GAP, 0, 200),
    rowGap: boundedNumber(space?.rowGap, ROW_GAP, 0, 200),
  };
}

let idSeq = 0;
export function newId(prefix) {
  return `${prefix}${Date.now().toString(36)}${(idSeq++).toString(36)}`;
}

// Title a fresh proof carries until the analyst renames it. Two proofs left at
// this title auto-number on save (see uniqueProofName) instead of clobbering.
export const DEFAULT_PROOF_TITLE = 'Untitled proof';

/** URL-safe proof filename from free text — mirror of the backend `_slug`. */
export function proofSlug(text) {
  const slug = (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, 80) || 'proof';
}

/**
 * A proof title that doesn't collide with `taken` (existing proof titles):
 * `base` when free, else `base 2`, `base 3`, … A new proof left at the default
 * title gets numbered so two never-renamed proofs read apart in the case, and
 * the filename simply follows the title (proofSlug). `taken` is a Set or array.
 */
export function uniqueProofTitle(base, taken) {
  const set = taken instanceof Set ? taken : new Set(taken);
  if (!set.has(base)) return base;
  let n = 2;
  while (set.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/** Prefill a new proof from its case name without colliding with a saved proof. */
export function proofTitleFromCase(caseName, taken = []) {
  const base = String(caseName ?? '').trim() || DEFAULT_PROOF_TITLE;
  return uniqueProofTitle(base, taken);
}

/**
 * Search and category filter for the proof panel picker. Satellite captures
 * carry `kind: satellite`; every other case image carries `kind: media`.
 */
export function filterProofPanelItems(items, query = '', category = 'all') {
  const needle = String(query).trim().toLocaleLowerCase();
  return (items ?? []).filter((item) => {
    if (category === 'satellite' && item.kind !== 'satellite') return false;
    if (category === 'media' && item.kind !== 'media') return false;
    if (!needle) return true;
    const text = [
      item.label,
      item.src,
      item.meta?.provider,
      item.meta?.date,
      item.meta?.imagery_date,
    ].filter(Boolean).join(' ').toLocaleLowerCase();
    return text.includes(needle);
  });
}

/** A proof has nothing to render until it contains at least one panel. */
export function hasProofCanvasContent(proof) {
  return Array.isArray(proof?.panels) && proof.panels.length > 0;
}

export const CAPTION_SIZE = 20; // default caption font size (px, editable per proof)
export const LEGEND_SIZE = 20; // default legend text size
export const FOOTER_SIZE = 15; // default footer / attribution text size

export const PANEL_DIRECTIONS = [
  { id: 'horizontal', label: 'Side by side' },
  { id: 'vertical', label: 'Stacked' },
];

/** Apply a template's preferred arrangement to its first two panels. */
export function orientFirstPanels(panels, direction = 'horizontal') {
  if (!panels?.length) return panels;
  panels[0].row = 0;
  if (panels.length > 1) panels[1].row = direction === 'vertical' ? 1 : 0;
  return panels;
}

/** Height of the caption band under a row for a given caption font size. */
export function captionBand(captionSize = CAPTION_SIZE) {
  return Math.round(captionSize + 17);
}

/** Height of one legend line for a given legend font size. */
export function legendLineHeight(legendSize = LEGEND_SIZE) {
  return Math.round(legendSize + 13);
}

/** Height of the footer band for a given footer font size. */
export function footerBand(footerSize = FOOTER_SIZE) {
  return Math.round(footerSize + 13);
}

// Default band heights, derived from the size defaults so they can't drift out
// of sync when those change (they mirror legendLineHeight()/footerBand()).
export const LEGEND_LINE_H = legendLineHeight();
export const FOOTER_H = footerBand();

/** Distinct row indices in ascending order (default row 0). */
function rowOrder(panels) {
  return [...new Set(panels.map((p) => p.row ?? 0))].sort((a, b) => a - b);
}

/** Whether any panel in row `r` carries caption text — the band collapses when none does. */
function rowHasCaption(panels, r) {
  return panels.some((p) => (p.row ?? 0) === r && (p.caption ?? '').trim());
}

/** Per-panel height in doc units: base PANEL_H times the panel's own scale. */
export function panelHeight(p) {
  return PANEL_H * (p.scale ?? 1);
}

/**
 * Panel layout boxes in doc space: [{x, y, w, h, scale, baseScale, row}] aligned
 * with the input `panels`. In the default `grid` layout panels are grouped by
 * `row` and centred; rows stack top→bottom with a caption band + ROW_GAP between
 * them (see layoutPanelsGrid). In the `free` layout each panel sits at its own
 * stored x/y (see layoutPanelsFree) and overlap is allowed — array order is the
 * z-order, front→back (the first panel is the foreground one).
 *
 * `scale` maps a panel's natural pixels → doc pixels (grows/shrinks with the
 * user scale); `baseScale` is that mapping at scale 1, used to keep stroke and
 * arrow-head sizes normalised while still letting them grow with the panel.
 */
export function layoutPanels(panels, captionSize = CAPTION_SIZE, layout = 'grid', space) {
  return layout === 'free'
    ? layoutPanelsFree(panels, captionSize, space)
    : layoutPanelsGrid(panels, captionSize, space);
}

/**
 * Grid layout: each panel is laid out at PANEL_H × its own `scale`, so a row's
 * height is its tallest panel and the shorter panels are bottom-aligned so
 * their captions share one baseline.
 */
function layoutPanelsGrid(panels, captionSize = CAPTION_SIZE, space) {
  const { pad, gap, rowGap } = normSpace(space);
  const rows = rowOrder(panels);
  // A row reserves a caption band only when one of its panels is captioned, so a
  // caption-less proof has no empty strip under the panels (and none below the
  // last row — the bottom "bar" a footer-less, margin-less proof would show).
  const bandOf = (r) => (rowHasCaption(panels, r) ? captionBand(captionSize) : 0);
  // width + height of each row, to centre narrower rows and stack by height
  const rowWidth = new Map();
  const rowHeight = new Map();
  for (const r of rows) {
    let w = 0;
    let h = 0;
    const inRow = panels.filter((p) => (p.row ?? 0) === r);
    inRow.forEach((p, k) => {
      const ph = panelHeight(p);
      h = Math.max(h, ph);
      w += p.natural[0] * (ph / p.natural[1]) + (k ? gap : 0);
    });
    rowWidth.set(r, w);
    rowHeight.set(r, h);
  }
  const contentW = rows.length ? Math.max(...rowWidth.values()) : 0;
  // cumulative top of each row (rows differ in height once panels are scaled)
  const rowTop = new Map();
  let cy = pad;
  for (const r of rows) {
    rowTop.set(r, cy);
    cy += rowHeight.get(r) + bandOf(r) + rowGap;
  }
  // running x cursor per row so array order stays left→right within a row
  const cursor = new Map(rows.map((r) => [r, pad + (contentW - rowWidth.get(r)) / 2]));
  return panels.map((p) => {
    const r = p.row ?? 0;
    const ph = panelHeight(p);
    const scale = ph / p.natural[1];
    const baseScale = PANEL_H / p.natural[1];
    const w = p.natural[0] * scale;
    const y = rowTop.get(r) + (rowHeight.get(r) - ph); // bottom-align within row
    const box = { x: cursor.get(r), y, w, h: ph, scale, baseScale, row: r };
    cursor.set(r, cursor.get(r) + w + gap);
    return box;
  });
}

/**
 * Free layout: each panel sits at its stored doc-space x/y (its size still
 * derives from PANEL_H × scale, exactly as in the grid). Positions are
 * normalised so the top/left-most panel lands at PAD — stored coordinates can
 * drift while dragging, the document always hugs its content. A panel that has
 * no position yet (just added, or a grid spec toggled to free) falls back to
 * where the grid would have put it, so nothing jumps when entering the mode.
 */
export function layoutPanelsFree(panels, captionSize = CAPTION_SIZE, space) {
  if (!panels.length) return [];
  const { pad } = normSpace(space);
  const grid = layoutPanelsGrid(panels, captionSize, space); // fallback positions
  const pos = panels.map((p, i) => ({
    x: p.x ?? grid[i].x,
    y: p.y ?? grid[i].y,
  }));
  const dx = pad - Math.min(...pos.map((q) => q.x));
  const dy = pad - Math.min(...pos.map((q) => q.y));
  return panels.map((p, i) => {
    const ph = panelHeight(p);
    const scale = ph / p.natural[1];
    return {
      x: pos[i].x + dx,
      y: pos[i].y + dy,
      w: p.natural[0] * scale,
      h: ph,
      scale,
      baseScale: PANEL_H / p.natural[1],
      row: p.row ?? 0,
    };
  });
}

/**
 * Shift that re-anchors stored free positions at PAD (the normalisation
 * layoutPanelsFree applies on the fly). The caller folds it into every panel's
 * stored x/y after a drag/resize so stored coordinates always equal rendered
 * ones — and can offset the stage by the same amount so nothing jumps on screen.
 */
export function freeNormalizeDelta(panels, captionSize = CAPTION_SIZE, space) {
  if (!panels.length) return { dx: 0, dy: 0 };
  const { pad } = normSpace(space);
  const grid = layoutPanelsGrid(panels, captionSize, space);
  const xs = panels.map((p, i) => p.x ?? grid[i].x);
  const ys = panels.map((p, i) => p.y ?? grid[i].y);
  return { dx: pad - Math.min(...xs), dy: pad - Math.min(...ys) };
}

/** Height of the stacked panel block (rows + their caption bands), no legend. */
export function panelsBlockHeight(panels, captionSize = CAPTION_SIZE, space) {
  const { rowGap } = normSpace(space);
  const rows = rowOrder(panels);
  if (!rows.length) return 0;
  let total = 0;
  for (const r of rows) {
    const inRow = panels.filter((p) => (p.row ?? 0) === r);
    const band = rowHasCaption(panels, r) ? captionBand(captionSize) : 0;
    total += Math.max(...inRow.map(panelHeight)) + band;
  }
  return total + (rows.length - 1) * rowGap;
}

/**
 * Doc-space y where the panel block ends and the legend may start. Grid: PAD +
 * the stacked block (every row reserves its caption band). Free: the lowest
 * panel bottom, plus a caption band only under panels that actually carry one.
 */
export function panelsBottom(panels, captionSize = CAPTION_SIZE, layout = 'grid', space) {
  const { pad } = normSpace(space);
  if (!panels.length) return pad;
  if (layout !== 'free') return pad + panelsBlockHeight(panels, captionSize, space);
  const boxes = layoutPanelsFree(panels, captionSize, space);
  const band = captionBand(captionSize);
  return Math.max(
    ...boxes.map((b, i) => b.y + b.h + (panels[i].caption?.trim() ? band : 0))
  );
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
 * `featureColors` order (first use), overridden by an explicit `legendOrder`
 * (array of colors) where one is given: known colors keep that order, colors
 * no longer in use are dropped, newly-used colors not yet in `legendOrder`
 * are appended after the known ones (first-use order among themselves).
 */
export function orderedFeatureColors(shapes, legendOrder = []) {
  const used = featureColors(shapes);
  const known = legendOrder.filter((c) => used.includes(c));
  const extra = used.filter((c) => !known.includes(c));
  return [...known, ...extra];
}

/**
 * Legend lines: one per used color (feature), text taken from the per-color
 * `notes` map, ordered by `legendOrder` (falls back to first-use order).
 * Annotations are written by color, not per element.
 */
export function legendLines(shapes, notes = {}, legendOrder = []) {
  const colors = orderedFeatureColors(shapes, legendOrder);
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
  return 'Composed with Azimut';
}

// ---- coordinates + source (auto-derived from panels, user-overridable) ------

/** First panel (add order) that carries geo → {lat, lon}, else null. */
export function autoCoords(panels) {
  for (const p of panels ?? []) {
    const lat = p.meta?.lat;
    const lon = p.meta?.lon;
    if (lat != null && lon != null) return { lat: Number(lat), lon: Number(lon) };
  }
  return null;
}

/**
 * A {lat, lon} rendered in the reader's coordinate format, or '' when null.
 * Defaults to decimal degrees so this stays a pure function — components pass
 * the user's preference in (state.svelte.js `prefs.coordFormat`).
 */
export function formatCoords(c, format = 'dd') {
  return c && c.lat != null && c.lon != null ? renderCoords(c.lat, c.lon, format) : '';
}

/**
 * Trace a media item back to its original *source link(s)*. A source is always a
 * URL (a downloaded webpage): a file uploaded from disk is NOT a source. Inspect
 * derivatives (frames, adjustments, collages) don't carry a URL themselves —
 * their `source` records the case paths they were derived from (`from` and, for
 * collages, `sources`), so we follow those through `mediaByPath` until we reach
 * the download that owns a `webpage_url`. Returns de-duplicated URLs.
 */
export function resolveSourceUrls(item, mediaByPath, seen = new Set()) {
  if (!item) return [];
  const s = item.source ?? {};
  const direct = s.webpage_url || (typeof s.url === 'string' && /^https?:\/\//i.test(s.url) ? s.url : null);
  if (direct) return [direct];
  const parents = [];
  if (s.from) parents.push(s.from);
  if (Array.isArray(s.sources)) parents.push(...s.sources);
  const urls = [];
  for (const path of parents) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    urls.push(...resolveSourceUrls(mediaByPath?.get?.(path), mediaByPath, seen));
  }
  return [...new Set(urls)];
}

/** Source URLs already resolved onto a panel's meta (array, first-mirrored). */
function panelSourceUrls(p) {
  if (Array.isArray(p.meta?.source_urls)) return p.meta.source_urls.filter(Boolean);
  return p.meta?.source_url ? [p.meta.source_url] : [];
}

/** Distinct source URLs across all panels (satellite imagery has none). */
export function autoSourceUrls(panels) {
  const set = new Set();
  for (const p of panels ?? []) for (const u of panelSourceUrls(p)) set.add(u);
  return [...set];
}

/** Auto source line: distinct panel source links joined, or '' when none. */
export function autoSource(panels) {
  return autoSourceUrls(panels).join('  ·  ');
}

/** Effective coordinates text for a proof/spec: manual override else auto. */
export function proofCoordsText(p, format = 'dd') {
  const manual = p.coordsText?.trim();
  if (manual) return manual;
  return formatCoords(autoCoords(p.panels ?? []), format);
}

/** Effective source line for a proof/spec: manual override else auto. */
export function proofSource(p) {
  const manual = p.source?.trim();
  if (manual) return manual;
  return autoSource(p.panels ?? []);
}

/** How many columns the legend splits into for a given content width + count. */
export function legendColumns(width, count, space) {
  if (count <= 1) return 1;
  const { pad, gap } = normSpace(space);
  const fit = Math.floor((width - pad * 2 + gap) / (LEGEND_COL_MIN + gap));
  return Math.max(1, Math.min(3, count, fit));
}

/** Number of stacked legend rows once split into columns. */
export function legendRowCount(count, columns) {
  return columns > 0 ? Math.ceil(count / columns) : 0;
}

/**
 * Full document size given panels + shapes. Legend grows with the feature
 * count and every text band grows with its own font size (all editable per
 * proof via `text = { captionSize, legendSize, footerSize }`).
 */
export function docSize(panels, shapes, notes = {}, text = {}, legendOrder = [], layout = 'grid', space) {
  const {
    captionSize = CAPTION_SIZE, legendSize = LEGEND_SIZE, footerSize = FOOTER_SIZE,
    footerEnabled = true,
  } = text;
  const { pad } = normSpace(space);
  const boxes = layoutPanels(panels, captionSize, layout, space);
  const width = boxes.length
    ? Math.max(...boxes.map((b) => b.x + b.w)) + pad
    : 640;
  const contentW = Math.max(width, 640);
  const legend = legendLines(shapes, notes, legendOrder).filter((l) => l.text);
  const cols = legendColumns(contentW, legend.length, space);
  const legendRows = legendRowCount(legend.length, cols);
  const height =
    panelsBottom(panels, captionSize, layout, space) +
    (legend.length ? 10 + legendRows * legendLineHeight(legendSize) : 0) +
    (footerEnabled ? footerBand(footerSize) : 0) + pad;
  return { width: contentW, height, legend, cols };
}

// ---- signature: the analyst's logo, stamped on a proof they choose to sign ---

/** Doc corners the signature can hang off: top/bottom × left/right. */
export const SIG_ANCHORS = [
  { id: 'tl', label: 'Top left' },
  { id: 'tr', label: 'Top right' },
  { id: 'bl', label: 'Bottom left' },
  { id: 'br', label: 'Bottom right' },
];

export const SIG_MARGIN = PAD; // inset from the doc edge at zero offset
export const SIG_SCALE = 0.08; // default logo footprint, as a share of the proof
export const SIG_OPACITY = 0.9;

/** A fresh signature record — bottom right, the corner a byline usually takes. */
export function newSignature() {
  return { anchor: 'br', dx: 0, dy: 0, scale: SIG_SCALE, opacity: SIG_OPACITY };
}

/**
 * Where the signature lands in doc space: {x, y, w, h}.
 *
 * Size fits inside a `scale` share of both document dimensions, so wide, square
 * and tall PNGs start with the same visual footprint. Position is an `anchor`
 * corner plus a user `dx`/`dy` nudge
 * — the document grows every time a panel or a font size changes, so a raw x/y
 * would drift off the image; an anchored offset stays put.
 *
 * The result is clamped inside the document: a nudge can't push the logo off
 * the export, where it would be silently cropped rather than visibly wrong.
 */
export function signatureBox(sig, docW, docH, natural) {
  const [nw, nh] = natural;
  const scale = sig.scale ?? SIG_SCALE;
  const maxW = docW * scale;
  const maxH = docH * scale;
  const aspect = nw > 0 && nh > 0 ? nw / nh : 1;
  const w = aspect >= maxW / Math.max(maxH, 1) ? maxW : maxH * aspect;
  const h = w / aspect;
  const right = (sig.anchor ?? 'br').endsWith('r');
  const bottom = (sig.anchor ?? 'br').startsWith('b');
  const x = right ? docW - SIG_MARGIN - w : SIG_MARGIN;
  const y = bottom ? docH - SIG_MARGIN - h : SIG_MARGIN;
  const relative = relativePlacement(sig, docW, docH, w, h);
  return relative ?? {
    x: clamp(x + (sig.dx ?? 0), 0, Math.max(0, docW - w)),
    y: clamp(y + (sig.dy ?? 0), 0, Math.max(0, docH - h)),
    w,
    h,
  };
}

/** Whether an anchored item is still at its untouched corner position. */
function hasDefaultPlacement(item) {
  return item
    && !Number.isFinite(item.xRatio)
    && !Number.isFinite(item.yRatio)
    && (item.dx ?? 0) === 0
    && (item.dy ?? 0) === 0;
}

/**
 * Default logo + account-handle stack. When both items still share an untouched
 * corner, the logo sits above the centered handle. Once either item is moved or
 * assigned another corner, callers use their independent positions instead.
 */
export function signaturePairPositions(
  signature, signatureText, docW, docH, logoBox, handleW, handleH,
) {
  if (!logoBox || !hasDefaultPlacement(signature) || !hasDefaultPlacement(signatureText)) return null;
  if ((signature.anchor ?? 'br') !== (signatureText.anchor ?? 'br')) return null;

  const anchor = signature.anchor ?? 'br';
  const right = anchor.endsWith('r');
  const bottom = anchor.startsWith('b');
  const gap = Math.max(8, Math.round(handleH * 0.3));
  const groupW = Math.max(logoBox.w, handleW);
  const groupH = logoBox.h + gap + handleH;
  const groupX = right ? docW - SIG_MARGIN - groupW : SIG_MARGIN;
  const groupY = bottom ? docH - SIG_MARGIN - groupH : SIG_MARGIN;
  const x = clamp(groupX, 0, Math.max(0, docW - groupW));
  const y = clamp(groupY, 0, Math.max(0, docH - groupH));

  return {
    logo: { ...logoBox, x: x + (groupW - logoBox.w) / 2, y },
    handle: { x: x + (groupW - handleW) / 2, y: y + logoBox.h + gap },
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Resolve a dragged placement as a share of the available document area. */
function relativePlacement(a, docW, docH, w, h) {
  if (!Number.isFinite(a?.xRatio) || !Number.isFinite(a?.yRatio)) return null;
  const maxX = Math.max(0, docW - w);
  const maxY = Math.max(0, docH - h);
  return {
    x: clamp(a.xRatio, 0, 1) * maxX,
    y: clamp(a.yRatio, 0, 1) * maxY,
    w,
    h,
  };
}

/**
 * {x, y} of a w×h box anchored to a document corner with a `dx`/`dy` nudge,
 * clamped inside the document. The general form behind signatureBox — used by
 * the text signature too, whose width is measured at render time.
 */
export function anchoredPos(a, docW, docH, w, h, margin = SIG_MARGIN) {
  const relative = relativePlacement(a, docW, docH, w, h);
  if (relative) return { x: relative.x, y: relative.y };
  const right = (a?.anchor ?? 'br').endsWith('r');
  const bottom = (a?.anchor ?? 'br').startsWith('b');
  const x = right ? docW - margin - w : margin;
  const y = bottom ? docH - margin - h : margin;
  return {
    x: clamp(x + (a?.dx ?? 0), 0, Math.max(0, docW - w)),
    y: clamp(y + (a?.dy ?? 0), 0, Math.max(0, docH - h)),
  };
}

/** The `dx`/`dy` placing an anchored box's top-left at (x, y) — inverse of anchoredPos. */
export function anchoredOffset(a, docW, docH, w, h, x, y, margin = SIG_MARGIN) {
  const base = anchoredPos({ ...a, dx: 0, dy: 0 }, docW, docH, w, h, margin);
  const maxX = Math.max(0, docW - w);
  const maxY = Math.max(0, docH - h);
  return {
    dx: x - base.x,
    dy: y - base.y,
    xRatio: maxX ? clamp(x / maxX, 0, 1) : 0,
    yRatio: maxY ? clamp(y / maxY, 0, 1) : 0,
  };
}

// Default doc-pixel height of a text signature (the Settings handle laid over
// the panels). The text itself is deliberately not stored in a proof/template:
// it is the analyst's app-wide identity, like the signature logo.
export const SIG_TEXT_SIZE = 28;

/** A fresh text-signature record — a handle in the bottom-right, over the panels. */
export function newSignatureText() {
  return { anchor: 'br', dx: 0, dy: 0, size: SIG_TEXT_SIZE, color: '#ffffff', opacity: 1 };
}

/** Copy a text-signature slot while dropping the legacy per-proof handle text. */
export function textSignatureStyle(signatureText) {
  if (!signatureText || typeof signatureText !== 'object' || Array.isArray(signatureText)) return null;
  const style = {
    anchor: ['tl', 'tr', 'bl', 'br'].includes(signatureText.anchor) ? signatureText.anchor : 'br',
    dx: boundedNumber(signatureText.dx, 0, -100_000, 100_000),
    dy: boundedNumber(signatureText.dy, 0, -100_000, 100_000),
    size: boundedNumber(signatureText.size, SIG_TEXT_SIZE, 12, 300),
    color: normalizedColor(signatureText.color, '#ffffff'),
    opacity: boundedNumber(signatureText.opacity, 1, 0, 1),
  };
  if (Number.isFinite(signatureText.xRatio)) style.xRatio = clamp(signatureText.xRatio, 0, 1);
  if (Number.isFinite(signatureText.yRatio)) style.yRatio = clamp(signatureText.yRatio, 0, 1);
  return style;
}

/**
 * The `dx`/`dy` that puts the signature's top-left at doc point (x, y) — the
 * inverse of signatureBox's anchoring, for writing a drag back to the spec.
 */
export function signatureOffset(sig, docW, docH, natural, x, y) {
  const base = signatureBox({ ...sig, dx: 0, dy: 0 }, docW, docH, natural);
  const maxX = Math.max(0, docW - base.w);
  const maxY = Math.max(0, docH - base.h);
  return {
    dx: x - base.x,
    dy: y - base.y,
    xRatio: maxX ? clamp(x / maxX, 0, 1) : 0,
    yRatio: maxY ? clamp(y / maxY, 0, 1) : 0,
  };
}

/** Serializable spec from runtime state (drops live image objects). */
export function toSpec(proof) {
  return {
    azimut_proof: 1,
    title: proof.title,
    // A proof keeps the selected house-style identity as well as its copied
    // style values, so reopening it can restore the template picker.
    templateId: typeof proof.templateId === 'string' ? proof.templateId : null,
    coords: autoCoords(proof.panels), // auto geo (first geo panel), for reference
    coordsText: proof.coordsText?.trim() ? proof.coordsText.trim() : null, // null → auto
    source: proof.source?.trim() ? proof.source.trim() : null, // null → auto (link only)
    captionSize: proof.captionSize ?? CAPTION_SIZE,
    legendSize: proof.legendSize ?? LEGEND_SIZE,
    footerSize: proof.footerSize ?? FOOTER_SIZE,
    footer: proof.footer?.trim() ? proof.footer.trim() : null, // null → default attribution line
    footerEnabled: proof.footerEnabled !== false, // false → no footer line at all
    footerColor: proof.footerColor ?? null, // null → auto from the background
    footerAlign: proof.footerAlign === 'right' ? 'right' : 'left',
    captionsEnabled: proof.captionsEnabled !== false, // default caption for newly added panels
    bg: proof.bg ?? BG, // proof background fill; text colours follow it (textColors)
    space: normSpace(proof.space), // panel spacing {pad, gap, rowGap}
    layout: proof.layout ?? 'grid', // 'grid' (rows) | 'free' (per-panel x/y, overlap allowed)
    panelDirection: proof.layout !== 'free' && proof.panels?.length > 1
      ? ((proof.panels[0].row ?? 0) === (proof.panels[1].row ?? 0) ? 'horizontal' : 'vertical')
      : (proof.panelDirection === 'vertical' ? 'vertical' : 'horizontal'),
    // null → unsigned. The logo itself lives in the workspace, never in the
    // spec: a shared case reads the same, it just renders no signature without
    // the file (see config.signature_path).
    signature: proof.signature ? { ...proof.signature } : null,
    // The handle value lives in Settings; this stores only its optional slot.
    signatureText: textSignatureStyle(proof.signatureText),
    palette: normalizePreferredColors(proof.palette),
    notes: { ...(proof.notes ?? {}) },
    legendOrder: [...(proof.legendOrder ?? [])],
    panels: proof.panels.map((p) => ({
      id: p.id, // kept so shapes stay bound to their panel on reload
      src: p.src,
      caption: p.caption ?? '',
      row: p.row ?? 0, // vertical row (0 = top); missing → single-row layout
      scale: p.scale ?? 1, // per-panel size multiplier (1 = default PANEL_H)
      x: p.x ?? null, // free-layout doc position; null → grid fallback
      y: p.y ?? null,
      natural: p.natural,
      meta: p.meta ?? {},
    })),
    shapes: proof.shapes.map((s) => ({ ...s })),
  };
}

// ---- reusable house-style templates -----------------------------------------

/**
 * A content-free house style extracted from a proof (or a loaded spec): the
 * fields that make a proof look like "yours" — background, spacing, layout
 * mode, text sizes, footer line, signature placement and preferred colours.
 * Never the panels, shapes, legend text, title, coordinates or source.
 */
export function templateFromProof(proof) {
  return normalizeProofStyle({
    bg: proof.bg ?? BG,
    space: normSpace(proof.space),
    layout: proof.layout ?? 'grid',
    captionSize: proof.captionSize ?? CAPTION_SIZE,
    legendSize: proof.legendSize ?? LEGEND_SIZE,
    footerSize: proof.footerSize ?? FOOTER_SIZE,
    footer: proof.footer ?? '',
    footerEnabled: proof.footerEnabled !== false,
    footerColor: proof.footerColor ?? null,
    footerAlign: proof.footerAlign === 'right' ? 'right' : 'left',
    captionsEnabled: proof.captionsEnabled !== false,
    panelDirection: proof.layout !== 'free' && proof.panels?.length > 1
      ? ((proof.panels[0].row ?? 0) === (proof.panels[1].row ?? 0) ? 'horizontal' : 'vertical')
      : (proof.panelDirection === 'vertical' ? 'vertical' : 'horizontal'),
    signature: proof.signature ? { ...proof.signature } : null,
    signatureText: textSignatureStyle(proof.signatureText),
    palette: normalizePreferredColors(proof.palette),
  });
}

function normalizedSignature(signature) {
  if (!signature || typeof signature !== 'object' || Array.isArray(signature)) return null;
  const style = {
    anchor: ['tl', 'tr', 'bl', 'br'].includes(signature.anchor) ? signature.anchor : 'br',
    dx: boundedNumber(signature.dx, 0, -100_000, 100_000),
    dy: boundedNumber(signature.dy, 0, -100_000, 100_000),
    scale: boundedNumber(signature.scale, SIG_SCALE, 0.03, 0.6),
    opacity: boundedNumber(signature.opacity, SIG_OPACITY, 0, 1),
  };
  if (Number.isFinite(signature.xRatio)) style.xRatio = clamp(signature.xRatio, 0, 1);
  if (Number.isFinite(signature.yRatio)) style.yRatio = clamp(signature.yRatio, 0, 1);
  return style;
}

/** Canonical, content-free proof style safe to feed into preview/render code. */
export function normalizeProofStyle(style = {}) {
  const source = style && typeof style === 'object' && !Array.isArray(style) ? style : {};
  return {
    bg: normalizedColor(source.bg, BG),
    space: normSpace(source.space),
    layout: source.layout === 'free' ? 'free' : 'grid',
    captionSize: boundedNumber(source.captionSize, CAPTION_SIZE, 8, 80),
    legendSize: boundedNumber(source.legendSize, LEGEND_SIZE, 8, 80),
    footerSize: boundedNumber(source.footerSize, FOOTER_SIZE, 8, 80),
    footer: typeof source.footer === 'string' ? source.footer.slice(0, 200) : '',
    footerEnabled: typeof source.footerEnabled === 'boolean' ? source.footerEnabled : true,
    footerColor: source.footerColor == null ? null : normalizedColor(source.footerColor, null),
    footerAlign: source.footerAlign === 'right' ? 'right' : 'left',
    captionsEnabled: typeof source.captionsEnabled === 'boolean' ? source.captionsEnabled : true,
    panelDirection: source.panelDirection === 'vertical' ? 'vertical' : 'horizontal',
    signature: normalizedSignature(source.signature),
    signatureText: textSignatureStyle(source.signatureText),
    palette: normalizePreferredColors(source.palette),
  };
}

/**
 * Apply a house style onto a proof, mutating it in place. Panel content,
 * shapes, title, coordinates and source stay untouched; the first pair's rows
 * may change when the template specifies their direction. Legend text and its
 * order are content, so templates leave both untouched.
 */
export function applyProofStyle(proof, style, available = {}) {
  if (!style) return proof;
  const source = typeof style === 'object' && !Array.isArray(style) ? style : {};
  const normalized = normalizeProofStyle(source);
  if ('bg' in source) proof.bg = normalized.bg;
  if ('space' in source) proof.space = normalized.space;
  if ('layout' in source) proof.layout = normalized.layout;
  if ('captionSize' in source) proof.captionSize = normalized.captionSize;
  if ('legendSize' in source) proof.legendSize = normalized.legendSize;
  if ('footerSize' in source) proof.footerSize = normalized.footerSize;
  if ('footer' in source) proof.footer = normalized.footer;
  if ('footerEnabled' in source) proof.footerEnabled = normalized.footerEnabled;
  if ('footerColor' in source) proof.footerColor = normalized.footerColor;
  if ('footerAlign' in source) proof.footerAlign = normalized.footerAlign;
  if ('captionsEnabled' in source) proof.captionsEnabled = normalized.captionsEnabled;
  if ('panelDirection' in source) {
    proof.panelDirection = normalized.panelDirection;
    orientFirstPanels(proof.panels ?? [], proof.panelDirection);
  }
  proof.signature = normalized.signature && available.logo !== false ? normalized.signature : null;
  proof.signatureText = normalized.signatureText && available.handle !== false
    ? normalized.signatureText
    : null;
  if ('palette' in source) proof.palette = normalized.palette;
  return proof;
}

/**
 * Detached, plain deep copy of a shape spec (id stripped) for the clipboard.
 * A shape is pure JSON data, so a JSON round-trip both unwraps any reactive
 * proxy — `structuredClone` of a live proxy throws in the browser, and a shallow
 * spread leaves points-based shapes with a proxied `points` array,
 * which silently broke copy for those kinds — and fully detaches the copy.
 */
export function copyShapeSpec(shape) {
  const clone = JSON.parse(JSON.stringify(shape));
  delete clone.id;
  return clone;
}

/**
 * Copy of a shape spec nudged by `d` doc-pixels down-right, for paste/duplicate.
 * Points-based kinds shift every vertex; box/ellipse/text
 * shift their x/y. The returned spec carries no id — the caller assigns one.
 */
export function offsetShape(shape, d) {
  const s = structuredClone(shape);
  delete s.id;
  if (Array.isArray(s.points)) {
    s.points = s.points.map((v) => v + d);
  } else {
    s.x = (s.x ?? 0) + d;
    s.y = (s.y ?? 0) + d;
  }
  return s;
}

/**
 * Panel input for a satellite capture. The caption is provider · coordinates,
 * dated with the imagery acquisition date (when the satellite scene was shot,
 * NOT when we fetched the tiles) — the date part is simply omitted when the
 * provider doesn't expose it, never substituted with the fetch date.
 */
export function satPanelInput(s, format = 'dd') {
  // the caption follows the reader's format; the panel meta below keeps the
  // raw decimal degrees, so provenance stays machine-readable either way
  const parts = [`${s.provider_label} · ${renderCoords(s.lat, s.lon, format)}`];
  if (s.imagery_date) parts.push(s.imagery_date);
  return {
    src: s.path,
    meta: {
      kind: 'satellite', attribution: s.attribution, lat: s.lat, lon: s.lon,
      zoom: s.zoom, provider: s.provider_label,
      date: s.fetched_at?.slice(0, 10), imagery_date: s.imagery_date ?? null,
    },
    caption: parts.join(' · '),
  };
}

/**
 * Panel input for a media image. Traces the real source link through the
 * derivation chain (a collage/frame carries no URL of its own — follow it back
 * to the downloaded original). A file uploaded from disk has no URL, so it
 * contributes no source.
 */
export function mediaPanelInput(m, mediaList = []) {
  const byPath = new Map(mediaList.map((x) => [x.path, x]));
  const urls = resolveSourceUrls(m, byPath);
  return {
    src: m.path,
    meta: { kind: 'media', source_url: urls[0], source_urls: urls },
    caption: '',
  };
}

/**
 * True when a media listing item is a satellite capture — mirrors the backend's
 * `satellite.is_capture`. A capture *is* a media image (one file in `media/`),
 * flagged by its sidecar `source.type`, so it surfaces in both the /media and
 * /satellite listings; callers use this to avoid listing it under both.
 */
export function isSatelliteCapture(item) {
  return (item?.source ?? {}).type === 'satellite';
}

/**
 * Collapse picker items that share a `src` down to their first occurrence.
 * The picker builds its list so no `src` repeats, but a duplicate key would
 * throw Svelte's `each_key_duplicate` and blank the whole modal — so this is a
 * cheap last-line guard around that keyed `{#each … (item.src)}`. Callers list
 * the richer satellite entry first, so the kept one carries coords/attribution.
 */
export function dedupeBySrc(items) {
  const seen = new Set();
  return items.filter((it) => {
    if (seen.has(it.src)) return false;
    seen.add(it.src);
    return true;
  });
}

/**
 * Auto-arrange panels into stacked rows so the whole composite's aspect ratio
 * lands as close as possible to `target` (a tweet-friendly aspect: 16:9 shows
 * uncropped in the X timeline, 4:5 fills the feed). Array order is preserved —
 * we only choose where to break the sequence into rows — so the caller keeps
 * left→right ordering. Returns one row index per panel (aligned with `panels`).
 *
 * The composite includes the legend + footer bands (they're part of the image
 * that gets cropped), so `shapes`/`notes`/`text` are folded into the measure.
 * Exhaustive search stays useful for small proofs. Larger documents use a
 * deterministic balanced-row search so runtime remains bounded.
 */
export function autoLayoutRows(
  panels, shapes = [], notes = {}, text = {}, target = TWEET_GUIDES['16:9'], space,
) {
  const n = panels.length;
  if (n <= 1) return panels.map(() => 0);
  let best = null;
  const measure = (rows) => {
    const candidate = panels.map((p, i) => ({ ...p, row: rows[i], scale: 1 }));
    const { width, height } = docSize(candidate, shapes, notes, text, [], 'grid', space);
    const score = Math.abs(width / height - target);
    if (!best || score < best.score) best = { score, rows };
  };

  const exhaustiveLimit = 12;
  if (n <= exhaustiveLimit) {
    const combos = 2 ** (n - 1);
    for (let mask = 0; mask < combos; mask++) {
      let row = 0;
      const rows = [0];
      for (let i = 1; i < n; i++) {
        if (mask & (2 ** (i - 1))) row += 1;
        rows.push(row);
      }
      measure(rows);
    }
    return best.rows;
  }

  const weights = panels.map((panel) => {
    const width = panel?.natural?.[0];
    const height = panel?.natural?.[1];
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
      ? width / height
      : 1;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const maxRows = Math.min(n, 64);
  for (let rowCount = 1; rowCount <= maxRows; rowCount++) {
    const rows = [];
    let row = 0;
    let cumulative = 0;
    for (let i = 0; i < n; i++) {
      rows.push(row);
      cumulative += weights[i];
      const remainingItems = n - i - 1;
      const remainingRows = rowCount - row - 1;
      if (
        row < rowCount - 1
        && (remainingItems === remainingRows || cumulative >= total * (row + 1) / rowCount)
      ) {
        row += 1;
      }
    }
    measure(rows);
  }
  return best.rows;
}

/** Safe canvas export settings for a measured proof document. */
export function proofExportOptions(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError('Proof dimensions are invalid.');
  }
  const pixelRatio = Math.min(Math.max(1800 / width, 0.75), 2);
  const outputWidth = Math.ceil(width * pixelRatio);
  const outputHeight = Math.ceil(height * pixelRatio);
  if (
    outputWidth > MAX_EXPORT_DIMENSION
    || outputHeight > MAX_EXPORT_DIMENSION
    || outputWidth * outputHeight > MAX_EXPORT_PIXELS
  ) {
    throw new RangeError('Proof is too large to export. Reduce its panel count or spacing.');
  }
  return { pixelRatio, outputWidth, outputHeight };
}

// ---- editor geometry & ordering (pure helpers behind the canvas gestures) ---

/**
 * Remap a point from one panel's natural-pixel space into another's, via doc
 * space. `fromBox`/`toBox` are layout boxes ({x, y, scale}); used when a shape
 * is dragged off its panel onto another so it keeps its on-screen position.
 */
export function remapPanelXY(x, y, fromBox, toBox) {
  return {
    x: (fromBox.x + x * fromBox.scale - toBox.x) / toBox.scale,
    y: (fromBox.y + y * fromBox.scale - toBox.y) / toBox.scale,
  };
}

/**
 * Topmost panel box under a doc-space point, or null. `boxes` is the layout in
 * front→back order (array order = z-order), so the first hit wins. Returns the
 * box, its index, and the point in that panel's natural pixels ({nx, ny}).
 */
export function panelHitTest(boxes, point) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (point.x >= b.x && point.x <= b.x + b.w && point.y >= b.y && point.y <= b.y + b.h) {
      return { index: i, box: b, nx: (point.x - b.x) / b.scale, ny: (point.y - b.y) / b.scale };
    }
  }
  return null;
}

/**
 * Index to swap `index` with when nudging it by `delta` (±1) while staying in
 * its own group: the nearest item in that direction sharing its group key
 * (`keyOf(item)` → a panel's row, a shape's panel). -1 when none (group edge).
 */
export function groupNeighborIndex(items, index, delta, keyOf) {
  const key = keyOf(items[index]);
  let target = index + delta;
  while (target >= 0 && target < items.length && keyOf(items[target]) !== key) {
    target += delta;
  }
  return target >= 0 && target < items.length && keyOf(items[target]) === key ? target : -1;
}

/** Whether `index` has a same-group item before it (delta<0) or after it (delta>0). */
export function hasGroupNeighbor(items, index, delta, keyOf) {
  const key = keyOf(items[index]);
  const side = delta < 0 ? items.slice(0, index) : items.slice(index + 1);
  return side.some((it) => keyOf(it) === key);
}

/**
 * Dense 0..n-1 row numbers for panels whose `row` indices went sparse after a
 * move emptied one. Ascending distinct rows map to 0,1,2,…; returns one value
 * per panel (aligned with `panels`) for the caller to assign back in place.
 */
export function denseRowValues(panels) {
  const order = [...new Set(panels.map((p) => p.row ?? 0))].sort((a, b) => a - b);
  const remap = new Map(order.map((r, i) => [r, i]));
  return panels.map((p) => remap.get(p.row ?? 0));
}

/** Clamp a panel scale after a `delta`, rounded to whole percent. */
export function clampPanelScale(current, delta, min, max) {
  return Math.round(Math.min(max, Math.max(min, (current ?? 1) + delta)) * 100) / 100;
}

/**
 * Drop the duplicate final vertex a double-click leaves on a drawn curve: if
 * the last point sits within `threshold` doc px of the previous one, trim it.
 * `points` is a flat [x0,y0,x1,y1,…] array; returns a (possibly shorter) copy.
 */
export function trimClosingDuplicate(points, threshold = 3) {
  const n = points.length;
  if (n >= 4 && Math.hypot(points[n - 2] - points[n - 4], points[n - 1] - points[n - 3]) < threshold) {
    return points.slice(0, n - 2);
  }
  return points.slice();
}

/**
 * Lightly smooth a pointer-drawn polyline. Samples closer than `minDistance`
 * are folded together first, then one weighted moving-average pass removes
 * hand jitter while preserving both endpoints.
 */
export function smoothFreehandPoints(points, minDistance = 1) {
  if (!Array.isArray(points) || points.length < 4) return [...(points ?? [])];
  const threshold = Math.max(0, minDistance);
  const sampled = [points[0], points[1]];
  for (let i = 2; i < points.length - 2; i += 2) {
    const lx = sampled[sampled.length - 2];
    const ly = sampled[sampled.length - 1];
    if (Math.hypot(points[i] - lx, points[i + 1] - ly) > threshold) {
      sampled.push(points[i], points[i + 1]);
    }
  }

  const endX = points[points.length - 2];
  const endY = points[points.length - 1];
  if (sampled.length === 2) sampled.push(endX, endY);
  else {
    const lx = sampled[sampled.length - 2];
    const ly = sampled[sampled.length - 1];
    if (Math.hypot(endX - lx, endY - ly) > threshold) sampled.push(endX, endY);
    else {
      sampled[sampled.length - 2] = endX;
      sampled[sampled.length - 1] = endY;
    }
  }
  if (sampled.length < 6) return sampled;

  const smoothed = [sampled[0], sampled[1]];
  for (let i = 2; i < sampled.length - 2; i += 2) {
    smoothed.push(
      (sampled[i - 2] + sampled[i] * 2 + sampled[i + 2]) / 4,
      (sampled[i - 1] + sampled[i + 1] * 2 + sampled[i + 3]) / 4,
    );
  }
  smoothed.push(sampled[sampled.length - 2], sampled[sampled.length - 1]);
  return smoothed;
}

/** Build a persisted freehand shape, or reject a click/tiny accidental drag. */
export function freehandShape(points, { minDistance = 1, minLength = 5 } = {}) {
  const smoothed = smoothFreehandPoints(points, minDistance);
  let length = 0;
  for (let i = 2; i < smoothed.length; i += 2) {
    length += Math.hypot(smoothed[i] - smoothed[i - 2], smoothed[i + 1] - smoothed[i - 1]);
  }
  return smoothed.length >= 4 && length > minLength
    ? { kind: 'freehand', points: smoothed, tension: 0.25 }
    : null;
}

/**
 * Whether the legend note on `oldColor` should follow a shape recolored to
 * `newColor`: only when `newColor` carries no note yet and no *other* shape
 * still uses `oldColor`, so the note is neither stranded on an unused color nor
 * stolen from shapes that keep it. `moving` is the shape being recolored.
 */
export function canReassignLegendNote(notes, oldColor, newColor, shapes, moving) {
  return Boolean(
    notes?.[oldColor] && !notes?.[newColor] &&
    !shapes.some((s) => s !== moving && s.color === oldColor),
  );
}

// ---- saved-proof case queries ----------------------------------------------

/** Filed proof entities in a case (those whose `attrs.spec` is `proofs/*.json`). */
export function savedProofEntities(entities) {
  return (entities ?? []).filter((e) => {
    const s = e.attrs?.spec;
    return typeof s === 'string' && s.startsWith('proofs/') && s.endsWith('.json');
  });
}

/** Slugs (filename without `proofs/….json`) of every saved proof — the collision set. */
export function savedProofSlugs(entities) {
  return new Set(savedProofEntities(entities).map((e) => e.attrs.spec.slice(7, -5)));
}

/** Titles of every saved proof, so a fresh title can read apart from them. */
export function savedProofTitles(entities) {
  return new Set(savedProofEntities(entities).map((e) => e.label ?? ''));
}

/** Title of the saved proof with slug `name`, for the overwrite prompt. */
export function savedProofTitle(entities, name) {
  const e = savedProofEntities(entities).find((x) => x.attrs.spec === `proofs/${name}.json`);
  return e?.label ?? name;
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}
