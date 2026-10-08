/**
 * The corners of a finished line, as handles the hand can take.
 *
 * Measure and Elevation profile both draw a line point by point and, once Enter
 * finishes it, let its corners be dragged. The handles are marks (DOM markers),
 * so the engine moves them under the pointer itself; what moves with them is
 * reported per corner, and the line is patched rather than rebuilt so the
 * handles are never torn down under the hand.
 */

/** A corner's look; the class is painted by `engine.css`. */
export const HANDLE = { className: 'path-handle', html: '<span></span>', size: [14, 14] };

/**
 * Handle shapes for `points`, ready for a surface layer.
 *
 * @param {{lat: number, lon: number}[]} points
 * @param {object} opts
 * @param {string} opts.prefix makes the ids unique on the layer
 * @param {(index: number, at: {lat: number, lon: number}) => void} opts.onMove
 * @param {(index: number) => void} [opts.onDrop]
 * @param {string} [opts.tone] a colour class matching the line, painted by `engine.css`
 * @param {boolean} [opts.ends] name the first corner A and the last B, for a
 *   line whose direction matters (a line of sight)
 */
export function cornerHandles(points, { prefix, onMove, onDrop = () => {}, tone = '', ends = false }) {
  const last = points.length - 1;
  return points.map((point, index) => {
    const name = ends && last > 0 ? (index === 0 ? 'A' : index === last ? 'B' : '') : '';
    return {
      id: `${prefix}-${index}`,
      kind: 'marker',
      at: point,
      ...HANDLE,
      ...(name ? { html: `<span>${name}</span>`, size: [20, 20] } : {}),
      className: [HANDLE.className, tone, name && 'named'].filter(Boolean).join(' '),
      title: name ? `Drag to move ${name}` : 'Drag to move this point',
      draggable: true,
      zIndex: 900,
      onDrag: (at) => onMove(index, { lat: at.lat, lon: at.lon }),
      onDragEnd: () => onDrop(index),
    };
  });
}
