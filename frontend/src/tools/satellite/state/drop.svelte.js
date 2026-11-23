/**
 * Dropping a pin where the analyst clicks, rather than reading the middle of the map.
 *
 * The status bar's button arms it, and a pale pin follows the pointer to show where a
 * click lands. While the case geolocates a scene, a click drops a **lead** for that
 * scene: a spot to come back to, numbered, in the scene's colour, kept on the scene and
 * never as a place of the case (`engine/geolocate.py`); several are dropped in a row,
 * until Escape or the button again. Otherwise a click asks for a name beside the point,
 * and Enter saves a place of the case under it, which ends the mode, as letting the pin
 * go does: a place with no name only reads as its coordinates later, so the name is
 * asked first.
 *
 * It draws the scene's leads too, and the pin waiting for its name: a lead is dragged to
 * move it and clicked to centre the map on it.
 *
 * @param {object} deps
 * @param {() => object|null} deps.engine the map façade, once built
 * @param {() => object|null} deps.held the scene the case geolocates, or null
 * @param {(at: {lat: number, lon: number}) => Promise<object>} deps.dropLead
 * @param {(id: string, at: {lat: number, lon: number}) => Promise<object>} deps.moveLead
 * @param {(place: {lat: number, lon: number, title: string}) => Promise<void>} deps.savePlace
 * @param {(at: {lat: number, lon: number}) => void} deps.centre
 * @param {(message: string, kind?: string, ms?: number) => void} deps.notify
 */
import { createSurface } from '../../../lib/map/surface.js';
import { MARKER_GEOMETRY, markerSvg } from '../../../lib/mapMarkers.js';
import { sceneColorAt } from '../../../lib/scenes.js';

/** What the status bar's drop button says on hover, one clause each. */
export const DROP_HELP = {
  place: 'Drop a pin where you click, then name it',
  lead: 'Drop leads where you click, for the scene being geolocated',
  stop: 'Stop dropping (Esc)',
};

/** The longest name a place takes, as the place dialog does. */
export const PLACE_NAME_MAX = 200;

/** A lead's mark: a teardrop in the scene's colour, its number inside, its tip the spot. */
export const LEAD_GEOMETRY = { size: [26, 36], anchor: [13, 35] };

/** A colour the mark may be painted in: a code, or one of the theme's own variables,
 *  which the scene colours are (`lib/scenes.sceneColorAt`). Anything else is not written. */
const PAINT = /^(#[0-9a-f]{3,8}|var\(--[a-z0-9-]+\))$/i;

export function leadSvg(n, color) {
  const number = Number.isInteger(n) && n > 0 ? n : '';
  const fill = PAINT.test(String(color)) ? color : '#e5484d';
  // in a style rather than the fill attribute: a theme variable resolves there
  return `<svg width="26" height="36" viewBox="0 0 26 36" aria-hidden="true">
    <path d="M13 35 C13 35 24 21 24 12.5 A11 11 0 1 0 2 12.5 C2 21 13 35 13 35 Z" style="fill: ${fill}" stroke="rgba(0,0,0,0.55)" stroke-width="1.5"/>
    <text x="13" y="16.5" text-anchor="middle" font-size="${number >= 10 ? 9.5 : 11}" font-weight="700" fill="#fff" font-family="system-ui, sans-serif">${number}</text>
  </svg>`;
}

/** What a click on a lead and a drag of it are told apart by: a drag ends in a click. */
const AFTER_DRAG_MS = 300;

export function createDropState({ engine, held, dropLead, moveLead, savePlace, centre, notify }) {
  let armed = $state(false);
  // the pin waiting for its name: `{ lat, lon, title }`
  let naming = $state(null);
  let saving = $state(false);
  let dropping = $state(false);
  let surface = null;
  // the pin under the pointer, on a surface of its own so a move only moves it
  let ghostSurface = null;
  let ghostLook = '';
  let ghostAt = null;
  let draggedAt = 0;
  // where a mark being dragged stands, kept out of the state so the map is not redrawn under the hand
  const dragged = new Map();

  /** The pin under the pointer: the next lead of the scene held, or a place's pin. */
  function ghostShape(at) {
    const scene = held();
    if (scene) {
      const next = Math.max(0, ...(scene.leads ?? []).map((lead) => lead.n)) + 1;
      return { key: `lead:${next}:${scene.order ?? 0}`, html: leadSvg(next, sceneColorAt(scene.order)), ...LEAD_GEOMETRY, at };
    }
    return { key: 'place', html: markerSvg('pin'), ...MARKER_GEOMETRY.pin, at };
  }

  function showGhost(at) {
    const map = engine();
    if (!map || !armed || naming) return hideGhost();
    ghostAt = at;
    const shape = ghostShape(at);
    ghostSurface ??= createSurface(map);
    if (ghostLook === shape.key && ghostSurface.patch('ghost', { at })) return;
    ghostLook = shape.key;
    ghostSurface.set([{
      id: 'ghost', kind: 'marker', at, className: 'sat-ghost', html: shape.html, size: shape.size, anchor: shape.anchor,
      zIndex: 580, keyboard: false,
    }]);
  }

  function hideGhost() {
    if (!ghostLook) return;
    ghostLook = '';
    ghostSurface?.clear();
  }

  /** Drop at a point: a lead for the scene held, else a pin asking for its name. */
  async function dropAt(at) {
    const point = { lat: at.lat, lon: at.lon };
    if (held()) {
      naming = null;
      if (dropping) return;
      dropping = true;
      try {
        await dropLead(point);
      } catch (e) {
        notify(`Could not drop the lead: ${e.message}`, 'danger', 6000);
      } finally {
        dropping = false;
      }
      return;
    }
    // a click elsewhere moves the pin waiting, the name typed so far kept
    naming = { ...point, title: naming?.title ?? '' };
    hideGhost();
  }

  function draw() {
    const map = engine();
    if (!map) return;
    const scene = held();
    const leads = scene?.leads ?? [];
    const color = sceneColorAt(scene?.order);
    const shapes = leads.map((lead) => ({
      id: `lead-${lead.id}`,
      kind: 'marker',
      at: { lat: lead.lat, lon: lead.lon },
      className: 'sat-lead',
      html: leadSvg(lead.n, color),
      size: LEAD_GEOMETRY.size,
      anchor: LEAD_GEOMETRY.anchor,
      title: `Lead ${lead.n}: drag to move, click to centre`,
      zIndex: 560,
      draggable: true,
      keyboard: false,
      onClick: () => {
        if (Date.now() - draggedAt < AFTER_DRAG_MS) return;
        centre({ lat: lead.lat, lon: lead.lon });
      },
      onDragStart: () => (draggedAt = Date.now()),
      onDrag: (to) => {
        draggedAt = Date.now();
        dragged.set(lead.id, to);
      },
      onDragEnd: async () => {
        draggedAt = Date.now();
        const to = dragged.get(lead.id);
        dragged.delete(lead.id);
        if (!to) return;
        try {
          await moveLead(lead.id, to);
        } catch (e) {
          notify(`Could not move the lead: ${e.message}`, 'danger', 6000);
          draw();
        }
      },
    }));
    if (naming) {
      shapes.push({
        id: 'naming',
        kind: 'marker',
        at: { lat: naming.lat, lon: naming.lon },
        className: 'sat-marker',
        html: markerSvg('pin'),
        size: MARKER_GEOMETRY.pin.size,
        anchor: MARKER_GEOMETRY.pin.anchor,
        zIndex: 575,
        draggable: true,
        keyboard: false,
        onDrag: (to) => dragged.set('naming', to),
        onDragEnd: () => {
          const to = dragged.get('naming');
          dragged.delete('naming');
          if (to && naming) naming = { ...naming, lat: to.lat, lon: to.lon };
        },
      });
    }
    surface ??= createSurface(map);
    surface.set(shapes);
    // a lead just dropped makes the next one's number: the pin under the pointer says it
    if (ghostLook && ghostAt) showGhost(ghostAt);
  }

  return {
    get armed() {
      return armed;
    },
    get naming() {
      return naming;
    },
    get saving() {
      return saving;
    },
    get dropping() {
      return dropping;
    },
    start() {
      armed = true;
    },
    /** End the mode, and let go of a pin still waiting for its name. */
    stop() {
      armed = false;
      naming = null;
      hideGhost();
    },
    /** A click on the map, taken while the mode is armed. */
    place(at) {
      if (!armed) return false;
      dropAt(at);
      return true;
    },
    /** A point chosen from the map's right-click menu: dropped the same way, armed or not. */
    at(point) {
      dropAt(point);
    },
    /** Let go of the pin waiting for its name, which ends the mode. True when there was one. */
    cancel() {
      if (!naming) return false;
      naming = null;
      armed = false;
      return true;
    },
    setTitle(title) {
      if (naming) naming = { ...naming, title: String(title ?? '').slice(0, PLACE_NAME_MAX) };
    },
    /** Save the pin waiting as a place under its name. Nothing without a name. */
    async save() {
      const pin = naming;
      const title = pin?.title.trim() ?? '';
      if (!pin || !title || saving) return false;
      saving = true;
      try {
        await savePlace({ lat: pin.lat, lon: pin.lon, title });
        if (naming === pin || (naming && naming.lat === pin.lat && naming.lon === pin.lon)) naming = null;
        // a place is saved one at a time: the mode ends with it
        armed = false;
        return true;
      } catch (e) {
        notify(`Could not save place: ${e.message}`, 'danger', 6000);
        return false;
      } finally {
        saving = false;
      }
    },
    /** Draw the scene's leads and the pin waiting, as they now stand. */
    draw,
    /** The pointer moved over the map: the pale pin follows it while the mode is armed. */
    ghost: showGhost,
    hideGhost,
    destroy() {
      surface?.destroy?.();
      surface = null;
      ghostSurface?.destroy?.();
      ghostSurface = null;
    },
  };
}
