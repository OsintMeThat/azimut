/**
 * Two dated views of one point, chosen where the analyst clicked.
 *
 * Compare's cold start was the reason: it opened on two empty panes, at the
 * world view, and asked for a provider and a date for each side before it could
 * show anything — while the analyst was already looking at the place they
 * wanted compared. This answers "what did this point look like before?" from
 * the map's own right-click menu: the app asks the archive which two pictures
 * are the last two *of that point*, and hands Compare the pair.
 *
 * Two archives, because they answer different questions. Esri Wayback holds
 * high-resolution pictures years apart, and a release only counts here when it
 * actually changed this point. Copernicus holds a pass every few days at 10 m,
 * which is what a fortnight-old change needs.
 *
 * Each side comes out in the shape a saved comparison stores, so the tool
 * applies a handoff through the same `applySide` it applies a session with.
 * Nothing is fetched until a row is pressed: both lookups are requests.
 */
import { WAYBACK_ID } from '../wayback.js';
import { RADAR_ID, onTrack } from '../radar.js';

export const SENTINEL_ID = 'sentinel2';

/** How far back a radar lookup asks: a track repeats every six to twelve days. */
export const RADAR_WINDOW_DAYS = 60;

/** How far back a Copernicus lookup asks. A pass every few days, so half a
 *  year is generous even where cloud hides most of them. */
export const SENTINEL_WINDOW_DAYS = 180;

/** The sources a point can be compared across, in the order the menu lists them. */
export const COMPARE_SOURCES = [
  {
    id: 'wayback',
    label: 'Esri Wayback',
    detail: 'the last two pictures of this point',
  },
  {
    id: 'sentinel',
    label: 'Copernicus',
    detail: 'the last two passes over this point',
    /** Only offered when Sentinel-2 is configured. */
    provider: SENTINEL_ID,
  },
  {
    id: 'radar',
    label: 'Copernicus radar',
    detail: 'the last two passes of one track, through cloud',
    /** Only offered once a Sentinel-1 layer is set up. */
    provider: RADAR_ID,
  },
];

const day = (date) => date.toISOString().slice(0, 10);

/** `start` and `end` for a Copernicus lookup ending today. */
export function sentinelWindow(today = new Date()) {
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - SENTINEL_WINDOW_DAYS);
  return { start: day(start), end: day(today) };
}

/**
 * The two most recent Esri Wayback pictures of a point.
 *
 * `/wayback/changes` already answers with the distinct pictures, newest first,
 * which is the narrowing the Wayback picker calls "only what changed here".
 */
export async function waybackPair(api, { lat, lon, zoom }) {
  const answer = await api.get(
    `/api/satellite/wayback/changes?lat=${lat}&lon=${lon}&zoom=${Math.max(1, Math.min(22, Math.round(zoom)))}`
  );
  const changes = answer?.changes ?? [];
  if (changes.length < 2) {
    throw new Error(
      changes.length
        ? 'Esri has published one picture of this point. There is nothing to compare it with.'
        : 'Esri has no dated picture of this point.'
    );
  }
  const [newer, older] = changes;
  return {
    title: 'Wayback · this point',
    a: { provider: WAYBACK_ID, wayback_release: older.release, present: true },
    b: { provider: WAYBACK_ID, wayback_release: newer.release, present: true },
    dates: [older.acquired, newer.acquired],
  };
}

/**
 * The two most recent Copernicus passes over a point.
 *
 * Cloud is reported rather than acted on: a cloudy pass is still the pass that
 * happened, and which two dates are worth comparing is the analyst's call.
 */
export async function sentinelPair(api, { lat, lon }, today = new Date()) {
  const { start, end } = sentinelWindow(today);
  const answer = await api.get(
    `/api/satellite/sentinel/dates?lat=${lat}&lon=${lon}&start=${start}&end=${end}`
  );
  const dates = answer?.dates ?? [];
  if (dates.length < 2) {
    throw new Error(
      `Copernicus has ${dates.length ? 'one pass' : 'no pass'} over this point in the last six months.`
    );
  }
  const [newer, older] = dates;
  const side = (entry) => ({
    provider: SENTINEL_ID,
    sentinel: { date: entry.date, layer: 'TRUE_COLOR', maxcc: 100 },
    present: true,
  });
  return {
    title: 'Copernicus · this point',
    a: side(older),
    b: side(newer),
    dates: [older.date, newer.date],
  };
}

/**
 * The two most recent Sentinel-1 passes of one track over a point.
 *
 * The newest pass sets the track, and the one before it on that track is its
 * pair: another track sees the ground from another angle, and that difference
 * would read as change.
 */
export async function radarPair(api, { lat, lon }, today = new Date()) {
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - RADAR_WINDOW_DAYS);
  const answer = await api.get(
    `/api/satellite/sentinel/dates?collection=sentinel1&lat=${lat}&lon=${lon}&start=${day(start)}&end=${day(today)}`
  );
  const passes = (answer?.dates ?? []).filter((entry) => entry.time);
  const [newer] = passes;
  const older = newer ? onTrack(passes.slice(1), newer.time)[0] : null;
  if (!newer || !older) {
    throw new Error(
      `Copernicus radar has ${newer ? 'one pass of this track' : 'no pass'} over this point in the last two months.`
    );
  }
  const side = (entry) => ({
    provider: RADAR_ID,
    radar: { date: entry.date, time: entry.time },
    present: true,
  });
  return {
    title: 'Radar · this point',
    a: side(older),
    b: side(newer),
    dates: [older.date, newer.date],
  };
}

/** The pair for one source id, at one point. */
export function comparePair(api, source, at, today = new Date()) {
  if (source === 'wayback') return waybackPair(api, at);
  if (source === 'sentinel') return sentinelPair(api, at, today);
  if (source === 'radar') return radarPair(api, at, today);
  return Promise.reject(new Error(`unknown comparison source: ${source}`));
}
