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
 * It draws the scene's leads too, unless the Layers panel hid them, and the pin waiting
 * for its name: a lead is dragged to move it, and clicked to centre the map on it and
 * select it, which Delete then removes (Escape or a click elsewhere lets it go). The
 * pin under the pointer and the pin waiting are a place's own mark
 * (`lib/mapMarkers.placeMark`), in the red a place wears until it is given a colour.
 *
 * @param {object} deps
 * @param {() => object|null} deps.engine the map façade, once built
 * @param {() => object|null} deps.held the scene the case geolocates, or null
 * @param {(at: {lat: number, lon: number}) => Promise<object>} deps.dropLead
 * @param {(id: string, at: {lat: number, lon: number}) => Promise<object>} deps.moveLead
 * @param {(id: string) => Promise<void>} deps.removeLead
 * @param {(place: {lat: number, lon: number, title: string}) => Promise<void>} deps.savePlace
 * @param {(at: {lat: number, lon: number}) => void} deps.centre
 * @param {(message: string, kind?: string, ms?: number) => void} deps.notify
 */
import { createSurface } from '../../../lib/map/surface.js';
import { DROP, DROP_PATH, placeMark } from '../../../lib/mapMarkers.js';
import { sceneColorAt } from '../../../lib/scenes.js';

/** What the status bar's drop button says on hover, one clause each. */
export const DROP_HELP = {
  place: 'Drop a pin where you click, then name it',
  lead: 'Drop leads where you click, for the scene being geolocated',
  stop: 'Stop dropping (Esc)',
};

/** The longest name a place takes, as the place dialog does. */
export const PLACE_NAME_MAX = 200;

/** A lead's mark: a place's drop in the scene's colour, its number inside, its tip the spot. */
export const LEAD_GEOMETRY = DROP;

/** A colour the mark may be painted in: a code, or one of the theme's own variables,
 *  which the scene colours are (`lib/scenes.sceneColorAt`). Anything else is not written. */
const PAINT = /^(#[0-9a-f]{3,8}|var\(--[a-z0-9-]+\))$/i;

export function leadSvg(n, color) {
  const number = Number.isInteger(n) && n > 0 ? n : '';
  const fill = PAINT.test(String(color)) ? color : '#e5484d';
  // in a style rather than the fill attribute: a theme variable resolves there
  return `<svg width="26" height="36" viewBox="0 0 26 36" aria-hidden="true">
    <path d="${DROP_PATH}" style="fill: ${fill}" stroke="rgba(0,0,0,0.55)" stroke-width="1.5"/>
    <text x="13" y="16.5" text-anchor="middle" font-size="${number >= 10 ? 9.5 : 11}" font-weight="700" fill="#fff" font-family="system-ui, sans-serif">${number}</text>
  </svg>`;
}

/** What a click on a lead and a drag of it are told apart by: a drag ends in a click. */
const AFTER_DRAG_MS = 300;

export function createDropState({ engine, held, dropLead, moveLead, removeLead, savePlace, centre, notify }) {
  let armed = $state(false);
  // the lead picked on the map, which Delete removes
  let selected = $state(null);
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
    return { key: 'place', ...placeMark({ className: 'sat-ghost' }), at };
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
      id: 'ghost', kind: 'marker', at, className: shape.className ?? 'sat-ghost', html: shape.html, size: shape.size,
      anchor: shape.anchor, zIndex: 580, keyboard: false,
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
    // hidden from the Layers panel, the leads are not drawn; dropping one still works
    const leads = scene?.leads ?? [];
    const color = sceneColorAt(scene?.order);
    // a lead deleted elsewhere (the pill, the extension) is no longer the one picked
    if (selected && !leads.some((lead) => lead.id === selected)) selected = null;
    const shapes = leads.map((lead) => ({
      id: `lead-${lead.id}`,
      kind: 'marker',
      at: { lat: lead.lat, lon: lead.lon },
      className: lead.id === selected ? 'sat-lead is-selected' : 'sat-lead',
      html: leadSvg(lead.n, color),
      size: LEAD_GEOMETRY.size,
      anchor: LEAD_GEOMETRY.anchor,
      title: `Lead ${lead.n}: drag to move, click to select, Delete to remove`,
      zIndex: 560,
      draggable: true,
      keyboard: false,
      onClick: () => {
        if (Date.now() - draggedAt < AFTER_DRAG_MS) return;
        selected = lead.id;
        draw();
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
        ...placeMark({ className: 'sat-naming' }),
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
    /** The lead picked on the map, or null. */
    get selected() {
      return selected;
    },
    /** Let go of the lead picked. True when there was one. */
    deselect() {
      if (!selected) return false;
      selected = null;
      draw();
      return true;
    },
    /** Remove the lead picked, as Delete does. True when there was one to remove. */
    removeSelected() {
      const id = selected;
      const lead = (held()?.leads ?? []).find((one) => one.id === id);
      if (!lead) return false;
      selected = null;
      draw();
      removeLead(id)
        .then(() => notify(`Lead ${lead.n} deleted`, 'ok', 2200))
        .catch((e) => notify(`Could not delete the lead: ${e.message}`, 'danger', 6000));
      return true;
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
