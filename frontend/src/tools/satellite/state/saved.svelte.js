/**
 * The case's saved work, as the Map's panel reads it.
 *
 * Two indexes, not one: places, captures and filed screenshots come back in one
 * compact index when a case opens, while located media is read only once its
 * position is opened — a case must not pay for a view it may never show. The
 * lazy one is keyed on the case *and its revision*, because placing a file
 * reloads the case and a stale list would still show the folder it just left.
 *
 * `runLocate` is the one long act here: filling in the country of everything
 * that still has none, one batch at a time because Nominatim allows one lookup
 * a second. Progress is the stored geography itself, so cancelling keeps what
 * was already resolved and a later pass picks up where this one stopped.
 *
 * @param {object} deps
 * @param {object} deps.api the app's fetch wrapper
 * @param {(message: string, kind?: string, ms?: number) => void} deps.notify
 * @param {(id: string, entity: object, folder: string) => Promise<any>} deps.assignFolder
 * @param {() => Promise<any>} deps.reloadCase
 */
import { filterSaved, isMode, pendingLocate, savedFolders } from '../../../lib/geoTree.js';

const GROUP_KEY = 'azimut:satelliteSavedGroup';
const LOCATE_BATCH = 10;

function loadGroup() {
  try {
    return localStorage.getItem(GROUP_KEY) === 'folders' ? 'folders' : 'geo';
  } catch {
    return 'geo'; // localStorage unavailable (private mode) — non-fatal
  }
}

/** Where the Media position's rows come from. */
const MEDIA_INDEX = (caseId) => `/api/cases/${caseId}/satellite/media`;

export function createSavedState({ api, notify, assignFolder, reloadCase }) {
  let rows = $state([]);
  // the located files, read the first time that position is opened
  let mediaRows = $state([]);
  // Media first: a map opened on a case answers "what footage do I have, and
  // where" before it lists every pin the analyst has dropped.
  let kind = $state('media');
  let query = $state('');
  /**
   * Which folder the map is drawing, or null for every one of them.
   *
   * The map's own filter rather than the panel's: the tree browses folders as
   * branches, and a busy case is read by taking the other folders off the
   * picture. `null` is all, `''` is what nobody has filed yet.
   */
  let folder = $state(null);
  let group = $state(loadGroup());
  let locating = $state(null); // { done, total } while a pass runs
  let acceptingId = $state(null);

  let rowsFor = null; // the case id every index was loaded for
  let mediaFor = null; // the case id *and revision* the media index was read for
  let locateStopped = false;
  let locateGeneration = 0;

  /** Everything a different case must not inherit. */
  function reset() {
    rows = [];
    mediaRows = [];
    mediaFor = null;
    locateStopped = true;
    locateGeneration += 1;
    locating = null;
  }

  /**
   * Read the compact index for one case. Returns the teardown that makes a
   * response arriving after the case changed land nowhere.
   */
  function load(caseId) {
    if (rowsFor !== caseId) {
      rowsFor = caseId;
      reset();
    }
    if (!caseId) return () => {};
    let live = true;
    api
      .get(`/api/cases/${caseId}/satellite/index`)
      .then((answer) => {
        if (live) rows = answer;
      })
      .catch(() => {
        if (live) rows = [];
      });
    return () => {
      live = false;
    };
  }

  /**
   * The media index, the first time that position is opened.
   *
   * An answer lands only while its case and revision are still the ones asked
   * about. Leaving the position before it arrives keeps it rather than throwing
   * it away: that stamp is already spent, and coming back would find nothing.
   */
  function loadMode(caseId, rev) {
    const stamp = `${caseId}:${rev}`;
    if (!caseId || !isMode(kind) || mediaFor === stamp) return;
    mediaFor = stamp;
    api
      .get(MEDIA_INDEX(caseId))
      .then((answer) => {
        if (mediaFor === stamp) mediaRows = answer;
      })
      .catch(() => {
        if (mediaFor !== stamp) return;
        mediaRows = [];
        mediaFor = null;
      });
  }

  async function runLocate(caseId) {
    if (locating || !caseId) return;
    const generation = ++locateGeneration;
    locateStopped = false;
    const total = pendingLocate(rows);
    locating = { done: 0, total };
    let located = 0;
    let failed = 0;
    let throttled = false;
    try {
      let remaining = total;
      while (remaining > 0 && !locateStopped && generation === locateGeneration) {
        const batch = await api.post(
          `/api/cases/${caseId}/satellite/locate?limit=${LOCATE_BATCH}`
        );
        if (generation !== locateGeneration) return;
        located += batch.located;
        failed += batch.failed;
        throttled = Boolean(batch.throttled);
        // A batch that resolved nothing means the network is down, or that
        // Nominatim put us in its penalty box — not that the next one will do
        // better: stop instead of hammering it forever.
        const stalled = batch.remaining >= remaining;
        remaining = batch.remaining;
        locating = { done: total - remaining, total };
        if (stalled || throttled) break;
      }
      if (generation !== locateGeneration) return;
      const fresh = await api.get(`/api/cases/${caseId}/satellite/index`);
      if (generation !== locateGeneration) return;
      rows = fresh;
      notify(
        throttled
          ? `Located ${located} of ${total}. OpenStreetMap is rate-limiting this address; wait a minute and run Locate again`
          : failed
            ? `Located ${located} of ${total}. ${failed} lookup(s) failed; run Locate again to retry`
            : `Located ${located} of ${total}`,
        failed || throttled ? 'warn' : 'ok'
      );
    } catch (e) {
      if (generation === locateGeneration) {
        notify(`Locate stopped: ${e.message}`, 'danger', 6000);
      }
    } finally {
      if (generation === locateGeneration) locating = null;
    }
  }

  /**
   * Accept a point a tool proposed.
   *
   * The same PATCH the sidebar sends, so the far end of the point's suggested
   * relations is accepted with it — the API keeps that invariant, and a point
   * confirmed here while the edge tying it to its capture stayed proposed would
   * be the two surfaces disagreeing about one click.
   */
  async function accept(caseId, row) {
    if (acceptingId) return;
    acceptingId = row.id;
    try {
      await api.patch(`/api/cases/${caseId}/entities/${row.id}`, { status: 'confirmed' });
      await reloadCase(); // re-reads the saved index and the case sidebar
      notify('Point accepted', 'ok', 1600);
    } catch (e) {
      notify(`Could not accept this point: ${e.message}`, 'danger');
    } finally {
      acceptingId = null;
    }
  }

  /**
   * File a saved item into a My-work folder. One PATCH through the shared
   * filing route (a capture's sidecar is the authority, a place carries the
   * folder itself), then the case reload every other edit here does.
   */
  async function move(caseId, row, folder) {
    // the row's kind *is* its entity type, bar the screenshot that rides the
    // capture type. Filing a place as a capture would route it to PATCH /media,
    // the sidecar of an image it is not.
    const entity = {
      id: row.id,
      type: ['place', 'media'].includes(row.kind) ? row.kind : 'capture',
      attrs: { path: row.path },
    };
    try {
      await assignFolder(caseId, entity, folder);
      await reloadCase();
      notify(folder ? `Filed in ${folder}` : 'Removed from My work', 'ok', 1600);
    } catch (e) {
      notify(e.message, 'danger');
    }
  }

  /** Drop a saved item: a capture loses its image file, a place its entity. */
  async function remove(caseId, row) {
    return row.kind === 'place'
      ? api.del(`/api/cases/${caseId}/entities/${row.id}`)
      : api.del(`/api/cases/${caseId}/satellite?path=${encodeURIComponent(row.path)}`);
  }

  return {
    get rows() {
      return rows;
    },
    set rows(value) {
      rows = value;
    },
    get media() {
      return mediaRows;
    },
    get kind() {
      return kind;
    },
    set kind(value) {
      kind = value;
    },
    get query() {
      return query;
    },
    set query(value) {
      query = value;
    },
    get folder() {
      return folder;
    },
    set folder(value) {
      folder = value;
    },
    /** The folders the rows on offer are filed under, each with its tally. */
    get folders() {
      return savedFolders(this.shownRows);
    },
    get group() {
      return group;
    },
    set group(value) {
      group = value;
      try {
        localStorage.setItem(GROUP_KEY, value);
      } catch {
        /* ignore */
      }
    },
    get locating() {
      return locating;
    },
    get acceptingId() {
      return acceptingId;
    },

    /** Media is a position of its own, and reads its own index. */
    get shownRows() {
      return isMode(kind) ? mediaRows : rows;
    },
    /** What the panel is showing, which is also what the map layer draws. */
    get shown() {
      return filterSaved(this.shownRows, { kind, query, folder });
    },
    get pending() {
      return pendingLocate(rows);
    },

    reset,
    load,
    loadMode,
    runLocate,
    stopLocate: () => (locateStopped = true),
    accept,
    move,
    remove,
  };
}
