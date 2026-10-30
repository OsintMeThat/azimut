/**
 * The corners of a finished line, as handles the hand can take.
 *
 * A measure is drawn point by point and, once finished, its corners are
 * dragged. The handles are marks (DOM markers), so the engine moves them under
 * the pointer itself; what moves with them is reported per corner, and the line
 * is patched rather than rebuilt so the handles are never torn down under the
 * hand.
 */
import { midway } from '../measure.js';

/** A corner's look; the class is painted by `engine.css`. */
export const HANDLE = { className: 'path-handle', html: '<span></span>', size: [14, 14] };
/** The smaller dot halfway along a leg, which becomes a corner once it is taken. */
export const GHOST = { className: 'path-handle ghost', html: '<span></span>', size: [10, 10] };

/**
 * Handle shapes for `points`, ready for a surface layer.
 *
 * @param {{lat: number, lon: number}[]} points
 * @param {object} opts
 * @param {string} opts.prefix makes the ids unique on the layer
 * @param {(index: number, at: {lat: number, lon: number}) => void} opts.onMove
 * @param {(index: number) => void} [opts.onDrop]
 * @param {boolean} [opts.ends] name the first corner A and the last B, for a
 *   line whose direction matters (a line of sight)
 */
export function cornerHandles(points, { prefix, onMove, onDrop = () => {}, ends = false }) {
  const last = points.length - 1;
  return points.map((point, index) => {
    const name = ends && last > 0 ? (index === 0 ? 'A' : index === last ? 'B' : '') : '';
    return {
      id: `${prefix}-${index}`,
      kind: 'marker',
      at: point,
      ...HANDLE,
      ...(name ? { html: `<span>${name}</span>`, size: [20, 20] } : {}),
      className: [HANDLE.className, name && 'named'].filter(Boolean).join(' '),
      title: name ? `Drag to move ${name}` : 'Drag to move this point',
      draggable: true,
      zIndex: 560,
      onDrag: (at) => onMove(index, { lat: at.lat, lon: at.lon }),
      onDragEnd: () => onDrop(index),
    };
  });
}

/**
 * A dot halfway along each leg, to bend the line there: taken and dragged, it
 * becomes a corner of its own. The corner is put in on the first move rather
 * than on the press, so a click that never moves changes nothing.
 *
 * @param {{lat: number, lon: number}[]} points
 * @param {object} opts
 * @param {string} opts.prefix makes the ids unique on the layer
 * @param {boolean} [opts.closed] an area, whose last corner has a leg back to its first
 * @param {(leg: number, at: {lat: number, lon: number}) => number} opts.onInsert puts a
 *   corner in after `leg`'s start and answers its index
 * @param {(index: number, at: {lat: number, lon: number}) => void} opts.onMove
 * @param {() => void} [opts.onDrop]
 */
export function ghostHandles(points, { prefix, closed = false, onInsert, onMove, onDrop = () => {} }) {
  const ends = closed && points.length >= 3 ? [...points, points[0]] : points;
  return ends.slice(1).map((to, leg) => {
    const from = ends[leg];
    let index = -1; // the corner this dot became, once it moved
    return {
      id: `${prefix}-${leg}`,
      kind: 'marker',
      at: midway(from, to),
      ...GHOST,
      title: 'Drag to bend the line here',
      draggable: true,
      zIndex: 559,
      onDragStart: () => (index = -1),
      onDrag: (at) => {
        const point = { lat: at.lat, lon: at.lon };
        if (index < 0) index = onInsert(leg, point);
        if (index >= 0) onMove(index, point);
      },
      onDragEnd: () => {
        if (index >= 0) onDrop(index);
      },
    };
  });
}
