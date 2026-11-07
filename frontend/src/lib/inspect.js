/**
 * Pure helpers shared by the Examine tools, Inspect and Collage.
 *
 * Frames, their adjustments and collage layouts are plain data ("recipes") that
 * only become case media when an output is saved to the case. These turn slider
 * values into the live CSS preview and the backend op pipeline, name what a save
 * files, and handle the collage perspective math.
 */

// Order the adjust pipeline is applied in: the backend runs ops in the order sent.
// Grain is smoothed and levels set before the tone sliders, and one channel is
// picked before the picture loses its colour. A filed frame's signature is its op
// list, so the filters that came first keep their order among themselves.
export const ADJUST_ORDER = [
  'denoise', 'autolevels', 'clahe',
  'brightness', 'contrast', 'saturation', 'gamma', 'sharpness', 'rotate', 'channel', 'grayscale', 'invert',
];

/**
 * Starting points for the sliders, by the kind of picture. A preset sets its
 * sliders and puts the others back; every one stays the analyst's to move after.
 */
export const ADJUST_PRESETS = [
  { id: 'dark', label: 'Dark scene', values: { gamma: 1.8, clahe: 2, denoise: 6 } },
  { id: 'haze', label: 'Haze', values: { autolevels: 1, clahe: 1.5, contrast: 1.15, saturation: 1.15 } },
  { id: 'text', label: 'Text and plates', values: { grayscale: 1, contrast: 1.5, sharpness: 2.2, clahe: 1.2 } },
];

/** Slider values for a preset, over the filters this server offers. */
export function presetValues(filters, preset) {
  const out = adjustDefaults(filters);
  for (const [id, value] of Object.entries(preset.values)) if (id in out) out[id] = value;
  return out;
}

/** The preset the sliders stand at exactly, if any. */
export function activePreset(filters, values) {
  return ADJUST_PRESETS.find((p) => {
    const wanted = presetValues(filters, p);
    return filters.every((f) => (values?.[f.id] ?? defaultOf(f)) === wanted[f.id]);
  })?.id ?? null;
}

/**
 * Whether the picture has to come from the server to show as it will save: a
 * filter with no CSS twin (sharpness, gamma, local contrast…) is set.
 */
export function needsRender(filters, values) {
  return filters.some((f) => !f.css && !f.transform && (values?.[f.id] ?? defaultOf(f)) !== defaultOf(f));
}

/** The ops the server renders a frame's adjusted preview from: everything but the crop, which the viewer draws. */
export function previewOps(filters, frame) {
  return [
    ...(frame?.sourceOps ?? []),
    ...rotationOps(frame?.rotation),
    ...buildOps(filters, frame?.adjust),
  ];
}

let _seq = 0;
export const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}_${_seq++}`;

// -- naming what a save files ------------------------------------------------
// What the analyst types at Save to case becomes the media title *and* the stem
// of the file on disk, so these defaults have to read as names, not placeholders.

/**
 * The name a savable inherits from what it was made out of.
 *
 * `title` is what the analyst called that media and what the library shows, so it
 * comes first: a frame cut from "Convoy dashcam" should read as that, not as the
 * download's own `convoy_dashcam_20240612-181455.mp4`. The filename and the path
 * are fallbacks for media nobody has titled.
 */
export function sourceStem(source) {
  // A title is already a name, so it is taken whole: stripping a trailing
  // extension off free text would cut "Convoy no. 3" down to "Convoy no".
  const title = String(source?.title ?? '').trim();
  if (title) return title;
  const raw = source?.filename || source?.path || '';
  const base = String(raw).split(/[\\/]/).pop() ?? '';
  return base.replace(/\.[^.]+$/, '') || 'Capture';
}

/** Seconds → `hh-mm-ss`, safe in a filename and readable in a list. */
export function timecode(seconds) {
  const t = Math.max(0, Math.round(Number(seconds) || 0));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(t / 3600))}-${pad(Math.floor((t % 3600) / 60))}-${pad(t % 60)}`;
}

/** Where a frame sits in its video, as a player shows it: 1:04.5. */
export function clockTime(seconds) {
  const t = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
}

/**
 * A captured frame's default name, timecode first.
 *
 * The timecode leads because these files end up side by side in a folder, where
 * sorting by name should walk the video in playback order. Trailing it sorted
 * frames from several videos into interleaved blocks instead. An edited still has
 * no timecode, so it keeps the source name up front.
 */
export function frameSaveName(stem, time) {
  return time == null ? `${stem} (edited)` : `${timecode(time)} ${stem}`;
}

/**
 * Default names for every frame of a file, numbered only where they would collide.
 *
 * Naming by the second reads best, but two frames grabbed a few tenths apart
 * round to one name. Those get a counter, and only those, so the common one
 * frame per second stays clean. Inside a second the counter follows playback
 * order rather than the order the strip was filled in, which keeps a name sort
 * walking the video forward even when frames were taken back to front.
 */
export function frameSaveNames(frames) {
  const key = (f) => (f.time == null ? `edit ${f.stem}` : `${timecode(f.time)} ${f.stem}`);
  const groups = new Map();
  frames.forEach((f, i) => {
    const k = key(f);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(i);
  });
  const counter = frames.map(() => '');
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const byTime = [...members].sort((a, b) => (frames[a].time ?? 0) - (frames[b].time ?? 0));
    byTime.forEach((index, rank) => { counter[index] = ` ${rank + 1}`; });
  }
  return frames.map((f, i) => `${frameSaveName(f.stem, f.time)}${counter[i]}`);
}

/** The name an item is filed under: what stands in its field, else its default. */
export function saveNameOf(item, value) {
  return String(value ?? '').trim() || item.defaultName;
}

export function adjustDefaults(filters) {
  const out = {};
  for (const f of filters) out[f.id] = f.params[0]?.default ?? 0;
  return out;
}

// The video gear only exposes these css-filter ids; a frame captured from a
// tuned video inherits them so it looks like it came from the modified clip.
export const VIDEO_ADJUST_IDS = ['brightness', 'contrast', 'saturation', 'gamma', 'grayscale', 'invert'];

// Video orientation is deliberately discrete: right-angle turns keep the full
// frame and map directly to ffmpeg's geometry filters.
export const RIGHT_ANGLE_ROTATIONS = [-180, -90, 0, 90, 180];

export function normalizeRightAngleRotation(value) {
  const angle = Number(value);
  return RIGHT_ANGLE_ROTATIONS.includes(angle) ? angle : 0;
}

export function rotationOps(value) {
  const angle = normalizeRightAngleRotation(value);
  return angle ? [{ op: 'rotate', params: { angle } }] : [];
}

/** Seed a new frame's adjust values from the current video-gear values. */
export function videoSeed(filters, videoAdjust) {
  const out = adjustDefaults(filters);
  for (const id of VIDEO_ADJUST_IDS) {
    if (videoAdjust && id in videoAdjust) out[id] = videoAdjust[id];
  }
  return out;
}

const paramName = (f) => f.params[0]?.name ?? 'amount';
const defaultOf = (f) => f.params[0]?.default ?? 0;

/**
 * Where a range slider's thumb sits for a value, and the value for a thumb.
 *
 * Most sliders spread min..max evenly. A `centred` one (brightness, 0 to ×4) puts
 * its default mid-travel: the lower half runs evenly to it one step a notch, and
 * the upper half starts at that same pace and quickens towards max. So ×1.05 is
 * as easy to set as on the old 0–2 slider, ×2 sits at three quarters and ×4 at
 * the end. The value stays the real factor, rounded to the param's step; only the
 * thumb's position is curved.
 */
export function sliderTravel(p) {
  if (p?.travel !== 'centred') {
    return { min: p?.min, max: p?.max, step: p?.step, toValue: Number, toPosition: (v) => v };
  }
  const step = p.step || 0.01;
  const mid = p.default;
  const low = mid - p.min; // value run of the lower half
  const curve = p.max - mid - low; // what the upper half adds over an even run
  const half = Math.round(low / step); // notches per half
  const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  const snap = (v) => Number((Math.round(v / step) * step).toFixed(decimals));
  return {
    min: 0,
    max: 2 * half,
    step: 1,
    toValue(position) {
      const at = Math.min(2 * half, Math.max(0, Number(position) || 0));
      if (at <= half) return snap(p.min + (at / half) * low);
      const s = at / half - 1;
      return Math.min(p.max, snap(mid + low * s + curve * s * s));
    },
    toPosition(value) {
      const v = Math.min(p.max, Math.max(p.min, Number(value ?? mid)));
      if (v <= mid) return Math.round(((v - p.min) / low) * half);
      const s = curve ? (Math.sqrt(low * low + 4 * curve * (v - mid)) - low) / (2 * curve) : (v - mid) / low;
      return Math.round(half * (1 + s));
    },
  };
}

/** Build the live-preview CSS `filter` + `transform` strings from slider values. */
export function previewStyle(filters, values) {
  values = values ?? {};
  const pick = (getter) =>
    filters
      .filter(getter)
      .map((f) => getter(f).replaceAll('{v}', values[f.id] ?? defaultOf(f)))
      .join(' ');
  return {
    filter: pick((f) => f.css),
    transform: pick((f) => f.transform),
  };
}

export function isNeutral(filters, values) {
  values = values ?? {};
  return filters.every((f) => (values[f.id] ?? defaultOf(f)) === defaultOf(f));
}

export function hasVideoEdits(filters, values, rotation) {
  return normalizeRightAngleRotation(rotation) !== 0 || !isNeutral(filters, values);
}

/** Turn slider values (+ optional fractional crop) into the backend op pipeline. */
export function buildOps(filters, values, crop = null) {
  values = values ?? {};
  const ops = [];
  if (crop) ops.push({ op: 'crop', params: crop });
  for (const id of ADJUST_ORDER) {
    const f = filters.find((x) => x.id === id);
    if (!f || (values[id] ?? defaultOf(f)) === defaultOf(f)) continue;
    ops.push({ op: id, params: { [paramName(f)]: values[id] } });
  }
  return ops;
}

/** Build the full recipe for a captured frame, including its video orientation. */
export function buildFrameOps(filters, frame) {
  return [
    ...(frame?.sourceOps ?? []),
    ...rotationOps(frame?.rotation),
    ...buildOps(filters, frame?.adjust, frame?.crop),
  ];
}

/**
 * A collage piece's recipe stripped back to its unprojected pixels.
 *
 * Auto-stitch's panorama modes bake their warp into the piece as a `remap` op,
 * and that op is only valid for the pixels it was solved on: a cylinder is not a
 * pinhole view, so re-stitching a remapped piece would measure the wrong scene
 * and compound one projection onto the last. Every stitch therefore starts here.
 */
export function pinholeOps(save) {
  return (save?.ops ?? []).filter((o) => o.op !== 'remap');
}

// ---------------------------------------------------------------------------
// Collage perspective: map an image's box to a 4-point quad via a CSS matrix3d.
// Classic homography-from-4-corners (general 2D projection). The same quad is
// sent to the backend, which composites the full-res warp with PIL — so the
// on-screen preview and the saved image agree.
// ---------------------------------------------------------------------------

function adj(m) {
  return [
    m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
  ];
}

function mul(a, b) {
  const c = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      c[3 * i + j] = a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j];
  return c;
}

function mulV(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function basisToPoints(p) {
  const m = [p[0][0], p[1][0], p[2][0], p[0][1], p[1][1], p[2][1], 1, 1, 1];
  const v = mulV(adj(m), [p[3][0], p[3][1], 1]);
  return mul(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
}

/**
 * CSS `matrix3d(...)` mapping the box (0,0)-(w,h) onto `quad`
 * (4 points: TL, TR, BR, BL, in the same pixel space as the element's parent).
 */
export function quadMatrix3d(w, h, quad) {
  const src = [[0, 0], [w, 0], [w, h], [0, h]];
  let H = mul(basisToPoints(quad), adj(basisToPoints(src)));
  H = H.map((x) => x / H[8]);
  const t = [
    H[0], H[3], 0, H[6],
    H[1], H[4], 0, H[7],
    0, 0, 1, 0,
    H[2], H[5], 0, H[8],
  ];
  return `matrix3d(${t.join(',')})`;
}

const _UNIT = [[0, 0], [1, 0], [1, 1], [0, 1]];

/**
 * Map points given in the piece's own unit square (u,v in 0..1, TL origin)
 * to canvas points, through the projective transform defined by `quad`
 * (TL, TR, BR, BL). Lets us reshape a piece's quad when a crop changes which
 * sub-rectangle of the source it shows.
 */
export function quadMapUnit(quad, pts) {
  const H = mul(basisToPoints(quad), adj(basisToPoints(_UNIT)));
  return pts.map(([u, v]) => {
    const p = mulV(H, [u, v, 1]);
    return [p[0] / p[2], p[1] / p[2]];
  });
}

/**
 * Where a canvas point falls in a piece's own unit square (u,v, TL origin): the
 * inverse of `quadMapUnit`. A point off the piece lands outside 0..1, and a point
 * past its horizon, where the warp folds over, answers null.
 */
export function quadUnitAt(quad, [x, y]) {
  const H = mul(basisToPoints(quad), adj(basisToPoints(_UNIT)));
  const p = mulV(adj(H), [x, y, 1]);
  if (!p[2] || !Number.isFinite(p[2])) return null;
  return [p[0] / p[2], p[1] / p[2]];
}

/**
 * The view that shows the pieces whole, `pad` screen pixels from the pane's edges:
 * `{ zoom, x, y }` as the canvas reads it, `zoom` 1 being the canvas fitted in the
 * pane. No piece, or no pane yet, is the canvas fitted.
 */
export function fitView(quads, pane, canvas, pad = 28) {
  const box = quadsBounds(quads ?? []);
  const fit = Math.min(pane.width / canvas.width, pane.height / canvas.height, 1) || 1;
  if (!box || !(pane.width > 0) || !(pane.height > 0)) return { zoom: 1, x: 0, y: 0 };
  const room = (side, size) => Math.max(1, side - 2 * pad) / Math.max(size, 1);
  const wanted = Math.min(room(pane.width, box.width), room(pane.height, box.height));
  const zoom = Math.min(8, Math.max(0.2, wanted / fit));
  const scale = fit * zoom;
  return {
    zoom,
    x: (pane.width - box.width * scale) / 2 - box.minX * scale,
    y: (pane.height - box.height * scale) / 2 - box.minY * scale,
  };
}

/**
 * New quad for a piece that now shows only the fractional sub-rectangle
 * `rect` ({x,y,w,h} in 0..1) of what `quad` currently shows. Preserves the
 * warp and keeps the piece in place, with the right proportions for the region.
 */
export function quadFromCropRect(quad, rect) {
  const { x, y, w, h } = rect;
  return quadMapUnit(quad, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]);
}

/**
 * Non-destructive CSS crop: inline styles for an absolutely-positioned <img>
 * inside an `overflow:hidden` wrapper, so the crop rect fills the wrapper. Lets
 * the live blob preview + thumbnails *show* a fractional crop with no re-render.
 */
export function cropImgStyle(crop) {
  if (!crop) return {};
  return {
    position: 'absolute',
    width: `${100 / crop.w}%`,
    height: `${100 / crop.h}%`,
    left: `${(-crop.x / crop.w) * 100}%`,
    top: `${(-crop.y / crop.h) * 100}%`,
    'max-width': 'none',
    'max-height': 'none',
  };
}

/** Join a `{prop: value}` style object into an inline `style=""` string. */
export function styleText(obj) {
  return Object.entries(obj ?? {})
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
}

/** Aspect ratio (w/h) of a crop rect over an image of natural size natW×natH. */
export function cropAspect(crop, natW, natH) {
  if (!crop || !natW || !natH) return null;
  return (crop.w * natW) / (crop.h * natH);
}

// ---------------------------------------------------------------------------
// Editable crop box: a fractional {x,y,w,h} (0..1) resized by dragging its 8
// handles (4 corners + 4 edges) or moved by its body, with an optional aspect
// lock. All pure so the same math backs the Frame overlay and the piece modal.
// ---------------------------------------------------------------------------

/** Clamp a fractional crop so it stays inside [0,1] and never smaller than `min`. */
export function clampCrop(c, min = 0.02) {
  const w = Math.max(min, Math.min(1, c.w));
  const h = Math.max(min, Math.min(1, c.h));
  const x = Math.min(Math.max(0, c.x), 1 - w);
  const y = Math.min(Math.max(0, c.y), 1 - h);
  return { x, y, w, h };
}

/** Translate a crop by a fractional delta, clamped inside the image. */
export function moveCrop(c, dx, dy) {
  const w = c.w;
  const h = c.h;
  return {
    x: Math.min(Math.max(0, c.x + dx), 1 - w),
    y: Math.min(Math.max(0, c.y + dy), 1 - h),
    w,
    h,
  };
}

// Handle → which edges it drives. l/r/t/b flags mean that edge follows the pointer.
const HANDLE_EDGES = {
  nw: { l: true, t: true }, n: { t: true }, ne: { r: true, t: true },
  e: { r: true }, se: { r: true, b: true }, s: { b: true },
  sw: { l: true, b: true }, w: { l: true },
};

/**
 * New crop after dragging `handle` (one of nw/n/ne/e/se/s/sw/w) to the pointer
 * fraction (px, py). With `fracAspect` (w/h in *fractional* units) the box keeps
 * that ratio: corners grow from the opposite corner, edges grow about the centre
 * of the fixed edge. Result is clamped inside the image.
 */
export function resizeCropByHandle(crop, handle, px, py, fracAspect = null, min = 0.02) {
  const e = HANDLE_EDGES[handle];
  if (!e) return clampCrop(crop, min);
  let left = crop.x;
  let top = crop.y;
  let right = crop.x + crop.w;
  let bottom = crop.y + crop.h;
  if (e.l) left = Math.min(px, right - min);
  if (e.r) right = Math.max(px, left + min);
  if (e.t) top = Math.min(py, bottom - min);
  if (e.b) bottom = Math.max(py, top + min);

  let x = left;
  let y = top;
  let w = right - left;
  let h = bottom - top;

  if (fracAspect) {
    const corner = (e.l || e.r) && (e.t || e.b);
    if (corner) {
      // corner: drive by width, derive height, keep the opposite corner fixed
      h = w / fracAspect;
      if (e.t) y = bottom - h;
    } else if (e.l || e.r) {
      // vertical edge: width drives, expand height about the fixed edge's centre
      const cy = crop.y + crop.h / 2;
      h = w / fracAspect;
      y = cy - h / 2;
    } else {
      // horizontal edge: height drives, expand width about the fixed edge's centre
      const cx = crop.x + crop.w / 2;
      w = h * fracAspect;
      x = cx - w / 2;
    }
  }
  return clampCrop({ x, y, w, h }, min);
}

// ---------------------------------------------------------------------------
// Collage piece edges: side handles that resize a (possibly warped) quad by
// sliding one edge along its outward normal, leaving the opposite edge fixed.
// Corners stay free-warp handles; sides are a pure, warp-preserving resize.
// ---------------------------------------------------------------------------

/** Corner index pairs for the four quad edges: top, right, bottom, left. */
export const QUAD_SIDES = [[0, 1], [1, 2], [2, 3], [3, 0]];

/** Midpoints of the four quad edges, tagged with their side index. */
export function quadEdgeMidpoints(quad) {
  return QUAD_SIDES.map(([a, b], side) => ({
    side,
    x: (quad[a][0] + quad[b][0]) / 2,
    y: (quad[a][1] + quad[b][1]) / 2,
  }));
}

/** Centroid (mean of the 4 corners) of a quad. */
export function quadCentroid(quad) {
  const cx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4;
  const cy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
  return [cx, cy];
}

/**
 * Uniformly scale a quad by `k` around a fixed point (its centroid by default).
 * Warp shape is preserved — this is the collage "resize" that composes with the
 * per-corner warp, since both just move the same 4 points.
 */
export function scaleQuad(quad, k, center = null) {
  const [cx, cy] = center ?? quadCentroid(quad);
  return quad.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
}

/**
 * Tight bounding box over every node's quad (+ optional padding). Used to trim
 * a transparent-PNG collage to just its pieces on export, so the canvas size
 * follows the layout instead of being set by hand.
 */
export function collageBounds(nodes, pad = 0) {
  const xs = [];
  const ys = [];
  for (const n of nodes) for (const [x, y] of n.quad) { xs.push(x); ys.push(y); }
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  return {
    minX,
    minY,
    width: Math.max(1, Math.round(Math.max(...xs) + pad - minX)),
    height: Math.max(1, Math.round(Math.max(...ys) + pad - minY)),
  };
}

/** Rotate a quad by `rad` radians around a fixed point (its centroid by default). */
export function rotateQuad(quad, rad, center = null) {
  const [cx, cy] = center ?? quadCentroid(quad);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return quad.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  });
}

// ---------------------------------------------------------------------------
// Group transforms — the multi-select block. Each is the single-quad primitive
// mapped over every quad with one *shared* pivot, which is what makes the block
// move/turn/grow as one rigid unit instead of each piece spinning about its own
// centroid. Callers must pass the quads captured at gesture start and derive the
// pivot once from those: re-deriving it mid-drag would chase the block's own
// bounding box and drift it away under the pointer.
// ---------------------------------------------------------------------------

/**
 * Axis-aligned bounds over several quads, plus their shared centre — the frame
 * drawn around a multi-piece selection and the pivot its rotate/scale turn
 * about. Unrounded, unlike collageBounds (which sizes an export in whole
 * pixels). Returns null for an empty selection.
 */
export function quadsBounds(quads) {
  if (!quads.length) return null;
  const xs = [];
  const ys = [];
  for (const q of quads) for (const [x, y] of q) { xs.push(x); ys.push(y); }
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    center: [(minX + maxX) / 2, (minY + maxY) / 2],
  };
}

/** Translate a single quad by (dx, dy). */
export function translateQuad(quad, dx, dy) {
  return quad.map(([x, y]) => [x + dx, y + dy]);
}

/** Move a group of quads by (dx, dy). */
export function moveQuads(quads, dx, dy) {
  return quads.map((q) => translateQuad(q, dx, dy));
}

/** Rotate a group of quads around a shared pivot (default: the group centre). */
export function rotateQuads(quads, rad, center = null) {
  const c = center ?? quadsBounds(quads)?.center;
  if (!c) return [];
  return quads.map((q) => rotateQuad(q, rad, c));
}

/** Uniformly scale a group of quads around a shared pivot (default: group centre). */
export function scaleQuads(quads, k, center = null) {
  const c = center ?? quadsBounds(quads)?.center;
  if (!c) return [];
  return quads.map((q) => scaleQuad(q, k, c));
}

// A collage canvas is only where the pieces are worked: a piece is added at
// whatever fits it (`initialQuad`) and auto-stitch grows it to hold its answer. The
// export does not follow it (`exportFrame`), and neither side ever passes the bounds
// the compose route accepts (`api/inspect.ComposeIn`).
export const COLLAGE_MIN_DIM = 16;
export const COLLAGE_MAX_DIM = 8192;
export const COLLAGE_DEFAULT_SIZE = { width: 1600, height: 800 };
/** The most pixels an export holds, so a wide panorama stays within a laptop's memory. */
export const COLLAGE_MAX_EXPORT_PIXELS = 40_000_000;

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/**
 * The pieces' bounds within a collage's cut (lib/collageCut.js), as `collageBounds`
 * gives them: what its picture shows. Null when the frame holds none of the pieces.
 */
export function cutBounds(nodes, clip) {
  const b = quadsBounds(nodes.map((n) => n.quad));
  if (!b) return null;
  const minX = Math.max(b.minX, clip.x);
  const minY = Math.max(b.minY, clip.y);
  const width = Math.min(b.maxX, clip.x + clip.w) - minX;
  const height = Math.min(b.maxY, clip.y + clip.h) - minY;
  if (!(width > 0 && height > 0)) return null;
  return { minX, minY, width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

/**
 * The size a collage exports at: its pieces' bounds, cut to its frame when it has
 * one (`clip`), enlarged until the sharpest piece is back at its own pixels, so what
 * was placed small on the canvas does not come out small. Held under
 * `COLLAGE_MAX_DIM` a side and `COLLAGE_MAX_EXPORT_PIXELS` in all; `capped` says the
 * limit, not the pieces, set the size. Null when the frame holds none of the pieces.
 */
export function exportFrame(nodes, clip = null) {
  const b = clip ? cutBounds(nodes, clip) : collageBounds(nodes);
  if (!b) return null;
  let wanted = 1;
  for (const n of nodes) {
    const [p0, p1, p2, p3] = n.quad;
    const across = (dist(p0, p1) + dist(p3, p2)) / 2;
    const down = (dist(p0, p3) + dist(p1, p2)) / 2;
    if (n.w > 0 && across > 0) wanted = Math.max(wanted, n.w / across);
    if (n.h > 0 && down > 0) wanted = Math.max(wanted, n.h / down);
  }
  const limit = Math.min(
    COLLAGE_MAX_DIM / b.width,
    COLLAGE_MAX_DIM / b.height,
    Math.sqrt(COLLAGE_MAX_EXPORT_PIXELS / (b.width * b.height)),
  );
  const scale = Math.min(wanted, limit);
  const side = (v) => Math.min(COLLAGE_MAX_DIM, Math.max(COLLAGE_MIN_DIM, Math.round(v * scale)));
  return {
    minX: b.minX,
    minY: b.minY,
    scale,
    width: side(b.width),
    height: side(b.height),
    capped: wanted > limit,
  };
}

/** A new, empty collage — one spelling, used wherever one is created. */
export function newCollage(name) {
  return {
    id: uid('cl'),
    name,
    ...COLLAGE_DEFAULT_SIZE,
    background: '#12141c',
    transparent: true,
    nodes: [],
  };
}

/**
 * A collage side, held inside the bounds the compose route accepts.
 *
 * An empty field is nothing said, not zero: `Number('')` is 0, and clamping that
 * would answer a cleared box by collapsing the canvas to its floor.
 */
export function clampCollageDim(value, fallback) {
  const typed = String(value ?? '').trim();
  const n = Math.round(Number(typed));
  if (!typed || !Number.isFinite(n)) return fallback;
  return Math.min(COLLAGE_MAX_DIM, Math.max(COLLAGE_MIN_DIM, n));
}

/**
 * The canvas an auto-stitch answer asks for, and the factor that carries a piece
 * it could not place into it.
 *
 * The solver works in source pixels and answers with the canvas that holds its
 * layout at full detail, so the canvas follows the stitch rather than the stitch
 * being squeezed into the canvas — that squeeze is a downscale of the very detail
 * the pieces were stitched for. `scale` is the smaller of the two ratios, so an
 * unplaced piece grows with the canvas without changing shape.
 */
export function stitchCanvas(canvas, current) {
  const width = clampCollageDim(canvas?.width, current.width);
  const height = clampCollageDim(canvas?.height, current.height);
  return { width, height, scale: Math.min(width / current.width, height / current.height) };
}

/** How deep a piece is followed through pictures composed from other pieces, as the server does. */
const COMPOSED_DEPTH = 3;

/**
 * The one video a collage is cut from, and the stretch of it its pieces span:
 * `{ path, from, to, times }` in seconds, the times sorted, or null when a piece is
 * a picture of its own or comes from another file. A piece is the video at an
 * instant, or a picture `origin(path)` reads back: a frame saved from the video,
 * `{ video, time }`, or a picture composed from pieces of its own, `{ pieces: [{ path,
 * time }] }`, such as a straightened collage, which stands for those pieces
 * (`engine/scenes.collage_video`). A single instant reads `from === to`.
 */
export function collageVideo(nodes, origin = () => null) {
  if (!nodes?.length) return null;
  const found = piecesVideo(nodes.map((n) => n.save), origin, 0);
  if (!found) return null;
  const times = found.times.sort((a, b) => a - b);
  return { path: found.path, from: times[0], to: times[times.length - 1], times };
}

function piecesVideo(pieces, origin, depth) {
  let path = null;
  const times = [];
  const take = (video, time) => {
    if (!video || !Number.isFinite(time) || (path && video !== path)) return false;
    path = video;
    times.push(time);
    return true;
  };
  for (const piece of pieces) {
    if (piece?.time != null) {
      if (!take(piece.path, Number(piece.time))) return null;
      continue;
    }
    const at = origin(piece?.path);
    if (at?.pieces) {
      const inner = depth < COMPOSED_DEPTH && at.pieces.length ? piecesVideo(at.pieces, origin, depth + 1) : null;
      if (!inner || !inner.times.every((time) => take(inner.path, time))) return null;
    } else if (!take(at?.video, Number(at?.time))) {
      return null;
    }
  }
  return path ? { path, times } : null;
}

/**
 * What a case file says it was made from, for `collageVideo`: a frame Inspect saved
 * from a video, `{ video, time }`, or a picture composed from pieces (a collage's
 * export, a straightened collage), `{ pieces }`. Anything else answers null.
 */
export function mediaOrigin(item) {
  const src = item?.source;
  if (src?.type !== 'inspect') return null;
  if (src.op === 'frame' && typeof src.from === 'string' && Number.isFinite(src.time)) {
    return { video: src.from, time: src.time };
  }
  if (src.op === 'collage' && Array.isArray(src.sources) && Array.isArray(src.times) && src.sources.length === src.times.length) {
    return { pieces: src.sources.map((path, i) => ({ path, time: src.times[i] ?? null })) };
  }
  return null;
}

/** A sensible starting quad: the image scaled to fit `maxW`, placed at (ox, oy). */
export function initialQuad(natW, natH, maxW, ox, oy) {
  const scale = Math.min(1, maxW / (natW || maxW));
  const w = Math.round((natW || maxW) * scale);
  const h = Math.round((natH || maxW) * scale);
  return [
    [ox, oy],
    [ox + w, oy],
    [ox + w, oy + h],
    [ox, oy + h],
  ];
}
