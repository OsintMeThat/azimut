/**
 * Which Wayback release a map shows, and which releases changed the point.
 *
 * Both questions reach Esri, so the store is about *when* it asks:
 *
 * - **The release list is read once**, the first time the basemap is shown or
 *   its picker opened, never on mount.
 * - **The change list follows the map from the first time the picker is
 *   opened**, and not before: opening it is the analyst saying they are reading
 *   this place through time, and from then on a view that settles over another
 *   tile reads that tile's history, picker open or not. Gating it on the picker
 *   *staying* open was the bug: the map moved, the picker was shut, and it
 *   re-opened on the history of wherever the analyst had been before. A pan
 *   inside the same tile has the same history and asks nothing.
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
  let watching = $state(false); // the picker has been opened: the history follows the map
  let changesOnly = $state(true);
  let changes = $state(null); // [release] for `changesFor`, null when unknown
  let pictures = $state({}); // release → { acquired, source } for those changes
  let changesFor = $state('');
  let changesBusy = $state(false);
  let changesNote = $state('');
  let changesRequest = 0;
  let asked = ''; // the tile whose history was last read, answered or refused
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

  async function loadChanges() {
    const key = hereKey();
    asked = key;
    if (changesCache.has(key)) {
      keep(changesCache.get(key));
      changesFor = key;
      changesNote = '';
      return changes;
    }
    const requestId = ++changesRequest;
    const { lat, lon, zoom } = place();
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
     * Both walks take their time — the history reads a tile per release and
     * compares the pixels — and both can be running with the picker shut, since
     * the history follows the map once it has been opened. So the chip carries
     * the wait: a basemap that answers nothing for ten seconds and says nothing
     * about it reads as one that is broken.
     */
    get busy() {
      return listBusy || changesBusy;
    },
    get changesNote() {
      return changesNote;
    },
    /** The analyst opened the history once, so it follows the map from here. */
    get watching() {
      return watching;
    },
    /** The tile the map is over. What a tool watches to keep the history here. */
    get here() {
      return hereKey();
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

    /**
     * The map settled: read this tile's history unless it is the one we hold.
     *
     * A tile already answered costs nothing — the answer is kept for the
     * session — and a tile Esri refused is not asked again until the analyst
     * presses Refresh, so a service that is down is not hammered by panning.
     */
    follow() {
      if (!watching || hereKey() === asked) return undefined;
      return loadChanges();
    },

    toggleMenu() {
      menuOpen = !menuOpen;
      if (!menuOpen) return;
      watching = true;
      loadReleases();
      loadChanges();
    },

    setChangesOnly(value) {
      changesOnly = Boolean(value);
      // …and a history of the tile the map has left is read again, not kept:
      // asking for changes here is asking about here.
      if (changesOnly && (!changes || this.stale)) loadChanges();
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
