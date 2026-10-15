/**
 * The layers the analyst added to this case, as every map reads them.
 *
 * One store for the whole app (`addedLayers` below), so a layer of a hundred
 * thousand features is fetched and parsed once however many maps draw it. The
 * Map's panel is where layers are added and worked; Compare, Detect and Horizon
 * only switch them on.
 *
 * Holds the list, the acts that change it, and the one thing that decides
 * whether this feature is honest about the network: **nothing here fetches on
 * mount.** Opening a case reads the layers already on disk and draws none of
 * them.
 *
 * **Whether a layer is on lives here**, and is kept per case in this browser
 * (`layerMemory.js`), so a case opens again on the layers each map had on. Each
 * map keeps its own switches (a scope per tool), so a layer is drawn only where it
 * was asked for. A case opening puts them back **one at a time**, each once the
 * one before is drawn, and a layer being drawn is marked as such until it is: a
 * layer heavy enough to take the tab down leaves its mark behind, and the next
 * session leaves that one off and says so rather than going down with it again. A
 * layer whose features cannot be read or drawn is switched off where it is.
 *
 * Switching a followed layer on for the first time in the session, in any map, is
 * what re-reads it, when it asked to be; one put back as the case opens draws the
 * snapshot it holds and asks nothing. An off layer never costs a request, and one
 * switched on offline draws the snapshot it holds.
 *
 * The parsed GeoJSON is kept here rather than in the overlay component so that
 * switching a layer off and on again does not re-read a file the browser already
 * has, and so the count on the row and the marks on the map come from one copy.
 *
 * @param {object} deps
 * @param {object} deps.api the app's fetch wrapper
 * @param {(message: string, kind?: string, ms?: number) => void} deps.notify
 * @param {() => Promise<object>} deps.ensureCase the case to add into, made if needed
 * @param {() => Promise<any>} deps.reloadCase
 * @param {ReturnType<import('./layerMemory.js').createLayerMemory>} [deps.memory]
 *   where the switches are kept between sessions
 */
import { api as appApi } from '../api.js';
import { ensureCase as appEnsureCase, reloadCase as appReloadCase, toast } from '../state.svelte.js';
import {
  drawable,
  followed,
  refreshedLabel,
  renewsOnShow,
  searchFeatures,
  toggleCategory,
} from './addedLayers.js';
import { active, indexDates, within } from './layerDates.js';
import { isTracked, moments as momentsOf } from './layerHistory.js';
import { layerMemory } from './layerMemory.js';

/** How a tracked layer is read when nobody moved its cursor: as it is now, with its trail. */
export const NOW = Object.freeze({ at: null, trail: true, since: null, window: 7 });

/** The Map's switches, where layers are added: what `rows`, `drawn` and `toggle` read. */
const MAP = 'satellite';

export function createAddedLayersState({ api, notify, ensureCase, reloadCase, memory = layerMemory }) {
  let rows = $state([]);
  let open = $state(true);
  let busy = $state(''); // the layer name an act is running on
  let refreshing = $state(false); // the head's Refresh is going through every layer
  let justAdded = $state(''); // the layer the + just filed, which opens unfolded
  let adding = $state(false); // the + dialog is up
  let saving = $state(false); // …and it is reading a file or an address
  let geoconfirmed = $state(false); // the GeoConfirmed dialog the + led to
  /** GeoConfirmed's conflicts, read the first time its dialog opens and kept for
   *  the session: they change a few times a year. */
  let conflictList = null;

  /** name → the parsed collection, once something has asked to draw it. */
  const drawings = new Map();
  /** …and which of them are in hand, as state, because a search box already open
   *  has to fill the moment its layer's features land. The collections
   *  themselves stay out of it: they run to a hundred thousand features and
   *  nothing reactive needs to look inside one. */
  let held = $state(new Set());
  /** The search result the map is being sent to, if any. Counted rather than
   *  timed, so picking the same result twice is twice. */
  let picked = $state(null);
  let picks = 0;
  let loadedFor = null; // the case every row was read for
  let readFor = ''; // …and the reload it was read at, so four maps ask once
  let asked = 0; // the latest list read, so an older answer lands nowhere
  /** scope → the layers switched on in that map, kept per case: see the header. */
  let on = $state({});
  /** scope → the layers the case opened with that are still to be drawn there,
   *  in turn. Listed as on, drawn once the one before them is. */
  let waiting = $state({});
  /** scope → the layer being put back there now, whose drawing lets the next one in. */
  let heads = {};
  /** The case whose kept switches were put back, so a reload does not do it twice. */
  let restoredFor = null;
  /** name → `{ caseId, count }`: the layers being drawn, and in how many maps. */
  const inFlight = new Map();
  /** name → the period a strip is being dragged to, ahead of the stored one, so
   *  the map and the counter follow the pointer and the backend hears the end. */
  let drafts = $state({});
  /** name → `{ collection, index }`: the days of a layer's features, indexed
   *  once per snapshot rather than on every frame of a drag. */
  const indexes = new Map();
  /** name → how a tracked layer is read: the moment its cursor is on (null for
   *  now), its trail, and the reference its gains are counted from. The page's
   *  and never stored, so a layer opens on what it is now, in every map at once. */
  let times = $state({});
  /** name → `{ collection, list }`: the moments a layer changes at, once per snapshot. */
  const momentLists = new Map();
  /** …and the ones already re-read this session, so switching one off and on
   *  again draws what is in hand rather than asking its source again. */
  const renewed = new Set();

  function reset() {
    rows = [];
    times = {};
    drawings.clear();
    held = new Set();
    picked = null;
    on = {};
    waiting = {};
    heads = {};
    restoredFor = null;
    renewed.clear();
    settleAll();
  }

  /** Nothing is being drawn any more, in whichever case it was. */
  function settleAll() {
    for (const [name, { caseId }] of inFlight) memory.markDrawing(caseId, name, false);
    inFlight.clear();
  }

  function show(scope, name, visible) {
    const next = new Set(on[scope]);
    if (visible) next.add(name);
    else next.delete(name);
    on = { ...on, [scope]: next };
  }

  const isOn = (scope, name) => Boolean(on[scope]?.has(name) || waiting[scope]?.includes(name));

  /** Take a layer out of one map's turn, letting the next one in if it was drawing. */
  function unqueue(scope, name) {
    if (waiting[scope]?.includes(name)) {
      waiting = { ...waiting, [scope]: waiting[scope].filter((entry) => entry !== name) };
    }
    if (heads[scope] === name) advance(scope);
  }

  /** The next layer a map was opened with, now that the one before it is drawn. */
  function advance(scope) {
    const [next, ...rest] = waiting[scope] ?? [];
    if (!next) {
      delete heads[scope];
      return;
    }
    waiting = { ...waiting, [scope]: rest };
    heads[scope] = next;
    show(scope, next, true);
  }

  /** Off in every map: what a removed layer is. */
  function hide(name) {
    on = Object.fromEntries(
      Object.entries(on).map(([scope, names]) => [scope, new Set([...names].filter((entry) => entry !== name))])
    );
    for (const scope of Object.keys(waiting)) unqueue(scope, name);
  }

  /**
   * Keep every map's switches for this case, the ones still waiting their turn
   * included. Not before they were put back, or a case opening would forget them.
   */
  function keep() {
    if (!loadedFor || restoredFor !== loadedFor) return;
    const scopes = new Set([...Object.keys(on), ...Object.keys(waiting)]);
    memory.keepAdded(
      loadedFor,
      Object.fromEntries([...scopes].map((scope) => [scope, [...(on[scope] ?? []), ...(waiting[scope] ?? [])]]))
    );
  }

  /**
   * Put back what each map had on in this case, the first layer of each now and
   * the rest in turn. A layer the last session was still drawing when it stopped
   * stays off, and the toast says which.
   */
  function restore(list) {
    restoredFor = loadedFor;
    const present = list.map((row) => row.name);
    const stalled = memory.drawing(loadedFor).filter((name) => present.includes(name));
    memory.clearDrawing(loadedFor);
    const kept = memory.added(loadedFor);
    for (const [scope, names] of Object.entries(kept)) {
      const wanted = present.filter((name) => names.includes(name) && !stalled.includes(name) && !isOn(scope, name));
      if (!wanted.length) continue;
      waiting = { ...waiting, [scope]: wanted };
      if (!heads[scope]) advance(scope);
    }
    keep();
    if (!stalled.length) return;
    const title = list.find((row) => row.name === stalled[0])?.title || stalled[0];
    notify(
      stalled.length === 1
        ? `${title} was left off: the last session stopped while drawing it`
        : `${stalled.length} layers were left off: the last session stopped while drawing them`,
      'warn',
      10000
    );
  }

  /** A map began drawing a layer: marked until it is drawn, so a tab dying on it is known. */
  function started(name) {
    if (!loadedFor) return;
    const held = inFlight.get(name);
    if (held) {
      held.count += 1;
      return;
    }
    inFlight.set(name, { caseId: loadedFor, count: 1 });
    memory.markDrawing(loadedFor, name, true);
  }

  /**
   * A map is done with a layer: `drawn`, `failed` (its features could not be read
   * or drawn), or `dropped` (switched off, or the map hidden, before it was).
   */
  function ended(scope, name, outcome) {
    const held = inFlight.get(name);
    if (!held) return; // a case since left
    held.count -= 1;
    if (held.count <= 0) {
      inFlight.delete(name);
      memory.markDrawing(held.caseId, name, false);
    }
    if (held.caseId !== loadedFor) return;
    if (outcome === 'failed') failed(name);
    else if (outcome === 'drawn' && heads[scope] === name) advance(scope);
  }

  /** Off everywhere, and said once however many maps were drawing it. */
  function failed(name) {
    if (!Object.keys({ ...on, ...waiting }).some((scope) => isOn(scope, name))) return;
    hide(name);
    keep();
    const title = rows.find((row) => row.name === name)?.title || name;
    notify(`${title} could not be drawn and was switched off`, 'error');
  }

  /** What a map's overlay reports its drawing to. */
  const watcher = (scope) => ({
    start: (name) => started(name),
    end: (name, outcome) => ended(scope, name, outcome),
  });
  const mapWatch = watcher(MAP);

  /** The rows as one map reads them, each saying whether it is on there. */
  function listed(scope = MAP) {
    return rows.map((row) => {
      const enabled = isOn(scope, row.name);
      // a tracked layer is read at a moment, not filtered by a period
      if (isTracked(row)) return { ...row, enabled, period: null, time: times[row.name] ?? NOW };
      const period = row.name in drafts ? drafts[row.name] : (row.period ?? null);
      const listing = { ...row, enabled, period };
      const index = active(period) ? datesOf(row.name) : null;
      if (!index) return listing;
      // what a period leaves on the map, which the counter and the legend state
      const counted = within(index, row.hidden, period);
      return { ...listing, shown: counted.total, shownBy: counted.byGroup };
    });
  }

  /** The indexed days of a layer whose features are in hand, or null. */
  function datesOf(name) {
    if (!held.has(name)) return null;
    const collection = drawings.get(name);
    const memo = indexes.get(name);
    if (memo?.collection === collection) return memo.index;
    const index = indexDates(collection);
    indexes.set(name, { collection, index });
    return index;
  }

  /** Drop a layer's features, which is what a new snapshot and a removal both do. */
  function forget(name) {
    drawings.delete(name);
    indexes.delete(name);
    momentLists.delete(name);
    if (!held.has(name)) return;
    const next = new Set(held);
    next.delete(name);
    held = next;
  }

  function replace(row) {
    const index = rows.findIndex((entry) => entry.name === row.name);
    if (index < 0) rows = [row, ...rows];
    else rows = rows.map((entry) => (entry.name === row.name ? row : entry));
  }

  /** What one map draws: its rows that are on, less the ones still waiting their turn. */
  function drawnIn(scope) {
    return drawable(listed(scope)).filter((row) => on[scope]?.has(row.name));
  }

  /**
   * Read this case's layers. Disk only, and each map's kept switches are put back
   * from the first read that answers.
   *
   * Every mounted map calls it when the case opens or reloads, so it reads once
   * per case and reload (`rev`): a layer Detect files from its findings reaches
   * every map's list from that one read. An answer for a case or a reload that
   * has since moved on lands nowhere.
   */
  function load(caseId, rev = 0) {
    if (loadedFor !== caseId) {
      loadedFor = caseId;
      reset();
    }
    const key = `${caseId}\u0000${rev}`;
    if (!caseId || key === readFor) return;
    readFor = key;
    const ticket = ++asked;
    api
      .get(`/api/cases/${caseId}/map-layers`)
      .then((list) => {
        if (ticket !== asked) return;
        rows = Array.isArray(list) ? list : [];
        if (Array.isArray(list) && restoredFor !== caseId) restore(rows);
      })
      .catch(() => {
        if (ticket === asked) rows = [];
      });
  }

  /**
   * Re-read a followed layer the first time it is switched on in the session.
   *
   * Silent when it fails: the snapshot is already being drawn, and the row says
   * how old it is — a source that cannot be reached is not worth a toast.
   */
  function renew(caseId, layer) {
    renewed.add(layer.name);
    return act(layer.name, async () => {
      try {
        const row = await api.post(`/api/cases/${caseId}/map-layers/${encodeURIComponent(layer.name)}/refresh`);
        if (loadedFor !== caseId) return;
        if (row.sha256 !== layer.sha256) forget(row.name);
        replace(row);
      } catch {
        /* the snapshot stays on the map, and the row says when it was last read */
      }
    });
  }

  /**
   * The parsed collection for one layer, read once and kept.
   *
   * Always checked with the server: the address stays the same through every
   * refresh, and a browser cache filled before the backend said `no-cache`
   * would otherwise go on handing back the features it read then.
   */
  async function drawing(caseId, name) {
    if (drawings.has(name)) return drawings.get(name);
    const owner = loadedFor;
    const version = rows.find((row) => row.name === name)?.sha256;
    const data = await api.get(`/api/cases/${caseId}/map-layers/${encodeURIComponent(name)}/data`, {
      cache: 'no-cache',
    });
    if (loadedFor !== owner || rows.find((row) => row.name === name)?.sha256 !== version) return data;
    drawings.set(name, data);
    held = new Set(held).add(name);
    return data;
  }

  /**
   * Fetch one followed layer again: `'moved'` when the bytes changed, `'same'`
   * when they did not. A failure throws, with the reason the backend gave.
   */
  function reread(caseId, layer) {
    return act(layer.name, async () => {
      const row = await api.post(`/api/cases/${caseId}/map-layers/${encodeURIComponent(layer.name)}/refresh`);
      if (loadedFor !== caseId) return 'same';
      const moved = row.sha256 !== layer.sha256;
      if (moved) forget(row.name);
      replace(row);
      return moved ? 'moved' : 'same';
    });
  }

  async function act(name, run) {
    busy = name;
    try {
      return await run();
    } finally {
      busy = '';
    }
  }

  /**
   * Every way in through the `+`, which differ only in what they post.
   *
   * A refusal is a toast and an open dialog, not a closed one: the reason the
   * backend gave — a KMZ with no KML in it, a My Maps that was never shared — is
   * something to act on, and closing the dialog would take the input away with it.
   */
  async function add(post, fallback) {
    const kase = await ensureCase();
    if (!kase) return null;
    saving = true;
    try {
      const row = await post(kase.id);
      replace(row);
      // on, since it was added to be looked at, and just read
      show(MAP, row.name, true);
      keep();
      justAdded = row.name;
      renewed.add(row.name);
      adding = false;
      geoconfirmed = false;
      await reloadCase();
      notify(`${row.title} added`, 'ok');
      return row;
    } catch (error) {
      notify(error?.message || fallback, 'error');
      return null;
    } finally {
      saving = false;
    }
  }

  /**
   * `icons` is the analyst's own tick, and it is the only thing on this path
   * that can reach out for a file: a KMZ carries its pictograms inside itself,
   * but a KML points at somebody else's server, and following that is a request
   * the dialog asks for rather than assumes.
   */
  function addFile(file, icons = false) {
    const body = new FormData();
    body.append('file', file);
    body.append('icons', String(Boolean(icons)));
    return add(
      (caseId) => api.post(`/api/cases/${caseId}/map-layers/upload`, body),
      'That file could not be read'
    );
  }

  function subscribe(url, icons = true) {
    return add(
      (caseId) => api.post(`/api/cases/${caseId}/map-layers`, { url, icons }),
      'That address could not be read'
    );
  }

  /** One GeoConfirmed conflict over a window, as `lib/map/geoconfirmed.js` builds it. */
  function addGeoConfirmed(body) {
    return add(
      (caseId) => api.post(`/api/cases/${caseId}/map-layers/geoconfirmed`, body),
      'GeoConfirmed could not be read'
    );
  }

  async function conflicts() {
    conflictList ??= await api.get('/api/geoconfirmed/conflicts');
    return conflictList;
  }

  async function patch(caseId, name, body) {
    const row = await api.patch(`/api/cases/${caseId}/map-layers/${encodeURIComponent(name)}`, body);
    replace(row);
    return row;
  }

  /** The eye on a row in one map, kept for the case in this browser only. */
  function toggleIn(scope, caseId, layer) {
    const visible = !isOn(scope, layer.name);
    show(scope, layer.name, visible);
    if (!visible) unqueue(scope, layer.name);
    keep();
    if (visible && !renewed.has(layer.name) && renewsOnShow(layer)) {
      return renew(caseId, layer);
    }
    return Promise.resolve();
  }

  return {
    get rows() {
      return listed();
    },
    get drawn() {
      return drawnIn(MAP);
    },
    /** What the Map's overlay reports its drawing to. */
    watch: mapWatch,
    /**
     * One map's own switches over the same layers: Compare, Detect and Horizon
     * each ask with their tool's id, and draw only what they switched on.
     */
    scope(name) {
      const watch = watcher(name);
      return {
        get rows() {
          return listed(name);
        },
        get drawn() {
          return drawnIn(name);
        },
        toggle: (caseId, layer) => toggleIn(name, caseId, layer),
        watch,
      };
    },
    /** The page is closing on its own: nothing it was drawing took it down. */
    leave: settleAll,
    get open() {
      return open;
    },
    set open(value) {
      open = value;
    },
    get busy() {
      return busy;
    },
    get refreshing() {
      return refreshing;
    },
    get justAdded() {
      return justAdded;
    },
    get adding() {
      return adding;
    },
    set adding(value) {
      adding = value;
    },
    get geoconfirmed() {
      return geoconfirmed;
    },
    set geoconfirmed(value) {
      geoconfirmed = value;
    },
    get saving() {
      return saving;
    },
    /** The match the map is being sent to, read by the overlay and nothing else. */
    get picked() {
      return picked;
    },
    load,
    drawing,
    addFile,
    createEditable(title, description = '') {
      return add((caseId) => api.post(`/api/cases/${caseId}/map-layers/editable`, { title, description }),
        'Could not create the layer');
    },
    importEditable(file, title, description = '') {
      const body = new FormData();
      body.append('file', file);
      body.append('title', title);
      body.append('description', description);
      return add((caseId) => api.post(`/api/cases/${caseId}/map-layers/editable/upload`, body),
        'Could not import the layer');
    },
    copyEditable(layer, title, description = '') {
      return add((caseId) => api.post(`/api/cases/${caseId}/map-layers/${encodeURIComponent(layer.name)}/editable-copy`, { title, description }),
        'Could not copy the layer');
    },
    edited(caseId, row) {
      if (loadedFor !== caseId) return;
      forget(row.name);
      replace(row);
    },
    subscribe,
    addGeoConfirmed,
    conflicts,

    /**
     * The features of one layer that match what was typed.
     *
     * Memory and nothing else: the collection was fetched to draw the layer, so
     * a keystroke costs no request — not to a server, not to this one. `ready`
     * is what tells "nothing matches that" apart from "the features are still on
     * their way", which are two different things to say to somebody searching.
     */
    search(layer, query) {
      const name = layer?.name ?? '';
      if (!held.has(name)) return { total: 0, results: [], ready: false };
      return {
        ...searchFeatures(drawings.get(name), query, {
          categories: layer.categories,
          hidden: layer.hidden,
          period: layer.period,
        }),
        ready: true,
      };
    },

    /**
     * Send the map to one match, and open the card the source wrote for it.
     *
     * A match in a group the legend switched off is listed all the same, so
     * picking it turns that group back on first: framing a feature that is not
     * drawn would be the map travelling somewhere to show nothing.
     */
    async pick(caseId, layer, result) {
      if (result?.hidden && layer.hidden?.includes(result.category)) {
        await patch(caseId, layer.name, {
          hidden: toggleCategory(layer, result.category),
        }).catch(() => {});
      }
      // a match outside the period lets every date back in: the map cannot be
      // sent to a feature it is filtering out
      if (result?.outside) await this.setPeriod(caseId, layer, null, true);
      picks += 1;
      picked = { name: layer.name, index: result.index, at: picks };
    },

    /**
     * The days a layer's features carry, indexed, for its time strip — or null
     * while they are on their way, or when the source dated none of them.
     */
    dates(layer) {
      return datesOf(layer?.name ?? '');
    },

    /** A layer's features once something drew them, else null: what a plate's legend reads. */
    collection(name) {
      return held.has(name) ? drawings.get(name) ?? null : null;
    },

    /** How a tracked layer is read right now (`NOW` until its cursor moves). */
    time(name) {
      return times[name] ?? NOW;
    },

    /** Move a tracked layer's cursor, or switch its trail or its gains: every map follows. */
    setTime(name, patch) {
      times = { ...times, [name]: { ...(times[name] ?? NOW), ...patch } };
    },

    /** The moments a tracked layer changes at, once its features are in hand, else []. */
    moments(name) {
      if (!held.has(name)) return [];
      const collection = drawings.get(name);
      const memo = momentLists.get(name);
      if (memo?.collection === collection) return memo.list;
      const list = momentsOf(collection);
      momentLists.set(name, { collection, list });
      return list;
    },

    /**
     * The row's time filter. While the strip is dragged (`commit` false) only
     * the page follows it; on release it is kept on the layer, as the legend is.
     * A failed save puts back what the layer held.
     */
    async setPeriod(caseId, layer, period, commit) {
      const name = layer.name;
      drafts = { ...drafts, [name]: period };
      if (!commit) return;
      try {
        await patch(caseId, name, { period: period ?? { start: '', end: '' } });
      } catch {
        /* the stored period stands, and the strip goes back to it */
      }
      const rest = { ...drafts };
      delete rest[name];
      drafts = rest;
    },

    /**
     * The eye on the Map's row. Off costs nothing and asks for nothing; the
     * first time on in the session re-reads a followed layer that asked for it,
     * while the snapshot already on disk is drawn.
     */
    toggle(caseId, layer) {
      return toggleIn(MAP, caseId, layer);
    },

    /** One legend row, which hides exactly its own features. */
    toggleCategory(caseId, layer, name) {
      return patch(caseId, layer.name, { hidden: toggleCategory(layer, name) }).catch(
        () => {}
      );
    },

    /** The explicit press. The second of this feature's three network calls. */
    async refresh(caseId, layer) {
      try {
        const result = await reread(caseId, layer);
        notify(result === 'same' ? 'Unchanged since last read' : `${layer.title} updated`, 'ok');
      } catch (error) {
        notify(error?.message || 'That source could not be reached', 'error');
      }
    },

    /**
     * The same press on every followed layer, one after the other so each row
     * says when its own turn comes, and one toast at the end rather than one
     * per layer. A file has nothing to read and is left alone.
     */
    async refreshAll(caseId) {
      const due = rows.filter(followed);
      if (!due.length || refreshing) return;
      refreshing = true;
      let moved = 0;
      let failed = 0;
      try {
        for (const layer of due) {
          try {
            if ((await reread(caseId, layer)) === 'moved') moved += 1;
          } catch {
            failed += 1;
          }
        }
      } finally {
        refreshing = false;
      }
      const kind = failed === due.length ? 'error' : failed ? 'warn' : 'ok';
      notify(refreshedLabel({ moved, failed, total: due.length }), kind);
    },

    /**
     * The rows as they were dragged, top of the map first. The list moves at
     * once, and a failed save puts it back.
     */
    async reorder(caseId, names) {
      const before = rows;
      const at = new Map(rows.map((row) => [row.name, row]));
      const kept = names.filter((name) => at.has(name));
      const positions = new Set(kept);
      let index = 0;
      rows = rows.map((row) => positions.has(row.name) ? at.get(kept[index++]) : row);
      try {
        const list = await api.put(`/api/cases/${caseId}/map-layers/order`, {
          names: rows.map((row) => row.name),
        });
        if (loadedFor === caseId && Array.isArray(list)) rows = list;
        return true;
      } catch (error) {
        if (loadedFor === caseId) rows = before;
        notify(error?.message || 'That order could not be kept', 'error');
        return false;
      }
    },

    async remove(caseId, layer) {
      return act(layer.name, async () => {
        try {
          const result = await api.del(`/api/cases/${caseId}/map-layers/${encodeURIComponent(layer.name)}`);
          forget(layer.name);
          hide(layer.name);
          keep();
          renewed.delete(layer.name);
          rows = rows.filter((entry) => entry.name !== layer.name);
          await reloadCase();
          return result;
        } catch (error) {
          notify(error?.message || 'That layer could not be removed', 'error');
        }
      });
    },
  };
}

/** The one store every map reads, so a layer's features are fetched and held once. */
export const addedLayers = createAddedLayersState({
  api: appApi,
  notify: toast,
  ensureCase: appEnsureCase,
  reloadCase: appReloadCase,
});

// A page closed or reloaded on purpose was not taken down by what it was drawing.
// One that dies never gets here, which is what leaves its mark behind.
globalThis.addEventListener?.('pagehide', () => addedLayers.leave());
