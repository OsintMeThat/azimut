/**
 * The measure tools: a distance, an area or an angle drawn on the map.
 *
 * One armed mode at a time and one list of clicked points, because that is what
 * the readout is a reading of. The rules are each a thing an analyst noticed
 * rather than a thing the geometry needed:
 *
 * - **Arming a mode drops the last one's points.** Two half-drawn measures on
 *   the map, with a readout naming one of them, is a picture that lies.
 * - **An angle is exactly three points**, so a fourth click starts a fresh one
 *   rather than bending the last one into something with no name.
 * - **Enter finishes a line or an area.** Clicks stop adding points and the
 *   points become handles: a measure is adjusted by dragging its corners, not
 *   by drawing it again.
 * - **Closing the panel disarms.** The button lit with the panel gone was the
 *   tool still swallowing map clicks nobody meant for it.
 *
 * A line's elevation profile is a tool of its own (`profile.svelte.js`): it
 * reads the terrain server, and drawing a distance never should.
 *
 * The arithmetic is `lib/measure.js`; this holds what has been clicked, what is
 * armed, and the layer the two are drawn on.
 *
 * @param {object} deps
 * @param {() => object|null} deps.engine the map, once it is up
 * @param {() => string} deps.units 'metric' | 'imperial', for the readout
 * @param {(engine: object) => object} [deps.surface] the drawing layer factory
 */
import { cornerHandles } from '../../../lib/map/handles.js';
import { createSurface } from '../../../lib/map/surface.js';
import * as measure from '../../../lib/measure.js';

const STROKE = { stroke: '#f5a623', strokeWidth: 2.5, strokeOpacity: 0.95 };
const DOT = { radius: 4, stroke: '#fff', strokeWidth: 2, fill: '#f5a623', fillOpacity: 1 };
const PATH = 'measure-path';

/** What to click, per mode. The vertex is named because an angle is the one
 *  shape where the order of the three points changes the answer. */
export const HINTS = {
  distance: 'Click points along the path',
  area: 'Click the polygon corners',
  angle: 'Click three points (vertex second)',
};

/** How many points a mode needs before Enter can finish it. */
const ENOUGH = { distance: 2, area: 3 };

export function createMeasureState({ engine, units, surface = createSurface }) {
  let mode = $state(null); // null | 'distance' | 'area' | 'angle'
  let points = $state([]);
  let panelOpen = $state(false);
  let finished = $state(false);
  let layer = null;

  function pathShape() {
    if (points.length < 2) return null;
    return mode === 'area'
      ? { id: PATH, kind: 'polygon', points, style: { ...STROKE, fill: '#f5a623', fillOpacity: 0.15 } }
      : { id: PATH, kind: 'line', points, style: STROKE };
  }

  function corners() {
    if (!finished) return points.map((point) => ({ kind: 'dot', at: point, style: DOT }));
    return cornerHandles(points, { prefix: 'measure-corner', onMove: moveCorner });
  }

  function draw() {
    const map = engine();
    if (!map) return;
    layer ??= surface(map);
    layer.set([pathShape(), ...corners()]);
  }

  /** A handle on its way: the line follows it without the handles being rebuilt
   *  under the hand. */
  function moveCorner(index, at) {
    points = points.map((point, i) => (i === index ? { lat: at.lat, lon: at.lon } : point));
    layer?.patch(PATH, { points });
  }

  function clear() {
    points = [];
    finished = false;
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
    get finished() {
      return finished;
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

    /** A map click, while a mode is armed. False means it was not ours. A
     *  finished measure takes the click and adds nothing: its points move by
     *  their handles. */
    addPoint(at) {
      if (!mode) return false;
      if (finished) return true;
      // an angle is exactly three points; a fourth click starts a fresh angle
      if (mode === 'angle' && points.length >= 3) points = [];
      points = [...points, at];
      draw();
      return true;
    },

    /** Enter: the line or the area is done, and its points become handles.
     *  False when there is nothing to finish. */
    finish() {
      if (finished || !ENOUGH[mode] || points.length < ENOUGH[mode]) return false;
      finished = true;
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
