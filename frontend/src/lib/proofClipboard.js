/**
 * Geo Proof's copy and paste of marks: a picked group copied, then pasted in the
 * same proof, onto another picture, or into another proof.
 *
 * A copy holds the marks as they are stored, each still naming the surface it was
 * on, and for each of those surfaces the size of what it showed, so a mark can be
 * set down at the same place on another picture. It is kept in memory and written
 * to the system clipboard as a marked text (`{"azimut":"proof-shapes", …}`), which
 * is how Ctrl+V tells it from an image copied since, and how another tab reads it.
 *
 * Where a pasted mark lands:
 * - **A target**, a picture picked or under the pointer: every mark is set at the
 *   same place on it, measured from the picture's edges, and sized with it.
 * - **No target**: on the picture it was copied from while the proof holds it, else
 *   on the picture in the same place in this proof (panel 2 on panel 2), else on
 *   the first one.
 * - **Free marks** stay free, where they were on the page.
 * - **A line holding to two pictures** keeps holding while both are in the proof,
 *   and comes free where it stood otherwise.
 * - **The marks drawn over a copied inset** ride on the copy of that inset.
 *
 * A paste that would cover what it copies, or the paste before it, is stepped down
 * and right by `step` page pixels, once per paste. Numbered markers keep their
 * numbers: pasting 1, 2, 3 from a frame onto its satellite capture is the point.
 */
import { pageStepOnSurface } from './composer.js';
import { PAGE, linkPoints, nudgedLink } from './freeMarks.js';
import { turned } from './proofSurface.js';

/** The tag the system clipboard's text carries. */
export const CLIP_TAG = 'proof-shapes';
/** How many marks one copy holds at most, and how long its text may be. */
export const CLIP_MAX_SHAPES = 500;
export const CLIP_MAX_TEXT = 4_000_000;

const KINDS = new Set(['rect', 'ellipse', 'arrow', 'line', 'curve', 'freehand', 'text', 'callout', 'icon', 'number', 'blur', 'zoom', 'cone']);
/** Marks that only mean something on a picture's own pixels: never free, never on an inset. */
const PICTURE_ONLY = new Set(['blur', 'zoom', 'callout', 'cone']);

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const plain = (value) => JSON.parse(JSON.stringify(value));

/** What a surface's frame shows, in its own pixels: its cut's bounds, or its whole picture. */
export function shownRect(frame) {
  if (!frame.outline?.length) return { x: 0, y: 0, w: frame.image[0], h: frame.image[1] };
  const xs = frame.outline.map((p) => p.x);
  const ys = frame.outline.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * The marks drawn over the copied insets come along with them, so a picked inset
 * copies with what is drawn on it.
 */
function withRiders(shapes, ids) {
  const picked = new Set(ids);
  const insets = new Set(shapes.filter((s) => picked.has(s.id) && s.kind === 'zoom').map((s) => s.id));
  return shapes.filter((s) => picked.has(s.id) || insets.has(s.panel));
}

/**
 * A copy of the marks `ids`, in the proof's order. `surfaces` is the list the
 * composer hits against (insets, overlays, panels, published pictures, the page),
 * `frameOf` gives one's frame, and `docKey` names the proof open, so a paste knows
 * whether it is going back into the same one.
 */
export function makeCopy(shapes, ids, { surfaces, frameOf, docKey, id = `${Date.now()}` }) {
  const taken = withRiders(shapes ?? [], ids ?? []);
  if (!taken.length) return null;
  const from = {};
  const kinds = { inset: [], paste: [], panel: [], published: [] };
  for (const entry of surfaces ?? []) kinds[entry.kind]?.push(entry);
  for (const s of taken) {
    if (s.panel === PAGE || from[s.panel]) continue;
    const entry = (surfaces ?? []).find((x) => x.id === s.panel);
    const frame = entry && frameOf(entry.id);
    if (!frame) continue;
    from[s.panel] = { kind: entry.kind, index: kinds[entry.kind]?.indexOf(entry) ?? 0, image: [...frame.image], shown: shownRect(frame) };
  }
  // a line holding to pictures is copied where the page shows it, which is where it
  // comes free if those pictures are not there to hold to
  const copied = taken.map((s) => plain(s.ends ? { ...s, points: linkPoints(s, frameOf) } : s));
  return { azimut: CLIP_TAG, v: 1, id, docKey, shapes: copied, from };
}

/** A copy as the text the system clipboard holds. */
export const clipText = (copy) => JSON.stringify(copy);

const validRect = (r) => r && finite(r.x) && finite(r.y) && finite(r.w) && finite(r.h) && r.w > 0 && r.h > 0;

/** A mark from a copy, kept only when it is one this composer can draw. */
function validShape(s) {
  if (!s || typeof s !== 'object' || !KINDS.has(s.kind) || typeof s.panel !== 'string' || !s.panel) return false;
  if (Array.isArray(s.points)) return s.points.length >= 2 && s.points.length % 2 === 0 && s.points.every(finite);
  return finite(s.x) && finite(s.y);
}

/**
 * The copy a text holds, or null when it is not one: anything else on the system
 * clipboard, a copy from a newer format, or one past the limits. Marks it cannot
 * draw are left out.
 */
export function readClip(text) {
  if (typeof text !== 'string' || !text.startsWith('{') || text.length > CLIP_MAX_TEXT || !text.includes(CLIP_TAG)) return null;
  let copy;
  try {
    copy = JSON.parse(text);
  } catch {
    return null;
  }
  if (copy?.azimut !== CLIP_TAG || copy.v !== 1 || !Array.isArray(copy.shapes)) return null;
  const shapes = copy.shapes.slice(0, CLIP_MAX_SHAPES).filter(validShape);
  if (!shapes.length) return null;
  const from = {};
  for (const [id, info] of Object.entries(copy.from && typeof copy.from === 'object' ? copy.from : {})) {
    const image = Array.isArray(info?.image) && info.image.length === 2 && info.image.every((v) => finite(v) && v > 0) ? info.image : null;
    if (image && validRect(info.shown)) {
      from[id] = { kind: String(info.kind ?? 'panel'), index: Number.isInteger(info.index) ? info.index : 0, image, shown: info.shown };
    }
  }
  return { azimut: CLIP_TAG, v: 1, id: String(copy.id ?? ''), docKey: copy.docKey ?? null, shapes, from };
}

/** The point a mark is set down by: a box's middle, a polyline's mean, or its own point. */
function anchorOf(s) {
  if (Array.isArray(s.points)) {
    let x = 0;
    let y = 0;
    for (let i = 0; i < s.points.length; i += 2) {
      x += s.points[i];
      y += s.points[i + 1];
    }
    const n = s.points.length / 2;
    return { x: x / n, y: y / n };
  }
  if (s.kind === 'rect' || s.kind === 'blur' || s.kind === 'zoom') {
    const v = turned((s.w ?? 0) / 2, (s.h ?? 0) / 2, s.rotation ?? 0);
    return { x: s.x + v.x, y: s.y + v.y };
  }
  return { x: s.x, y: s.y };
}

/**
 * A mark set at the same place on another picture: its point at the same share of
 * what each picture shows, and its spans grown or shrunk by how much bigger the
 * one picture is than the other. Its ink is in page pixels and stays.
 * `from` and `to` are `{ shown }`, a picture's shown rectangle in its own pixels.
 */
export function acrossPictures(shape, from, to) {
  const a = from.shown;
  const b = to.shown;
  const k = Math.sqrt((b.w / a.w) * (b.h / a.h));
  const s = plain(shape);
  if (Array.isArray(s.points) && s.rotation) {
    // a turned polyline has its turn folded in, so each vertex is carried on its own
    const pts = [];
    for (let i = 0; i < s.points.length; i += 2) {
      const p = turned(s.points[i], s.points[i + 1], s.rotation);
      pts.push(p.x, p.y);
    }
    s.points = pts;
    s.rotation = 0;
  }
  const at = anchorOf(s);
  const to2 = { x: b.x + ((at.x - a.x) / a.w) * b.w, y: b.y + ((at.y - a.y) / a.h) * b.h };
  if (Array.isArray(s.points)) {
    s.points = s.points.map((v, i) => (i % 2 === 0 ? to2.x + (v - at.x) * k : to2.y + (v - at.y) * k));
    return s;
  }
  if (finite(s.w)) s.w *= k;
  if (finite(s.h)) s.h *= k;
  if (finite(s.reach)) s.reach *= k;
  if (s.kind === 'rect' || s.kind === 'blur' || s.kind === 'zoom') {
    const v = turned(s.w / 2, s.h / 2, s.rotation ?? 0);
    s.x = to2.x - v.x;
    s.y = to2.y - v.y;
  } else {
    s.x = to2.x;
    s.y = to2.y;
  }
  return s;
}

/** A mark moved by (`dx`, `dy`) of its surface's pixels. */
function offset(s, dx, dy) {
  if (!dx && !dy) return s;
  if (Array.isArray(s.points)) return { ...s, points: s.points.map((v, i) => v + (i % 2 === 0 ? dx : dy)) };
  return { ...s, x: s.x + dx, y: s.y + dy };
}

/**
 * The picture a mark goes on when the one it was copied from is not in this proof:
 * the one in the same place (panel 2 for panel 2, overlay 1 for overlay 1), else the
 * first panel, the first published picture or the first overlay.
 */
function counterpart(info, list) {
  const pictures = list.filter((x) => x.id !== PAGE);
  if (info) {
    const same = pictures.filter((x) => x.kind === info.kind);
    if (same[info.index]) return same[info.index];
  }
  return pictures.find((x) => x.kind === 'panel')
    ?? pictures.find((x) => x.kind === 'published')
    ?? pictures.find((x) => x.kind === 'paste')
    ?? null;
}

/**
 * The marks a paste of `copy` adds, with fresh ids, and where they went.
 *
 * `surfaces` is the composer's list (insets first, the page last) and `frameOf`
 * gives a surface's frame. `target` is the picture asked for, or null. `runs`
 * counts the pastes of this copy so far, by where they went, so each one steps on
 * from the one before: it is read and written here. `newId` makes an id.
 */
export function pasteShapes(copy, { surfaces, frameOf, target = null, docKey = null, runs = new Map(), newId, step = 26 }) {
  if (!copy?.shapes?.length) return [];
  const sameDoc = copy.docKey != null && copy.docKey === docKey;
  const has = new Set((surfaces ?? []).map((x) => x.id));
  const key = `${docKey}|${target ?? ''}`;
  const base = runs.get(key) ?? 0;
  runs.set(key, base + 1);
  // ids for every mark first, so the marks over a copied inset can ride on its copy
  const ids = new Map(copy.shapes.map((s) => [s.id, newId()]));
  const riding = new Set(copy.shapes.filter((s) => s.kind === 'zoom').map((s) => s.id));
  const targetEntry = target ? (surfaces ?? []).find((x) => x.id === target && x.id !== PAGE) ?? null : null;
  const out = [];
  for (const source of copy.shapes) {
    const fresh = ids.get(source.id) ?? newId();
    if (riding.has(source.panel)) {
      out.push({ ...plain(source), id: fresh, panel: ids.get(source.panel) });
      continue;
    }
    const placed = place(source, { copy, sameDoc, has, targetEntry, surfaces: surfaces ?? [], frameOf, ids });
    if (!placed) continue;
    const n = base + (placed.covers ? 1 : 0);
    let s = placed.shape;
    if (n) {
      if (s.ends) {
        s = { ...s, ...nudgedLink(s, n * step, n * step, frameOf) };
      } else {
        const frame = frameOf(s.panel);
        const by = frame ? pageStepOnSurface(n * step, n * step, frame) : { dx: n * step, dy: n * step };
        s = offset(s, by.dx, by.dy);
      }
    }
    out.push({ ...s, id: fresh });
  }
  return out;
}

/**
 * Where one copied mark goes, and whether it would cover what it was copied from
 * (`covers`): back on its own picture in the same proof, or free where it stood.
 */
function place(source, { copy, sameDoc, has, targetEntry, surfaces, frameOf, ids }) {
  const s = plain(source);
  delete s.id;
  if (s.ends) {
    // ties to a copied inset hold to its copy
    const ends = s.ends.map((tie) => (tie && ids.has(tie.panel) ? { ...tie, panel: ids.get(tie.panel) } : tie));
    const held = ends.every((tie) => !tie || has.has(tie.panel) || [...ids.values()].includes(tie.panel));
    if (held) return { shape: { ...s, ends }, covers: sameDoc };
    delete s.ends;
    return { shape: { ...s, panel: PAGE }, covers: sameDoc };
  }
  if (s.panel === PAGE) return { shape: s, covers: sameDoc };
  const pictureOnly = PICTURE_ONLY.has(s.kind);
  const fits = (entry) => entry && !(pictureOnly && entry.kind === 'inset');
  const info = copy.from[s.panel];
  const into = (entry) => {
    const frame = frameOf(entry.id);
    if (!frame) return null;
    if (entry.id === s.panel) return { shape: s, covers: sameDoc };
    if (!info) return null;
    return { shape: { ...acrossPictures(s, info, { shown: shownRect(frame) }), panel: entry.id }, covers: false };
  };
  if (fits(targetEntry)) return into(targetEntry);
  if (has.has(s.panel)) return into(surfaces.find((x) => x.id === s.panel));
  const other = counterpart(info, surfaces.filter((x) => !(pictureOnly && x.kind === 'inset')));
  return other ? into(other) : null;
}
