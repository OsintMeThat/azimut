/**
 * One case item in the analyst's layers: which layers it can join, where its
 * markers already are, and adding one or taking it back out.
 *
 * A marker added from an item follows it (`engine/layerlinks.py`) and starts out
 * saying what the item says. Geo Proof's points (`proofLayers.svelte.js`) and the
 * file played beside the map both go through here; `resolve` turns what the
 * caller holds into the item's entity id, null when there is none yet.
 */
import { parseLatLon } from '../../lib/sheetRoles.js';

const memory = (caseId) => `azimut:layer-last:${caseId}`;

/** Metres-ish between two points, for picking the nearest only. */
const apart = (first, second) => Math.hypot((first.lon - second.lon) * Math.cos((first.lat * Math.PI) / 180), first.lat - second.lat);

/**
 * The markers standing on each of an item's points: `texts` are the points'
 * coordinates as typed, `targets` the layers with their markers. Index → list of
 * `{ layer, group, marker }`.
 */
export function placesOf(texts, targets) {
  const points = texts.map((text) => parseLatLon(text));
  const found = new Map();
  for (const layer of targets) {
    for (const marker of layer.markers ?? []) {
      let best = -1;
      points.forEach((point, index) => {
        if (point && (best < 0 || apart(point, marker) < apart(points[best], marker))) best = index;
      });
      if (best < 0) continue;
      const group = layer.groups.find((one) => one.id === marker.group) ?? null;
      if (!found.has(best)) found.set(best, []);
      found.get(best).push({ layer, group, marker });
    }
  }
  return found;
}

/** The markers on one point of an item standing in several, about a metre either way. */
export function placesAt(point, targets) {
  const near = (marker) => Math.abs(marker.lat - point.lat) < 1e-5 && Math.abs(marker.lon - point.lon) < 1e-5;
  return targets.flatMap((layer) => (layer.markers ?? []).filter(near)
    .map((marker) => ({ layer, group: layer.groups.find((one) => one.id === marker.group) ?? null, marker })));
}

/** The layers as a menu offers them: the one used last first, the others in their order. */
export function orderedTargets(targets, last = '') {
  return [...targets].sort((a, b) => (b.name === last) - (a.name === last));
}

export function createItemLayers({
  api, layers, notify, refreshEditor = () => {}, storage = globalThis.localStorage,
  resolve = async (caseId, id) => id, missing = 'This item is no longer in the case',
}) {
  let targets = $state.raw([]);
  let entity = $state(null);
  let busy = $state(false);
  let asked = 0;

  /** The layers again, with the markers following the item `ref` names. */
  async function refresh(caseId, ref) {
    const ticket = ++asked;
    if (!caseId) { targets = []; entity = null; return; }
    try {
      const id = ref ? await resolve(caseId, ref) : null;
      const query = id ? `?entity=${encodeURIComponent(id)}` : '';
      const rows = await api.get(`/api/cases/${caseId}/layer-targets${query}`);
      if (ticket !== asked) return;
      entity = id ?? null;
      targets = rows;
    } catch {
      if (ticket === asked) targets = [];
    }
  }

  /**
   * The item at `coords` (typed text or `{ lat, lon }`) into `layer`, in `group`
   * (its first when null), as a marker in `style` (`{ symbol, colour }`) or in the
   * group's, saying `status` ('' intact, damaged or destroyed) of what it shows.
   */
  async function add(caseId, ref, coords, layer, group = null, style = null, status = '') {
    busy = true;
    try {
      const at = typeof coords === 'string' ? parseLatLon(coords) ?? await api.post('/api/geo/parse', { text: coords }) : coords;
      const id = await resolve(caseId, ref);
      if (!id) throw new Error(missing);
      const answer = await api.post(`/api/cases/${caseId}/map-layers/${encodeURIComponent(layer.name)}/links`, {
        items: [{ id, lat: at.lat, lon: at.lon }], ...(group ? { group: group.id } : {}), ...(style ?? {}),
        ...(status ? { status } : {}) });
      layers.edited(caseId, answer.layer);
      refreshEditor(layer.name);
      try { storage?.setItem(memory(caseId), layer.name); } catch { /* the order is a convenience */ }
      notify(answer.added ? `Added to ${layer.title}` : `Already in ${layer.title}`, answer.added ? 'ok' : 'info');
      await refresh(caseId, ref);
      return true;
    } catch (error) {
      notify(error.message, 'danger');
      return false;
    } finally { busy = false; }
  }

  /** A new layer, made to hold the item: its name once the list holds it, else null. */
  async function create(caseId, ref, title) {
    busy = true;
    try {
      const row = await layers.createEditable(title);
      if (!row) return null;
      await refresh(caseId, ref);
      return row.name;
    } finally { busy = false; }
  }

  /** Take one of the item's markers out of a layer, with a way back. */
  async function remove(caseId, ref, { layer, marker }) {
    const path = `/api/cases/${caseId}/map-layers/${encodeURIComponent(layer.name)}/markers/${marker.key}`;
    busy = true;
    try {
      const answer = await api.del(path);
      layers.edited(caseId, answer.layer);
      refreshEditor(layer.name);
      await refresh(caseId, ref);
      notify(`Taken out of ${layer.title}`, 'info', 7000, { label: 'Undo', onClick: async () => {
        try {
          const back = await api.post(`${path}/restore`, {});
          layers.edited(caseId, back.layer);
          refreshEditor(layer.name);
          await refresh(caseId, ref);
        } catch (error) { notify(error.message, 'danger'); }
      } });
    } catch (error) {
      notify(error.message, 'danger');
    } finally { busy = false; }
  }

  return {
    get targets() { return targets; },
    get entity() { return entity; },
    get busy() { return busy; },
    /** The layer this case's items went into last, offered first. */
    last(caseId) { try { return storage?.getItem(memory(caseId)) ?? ''; } catch { return ''; } },
    refresh,
    add,
    create,
    remove,
  };
}
