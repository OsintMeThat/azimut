/**
 * Which Wayback release a map shows, and which releases changed the point.
 *
 * Both questions reach Esri, so the store is about *when* it asks:
 *
 * - **The release list is read once**, the first time the basemap is shown or
 *   its picker opened, never on mount. It costs one request and dates every
 *   release by publication.
 * - **A point's history is read only when the analyst asks for it**: pressing
 *   *Changes here*, or *Imagery history here* on the map's menu. It walks
 *   Esri's tiles and metadata, dozens of requests, so it never follows the
 *   map. A history that no longer describes the tile under the crosshair says
 *   so and waits for the analyst to ask again.
 * - **A failed read is said, not hidden.** An empty change list means the point
 *   never changed; a failed one means we do not know, and the picker falls back
 *   to every release rather than claiming there is nothing to see.
 *
 * The arithmetic is `lib/wayback.js`; this holds what was asked and what came back.
 *
 * @param {object} deps
 * @param {object} deps.api the app's fetch wrapper
 * @param {() => {lat: number, lon: number, zoom: number}} deps.place where the map points
 */
import {
  changesKey,
  positionOf,
  releaseDate,
  stepRelease,
  visibleReleases,
} from '../../../lib/wayback.js';

export function createWaybackState({ api, place }) {
  let releases = $state([]); // [{ release, date }], newest first
  let listNote = $state('');
  let listing = null; // the one in-flight read of the list
  let listBusy = $state(false); // …as the chip shows it
  let release = $state(null); // null = the newest
  let menuOpen = $state(false);
  let changesOnly = $state(false);
  let changes = $state(null); // [release] for `changesFor`, null when unknown
  let pictures = $state({}); // release → { acquired, source } for those changes
  let changesFor = $state('');
  let changesBusy = $state(false);
  let changesNote = $state('');
  let changesRequest = 0;
  const changesCache = new Map();

  const hereKey = () => {
    const { lat, lon, zoom } = place();
    return changesKey(lat, lon, zoom);
  };

  async function loadReleases() {
    if (releases.length) return releases;
    listing ??= (async () => {
      listBusy = true;
      try {
        const answer = await api.get('/api/satellite/wayback/releases');
        releases = answer.releases ?? [];
        listNote = '';
      } catch (error) {
        listNote = `Could not read the release list: ${error.message}`;
      } finally {
        listing = null;
        listBusy = false;
      }
      return releases;
    })();
    return listing;
  }

  /** A history as the route answers it: each picture and the release that first showed it. */
  function keep(list) {
    changes = list.map((entry) => entry.release);
    pictures = Object.fromEntries(list.map((entry) => [entry.release, entry]));
  }

  /** Read the history of the tile at `at`, the map's centre unless given. */
  async function loadChanges(at = place()) {
    const { lat, lon, zoom } = at;
    const key = changesKey(lat, lon, zoom);
    if (changesCache.has(key)) {
      keep(changesCache.get(key));
      changesFor = key;
      changesNote = '';
      return changes;
    }
    const requestId = ++changesRequest;
    changesBusy = true;
    changesNote = '';
    try {
      const answer = await api.get(
        `/api/satellite/wayback/changes?lat=${lat}&lon=${lon}&zoom=${Math.round(zoom)}`
      );
      if (requestId !== changesRequest) return changes;
      changesCache.set(key, answer.changes ?? []);
      keep(answer.changes ?? []);
      changesFor = key;
    } catch (error) {
      if (requestId !== changesRequest) return changes;
      changes = null;
      pictures = {};
      changesFor = '';
      changesNote = `Could not read this point's history: ${error.message}`;
    } finally {
      if (requestId === changesRequest) changesBusy = false;
    }
    return changes;
  }

  return {
    get releases() {
      return releases;
    },
    get listNote() {
      return listNote;
    },
    get release() {
      return release;
    },
    get menuOpen() {
      return menuOpen;
    },
    set menuOpen(value) {
      menuOpen = value;
    },
    get changesOnly() {
      return changesOnly;
    },
    get changes() {
      return changes;
    },
    get changesBusy() {
      return changesBusy;
    },
    /**
     * Esri is being asked something, list or history.
     *
     * Both walks take their time, the history above all: it reads a tile per
     * candidate release and compares the pixels. The picker can be shut while
     * one runs, so the chip carries the wait: a basemap that answers nothing
     * for ten seconds and says nothing about it reads as one that is broken.
     */
    get busy() {
      return listBusy || changesBusy;
    },
    get changesNote() {
      return changesNote;
    },
    /** The point moved out of the tile the change list describes. */
    get stale() {
      return Boolean(changesFor) && changesFor !== hereKey();
    },
    /**
     * Narrowed to changes, with this tile's history still coming.
     *
     * The picker offers nothing rather than the whole release list: a list
     * about to be replaced by a quarter of itself is one the analyst reads and
     * acts on, and it is not what they asked for.
     */
    get reading() {
      return changesOnly && changes === null && changesBusy;
    },
    /** What the provider id carries (`lib/wayback.js` `waybackId`). */
    get variant() {
      return { release };
    },
    /**
     * The publication date of what is showing, '' until the list is read.
     *
     * Narrowed to changes, the newest release is not a picture of its own: it
     * shows the latest change's pixels, so it is named by that change, the row
     * the picker highlights, rather than by a date no row carries.
     */
    get date() {
      if (release == null && changesOnly && changes?.length) {
        return releaseDate(releases, changes[0]);
      }
      return releaseDate(releases, release);
    },
    /** When and by what a change's picture was taken, when its metadata says. */
    picture(number) {
      return pictures[number] ?? null;
    },
    /**
     * The releases the picker offers. Every release until the changes are known.
     *
     * A map that left the tile keeps the list it had while the next one is
     * read: the walk takes seconds, and swapping four rows for two hundred
     * under the cursor and back is worse than a list the hint already calls
     * stale.
     */
    get visible() {
      return visibleReleases(releases, changes, changesOnly);
    },
    get position() {
      return positionOf(this.visible, releases, release);
    },

    loadReleases,
    loadChanges,

    toggleMenu() {
      menuOpen = !menuOpen;
      if (menuOpen) loadReleases();
    },

    setChangesOnly(value) {
      changesOnly = Boolean(value);
      // …and a history of the tile the map has left is read again, not kept:
      // asking for changes here is asking about here.
      if (changesOnly && (!changes || this.stale)) loadChanges();
    },

    /**
     * Open the picker on the changes at `at`, a point the analyst named.
     *
     * The point is passed rather than read from the map, since a map sent
     * there has not settled yet when this is asked.
     */
    historyAt(at) {
      changesOnly = true;
      menuOpen = true;
      loadReleases();
      return loadChanges(at);
    },

    /** Show one release. The newest is stored as null so the id stays plain. */
    pick(next) {
      release = next == null || next === releases[0]?.release ? null : next;
    },

    /** `-1` newer, `+1` older, through what the picker offers. */
    step(direction) {
      const next = stepRelease(this.visible, releases, release, direction);
      if (next !== undefined) this.pick(next);
      return next;
    },
  };
}
