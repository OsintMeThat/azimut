/**
 * Which Sentinel-1 pass a map shows, and which passes the point has.
 *
 * Like Sentinel-2's store, every question costs a metered request, so it is
 * about *when* it asks:
 *
 * - **Passes are read by the month, when the picker is open**, and kept per
 *   month and place: paging back to a month already seen spends nothing.
 * - **An empty month and a failed read are different facts.** A read that
 *   failed says so rather than offering a list that claims there was no pass.
 * - **A pass is a day and a time.** The radar sees a place at dawn flying south
 *   and at dusk flying north, and those are two looks from opposite sides.
 * - **"Most recent" is a lookup, not a layer default.** Sending no window makes
 *   Sentinel Hub blend every pass in the archive, pixel by pixel, which for
 *   radar means mixing looks from opposite sides. So the newest pass is resolved
 *   and *that* pass is the window; where it has no pixels the map shows a hole.
 *
 * The arithmetic is `lib/radar.js`; this holds what was asked and what came back.
 *
 * @param {object} deps
 * @param {object} deps.api the app's fetch wrapper
 * @param {() => {lat: number, lon: number}} deps.place where the map points
 * @param {() => void} [deps.onBilled] a metered request went out
 * @param {() => ({date: string, time: string}|null)} [deps.peer] the pass on the
 *   other side of a comparison, whose track the list marks
 */
import { validPass } from '../../../lib/radar.js';
import { addMonths, isoDay, monthBounds, monthOf, sentinelPlaceKey } from '../../../lib/sentinel.js';

export function createRadarState({ api, place, onBilled = () => {}, peer = () => null }) {
  let pass = $state(null); // null = whatever "most recent" resolves to here
  let menuOpen = $state(false);
  let month = $state(monthOf(''));
  let passes = $state([]);
  let passesFor = $state('');
  let busy = $state(false);
  let note = $state('');
  // The newest pass over this point, and the place it answers for.
  let latest = $state(null);
  let latestFor = $state('');
  let requestId = 0;
  const cache = new Map();

  const hereKey = () => `${month}@${sentinelPlaceKey(place().lat, place().lon)}`;
  const placeKey = () => sentinelPlaceKey(place().lat, place().lon);

  /** The passes of one month over this point, or null when the read failed. */
  async function monthPasses(forMonth, at) {
    const key = `${forMonth}@${at}`;
    if (cache.has(key)) return cache.get(key);
    const { lat, lon } = place();
    const { from, to } = monthBounds(forMonth);
    try {
      const answer = await api.get(
        `/api/satellite/sentinel/dates?collection=sentinel1&lat=${lat}&lon=${lon}&start=${from}&end=${to}`
      );
      onBilled();
      const list = (answer.dates ?? []).filter((entry) => entry.time);
      cache.set(key, list);
      return list;
    } catch {
      return null;
    }
  }

  /**
   * Which pass "most recent" is showing. Sentinel-1 revisits every ~6 days from
   * one track, so this month usually answers it and one step back does the rest.
   * Without it the tiles would blend the archive and the map could not say which
   * look it is drawing, which for radar is most of the reading.
   */
  async function resolveLatest(today = isoDay(new Date())) {
    const at = placeKey();
    if (latestFor === at) return;
    for (const forMonth of [monthOf(today), addMonths(monthOf(today), -1)]) {
      const list = await monthPasses(forMonth, at);
      if (list === null) return; // lookup failed — say nothing rather than guess
      const found = list
        .filter((entry) => entry.date <= today)
        .sort((one, other) => `${one.date}T${one.time}`.localeCompare(`${other.date}T${other.time}`))
        .at(-1);
      if (found && validPass(found)) {
        latest = { date: found.date, time: found.time, orbit: found.orbit ?? '' };
        latestFor = at;
        return;
      }
    }
    // No pass in ~2 months. There is no window to send, so the tiles are the
    // archive blend and the map says so rather than naming a pass.
    latest = null;
    latestFor = at;
  }

  async function loadPasses(force = false) {
    const key = hereKey();
    if (!force && cache.has(key)) {
      passes = cache.get(key);
      passesFor = key;
      note = passes.length ? '' : 'No Sentinel-1 pass here this month.';
      return passes;
    }
    if (force) cache.delete(key);
    const mine = ++requestId;
    const { lat, lon } = place();
    const { from, to } = monthBounds(month);
    busy = true;
    note = '';
    try {
      const answer = await api.get(
        `/api/satellite/sentinel/dates?collection=sentinel1&lat=${lat}&lon=${lon}&start=${from}&end=${to}`
      );
      onBilled();
      if (mine !== requestId) return passes;
      const list = (answer.dates ?? []).filter((entry) => entry.time);
      cache.set(key, list);
      passes = list;
      passesFor = key;
      if (!list.length) note = 'No Sentinel-1 pass here this month.';
    } catch (error) {
      if (mine !== requestId) return passes;
      passes = [];
      passesFor = '';
      note = `Could not read this month’s passes: ${error.message}`;
    } finally {
      if (mine === requestId) busy = false;
    }
    return passes;
  }

  return {
    get pass() {
      return pass;
    },
    get menuOpen() {
      return menuOpen;
    },
    set menuOpen(value) {
      menuOpen = value;
    },
    get month() {
      return month;
    },
    get passes() {
      return passes;
    },
    get busy() {
      return busy;
    },
    get note() {
      return note;
    },
    /** The list on screen describes another place or month than the map's. */
    get stale() {
      return Boolean(passesFor) && passesFor !== hereKey();
    },
    /** The other side's pass, whose track the list marks. */
    get peer() {
      return peer();
    },
    /** The pass the tiles are rendered from: the chosen one, else the one
     *  "most recent" resolved to. Null only while that lookup has not answered
     *  or found nothing, which is the one case the tiles blend passes. */
    get shownPass() {
      return pass ?? latest;
    },
    get latest() {
      return latest;
    },
    /** Has "most recent" been answered for the place on screen? */
    get resolved() {
      return Boolean(pass) || latestFor === placeKey();
    },
    /** No pass could be put under the crosshair, so the tiles blend the
     *  archive. Declared on screen and left out of provenance. */
    get undated() {
      return !this.shownPass && latestFor === placeKey();
    },
    /** What the provider id carries (`lib/radar.js` `radarId`). */
    get variant() {
      return { pass: this.shownPass };
    },
    resolveLatest,
    toggleMenu() {
      menuOpen = !menuOpen;
      if (menuOpen && (!passesFor || this.stale)) void loadPasses();
    },
    stepMonth(delta) {
      const next = addMonths(month, delta);
      if (next > monthOf(isoDay(new Date()))) return;
      month = next;
      void loadPasses();
    },
    loadPasses,
    /** Show one pass, or the most recent with null. The pass already shown
     *  is left alone: a fresh object would read as a change to everything
     *  that follows it, the tiles included. */
    pick(next) {
      const chosen = validPass(next) ? { date: next.date, time: next.time, orbit: next.orbit ?? '' } : null;
      if (chosen?.date === pass?.date && chosen?.time === pass?.time) return;
      pass = chosen;
      if (pass) month = monthOf(pass.date);
    },
  };
}
