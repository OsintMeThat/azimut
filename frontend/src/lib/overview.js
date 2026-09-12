/**
 * What the home surface reads off the open case, as values.
 *
 * Pure on purpose: the numbers arrive as the bounded payloads the case already
 * serves — one catalog summary and one timeline page — and what comes out is the
 * rows the page draws. No request and no Svelte, which is the half worth testing
 * without a browser.
 *
 * **The waiting rows are the Board's own standing questions, priced.** Three of the
 * four come straight out of `entityFilter.js` QUESTIONS, wording and terms included,
 * and pressing one hands that exact question to the Board. So the number on this page
 * and the count on that table are one predicate asked twice, and cannot drift into
 * saying two different things about the same case. Nothing here writes its own
 * sentence for a question the Board already words.
 */
import { QUESTIONS } from './entityFilter.js';

/**
 * How many entities sit in none of the analyst's folders.
 *
 * Derived rather than asked for: `by_folder` counts the rows that *have* a folder, so
 * the rest of the case is the remainder. Clamped at zero, since a summary read while a
 * write lands can briefly count more folders than it counts rows.
 */
export function unfiledCount(summary) {
  const total = Number(summary?.total ?? 0);
  const filed = Object.values(summary?.by_folder ?? {}).reduce(
    (sum, n) => sum + Number(n || 0),
    0
  );
  return Math.max(0, total - filed);
}

/** A Board question by id, carrying its own label, hint and terms. */
function asked(id) {
  return QUESTIONS.find((entry) => entry.id === id) ?? { id, label: id, hint: '', terms: {} };
}

/**
 * What the case is waiting on, in the order it is worth answering.
 *
 * `read` takes the two payloads and returns a count; `surface` is where the row lands
 * when it is pressed. A row with a `terms` object hands that question over on the way,
 * which is what makes the landing table show exactly the rows this number counted.
 *
 * Deliberately four. *Added this week* is the Board's fourth standing question and is
 * not one of these: it says what happened, not what is outstanding, so it leads the
 * recent work instead of sitting in a list of things to do.
 */
export const WAITING = [
  {
    ...asked('review'),
    icon: 'check',
    surface: 'board',
    read: ({ summary }) => summary?.by_status?.suggested ?? 0,
  },
  {
    ...asked('loose'),
    icon: 'link',
    surface: 'board',
    read: ({ summary }) => summary?.unlinked ?? 0,
  },
  {
    ...asked('unfiled'),
    icon: 'folderMinus',
    surface: 'board',
    read: ({ summary }) => unfiledCount(summary),
  },
  {
    id: 'undated',
    label: 'No date yet',
    hint: 'a statement the timeline has nowhere to put',
    icon: 'clock',
    surface: 'timeline',
    read: ({ timeline }) => timeline?.undated ?? 0,
  },
];

/** The waiting rows with their counts read off the payloads. */
export function waitingRows(sources = {}) {
  return WAITING.map((row) => ({ ...row, count: Math.max(0, Number(row.read(sources) || 0)) }));
}

/**
 * Whether the case has nothing outstanding.
 *
 * A clear case is an answer rather than four zeros: read as a list it says the page
 * failed to load, read as one line it says the work is done.
 */
export function nothingWaiting(rows) {
  return rows.every((row) => row.count === 0);
}

/**
 * The case by family, biggest first, summed off the per-type counts the summary
 * already holds.
 *
 * Families rather than types, because eight readings is a sentence and twenty type
 * slugs is a list. `familyOf` is handed in rather than imported so this stays pure of
 * the registry; a type the vocabulary has never heard of is counted under `other`
 * instead of being dropped, since a free type is still something the case holds.
 */
export function familyCounts(summary, familyOf = () => null) {
  const totals = new Map();
  for (const [type, n] of Object.entries(summary?.by_type ?? {})) {
    const family = familyOf(type) ?? 'other';
    totals.set(family, (totals.get(family) ?? 0) + Number(n || 0));
  }
  return [...totals]
    .map(([family, count]) => ({ family, count }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
}

/**
 * The same families, each carrying its share of the biggest one.
 *
 * A share of the largest rather than of the total: the bars are read against each
 * other, and a case where one family holds four fifths of the rows would otherwise
 * draw seven bars of nothing. The colour is not decided here — the page reads
 * `--graph-<family>`, the hues the Graph already gives the same eight families, so
 * one reading of a case cannot be two palettes.
 */
export function familyBars(summary, familyOf = () => null) {
  const rows = familyCounts(summary, familyOf);
  const top = rows[0]?.count ?? 0;
  return rows.map((row) => ({ ...row, share: top ? row.count / top : 0 }));
}

/** How many points the home map draws before it stops. Higher than the plate that
 *  drew them without a map could take: a dense patch there was one smear, and here
 *  it is something to zoom into. The cap is what keeps a case with thousands of
 *  saved points from paying for all of them on a page nobody came to read them on. */
export const MAP_PINS = 200;

/**
 * A coordinate a row actually recorded, or NaN where it recorded none.
 *
 * `Number(null)` is 0 and zero is a real place, so a row with no position would be
 * drawn off West Africa and would stretch the plate of every case that holds one.
 */
function coordinate(value) {
  return value === null || value === undefined || value === '' ? NaN : Number(value);
}

/**
 * The case's saved points, as the home map takes them.
 *
 * Coordinates and nothing else: the map projects, frames and draws them
 * (`tools/overview/PlaceMap.svelte`), so this only decides which rows can be drawn
 * at all and how many of them are. A second projection written here is a second
 * thing that can disagree with the map about where the case is.
 *
 * `total` counts every row that holds a position, drawn or not, so the foot can say
 * how much of the case the map is showing.
 *
 * Pure, and the half worth testing: the component only turns these into dots.
 */
export function mapPins(rows, { limit = MAP_PINS } = {}) {
  const points = [];
  for (const row of rows ?? []) {
    const lat = coordinate(row?.lat);
    const lon = coordinate(row?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    points.push({
      id: String(row.key ?? row.id ?? `${lat},${lon}`),
      kind: row.kind ?? 'place',
      title: row.title ?? '',
      lat,
      lon,
    });
  }
  return { pins: points.slice(0, limit), total: points.length };
}

/** The `YYYY-MM-DD` a week back, as the catalog's own `since` bound. */
export function weekAgo(now = Date.now()) {
  const at = new Date(now);
  at.setDate(at.getDate() - 7);
  return at.toISOString().slice(0, 10);
}

/**
 * The case's own last-written stamp, preferring the freshest of the two the app holds.
 *
 * The open case carries the manifest's `updated_at`, which only moves when the
 * manifest itself is rewritten; the case list carries one recomputed off the database,
 * so a case worked on all afternoon reads as touched this afternoon rather than as
 * touched the day it was renamed.
 */
export function lastTouched(current, list = []) {
  const listed = list.find((entry) => entry?.id === current?.id)?.updated_at;
  const own = current?.updated_at;
  if (!listed) return own ?? '';
  if (!own) return listed;
  return listed > own ? listed : own;
}
