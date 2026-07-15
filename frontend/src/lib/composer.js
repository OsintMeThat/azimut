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

export const BG = '#0d1117';
export const TEXT_MAIN = '#e8edf6';
export const TEXT_DIM = '#94a3b8';
export const TEXT_FAINT = '#64748b';

let idSeq = 0;
export function newId(prefix) {
  return `${prefix}${Date.now().toString(36)}${(idSeq++).toString(36)}`;
}

export const CAPTION_SIZE = 20; // default caption font size (px, editable per proof)
export const LEGEND_SIZE = 20; // default legend text size
export const FOOTER_SIZE = 15; // default footer / attribution text size

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
export function layoutPanels(panels, captionSize = CAPTION_SIZE, layout = 'grid') {
  return layout === 'free'
    ? layoutPanelsFree(panels, captionSize)
    : layoutPanelsGrid(panels, captionSize);
}

/**
 * Grid layout: each panel is laid out at PANEL_H × its own `scale`, so a row's
 * height is its tallest panel and the shorter panels are bottom-aligned so
 * their captions share one baseline.
 */
function layoutPanelsGrid(panels, captionSize = CAPTION_SIZE) {
  const rows = rowOrder(panels);
  const band = captionBand(captionSize);
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
      w += p.natural[0] * (ph / p.natural[1]) + (k ? GAP : 0);
    });
    rowWidth.set(r, w);
    rowHeight.set(r, h);
  }
  const contentW = rows.length ? Math.max(...rowWidth.values()) : 0;
  // cumulative top of each row (rows differ in height once panels are scaled)
  const rowTop = new Map();
  let cy = PAD;
  for (const r of rows) {
    rowTop.set(r, cy);
    cy += rowHeight.get(r) + band + ROW_GAP;
  }
  // running x cursor per row so array order stays left→right within a row
  const cursor = new Map(rows.map((r) => [r, PAD + (contentW - rowWidth.get(r)) / 2]));
  return panels.map((p) => {
    const r = p.row ?? 0;
    const ph = panelHeight(p);
    const scale = ph / p.natural[1];
    const baseScale = PANEL_H / p.natural[1];
    const w = p.natural[0] * scale;
    const y = rowTop.get(r) + (rowHeight.get(r) - ph); // bottom-align within row
    const box = { x: cursor.get(r), y, w, h: ph, scale, baseScale, row: r };
    cursor.set(r, cursor.get(r) + w + GAP);
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
export function layoutPanelsFree(panels, captionSize = CAPTION_SIZE) {
  if (!panels.length) return [];
  const grid = layoutPanelsGrid(panels, captionSize); // fallback positions
  const pos = panels.map((p, i) => ({
    x: p.x ?? grid[i].x,
    y: p.y ?? grid[i].y,
  }));
  const dx = PAD - Math.min(...pos.map((q) => q.x));
  const dy = PAD - Math.min(...pos.map((q) => q.y));
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
export function freeNormalizeDelta(panels, captionSize = CAPTION_SIZE) {
  if (!panels.length) return { dx: 0, dy: 0 };
  const grid = layoutPanelsGrid(panels, captionSize);
  const xs = panels.map((p, i) => p.x ?? grid[i].x);
  const ys = panels.map((p, i) => p.y ?? grid[i].y);
  return { dx: PAD - Math.min(...xs), dy: PAD - Math.min(...ys) };
}

/** Height of the stacked panel block (rows + their caption bands), no legend. */
export function panelsBlockHeight(panels, captionSize = CAPTION_SIZE) {
  const rows = rowOrder(panels);
  if (!rows.length) return 0;
  const band = captionBand(captionSize);
  let total = 0;
  for (const r of rows) {
    const inRow = panels.filter((p) => (p.row ?? 0) === r);
    total += Math.max(...inRow.map(panelHeight)) + band;
  }
  return total + (rows.length - 1) * ROW_GAP;
}

/**
 * Doc-space y where the panel block ends and the legend may start. Grid: PAD +
 * the stacked block (every row reserves its caption band). Free: the lowest
 * panel bottom, plus a caption band only under panels that actually carry one.
 */
export function panelsBottom(panels, captionSize = CAPTION_SIZE, layout = 'grid') {
  if (!panels.length) return PAD;
  if (layout !== 'free') return PAD + panelsBlockHeight(panels, captionSize);
  const boxes = layoutPanelsFree(panels, captionSize);
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

/** Decimal "lat, lon" (6 dp) for a {lat, lon}, or '' when null. */
export function formatCoords(c) {
  return c && c.lat != null && c.lon != null
    ? `${Number(c.lat).toFixed(6)}, ${Number(c.lon).toFixed(6)}`
    : '';
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
export function proofCoordsText(p) {
  const manual = p.coordsText?.trim();
  if (manual) return manual;
  return formatCoords(autoCoords(p.panels ?? []));
}

/** Effective source line for a proof/spec: manual override else auto. */
export function proofSource(p) {
  const manual = p.source?.trim();
  if (manual) return manual;
  return autoSource(p.panels ?? []);
}

/** How many columns the legend splits into for a given content width + count. */
export function legendColumns(width, count) {
  if (count <= 1) return 1;
  const fit = Math.floor((width - PAD * 2 + GAP) / (LEGEND_COL_MIN + GAP));
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
export function docSize(panels, shapes, notes = {}, text = {}, legendOrder = [], layout = 'grid') {
  const {
    captionSize = CAPTION_SIZE, legendSize = LEGEND_SIZE, footerSize = FOOTER_SIZE,
  } = text;
  const boxes = layoutPanels(panels, captionSize, layout);
  const width = boxes.length
    ? Math.max(...boxes.map((b) => b.x + b.w)) + PAD
    : 640;
  const contentW = Math.max(width, 640);
  const legend = legendLines(shapes, notes, legendOrder).filter((l) => l.text);
  const cols = legendColumns(contentW, legend.length);
  const legendRows = legendRowCount(legend.length, cols);
  const height =
    panelsBottom(panels, captionSize, layout) +
    (legend.length ? 10 + legendRows * legendLineHeight(legendSize) : 0) +
    footerBand(footerSize) + PAD;
  return { width: contentW, height, legend, cols };
}

/** Serializable spec from runtime state (drops live image objects). */
export function toSpec(proof) {
  return {
    azimut_proof: 1,
    title: proof.title,
    coords: autoCoords(proof.panels), // auto geo (first geo panel), for reference
    coordsText: proof.coordsText?.trim() ? proof.coordsText.trim() : null, // null → auto
    source: proof.source?.trim() ? proof.source.trim() : null, // null → auto (link only)
    captionSize: proof.captionSize ?? CAPTION_SIZE,
    legendSize: proof.legendSize ?? LEGEND_SIZE,
    footerSize: proof.footerSize ?? FOOTER_SIZE,
    footer: proof.footer?.trim() ? proof.footer.trim() : null, // null → default attribution line
    layout: proof.layout ?? 'grid', // 'grid' (rows) | 'free' (per-panel x/y, overlap allowed)
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

/**
 * Detached, plain deep copy of a shape spec (id stripped) for the clipboard.
 * A shape is pure JSON data, so a JSON round-trip both unwraps any reactive
 * proxy — `structuredClone` of a live proxy throws in the browser, and a shallow
 * spread leaves points-based line/arrow/curve with a proxied `points` array,
 * which silently broke copy for those kinds — and fully detaches the copy.
 */
export function copyShapeSpec(shape) {
  const clone = JSON.parse(JSON.stringify(shape));
  delete clone.id;
  return clone;
}

/**
 * Copy of a shape spec nudged by `d` doc-pixels down-right, for paste/duplicate.
 * Points-based kinds (line/arrow/curve) shift every vertex; box/ellipse/text
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
export function satPanelInput(s) {
  const parts = [`${s.provider_label} · ${s.lat.toFixed(6)}, ${s.lon.toFixed(6)}`];
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
 * Brute-forces the 2^(n-1) row-break combinations; n is tiny for real proofs.
 */
export function autoLayoutRows(
  panels, shapes = [], notes = {}, text = {}, target = TWEET_GUIDES['16:9'],
) {
  const n = panels.length;
  if (n <= 1) return panels.map(() => 0);
  let best = null;
  const combos = 1 << (n - 1); // one break-or-not bit between each adjacent pair
  for (let mask = 0; mask < combos; mask++) {
    let row = 0;
    const rows = [0];
    for (let i = 1; i < n; i++) {
      if (mask & (1 << (i - 1))) row += 1;
      rows.push(row);
    }
    const candidate = panels.map((p, i) => ({ ...p, row: rows[i], scale: 1 }));
    const { width, height } = docSize(candidate, shapes, notes, text);
    const score = Math.abs(width / height - target);
    if (!best || score < best.score) best = { score, rows };
  }
  return best.rows;
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}
