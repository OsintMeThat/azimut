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
 * A zone has no pin: what follows the pointer is its own outline, its point under the
 * hand as the pin's tip would be.
 *
 * @param {object} deps
 * @param {() => object|null} deps.engine the map façade, once built
 * @param {(row: object, at: {lat: number, lon: number}) => Promise<void>} deps.move
 *   puts the place down on the server; a refusal throws
 * @param {(message: string, kind?: string, ms?: number) => void} deps.notify
 */
import { createSurface } from '../../../lib/map/surface.js';
import { placeColour, placeMark } from '../../../lib/mapMarkers.js';
import { isZone } from '../../../lib/savedMarkers.js';
import { cornersOf } from './footprint.svelte.js';

export function createPlaceMove({ engine, move, notify }) {
  // the place picked up, as its saved-index row
  let row = $state(null);
  let saving = $state(false);
  let surface = null;
  let drawn = false;
  // a zone's corners, carried with the pointer instead of a pin
  let outline = null;

  /** A zone's corners moved so that its point stands on `at`. */
  function carried(at) {
    const dlat = at.lat - Number(row.lat);
    const dlon = at.lon - Number(row.lon);
    return outline.map((corner) => ({ lat: corner.lat + dlat, lon: corner.lon + dlon }));
  }

  function show(at) {
    const map = engine();
    if (!map || !row) return;
    surface ??= createSurface(map);
    if (outline) {
      if (drawn && surface.patch('ghost', { points: carried(at) })) return;
      drawn = true;
      const colour = placeColour(row.color);
      surface.set([{
        id: 'ghost',
        kind: 'polygon',
        points: carried(at),
        style: { stroke: colour, strokeWidth: 2, strokeOpacity: 0.9, dash: '6 4', fill: colour, fillOpacity: 0.1, interactive: false },
      }]);
      return;
    }
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
      hide(); // a pin or an outline from a pick before is not this one's
      row = place;
      const corners = isZone(place) ? cornersOf(place.footprint) : [];
      outline = corners.length >= 3 ? corners : null;
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
    /** Whether the place in the hand is a zone, carried as its outline. */
    get zone() {
      return Boolean(row && outline);
    },
    destroy() {
      surface?.destroy?.();
      surface = null;
      drawn = false;
    },
  };
}
