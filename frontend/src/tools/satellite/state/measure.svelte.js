/**
 * The measure tools: a distance, an area or an angle drawn on the map.
 *
 * One armed mode at a time and one list of clicked points, because that is what
 * the readout is a reading of. Three rules are the whole of it, and each one is
 * a thing an analyst noticed rather than a thing the geometry needed:
 *
 * - **Arming a mode drops the last one's points.** Two half-drawn measures on
 *   the map, with a readout naming one of them, is a picture that lies.
 * - **An angle is exactly three points**, so a fourth click starts a fresh one
 *   rather than bending the last one into something with no name.
 * - **Closing the panel disarms.** The button lit with the panel gone was the
 *   tool still swallowing map clicks nobody meant for it.
 *
 * The arithmetic is `lib/measure.js`; this holds what has been clicked, what is
 * armed, and the layer the two are drawn on.
 *
 * @param {object} deps
 * @param {() => object|null} deps.engine the map, once it is up
 * @param {() => string} deps.units 'metric' | 'imperial', for the readout
 * @param {(engine: object) => object} [deps.surface] the drawing layer factory
 */
import { createSurface } from '../../../lib/map/surface.js';
import * as measure from '../../../lib/measure.js';

const STROKE = { stroke: '#f5a623', strokeWidth: 2.5, strokeOpacity: 0.95 };
const DOT = { radius: 4, stroke: '#fff', strokeWidth: 2, fill: '#f5a623', fillOpacity: 1 };

/** What to click, per mode. The vertex is named because an angle is the one
 *  shape where the order of the three points changes the answer. */
export const HINTS = {
  distance: 'Click points along the path',
  area: 'Click the polygon corners',
  angle: 'Click three points (vertex second)',
};

export function createMeasureState({ engine, units, surface = createSurface }) {
  let mode = $state(null); // null | 'distance' | 'area' | 'angle'
  let points = $state([]);
  let panelOpen = $state(false);
  let layer = null;

  function draw() {
    const map = engine();
    if (!map) return;
    layer ??= surface(map);
    const path =
      points.length < 2
        ? null
        : mode === 'area'
          ? {
              kind: 'polygon',
              points,
              style: { ...STROKE, fill: '#f5a623', fillOpacity: 0.15 },
            }
          : { kind: 'line', points, style: STROKE };
    layer.set([path, ...points.map((point) => ({ kind: 'dot', at: point, style: DOT }))]);
  }

  function clear() {
    points = [];
    layer?.clear();
  }

  return {
    get mode() {
      return mode;
    },
    get points() {
      return points;
    },
    get panelOpen() {
      return panelOpen;
    },

    /** The measurement itself, in the user's units. `…` while a shape is one
     *  point short of meaning something. */
    get readout() {
      if (!mode || points.length < 2) return null;
      if (mode === 'distance') return measure.formatDistance(measure.pathLength(points), units());
      if (mode === 'area') {
        return points.length >= 3
          ? measure.formatArea(measure.polygonArea(points), units())
          : '…';
      }
      return points.length >= 3
        ? measure.formatAngle(measure.angleAt(points[0], points[1], points[2]))
        : '…';
    },

    /** Arm a mode, or disarm the one already armed by pressing it again. */
    setMode(next) {
      mode = mode === next ? null : next;
      clear();
      return mode;
    },

    togglePanel() {
      panelOpen = !panelOpen;
      if (!panelOpen && mode) this.setMode(null);
      return panelOpen;
    },

    /** A map click, while a mode is armed. False means it was not ours. */
    addPoint(at) {
      if (!mode) return false;
      // an angle is exactly three points; a fourth click starts a fresh angle
      if (mode === 'angle' && points.length >= 3) points = [];
      points = [...points, at];
      draw();
      return true;
    },

    clear,
    destroy() {
      layer?.destroy();
      layer = null;
    },
  };
}
