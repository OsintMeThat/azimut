/**
 * Moving a saved place: picked up from its card, put down with a click.
 *
 * A page cannot put the pointer on the point, so the map comes to the pointer: it
 * slides by the distance between the two, and the place is under the hand at the spot
 * it stands on. A pale copy of its pin then follows the pointer, a click puts it down
 * and Escape leaves it where it was. Its own mark stays, faint, at the old spot until
 * then (`SavedOverlay`'s `movingKey`).
 *
 * A place a proof states is never picked up here: the proof holds its coordinates and
 * prints them, so the card sends it to the proof instead (`Satellite.pickUpPlace`).
 *
 * @param {object} deps
 * @param {() => object|null} deps.engine the map façade, once built
 * @param {(row: object, at: {lat: number, lon: number}) => Promise<void>} deps.move
 *   puts the place down on the server; a refusal throws
 * @param {(message: string, kind?: string, ms?: number) => void} deps.notify
 */
import { createSurface } from '../../../lib/map/surface.js';
import { placeMark } from '../../../lib/mapMarkers.js';

export function createPlaceMove({ engine, move, notify }) {
  // the place picked up, as its saved-index row
  let row = $state(null);
  let saving = $state(false);
  let surface = null;
  let drawn = false;

  function show(at) {
    const map = engine();
    if (!map || !row) return;
    surface ??= createSurface(map);
    if (drawn && surface.patch('ghost', { at })) return;
    drawn = true;
    surface.set([{
      id: 'ghost',
      kind: 'marker',
      at,
      ...placeMark({ colour: row.color, className: 'sat-ghost' }),
      zIndex: 580,
      keyboard: false,
    }]);
  }

  function hide() {
    if (!drawn) return;
    drawn = false;
    surface?.clear();
  }

  return {
    get row() {
      return row;
    },
    get on() {
      return row !== null;
    },
    get saving() {
      return saving;
    },
    /**
     * Pick a place up. `pointer` is where the press was, in the map's own pixels: the
     * map slides so the place's point is under it. Without one the pin waits on its
     * point for the pointer to come to it.
     */
    start(place, pointer = null) {
      const view = engine();
      const lat = Number(place?.lat);
      const lon = Number(place?.lon);
      if (!view || place?.lat == null || place?.lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) {
        return false;
      }
      row = place;
      const at = { lat, lon };
      if (pointer && Number.isFinite(pointer.x) && Number.isFinite(pointer.y)) {
        const pin = view.latLngToContainerPoint(at);
        view.panBy(pin.x - pointer.x, pin.y - pointer.y);
      }
      show(at);
      return true;
    },
    /** The pointer moved over the map: the pin goes with it. */
    follow(at) {
      if (row && !saving) show(at);
    },
    /** The pointer left the map: the pin waits out of sight. */
    hide,
    /** A click on the map while a place is held: it is put down there. True when one was held. */
    place(at) {
      if (!row) return false;
      if (saving) return true;
      const picked = row;
      saving = true;
      move(picked, { lat: at.lat, lon: at.lon })
        .then(() => {
          // a place picked up again meanwhile keeps its pin in the hand
          if (row === picked) row = null;
          if (!row) hide();
        })
        .catch((e) => notify(`Could not move the place: ${e.message}`, 'danger', 6000))
        .finally(() => (saving = false));
      return true;
    },
    /** Leave the place where it was. True when one was held. */
    cancel() {
      if (!row) return false;
      row = null;
      hide();
      return true;
    },
    destroy() {
      surface?.destroy?.();
      surface = null;
      drawn = false;
    },
  };
}
