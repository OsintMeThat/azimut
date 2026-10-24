/**
 * The analyst's icon library (Settings → Icons), read once and shared by every
 * palette, and the icons each layer holds, read when a palette opens on it.
 *
 * `look` turns an icon key into what a preview draws, `{ key, src, mode }`: from
 * the library when it holds the icon, else from the copy the layer keeps.
 */
import { api as defaultApi } from './api.js';
import { importIcons } from './iconImport.js';
import { layerIconUrl, libraryIconUrl } from './map/ownIcons.js';

export const DEFAULT_GROUP = 'My icons';

export function createIconLibrary({ api = defaultApi, send = importIcons } = {}) {
  let icons = $state([]);
  let max = $state(1000);
  let loaded = $state(false);
  let asking = null;
  /** `${caseId}/${layer}` → the icons that layer holds (`GET …/icons`). */
  let held = $state({});

  const byKey = () => new Map(icons.map((icon) => [icon.key, icon]));
  const replace = (list) => { icons = Array.isArray(list) ? list : []; loaded = true; };

  return {
    get icons() { return icons; },
    get max() { return max; },
    get loaded() { return loaded; },
    /** The groups in the order their first icon was filed. */
    get groups() { return [...new Set(icons.map((icon) => icon.group || DEFAULT_GROUP))]; },
    load(again = false) {
      if (asking && !again) return asking;
      asking = api.get('/api/icons').then((body) => { replace(body?.icons); max = body?.max ?? max; return icons; })
        .catch(() => { asking = null; return icons; });
      return asking;
    },
    find(key) { return byKey().get(key) ?? null; },
    /** Whether the library holds this picture, by its key or the hash a layer stored it under. */
    holds(key, digest = '') {
      return icons.some((icon) => icon.key === key || icon.key === digest
        || (digest && icon.aliases?.includes(digest)) || icon.aliases?.includes(key));
    },
    /** Import pictures, filed in `group` when one is named, else by the folder each came in. */
    async importFiles(files, onprogress = null, group = '') {
      const answer = await send(files, { api, onprogress, ...(group ? { group } : {}) });
      await this.load(true);
      return answer;
    },
    async update(key, changes) {
      const icon = await api.patch(`/api/icons/${key}`, changes);
      icons = icons.map((one) => (one.key === key ? icon : one));
      return icon;
    },
    async remove(keys) {
      const body = await api.post('/api/icons/remove', { keys });
      replace(body.icons);
      return body.removed;
    },
    /** Read the icons a layer holds, as a palette opens on it: a copy may have brought some since. */
    loadLayer(caseId, layer) {
      if (!caseId || !layer) return Promise.resolve([]);
      const slot = `${caseId}/${layer}`;
      return api.get(`/api/cases/${caseId}/map-layers/${encodeURIComponent(layer)}/icons`)
        .then((list) => { held = { ...held, [slot]: Array.isArray(list) ? list : [] }; return held[slot]; })
        .catch(() => held[slot] ?? []);
    },
    /** The icons a layer holds, as last read (`loadLayer`). */
    layerIcons(caseId, layer) {
      return held[`${caseId}/${layer}`] ?? [];
    },
    /** Some of a layer's icons filed in the library, under the layer's name. */
    async fromLayer(caseId, layer, keys) {
      const body = await api.post(`/api/cases/${caseId}/map-layers/${encodeURIComponent(layer)}/icons/library`, { keys });
      replace(body.icons);
      return body;
    },
    /**
     * What a preview of `key` draws. `meta` is the layer's own `{key: {mode, name}}`
     * and wins over the library's mode, since that is how the layer draws it.
     */
    look(key, { caseId = null, layer = null, meta = null, mode = null } = {}) {
      if (!key) return null;
      const icon = byKey().get(key);
      const drawn = mode ?? meta?.[key]?.mode ?? icon?.mode ?? 'image';
      const src = icon || !caseId || !layer ? libraryIconUrl(key) : layerIconUrl(caseId, layer, key);
      return { key, src, mode: drawn === 'disc' ? 'disc' : 'image', name: meta?.[key]?.name || icon?.name || '' };
    },
  };
}

export const iconLibrary = createIconLibrary();
