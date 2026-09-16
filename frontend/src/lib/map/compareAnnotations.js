/**
 * Compare's annotations, pinned to the ground.
 *
 * A mark stores `[lon, lat]` points, so it follows the imagery through a pan,
 * a zoom or a turn and lands on the same spot of both maps. `side` says which
 * picture it belongs to: a "before" note on A, a new building outlined on B, or
 * an arrow at a spot on both. Screen positions are derived on demand through a
 * projection the caller supplies (the live map, or an export frame).
 *
 * Rectangles and ellipses are shapes on the ground: two opposite corners, drawn
 * turned when the map is turned. Measures and polygons read their length and
 * area off the ground, not the screen.
 */

import { formatArea, formatDistance, haversine, polygonArea } from '../measure.js';

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
]);

const KINDS = new Set(ANNOTATION_TOOLS.filter((tool) => tool.points).map((tool) => tool.id));
const LIMITS = {
  text: [1, 1], arrow: [2, 2], line: [2, 2], measure: [2, 2], rect: [2, 2], ellipse: [2, 2],
  freehand: [2, 400], polygon: [3, 200],
};

export const canFill = (kind) => kind === 'rect' || kind === 'ellipse' || kind === 'polygon';

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
    }];
  });
}

/** Whether a mark is drawn on the picture of one side. */
export const onSide = (mark, letter) => mark.side === 'both' || mark.side === letter;

const asLatLon = ([lon, lat]) => ({ lat, lon });

/** An ellipse inscribed in the ground box of two corners, as a ring of ground points. */
export function ellipseRing([first, second], steps = 48) {
  const centreLon = (first[0] + second[0]) / 2;
  const centreLat = (first[1] + second[1]) / 2;
  const radiusLon = Math.abs(second[0] - first[0]) / 2;
  const radiusLat = Math.abs(second[1] - first[1]) / 2;
  return Array.from({ length: steps }, (_, step) => {
    const angle = (step / steps) * Math.PI * 2;
    return [centreLon + Math.cos(angle) * radiusLon, centreLat + Math.sin(angle) * radiusLat];
  });
}

/** A ground box of two corners as its four ground corners. */
export const boxRing = ([first, second]) => [
  first, [second[0], first[1]], second, [first[0], second[1]],
];

/** The ground ring a filled mark encloses, or null for a mark with no inside. */
export function markRing(mark) {
  if (mark.kind === 'rect') return boxRing(mark.points);
  if (mark.kind === 'ellipse') return ellipseRing(mark.points);
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
    if (mark.kind !== 'text') {
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
