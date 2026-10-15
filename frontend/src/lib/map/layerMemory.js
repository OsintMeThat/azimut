/**
 * Which layers each map had on, kept per case in this browser, so a case opens
 * again on the layers it was closed on.
 *
 * View state rather than case data: it stays in `localStorage`, never in the case
 * or the settings backup, and a case that never said anything opens on each map's
 * own defaults. Two kinds of layer are kept apart, because their ids could meet:
 * the catalogue's (`layerCatalog.js`) per map, and the case's added layers per map
 * scope (`addedLayersState.svelte.js`).
 *
 * The fire and night layers are never kept. They show a day, and switching them
 * back on after a reload would show a different day than the one that was being
 * read, on a FIRMS key's quota.
 *
 * The same entry holds the added layers being drawn right now (`drawing`). A tab
 * that dies while drawing one leaves its name there, which is how the next
 * session knows to leave that layer off.
 */
import { knownLayers, layerInfo } from './layerCatalog.js';

const PREFIX = 'azimut:map-layers:';

/** The catalogue layers a map may keep: every one but the dated feeds. */
export function keptLayers(ids) {
  return knownLayers(ids).filter((id) => layerInfo(id)?.group !== 'events');
}

const names = (value) =>
  Array.isArray(value) ? [...new Set(value.filter((name) => typeof name === 'string' && name))] : [];

const same = (a, b) => a.length === b.length && a.every((entry, index) => entry === b[index]);

/** @param {() => Storage | null | undefined} [store] where it is kept; `localStorage` by default */
export function createLayerMemory(store = () => globalThis.localStorage) {
  function read(caseId) {
    try {
      const value = JSON.parse(store()?.getItem(PREFIX + caseId) ?? 'null');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function write(caseId, value) {
    try {
      store()?.setItem(PREFIX + caseId, JSON.stringify(value));
    } catch {
      // a browser that keeps nothing opens every case on the defaults
    }
  }

  function update(caseId, change) {
    if (!caseId) return;
    const value = read(caseId);
    write(caseId, { ...value, ...change(value) });
  }

  return {
    /** The catalogue layers a map had on in this case, or null when it never said. */
    layers(caseId, map) {
      if (!caseId) return null;
      const ids = read(caseId).maps?.[map];
      return Array.isArray(ids) ? keptLayers(ids) : null;
    },

    /**
     * Keep a map's catalogue layers for this case. A case still on `fallback`
     * that never said anything stays silent, so it keeps following the defaults.
     */
    keepLayers(caseId, map, ids, fallback = []) {
      if (!caseId) return;
      const kept = keptLayers(ids);
      const held = this.layers(caseId, map);
      if (held ? same(held, kept) : same(keptLayers(fallback), kept)) return;
      update(caseId, (value) => ({ maps: { ...value.maps, [map]: kept } }));
    },

    /** The added layers each map scope had on in this case: `{ scope: names }`. */
    added(caseId) {
      if (!caseId) return {};
      const held = read(caseId).added;
      if (!held || typeof held !== 'object') return {};
      return Object.fromEntries(Object.entries(held).map(([scope, list]) => [scope, names(list)]));
    },

    /** Keep each scope's added layers; a case that never had one on stays silent. */
    keepAdded(caseId, byScope) {
      const added = Object.fromEntries(Object.entries(byScope).map(([scope, list]) => [scope, names(list)]));
      if (!caseId || (!read(caseId).added && Object.values(added).every((list) => !list.length))) return;
      update(caseId, () => ({ added }));
    },

    /** The added layers marked as being drawn in this case. */
    drawing(caseId) {
      return caseId ? names(read(caseId).drawing) : [];
    },

    /** Mark one added layer as being drawn, or as drawn. */
    markDrawing(caseId, name, on) {
      update(caseId, (value) => {
        const rest = names(value.drawing).filter((entry) => entry !== name);
        return { drawing: on ? [...rest, name] : rest };
      });
    },

    /** No layer is being drawn any more: the page is closing on its own. */
    clearDrawing(caseId) {
      if (caseId && this.drawing(caseId).length) update(caseId, () => ({ drawing: [] }));
    },

    /** A deleted case takes its layers with it. */
    forget(caseId) {
      try {
        if (caseId) store()?.removeItem(PREFIX + caseId);
      } catch {
        // nothing was kept, then
      }
    },
  };
}

/** The one this browser keeps. */
export const layerMemory = createLayerMemory();

/**
 * One map's catalogue switches, read when a case opens and kept when they move.
 *
 * `fallback` is what the map starts on in a case that never said anything.
 */
export function createMapLayerMemory(map, fallback, memory = layerMemory) {
  return {
    /** The layers this map opens the case on. */
    recall(caseId) {
      return memory.layers(caseId, map) ?? keptLayers(fallback);
    },
    /** Keep what is on now, for this case. No case, nothing kept. */
    keep(caseId, ids) {
      memory.keepLayers(caseId, map, ids, fallback);
    },
  };
}
