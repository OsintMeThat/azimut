/**
 * Sentinel-2's choices: which layer, over which day, under which cloud ceiling.
 *
 * It is the one basemap with choices in it, and the reason they need a state
 * machine rather than three variables is that every one of them costs a
 * metered request and can be asked about a place the map has already left:
 *
 * - **A day with no pass is not selectable.** Otherwise you pick a date, pay
 *   for a tile and discover it was a coverage gap.
 * - **An empty month and a failed lookup are different facts**, and blurring
 *   them would grey out imagery that exists.
 * - **Answers are cached by month *and* place**, because Sentinel-2's swath
 *   means the answer genuinely differs a few km away — and a nudge of the map
 *   is not a new question.
 * - **The ceiling is part of the question**: the same day is available under
 *   100% and a gap under 20%, so a cached answer must not outlive the number.
 *
 * The pure arithmetic (window, month grid, variant id, labels) is
 * `lib/sentinel.js`; this holds what has been asked, what came back, and what
 * is still in flight.
 *
 * @param {object} deps
 * @param {() => {lat: number, lon: number}} deps.place where the map is pointing
 * @param {() => void} deps.onBilled a metered request went out
 * @param {(message: string, kind?: string, ms?: number) => void} deps.notify
 * @param {object} deps.api the app's fetch wrapper
 */
import {
  DEFAULT_LAYER,
  DEFAULT_MAXCC,
  addMonths,
  coverageRequestPath,
  dateAfterCoverage,
  isoDay,
  latestAllowedPass,
  monthBounds,
  monthOf,
  overCloudCeiling,
  sentinelPlaceKey,
  validDay,
  validMaxcc,
  cloudLabel,
} from '../../../lib/sentinel.js';

export function createSentinelState({ place, onBilled, notify, api }) {
  let layer = $state(DEFAULT_LAYER);
  // One date, not a range: a Sentinel-2 image *is* a pass on a day. (The WMTS
  // window underneath is a range, so we send day/day — but a range is a mosaic
  // of several passes, which is not a thing you can point at and date.)
  let date = $state(''); // '' = the layer's default, i.e. the most recent pass
  // Cloud ceiling, in percent. 100 = render whatever passed overhead, which is
  // the default because the *instance* has a filter of its own (20% in the
  // standard template) and a scene above it renders as nothing at all: without
  // saying MAXCC=100 we would be hiding cloudy days without ever saying so.
  let maxcc = $state(DEFAULT_MAXCC);
  let menuOpen = $state(false);
  let layers = $state([]); // [{id,label,hint}] — catalogue until the instance is asked
  let layersSource = $state('');
  let layersAsked = false; // the instance is asked once per session, on first open
  // The month the calendar is showing, and the passes found in it:
  // { 'YYYY-MM-DD': {cloud, granules} }. A day with no entry has no imagery and
  // is not selectable — the same rule the Copernicus browser follows.
  let month = $state(monthOf(''));
  let passes = $state({});
  let passesFor = $state(''); // the month+place `passes` describes
  let passesBusy = $state(false);
  let passesNote = $state('');
  let verifyingDate = $state('');
  let coverageRev = $state(0);
  // The newest pass over this point — what "most recent" is actually showing.
  // The layer's default window renders the latest acquisition, so naming it is
  // the difference between a dated image and an undated one.
  let latest = $state('');
  let latestFor = $state(''); // the place `latest` was resolved for

  const passCache = new Map();
  const passPending = new Map();
  const coverageCache = new Map();
  let passRequestId = 0;
  let pickRequestId = 0;

  const placeKey = () => sentinelPlaceKey(place().lat, place().lon);
  const coverageKey = (day, at = placeKey(), forLayer = layer, ceiling = maxcc) =>
    `${forLayer}@${ceiling}@${day}@${at}`;

  /**
   * The catalogue costs nothing and reaches no network (the backend answers it
   * from its own list); `check` asks the user's instance what it really serves,
   * which is the only authority — a configuration can rename or drop any layer.
   */
  async function loadLayers(check = false, quiet = false) {
    try {
      const r = await api.get(`/api/satellite/sentinel/layers${check ? '?check=true' : ''}`);
      layers = r.layers ?? [];
      layersSource = r.source ?? '';
      // a layer that vanished with the list can't stay selected
      if (layers.length && !layers.some((l) => l.id === layer)) layer = layers[0].id;
      if (quiet) return;
      if (check && r.detail) notify(r.detail, 'warn', 6000);
      else if (check && r.source === 'instance') {
        notify(`${r.layers.length} layers read from your instance`, 'ok');
      }
    } catch (e) {
      notify(`Sentinel-2 layers: ${e.message}`, 'danger');
    }
  }

  /**
   * One month's passes over one place: `{ 'YYYY-MM-DD': {cloud, granules} }`,
   * or null when the lookup failed. Cached — paging back to a month already
   * seen must not spend a second request.
   */
  async function fetchMonth(forMonth, at, force = false, lat = place().lat, lon = place().lon) {
    const key = `${forMonth}@${at}`;
    if (!force && passCache.has(key)) return passCache.get(key);
    if (!force && passPending.has(key)) return passPending.get(key);
    if (force) passCache.delete(key);
    const { from, to } = monthBounds(forMonth);
    const request = (async () => {
      try {
        const r = await api.get(
          `/api/satellite/sentinel/dates?lat=${lat}&lon=${lon}&start=${from}&end=${to}`
        );
        const byDay = {};
        for (const d of r.dates) byDay[d.date] = { cloud: d.cloud, granules: d.granules };
        passCache.set(key, byDay);
        onBilled(); // the lookup is billed: keep the pill honest
        return byDay;
      } catch {
        return null;
      }
    })();
    passPending.set(key, request);
    try {
      return await request;
    } finally {
      if (passPending.get(key) === request) passPending.delete(key);
    }
  }

  /**
   * Which days Sentinel-2 actually passed over this point, and how cloudy each
   * was. One metadata request per month (~1/100th of a tile's processing
   * units), only while the picker is open.
   */
  async function loadPasses(force = false) {
    const requestId = ++passRequestId;
    const { lat, lon } = place();
    const at = placeKey();
    const key = `${month}@${at}`;
    passesBusy = true;
    passesNote = '';
    const days = await fetchMonth(month, at, force, lat, lon);
    if (requestId !== passRequestId) return;
    if (days) {
      passes = days;
      passesFor = key;
      if (!Object.keys(days).length) passesNote = 'No Sentinel-2 pass here this month.';
    } else {
      // an empty month and a failed lookup are different facts. Never blur them:
      // greying every day out because the network hiccuped would be a lie about
      // what exists.
      passes = {};
      passesFor = '';
      passesNote = 'Could not read this month’s passes. The days below do not confirm coverage.';
    }
    passesBusy = false;
  }

  function stepMonth(delta) {
    month = addMonths(month, delta);
    loadPasses();
  }

  function toggleMenu() {
    menuOpen = !menuOpen;
    if (!menuOpen) return;
    // Ask the instance what it actually serves, once per session. The built-in
    // list is only a fallback: a configuration serves whatever it was built
    // with, and offering a layer that isn't there just 400s when picked.
    if (!layersAsked) {
      layersAsked = true;
      loadLayers(true, true);
    } else if (!layers.length) {
      loadLayers(false);
    }
    loadPasses();
  }

  /**
   * Which pass "most recent" is showing. Sentinel-2 revisits every ~5 days, so
   * this month usually answers it; early in a month it may not, and one step
   * back does. Two requests at worst, once per place — the alternative is a
   * basemap that can't say what date it is showing, which for satellite
   * imagery is most of the point.
   */
  async function resolveLatest(today = isoDay(new Date())) {
    const at = placeKey();
    const ceiling = maxcc;
    const key = `${at}@${ceiling}`;
    if (latestFor === key) return;
    for (const forMonth of [monthOf(today), addMonths(monthOf(today), -1)]) {
      const days = await fetchMonth(forMonth, at);
      if (days === null) return; // lookup failed — say nothing rather than guess
      // the ceiling drops cloudy passes from the tiles, so "most recent" is the
      // newest pass it still allows, not the newest pass there is
      const found = latestAllowedPass(days, today, ceiling);
      if (found) {
        latest = found;
        latestFor = key;
        return;
      }
    }
    // no pass in ~2 months: real (deep polar winter, persistent gaps) — the
    // pill falls back to "most recent" rather than inventing a date
    latest = '';
    latestFor = key;
  }

  function clearDate() {
    pickRequestId += 1;
    verifyingDate = '';
    date = '';
  }

  /** Is this day's pass above the ceiling, i.e. filtered out of the tiles? */
  function filtered(day) {
    return overCloudCeiling(passes[day]?.cloud, maxcc);
  }

  /**
   * A new cloud ceiling. It reaches the tiles through the provider id, so the
   * only thing left to settle is a pinned date the new ceiling excludes: that
   * day renders nothing, so it goes back to most recent rather than to a blank
   * map nobody asked for.
   */
  function setMaxcc(value) {
    const ceiling = Math.round(Number(value));
    if (!validMaxcc(ceiling) || ceiling === maxcc) return;
    maxcc = ceiling;
    if (date && overCloudCeiling(passes[date]?.cloud, ceiling)) {
      const cloud = cloudLabel(passes[date].cloud);
      const day = date;
      clearDate();
      notify(`${day} is ${cloud}, over the ${ceiling}% ceiling. Back to most recent.`, 'warn');
    }
  }

  async function pickDate(day) {
    if (day === date) {
      clearDate();
      return;
    }
    if (!passes[day] || stale() || passesBusy || verifyingDate) return;
    if (filtered(day)) {
      notify(`${day} is ${cloudLabel(passes[day].cloud)}, over the ${maxcc}% ceiling.`, 'warn');
      return;
    }

    const { lat, lon } = place();
    const at = placeKey();
    const forLayer = layer;
    const ceiling = maxcc;
    const key = coverageKey(day, at, forLayer, ceiling);
    const known = coverageCache.get(key);
    if (known === true) {
      date = day;
      return;
    }
    if (known === false) {
      notify(`No imagery at the crosshair on ${day}.`, 'warn');
      return;
    }

    const requestId = ++pickRequestId;
    verifyingDate = day;
    try {
      const result = await api.get(
        coverageRequestPath({ lat, lon, layer: forLayer, date: day, maxcc: ceiling })
      );
      coverageCache.set(key, result.available === true);
      coverageRev += 1;
      onBilled();
      if (requestId !== pickRequestId) return;
      if (at !== placeKey() || forLayer !== layer || ceiling !== maxcc) {
        notify('The view changed. Pick the date again.', 'warn');
        return;
      }
      date = dateAfterCoverage(date, day, result.available);
      if (!result.available) notify(`No imagery at the crosshair on ${day}.`, 'warn');
    } catch (e) {
      if (requestId === pickRequestId) {
        notify(`Could not check imagery for ${day}: ${e.message}`, 'danger');
      }
    } finally {
      if (requestId === pickRequestId) verifyingDate = '';
    }
  }

  /**
   * The passes on screen describe the place they were fetched for; once the map
   * has moved somewhere else they are stale and must not grey out real imagery.
   */
  function stale() {
    return !!passesFor && passesFor !== `${month}@${placeKey()}`;
  }

  return {
    get layer() {
      return layer;
    },
    set layer(value) {
      layer = value;
    },
    get date() {
      return date;
    },
    get maxcc() {
      return maxcc;
    },
    get menuOpen() {
      return menuOpen;
    },
    set menuOpen(value) {
      menuOpen = value;
    },
    get layers() {
      return layers;
    },
    get layersSource() {
      return layersSource;
    },
    get month() {
      return month;
    },
    get passes() {
      return passes;
    },
    get passesBusy() {
      return passesBusy;
    },
    get passesNote() {
      return passesNote;
    },
    get verifyingDate() {
      return verifyingDate;
    },
    get latest() {
      return latest;
    },
    get layerHint() {
      return layers.find((l) => l.id === layer)?.hint ?? '';
    },
    get layerLabel() {
      return (
        layers.find((l) => l.id === layer)?.label ?? layer.replace(/_/g, ' ').toLowerCase()
      );
    },
    /** The pill is small: "false colour (infrared)" doesn't fit, "FALSE COLOR" does. */
    get layerShort() {
      return layer.replace(/_/g, ' ');
    },

    /** A half-typed date is not a date: it stays "most recent" rather than
     *  becoming a request the backend would refuse. */
    get window() {
      return validDay(date) ? { from: date, to: date } : { from: '', to: '' };
    },
    /** What rides on the provider id, so the tiles, the capture and the cache
     *  all key on the same choices. */
    get variant() {
      return { layer, ...this.window, maxcc };
    },
    get stale() {
      return stale();
    },
    /** The place the passes on screen were asked about. */
    get placeKey() {
      return placeKey();
    },

    dateStatus(day) {
      coverageRev; // read, so a settled check repaints the calendar
      return coverageCache.get(coverageKey(day));
    },
    filtered,
    loadLayers,
    loadPasses,
    stepMonth,
    toggleMenu,
    resolveLatest,
    clearDate,
    setMaxcc,
    pickDate,
  };
}
