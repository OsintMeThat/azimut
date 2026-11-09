/**
 * Compare's annotations, pinned to the ground.
 *
 * A mark stores `[lon, lat]` points, so it follows the imagery through a pan,
 * a zoom or a turn and lands on the same spot of both maps. `side` says which
 * picture it belongs to: a "before" note on A, a new building outlined on B, or
 * an arrow at a spot on both. Screen positions are derived on demand through a
 * projection the caller supplies (the live map, or an export frame).
 *
 * Rectangles and ellipses are shapes on the ground: two opposite corners, and
 * as `angle` the compass direction that was up on the screen they were drawn
 * on (`groundFrame`'s bearing, not the app's clockwise turn), so a box drawn on a
 * turned map runs along that screen and turns with the ground after. Turning a
 * mark turns its points about its centre, and a box's angle with them.
 * Measures and polygons read their length and area off the ground, not the
 * screen.
 *
 * A symbol names anything the Proof Maker can stamp (`lib/icons/catalog.js`): one
 * of its eleven stamps, a layer badge's flat glyph, or a vehicle model. A model
 * is seen from above, as the map is, and its `angle` is where its nose points on
 * the compass: the same field a box keeps its own up in, so turning one is the
 * turn every other mark already has.
 */

import { formatArea, formatDistance, haversine, polygonArea } from '../measure.js';
import {
  boxCorners, boxPoint, compassAngle, fromMercator, toMercator, turnAbout, turnedBox,
} from './groundFrame.js';
import {
  ICON_BOX, PROOF_ICONS, glyphInk, iconByName, iconOrigin, stampByName, stampParts,
} from '../proofIcons.js';
import { isModel, isStampable } from '../icons/catalog.js';
import { loadModels, modelsNow } from '../icons/loadModels.svelte.js';
import { modelHalo, modelLine } from '../proofModelNode.js';
import { glyphOps } from '../proofStamp.js';

export const ANNOTATION_COLOURS = Object.freeze([
  '#f6a81a', '#22c55e', '#ef4444', '#38bdf8', '#e879f9', '#f4f5f6', '#111827',
]);

/** Each tool: how its points are collected, and what it draws. */
export const ANNOTATION_TOOLS = Object.freeze([
  { id: 'select', icon: 'cursor', label: 'Select and move', shortcut: 'V' },
  { id: 'arrow', icon: 'arrow', label: 'Arrow', shortcut: 'A', points: 2 },
  { id: 'rect', icon: 'square', label: 'Box', shortcut: 'R', points: 2, fill: true },
  { id: 'ellipse', icon: 'circle', label: 'Ellipse', shortcut: 'E', points: 2, fill: true },
  { id: 'polygon', icon: 'polygon', label: 'Area', shortcut: 'P', points: 'many', fill: true },
  { id: 'measure', icon: 'ruler', label: 'Measure', shortcut: 'M', points: 2 },
  { id: 'line', icon: 'line', label: 'Line', shortcut: 'L', points: 2 },
  { id: 'freehand', icon: 'freehand', label: 'Freehand', shortcut: 'D', points: 'drag' },
  { id: 'text', icon: 'text', label: 'Note', shortcut: 'T', points: 1 },
  // The two the Proof Maker stamps, on the ground instead of on a panel: one
  // press each, and the tool stays in hand because numbering four things or
  // marking six vehicles is one act rather than four or six.
  { id: 'number', icon: 'numbered', label: 'Numbered marker', shortcut: 'N', points: 1, stamp: true },
  { id: 'icon', icon: 'pin', label: 'Symbol', shortcut: 'S', points: 1, stamp: true },
]);

/** The kinds stamped whole with one press, rather than dragged out. */
export const STAMPED = new Set(ANNOTATION_TOOLS.filter((tool) => tool.stamp).map((tool) => tool.id));

const KINDS = new Set(ANNOTATION_TOOLS.filter((tool) => tool.points).map((tool) => tool.id));
const LIMITS = {
  text: [1, 1], arrow: [2, 2], line: [2, 2], measure: [2, 2], rect: [2, 2], ellipse: [2, 2],
  freehand: [2, 400], polygon: [3, 200], number: [1, 1], icon: [1, 1],
};

export const canFill = (kind) => kind === 'rect' || kind === 'ellipse' || kind === 'polygon';

/** The kinds whose sides follow an angle rather than the points alone. */
export const ANGLED = new Set(['rect', 'ellipse']);

/** The kinds a turn means anything to: one point turns about itself. */
export const TURNABLE = new Set(['arrow', 'line', 'measure', 'rect', 'ellipse', 'polygon', 'freehand']);

/** A symbol that is a vehicle model, which has a nose and so a heading. */
export const isModelMark = (mark) => mark?.kind === 'icon' && isModel(mark.glyph);

/** Whether a mark can be turned: a shape about its centre, or a model on its point. */
export const canTurn = (mark) => TURNABLE.has(mark?.kind) || isModelMark(mark);

/** Whether a mark keeps an angle of its own: a box's up, or a model's nose. */
const keepsAngle = (mark) => ANGLED.has(mark?.kind) || isModelMark(mark);

const bounded = (value, fallback, min, max) => {
  const number = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback));
};

function groundPoint(raw) {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const lon = Number(raw[0]);
  const lat = Number(raw[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return [lon, lat];
}

/** The marks a session can hold, cleaned; anything the server would refuse is dropped. */
export function comparisonAnnotations(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw, index) => {
    if (!KINDS.has(raw?.kind) || !Array.isArray(raw.points)) return [];
    const points = raw.points.map(groundPoint);
    const [low, high] = LIMITS[raw.kind];
    if (points.some((point) => !point) || points.length < low) return [];
    const text = String(raw.text ?? '').trim().slice(0, 240);
    if (raw.kind === 'text' && !text) return [];
    return [{
      id: String(raw.id || `mark-${index + 1}`).slice(0, 80),
      kind: raw.kind,
      side: raw.side === 'a' || raw.side === 'b' ? raw.side : 'both',
      colour: /^#[0-9a-f]{6}$/i.test(String(raw.colour ?? ''))
        ? String(raw.colour).toLowerCase()
        : ANNOTATION_COLOURS[0],
      points: points.slice(0, high),
      stroke_width: Math.round(bounded(raw.stroke_width, 3, 1, 24)),
      fill_opacity: canFill(raw.kind) ? bounded(raw.fill_opacity, 0, 0, 1) : 0,
      font_size: Math.round(bounded(raw.font_size, 16, 8, 72)),
      text,
      // What a stamp carries: its number, or the glyph it draws. A glyph this
      // build does not know is drawn as the first one rather than as nothing,
      // so a comparison made on a newer version still shows a mark there.
      number: Math.round(bounded(raw.number, 1, 1, 999)),
      glyph: isStampable(raw.glyph) ? String(raw.glyph) : PROOF_ICONS[0].name,
      angle: keepsAngle(raw) ? compassAngle(raw.angle) : 0,
    }];
  });
}

/** Whether a mark is drawn on the picture of one side. */
export const onSide = (mark, letter) => mark.side === 'both' || mark.side === letter;

/**
 * How wide a stamped mark is drawn, in screen pixels.
 *
 * Its own size number, which is the one the rail's slider sets — a stamp has no
 * stroke to widen and no ground extent to read, so the control that sizes a
 * note's letters sizes these.
 */
export const markSize = (mark) => Math.max(12, Math.round((mark.font_size ?? 16) * 1.8));

/** The ink a numeral takes over a disc of the mark's own colour: it has to be
 *  read over whatever the disc is standing on. */
export const stampInk = (mark) => glyphInk(mark.colour, 1);

/**
 * Where a symbol's 24-unit box lands on screen, given the point it is pinned to.
 *
 * The glyph keeps the point it names rather than the corner it occupies, the way
 * the Proof Maker's does, so a pin's tip is on the ground it was put on.
 */
export function glyphBox(mark, [x, y], scale = 1) {
  const size = markSize(mark) * scale;
  const origin = iconOrigin(markGlyph(mark).name, size);
  return { x: x + origin.x, y: y + origin.y, size, scale: size / ICON_BOX };
}

/** The symbol a mark draws, always one this build knows: an unknown name draws the pin. */
export const markGlyph = (mark) => iconByName(mark.glyph) ?? PROOF_ICONS[0];

/**
 * What a flat symbol is drawn from, in its box's units, bottom first: each part a
 * path `d` with a `fill` (under `rule`), maybe a `stroke` of `width`, maybe turned
 * by `rotate` degrees about the box's middle.
 *
 * One of the eleven stamps is drawn as a proof stamps it (`stampParts`): its halo,
 * its silhouette and its carved details, the stroke width as its weight. A layer
 * badge's glyph is drawn as a proof draws one (`glyphOps`), in its own weight.
 * Either way the size is the one seen on screen, so an export keeps the halo the
 * screen showed. A model has no flat parts.
 */
export function glyphParts(mark) {
  const { name } = markGlyph(mark);
  if (stampByName(name)) {
    return stampParts(name, { color: mark.colour, strokeWidth: mark.stroke_width, size: markSize(mark) })
      .map((part) => ({ ...part, rule: 'evenodd' }));
  }
  return glyphOps(name, { color: mark.colour, size: markSize(mark) }).map((op) => ({ ...op, rule: 'nonzero' }));
}

/** How far along its heading a model is looked at to find where its nose points on screen, in ground metres. */
const NOSE_REACH = 10;

/**
 * Where a model's nose points on a picture, in degrees clockwise from the
 * picture's up, read through the same projection that places it: a map turned
 * under it turns it, and a framed export turned upright does too.
 */
export function screenHeading(mark, project) {
  const [lon, lat] = mark.points[0];
  const [x, y] = toMercator(lon, lat);
  const turn = ((mark.angle ?? 0) * Math.PI) / 180;
  const from = project([lon, lat]);
  const to = project(fromMercator(x + Math.sin(turn) * NOSE_REACH, y + Math.cos(turn) * NOSE_REACH));
  return compassAngle((Math.atan2(to[0] - from[0], from[1] - to[1]) * 180) / Math.PI);
}

/**
 * How a model is painted at `heading` on a picture `scale` times the screen: from
 * above, its length the mark's size, outlined and haloed by the Proof Maker's
 * rule for a stamp that size, so it holds over imagery the way a proof's does.
 */
export function modelLook(mark, heading, scale = 1) {
  const size = markSize(mark);
  return {
    px: size * scale, fit: 'length', heading, tilt: 0, colour: mark.colour, mode: 'tone',
    line: modelLine(size) * scale, halo: modelHalo(size) * scale,
  };
}

/** The SVG of each model look drawn so far, the last few kept: a pan redraws none. */
const DRAWN = new Map();
const DRAWN_CAP = 96;

/**
 * A model mark as an SVG `markSize` wide, its middle at the box's, or '' while the
 * models have not landed (they load when a comparison names one, `marksReady`).
 */
export function modelMarkup(mark, heading) {
  const engine = modelsNow();
  const model = engine?.modelById(mark.glyph);
  if (!model) return '';
  const look = modelLook(mark, heading);
  const key = `${mark.glyph}|${Math.round(heading) % 360}|${look.px}|${mark.colour}`;
  let svg = DRAWN.get(key);
  if (svg === undefined) {
    svg = engine.modelSvg(model, look);
    DRAWN.set(key, svg);
    if (DRAWN.size > DRAWN_CAP) DRAWN.delete(DRAWN.keys().next().value);
  }
  return svg;
}

/**
 * Settles once everything the marks need to be drawn has landed: the models'
 * module when one of them is a model, nothing otherwise. An export awaits it, since
 * it draws its picture in one go.
 */
export const marksReady = (marks) => ((marks ?? []).some(isModelMark) ? loadModels() : Promise.resolve());

/**
 * The first number no marker of this colour holds.
 *
 * Counted per colour, as the Proof Maker counts them: colour is what says "same
 * feature" on both surfaces, so a second colour is a second series and starts
 * back at 1. A gap left by a deleted marker is refilled.
 */
export function nextMarkNumber(marks, colour) {
  const taken = new Set(
    (marks ?? [])
      .filter((mark) => mark.kind === 'number' && mark.colour === colour)
      .map((mark) => Number(mark.number))
      .filter(Number.isFinite)
  );
  let n = 1;
  while (taken.has(n)) n += 1;
  return n;
}

const asLatLon = ([lon, lat]) => ({ lat, lon });

/** An ellipse inscribed in the ground box of two corners, as a ring of ground points. */
export function ellipseRing([first, second], steps = 48, angle = 0) {
  if (angle) {
    const box = turnedBox([first, second], angle);
    return Array.from({ length: steps }, (_, step) => {
      const turn = (step / steps) * Math.PI * 2;
      return boxPoint(box, Math.cos(turn) / 2, Math.sin(turn) / 2);
    });
  }
  const centreLon = (first[0] + second[0]) / 2;
  const centreLat = (first[1] + second[1]) / 2;
  const radiusLon = Math.abs(second[0] - first[0]) / 2;
  const radiusLat = Math.abs(second[1] - first[1]) / 2;
  return Array.from({ length: steps }, (_, step) => {
    const angle = (step / steps) * Math.PI * 2;
    return [centreLon + Math.cos(angle) * radiusLon, centreLat + Math.sin(angle) * radiusLat];
  });
}

/** A ground box of two corners as its four ground corners, its sides along `angle`. */
export const boxRing = ([first, second], angle = 0) => (angle
  ? boxCorners(turnedBox([first, second], angle))
  : [first, [second[0], first[1]], second, [first[0], second[1]]]);

/** The ground ring a filled mark encloses, or null for a mark with no inside. */
export function markRing(mark) {
  if (mark.kind === 'rect') return boxRing(mark.points, mark.angle ?? 0);
  if (mark.kind === 'ellipse') return ellipseRing(mark.points, 48, mark.angle ?? 0);
  if (mark.kind === 'polygon') return mark.points;
  return null;
}

/** What a mark measures, in metres or square metres, when it measures anything. */
export function markMetric(mark) {
  if (mark.kind === 'measure' || mark.kind === 'line' || mark.kind === 'arrow') {
    return { distance: haversine(asLatLon(mark.points[0]), asLatLon(mark.points[1])) };
  }
  const ring = markRing(mark);
  return ring ? { area: polygonArea(ring.map(asLatLon)) } : {};
}

/** The words drawn beside a mark: its note, its length or its area. */
export function markLabel(mark, units = 'metric') {
  if (mark.kind === 'text') return mark.text;
  if (mark.kind === 'measure') return formatDistance(markMetric(mark).distance, units);
  if (mark.kind === 'polygon') return formatArea(markMetric(mark).area, units);
  return mark.text;
}

/** Shift every point of a mark by a ground offset, clamped to valid coordinates. */
export function movedMark(mark, dLon, dLat) {
  return {
    ...mark,
    points: mark.points.map(([lon, lat]) => [
      Math.min(180, Math.max(-180, lon + dLon)),
      Math.min(90, Math.max(-90, lat + dLat)),
    ]),
  };
}

/**
 * The ground point a mark turns about: a box's own centre, or the middle of
 * whatever the points span.
 */
export function markCentre(mark) {
  if (ANGLED.has(mark.kind)) return fromMercator(...turnedBox(mark.points, mark.angle ?? 0).centre);
  const metres = mark.points.map((point) => toMercator(...point));
  const xs = metres.map((point) => point[0]);
  const ys = metres.map((point) => point[1]);
  return fromMercator((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2);
}

/**
 * Where a box's top edge crosses its own up axis, which is where the grip that
 * turns it sits: it turns with the box rather than hanging off the screen.
 * Null for a mark with no sides of its own.
 */
export function markTop(mark) {
  if (!ANGLED.has(mark.kind)) return null;
  const box = turnedBox(mark.points, mark.angle ?? 0);
  return boxPoint(box, 0, -Math.sign(box.height || 1) / 2);
}

/**
 * A mark turned clockwise by `degrees` about `pivot`, its points clamped to the
 * map. A model stays on its point and turns its nose.
 */
export function turnedMark(mark, pivot, degrees) {
  if (!degrees) return mark;
  if (isModelMark(mark)) return { ...mark, angle: compassAngle((mark.angle ?? 0) + degrees) };
  if (!TURNABLE.has(mark.kind)) return mark;
  return {
    ...mark,
    points: mark.points.map((point) => {
      const [lon, lat] = turnAbout(point, pivot, degrees);
      return [Math.min(180, Math.max(-180, lon)), Math.min(85, Math.max(-85, lat))];
    }),
    ...(ANGLED.has(mark.kind) ? { angle: compassAngle((mark.angle ?? 0) + degrees) } : {}),
  };
}

/**
 * Screen geometry for one mark under a projection `([lon, lat]) => [x, y]`.
 * `path` is the outline to stroke (closed when `closed`), `anchor` where its
 * label sits, `head` the arrow's head triangle.
 */
export function projectMark(mark, project) {
  const ring = markRing(mark);
  const path = (ring ?? mark.points).map(project);
  const shape = { path, closed: Boolean(ring), anchor: path[0], head: null };
  if (mark.kind === 'arrow' || mark.kind === 'measure' || mark.kind === 'line') {
    const [start, end] = path;
    if (mark.kind === 'arrow') {
      const angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
      const size = 10 + mark.stroke_width * 2.6;
      const spread = Math.PI / 7;
      shape.head = [
        end,
        [end[0] - Math.cos(angle - spread) * size, end[1] - Math.sin(angle - spread) * size],
        [end[0] - Math.cos(angle + spread) * size, end[1] - Math.sin(angle + spread) * size],
      ];
    }
    shape.anchor = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  } else if (ring) {
    const xs = path.map((point) => point[0]);
    const ys = path.map((point) => point[1]);
    shape.anchor = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  }
  return shape;
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function hexWithAlpha(hex, alpha) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

function textLines(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines.slice(0, 8);
}

/** A label plate: dark, legible over any imagery, edged in the mark's colour. */
function drawPlate(ctx, text, x, y, { colour, fontSize, scale, centred }) {
  const size = Math.max(9, Math.round(fontSize * scale));
  const padX = Math.round(size * 0.55);
  const padY = Math.round(size * 0.38);
  ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const lines = textLines(ctx, text, 360 * scale);
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width)) + padX * 2;
  const height = lines.length * size * 1.25 + padY * 2;
  const left = centred ? x - width / 2 : x + 6 * scale;
  const top = centred ? y - height / 2 : y - height - 6 * scale;
  ctx.fillStyle = 'rgba(12,14,17,.86)';
  roundedRect(ctx, left, top, width, height, Math.min(6 * scale, height / 2));
  ctx.fill();
  ctx.lineWidth = Math.max(1, 1.5 * scale);
  ctx.strokeStyle = colour;
  ctx.stroke();
  ctx.fillStyle = '#f5f6f7';
  ctx.textBaseline = 'alphabetic';
  lines.forEach((line, index) => {
    ctx.fillText(line, left + padX, top + padY + size * 0.95 + index * size * 1.25);
  });
}

/**
 * A stamped mark on a 2D context: a numbered disc, a flat symbol in its box, or a
 * model turned to where its nose points on this picture (`project` says).
 *
 * Drawn from the same numbers the map's own SVG draws from, so what the export
 * holds is what was on screen. The disc and the eleven stamps keep the soft shadow
 * an export has always given them; a badge's glyph and a model wear their own halo
 * and nothing more, as on screen.
 */
function drawStamp(ctx, mark, [x, y], scale, project) {
  const size = markSize(mark) * scale;
  ctx.save();
  if (mark.kind === 'number' || stampByName(markGlyph(mark).name)) {
    ctx.shadowColor = 'rgba(0,0,0,.55)';
    ctx.shadowBlur = 3 * scale;
  }
  if (mark.kind === 'number') {
    const ink = stampInk(mark);
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fillStyle = mark.colour;
    ctx.fill();
    ctx.lineWidth = Math.max(1, size * 0.05);
    ctx.strokeStyle = ink;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = ink;
    ctx.font = `700 ${Math.round(size * 0.58)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(mark.number), x, y);
  } else if (isModelMark(mark)) {
    const engine = modelsNow();
    const model = engine?.modelById(mark.glyph);
    if (model) {
      ctx.translate(x, y);
      engine.drawModel(ctx, model, modelLook(mark, screenHeading(mark, project), scale));
    }
  } else {
    const box = glyphBox(mark, [x, y], scale);
    ctx.translate(box.x, box.y);
    ctx.scale(box.scale, box.scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // drawn in the box's units, so a bigger symbol is the same drawing, bigger
    for (const part of glyphParts(mark)) {
      ctx.save();
      if (part.rotate) {
        ctx.translate(ICON_BOX / 2, ICON_BOX / 2);
        ctx.rotate((part.rotate * Math.PI) / 180);
        ctx.translate(-ICON_BOX / 2, -ICON_BOX / 2);
      }
      const path = new Path2D(part.d);
      if (part.stroke) {
        ctx.strokeStyle = part.stroke;
        ctx.lineWidth = part.width;
        ctx.stroke(path);
      }
      if (part.fill) {
        ctx.fillStyle = part.fill;
        ctx.fill(path, part.rule);
      }
      ctx.restore();
    }
  }
  ctx.restore();
}

/**
 * Burn marks into an exported picture. `project` maps `[lon, lat]` to that
 * picture's pixels; `scale` is its pixels per CSS pixel, so strokes and labels
 * keep the weight they had on screen.
 */
export function drawAnnotations(ctx, marks, project, { scale = 1, units = 'metric' } = {}) {
  const list = comparisonAnnotations(marks);
  if (!list.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const mark of list) {
    const shape = projectMark(mark, project);
    ctx.lineWidth = Math.max(1, mark.stroke_width * scale);
    ctx.strokeStyle = mark.colour;
    if (STAMPED.has(mark.kind)) {
      drawStamp(ctx, mark, shape.anchor, scale, project);
    } else if (mark.kind !== 'text') {
      // a thin dark casing keeps a light stroke readable on bright ground
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.55)';
      ctx.shadowBlur = 3 * scale;
      ctx.beginPath();
      shape.path.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      if (shape.closed) {
        ctx.closePath();
        if (mark.fill_opacity > 0) {
          ctx.fillStyle = hexWithAlpha(mark.colour, mark.fill_opacity);
          ctx.fill();
        }
      }
      if (mark.kind === 'measure') ctx.setLineDash([8 * scale, 6 * scale]);
      ctx.stroke();
      ctx.restore();
      if (shape.head) {
        ctx.fillStyle = mark.colour;
        ctx.beginPath();
        shape.head.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fill();
      }
    }
    const label = markLabel(mark, units);
    if (label) {
      drawPlate(ctx, label, shape.anchor[0], shape.anchor[1], {
        colour: mark.colour,
        fontSize: mark.font_size,
        scale,
        centred: mark.kind !== 'text',
      });
    }
  }
  ctx.restore();
}
