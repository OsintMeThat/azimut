/**
 * Horizon's buildings: whether they are on, how they are drawn, and the tiles
 * the app has merged for the area round the eye (api/horizon_buildings.py).
 *
 * Nothing is asked of the app until the Buildings row is switched on. Then the
 * area is asked again every `POLL_MS` while tiles are still coming or a
 * 3D-GloBFP grid downloads, and each ready tile is fetched once per version (a
 * tile is drawn again when a download lends it estimates). A grid is downloaded
 * only when the analyst says yes to its size (`allow`); "Not now" stops the
 * question for that grid until the page is reloaded.
 *
 * The settings are kept in this browser, as the summit names switch is.
 */
import {
  alignment, caveat, credits, describeBuilding, downloading, formatSize, keyNumbers, problems, question, readSettings,
  sourcesParam, splitBatch, summary, tilesToFetch,
} from '../../../lib/horizon/buildings.js';

export const BUILDINGS_KEY = 'azimut.horizon.buildings';
/** ms between two askings while the area fills. */
export const POLL_MS = 1500;
/** ms the eye must rest after a move before the area round it is asked. */
export const MOVE_DELAY = 400;
/** Tiles asked in one batch (api/horizon.py TILES_MAX). */
export const TILES_PER_ASK = 32;

function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

async function fetchBytes(path) {
  const answer = await fetch(path);
  if (!answer.ok) throw new Error(`The app answered ${answer.status}`);
  return answer.arrayBuffer();
}

/**
 * @param {object} deps
 * @param {object} deps.api the app's fetch wrapper
 * @param {(path: string) => Promise<ArrayBuffer>} [deps.bytes] a binary GET, for tests
 * @param {Storage|null} [deps.storage]
 * @param {(fn: Function, ms: number) => any} [deps.later] @param {(handle: any) => void} [deps.cancel]
 */
export function createBuildingsState({ api, bytes = fetchBytes, storage = browserStorage(), later = setTimeout, cancel = clearTimeout }) {
  const remembered = () => {
    try {
      return storage?.getItem(BUILDINGS_KEY) ?? null;
    } catch {
      return null;
    }
  };
  let settings = $state(readSettings(remembered()));
  let status = $state.raw(null);
  // key → { key, x, y, bytes, version }
  let tiles = $state.raw(new Map());
  let busy = $state(false);
  let error = $state('');
  let declined = $state.raw(new Set());
  let panelOpen = $state(false);
  let info = $state('');
  let eye = null;
  let asked = 0;
  let timer = null;
  let moveTimer = null;

  function save() {
    try {
      storage?.setItem(BUILDINGS_KEY, JSON.stringify(settings));
    } catch {
      // a refused storage only means the choice is not kept
    }
  }

  const query = () =>
    `lat=${eye.lat.toFixed(6)}&lon=${eye.lon.toFixed(6)}&radius=${settings.radius}&sources=${sourcesParam(settings.sources)}`;

  function stop() {
    cancel(timer);
    timer = null;
  }

  function clear() {
    stop();
    asked += 1;
    status = null;
    tiles = new Map();
    busy = false;
    error = '';
    info = '';
  }

  async function refresh() {
    stop();
    if (!settings.on) {
      // off: nothing more is asked, and what is held stays for the next time it is switched on
      asked += 1;
      busy = false;
      return;
    }
    if (!eye) {
      clear();
      return;
    }
    if (!sourcesParam(settings.sources)) {
      clear();
      error = 'Switch on at least one source.';
      return;
    }
    const ask = ++asked;
    busy = true;
    try {
      const answer = await api.get(`/api/horizon/buildings?${query()}`);
      if (ask !== asked) return;
      status = answer;
      error = '';
      // tiles the area no longer reaches are let go; the ready ones not held are fetched
      const inArea = new Set(answer.tiles.map((t) => t.key));
      const kept = new Map([...tiles].filter(([key]) => inArea.has(key)));
      const wanted = tilesToFetch(answer, kept);
      const versions = new Map(wanted.map((t) => [t.key, t.version]));
      for (let i = 0; i < wanted.length; i += TILES_PER_ASK) {
        const keys = wanted.slice(i, i + TILES_PER_ASK).map((t) => t.key);
        const body = await bytes(`/api/horizon/buildings/tiles?t=${keys.join(',')}&sources=${sourcesParam(settings.sources)}`);
        if (ask !== asked) return;
        for (const [key, data] of splitBatch(body, keys)) {
          if (data) kept.set(key, { key, ...keyNumbers(key), bytes: data, version: versions.get(key) });
        }
        tiles = new Map(kept);
      }
      tiles = kept;
      const live =
        answer.pending > 0 ||
        answer.working > 0 ||
        answer.downloads.some((d) => !d.error) ||
        kept.size < answer.tiles.filter((t) => t.ready).length;
      if (live) timer = later(refresh, POLL_MS);
      else if (answer.failed.length && answer.retry_in > 0) timer = later(refresh, answer.retry_in * 1000 + 250);
    } catch (failure) {
      if (ask !== asked) return;
      error = failure?.message ?? String(failure);
      timer = later(refresh, POLL_MS * 4);
    } finally {
      if (ask === asked) busy = false;
    }
  }

  function set(patch) {
    const before = settings;
    settings = { ...settings, ...patch };
    save();
    if (
      'on' in patch ||
      before.radius !== settings.radius ||
      sourcesParam(before.sources) !== sourcesParam(settings.sources)
    ) {
      if (!settings.on) info = '';
      refresh();
    }
  }

  return {
    get settings() {
      return settings;
    },
    get on() {
      return settings.on;
    },
    get status() {
      return status;
    },
    get busy() {
      return busy;
    },
    get error() {
      return error;
    },
    get summaryText() {
      return summary(status);
    },
    get creditLines() {
      return credits(status);
    },
    get question() {
      return question(status, declined);
    },
    get downloadingText() {
      return downloading(status);
    },
    get problems() {
      return [...problems(status), ...(error ? [error] : [])];
    },
    get info() {
      return info;
    },
    get panelOpen() {
      return panelOpen;
    },
    set panelOpen(value) {
      panelOpen = Boolean(value);
    },
    /**
     * The Layers menu's row (components/LayerRows.svelte): its switch, what the area
     * holds or waits for, and the yes or no to a download.
     */
    get layerRow() {
      const said = [
        busy && !status ? 'Reading the area…' : summary(status),
        downloading(status),
        ...problems(status),
        ...(error ? [error] : []),
      ].filter(Boolean);
      return {
        id: 'buildings',
        group: 'reference',
        label: 'Buildings',
        title: 'Buildings round the eye, raised from open data',
        on: settings.on,
        toggle: () => set({ on: !settings.on }),
        note: settings.on ? said.join(' · ') : '',
        actions: settings.on
          ? [{ label: panelOpen ? 'Hide settings' : 'Settings', quiet: true, run: () => (panelOpen = !panelOpen) }]
          : [],
      };
    },
    /**
     * What the view says over the picture, or null: the question before a download, with
     * its buttons, else a download or the area being raised, with how far along it is
     * (`share`, 0 to 1, or null when that is not known).
     */
    get banner() {
      if (!settings.on) return null;
      const asking = question(status, declined);
      if (asking) {
        return {
          kind: 'ask',
          text: asking.text,
          share: null,
          actions: [
            ...asking.groups.map((g) => ({
              label: `Download ${g.name} (${formatSize(g.size)})`,
              run: () => this.allow(g.source),
            })),
            { label: 'Not now', quiet: true, run: () => this.decline() },
          ],
        };
      }
      const live = (status?.downloads ?? []).filter((d) => !d.error);
      if (live.length) {
        const total = live.reduce((sum, d) => sum + d.total, 0);
        const done = live.reduce((sum, d) => sum + d.done, 0);
        return { kind: 'progress', text: `Downloading ${downloading(status)}`, share: total ? done / total : null, actions: [] };
      }
      const all = status?.tiles?.length ?? 0;
      if ((busy && !status) || status?.pending || status?.working) {
        const ready = status?.tiles?.filter((t) => t.ready).length ?? 0;
        return {
          kind: 'progress',
          text: 'Raising the buildings…',
          share: status?.pending && all ? ready / all : null,
          actions: [],
        };
      }
      return null;
    },
    /** What the view notes under the picture while buildings show: where their heights come from, and that they can be wrong. */
    get caveat() {
      return settings.on ? caveat(status, settings) : null;
    },
    /** The tiles held for the scene (mesh/scene.js `setBuildings`), drawn or not. */
    get sceneTiles() {
      return [...tiles.values()];
    },
    /** How the scene draws a building nobody knows the height of. */
    get sceneOptions() {
      return { unknown: settings.unknown, unknownHeight: settings.unknownHeight };
    },
    /** What the renderer draws the buildings with, at the eye's latitude. */
    drawOptions(lat) {
      return {
        buildings: settings.look,
        roofs: settings.roofs,
        showKinds: settings.showKinds,
        ...alignment(settings, lat ?? 0),
      };
    },

    set,
    toggle() {
      set({ on: !settings.on });
    },
    resetAlignment() {
      set({ shift: [0, 0], lean: [0, 0] });
    },
    /** The eye stands somewhere new: the area round it is asked once it rests. */
    follow(observer) {
      const next = observer ? { lat: observer.lat, lon: observer.lon } : null;
      if (next && eye && next.lat === eye.lat && next.lon === eye.lon) return;
      eye = next;
      cancel(moveTimer);
      if (!settings.on) return;
      moveTimer = later(refresh, MOVE_DELAY);
    },
    refresh,
    /** The analyst said yes to the files the question named: one source's, or all of them. */
    async allow(source = null) {
      const asking = question(status, declined);
      if (!asking) return;
      const grids = source ? (asking.groups.find((g) => g.source === source)?.grids ?? []) : asking.grids;
      if (!grids.length) return;
      try {
        await api.post('/api/horizon/buildings/allow', { grids });
      } catch (failure) {
        error = failure?.message ?? String(failure);
        return;
      }
      await refresh();
    },
    /** "Not now": the question is not asked again for these grids in this page. */
    decline() {
      const asking = question(status, declined);
      if (asking) declined = new Set([...declined, ...asking.grids]);
    },
    async clearCache() {
      busy = true;
      try {
        await api.del('/api/horizon/buildings/cache');
        tiles = new Map();
      } catch (failure) {
        error = failure?.message ?? String(failure);
      } finally {
        busy = false;
      }
      await refresh();
    },
    /** The building at a point of the ground, said in words; nothing where there is none. */
    async inspect(point) {
      if (!settings.on || point?.lat == null) {
        info = '';
        return;
      }
      try {
        const found = await api.get(
          `/api/horizon/buildings/at?lat=${point.lat.toFixed(7)}&lon=${point.lon.toFixed(7)}&sources=${sourcesParam(settings.sources)}`
        );
        info = describeBuilding(found);
      } catch {
        info = '';
      }
    },
    destroy() {
      stop();
      cancel(moveTimer);
      asked += 1;
    },
  };
}
