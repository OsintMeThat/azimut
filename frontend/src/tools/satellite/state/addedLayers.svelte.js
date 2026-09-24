/**
 * The layers the analyst added to this case, as the Map's panel works them.
 *
 * Holds the list, the acts that change it, and the one thing that decides
 * whether this feature is honest about the network: **nothing here fetches on
 * mount.** Opening a case reads the layers already on disk and draws none of
 * them.
 *
 * **Whether a layer is on lives here and nowhere else**, so every layer starts
 * off when the app or the page is opened again: one heavy enough to take the tab
 * down would otherwise take it down again on every reload. Switching a followed
 * layer on for the first time in the session is what re-reads it, when it asked
 * to be; an off layer never costs a request, and one switched on offline draws
 * the snapshot it holds.
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
 */
import {
  drawable,
  renewsOnShow,
  searchFeatures,
  toggleCategory,
} from '../../../lib/map/addedLayers.js';
import { active, indexDates, within } from '../../../lib/map/layerDates.js';

export function createAddedLayersState({ api, notify, ensureCase, reloadCase }) {
  let rows = $state([]);
  let open = $state(true);
  let busy = $state(''); // the layer name an act is running on
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
  /** The layers switched on in this page. Never stored: see the header. */
  let on = $state(new Set());
  /** name → the period a strip is being dragged to, ahead of the stored one, so
   *  the map and the counter follow the pointer and the backend hears the end. */
  let drafts = $state({});
  /** name → `{ collection, index }`: the days of a layer's features, indexed
   *  once per snapshot rather than on every frame of a drag. */
  const indexes = new Map();
  /** …and the ones already re-read this session, so switching one off and on
   *  again draws what is in hand rather than asking its source again. */
  const renewed = new Set();

  function reset() {
    rows = [];
    drawings.clear();
    held = new Set();
    picked = null;
    on = new Set();
    renewed.clear();
  }

  function show(name, visible) {
    const next = new Set(on);
    if (visible) next.add(name);
    else next.delete(name);
    on = next;
  }

  /** The rows as the panel and the map read them, each saying whether it is on. */
  function listed() {
    return rows.map((row) => {
      const period = row.name in drafts ? drafts[row.name] : (row.period ?? null);
      const listing = { ...row, enabled: on.has(row.name), period };
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

  /**
   * Read this case's layers. Disk only, and every one of them starts off.
   *
   * Returns the teardown that makes a response arriving after the case changed
   * land nowhere, as the other panel indexes do.
   */
  function load(caseId) {
    if (loadedFor !== caseId) {
      loadedFor = caseId;
      reset();
    }
    if (!caseId) return () => {};
    let live = true;
    api
      .get(`/api/cases/${caseId}/map-layers`)
      .then((list) => {
        if (!live) return;
        rows = Array.isArray(list) ? list : [];
      })
      .catch(() => {
        if (live) rows = [];
      });
    return () => {
      live = false;
    };
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
    const data = await api.get(`/api/cases/${caseId}/map-layers/${encodeURIComponent(name)}/data`, {
      cache: 'no-cache',
    });
    drawings.set(name, data);
    held = new Set(held).add(name);
    return data;
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
      show(row.name, true);
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

  return {
    get rows() {
      return listed();
    },
    get drawn() {
      return drawable(listed());
    },
    get open() {
      return open;
    },
    set open(value) {
      open = value;
    },
    get busy() {
      return busy;
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
     * The eye on the row, which stores nothing. Off costs nothing and asks for
     * nothing; the first time on in the session re-reads a followed layer that
     * asked for it, while the snapshot already on disk is drawn.
     */
    toggle(caseId, layer) {
      const visible = !on.has(layer.name);
      show(layer.name, visible);
      if (visible && !renewed.has(layer.name) && renewsOnShow(layer)) {
        return renew(caseId, layer);
      }
      return Promise.resolve();
    },

    /** One legend row, which hides exactly its own features. */
    toggleCategory(caseId, layer, name) {
      return patch(caseId, layer.name, { hidden: toggleCategory(layer, name) }).catch(
        () => {}
      );
    },

    /** The explicit press. The second of this feature's three network calls. */
    refresh(caseId, layer) {
      return act(layer.name, async () => {
        try {
          const row = await api.post(`/api/cases/${caseId}/map-layers/${encodeURIComponent(layer.name)}/refresh`);
          if (row.sha256 !== layer.sha256) forget(row.name);
          replace(row);
          notify(
            row.sha256 === layer.sha256 ? 'Unchanged since last read' : `${row.title} updated`,
            'ok'
          );
        } catch (error) {
          notify(error?.message || 'That source could not be reached', 'error');
        }
      });
    },

    async remove(caseId, layer) {
      return act(layer.name, async () => {
        try {
          await api.del(`/api/cases/${caseId}/map-layers/${encodeURIComponent(layer.name)}`);
          forget(layer.name);
          show(layer.name, false);
          renewed.delete(layer.name);
          rows = rows.filter((entry) => entry.name !== layer.name);
          await reloadCase();
        } catch (error) {
          notify(error?.message || 'That layer could not be removed', 'error');
        }
      });
    },
  };
}
