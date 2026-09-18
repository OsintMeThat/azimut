/**
 * The layers the analyst added to this case, as the Map's panel works them.
 *
 * Holds the list, the acts that change it, and the one thing that decides
 * whether this feature is honest about the network: **nothing here fetches on
 * mount.** Opening a case reads the layers already on disk, and only then, only
 * for subscriptions that are enabled and asked to, does `refreshOnOpen` reach
 * out. A disabled layer never costs a request, and a case opened offline draws
 * every snapshot it holds.
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
  refreshable,
  searchFeatures,
  toggleCategory,
} from '../../../lib/map/addedLayers.js';

export function createAddedLayersState({ api, notify, ensureCase, reloadCase }) {
  let rows = $state([]);
  let open = $state(true);
  let busy = $state(''); // the layer name an act is running on
  let adding = $state(false); // the + dialog is up
  let saving = $state(false); // …and it is reading a file or an address

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

  function reset() {
    rows = [];
    drawings.clear();
    held = new Set();
    picked = null;
  }

  /** Drop a layer's features, which is what a new snapshot and a removal both do. */
  function forget(name) {
    drawings.delete(name);
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
   * Read this case's layers. Disk only — the network boundary is `refreshOnOpen`.
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
        refreshOnOpen(caseId);
      })
      .catch(() => {
        if (live) rows = [];
      });
    return () => {
      live = false;
    };
  }

  /**
   * Re-read the feeds a case open is allowed to re-read, and only those.
   *
   * One request per layer, all of them failing silently: a subscription that
   * cannot be reached is not an error worth a toast on every case open — the row
   * already says how old what it is drawing is.
   */
  async function refreshOnOpen(caseId) {
    for (const layer of refreshable(rows)) {
      try {
        const row = await api.post(`/api/cases/${caseId}/map-layers/${layer.name}/refresh`);
        if (loadedFor !== caseId) return;
        if (row.sha256 !== layer.sha256) forget(row.name);
        replace(row);
      } catch {
        /* the snapshot stays on the map, and the row says when it was last read */
      }
    }
  }

  /** The parsed collection for one layer, read once and kept. */
  async function drawing(caseId, name) {
    if (drawings.has(name)) return drawings.get(name);
    const data = await api.get(`/api/cases/${caseId}/map-layers/${name}/data`);
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
   * Both halves of the `+`, which differ only in what they post.
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
      adding = false;
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

  async function patch(caseId, name, body) {
    const row = await api.patch(`/api/cases/${caseId}/map-layers/${name}`, body);
    replace(row);
    return row;
  }

  return {
    get rows() {
      return rows;
    },
    get drawn() {
      return drawable(rows);
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
      if (result?.hidden) {
        await patch(caseId, layer.name, {
          hidden: toggleCategory(layer, result.category),
        }).catch(() => {});
      }
      picks += 1;
      picked = { name: layer.name, index: result.index, at: picks };
    },

    /** The eye on the row. Off costs nothing and asks for nothing. */
    toggle(caseId, layer) {
      return patch(caseId, layer.name, { enabled: !layer.enabled }).catch(() => {});
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
          const row = await api.post(`/api/cases/${caseId}/map-layers/${layer.name}/refresh`);
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
          await api.del(`/api/cases/${caseId}/map-layers/${layer.name}`);
          forget(layer.name);
          rows = rows.filter((entry) => entry.name !== layer.name);
          await reloadCase();
        } catch (error) {
          notify(error?.message || 'That layer could not be removed', 'error');
        }
      });
    },

    /** What a hidden folder owes the analyst: where the bytes actually are. */
    async reveal(caseId, layer) {
      try {
        await api.post(`/api/cases/${caseId}/map-layers/${layer.name}/reveal`);
      } catch (error) {
        notify(error?.message || 'That folder could not be opened', 'error');
      }
    },
  };
}
