/**
 * A proof's points in the analyst's layers: which layers they can join, where
 * they already are, and adding one or taking it back out.
 *
 * A marker added from a proof follows it (`engine/layerlinks.py`), so it is
 * added from the proof as saved, never from what the composer holds unsaved;
 * the composer saves first. A proof standing in several places has one marker
 * per point, and a marker belongs to the point it stands nearest to.
 */
import { specPath } from '../../lib/naming.js';
import { parseLatLon } from '../../lib/sheetRoles.js';

const memory = (caseId) => `azimut:proof-layer:${caseId}`;

/** Metres-ish between two points, for picking the nearest only. */
const apart = (first, second) => Math.hypot((first.lon - second.lon) * Math.cos((first.lat * Math.PI) / 180), first.lat - second.lat);

/**
 * The markers standing on each point of the proof: `texts` are the points'
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

/** The layers as the menu offers them: the one used last first, the others in their order. */
export function orderedTargets(targets, last = '') {
  return [...targets].sort((a, b) => (b.name === last) - (a.name === last));
}

export function createProofLayers({ api, layers, lookup, notify, refreshEditor = () => {}, storage = globalThis.localStorage }) {
  let targets = $state.raw([]);
  let entity = $state(null);
  let busy = $state(false);
  let asked = 0;

  async function refresh(caseId, savedName) {
    const ticket = ++asked;
    if (!caseId) { targets = []; entity = null; return; }
    try {
      const proof = savedName ? await lookup(caseId, 'spec', specPath('proof', savedName)) : null;
      const query = proof ? `?entity=${encodeURIComponent(proof.id)}` : '';
      const rows = await api.get(`/api/cases/${caseId}/layer-targets${query}`);
      if (ticket !== asked) return;
      entity = proof?.id ?? null;
      targets = rows;
    } catch {
      if (ticket === asked) targets = [];
    }
  }

  /**
   * The saved proof's point at `coords` into `layer`, in `group` (its first when
   * null), as a marker in `style` (`{ symbol, colour }`) or in the group's.
   */
  async function add(caseId, savedName, coords, layer, group = null, style = null) {
    busy = true;
    try {
      const at = parseLatLon(coords) ?? await api.post('/api/geo/parse', { text: coords });
      const proof = await lookup(caseId, 'spec', specPath('proof', savedName));
      if (!proof) throw new Error('This proof is no longer in the case');
      const answer = await api.post(`/api/cases/${caseId}/map-layers/${encodeURIComponent(layer.name)}/links`, {
        items: [{ id: proof.id, lat: at.lat, lon: at.lon }], ...(group ? { group: group.id } : {}), ...(style ?? {}) });
      layers.edited(caseId, answer.layer);
      refreshEditor(layer.name);
      try { storage?.setItem(memory(caseId), layer.name); } catch { /* the order is a convenience */ }
      notify(answer.added ? `Added to ${layer.title}` : `Already in ${layer.title}`, answer.added ? 'ok' : 'info');
      await refresh(caseId, savedName);
      return true;
    } catch (error) {
      notify(error.message, 'danger');
      return false;
    } finally { busy = false; }
  }

  /** A new layer, made to hold a point: its name once the list holds it, else null. */
  async function create(caseId, savedName, title) {
    busy = true;
    try {
      const row = await layers.createEditable(title);
      if (!row) return null;
      await refresh(caseId, savedName);
      return row.name;
    } finally { busy = false; }
  }

  /** Take a point's marker out of a layer, with a way back. */
  async function remove(caseId, savedName, { layer, marker }) {
    const path = `/api/cases/${caseId}/map-layers/${encodeURIComponent(layer.name)}/markers/${marker.key}`;
    busy = true;
    try {
      const answer = await api.del(path);
      layers.edited(caseId, answer.layer);
      refreshEditor(layer.name);
      await refresh(caseId, savedName);
      notify(`Taken out of ${layer.title}`, 'info', 7000, { label: 'Undo', onClick: async () => {
        try {
          const back = await api.post(`${path}/restore`, {});
          layers.edited(caseId, back.layer);
          refreshEditor(layer.name);
          await refresh(caseId, savedName);
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
    /** The layer this case's proofs went into last, offered first. */
    last(caseId) { try { return storage?.getItem(memory(caseId)) ?? ''; } catch { return ''; } },
    refresh,
    add,
    create,
    remove,
  };
}
