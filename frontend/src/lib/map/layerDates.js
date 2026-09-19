/**
 * The arithmetic behind an added layer's time filter.
 *
 * A layer's features carry a day, `date: 'YYYY-MM-DD'`, when their source dated
 * them (`engine/maplayers.py`): every GeoConfirmed event, a KML placemark with a
 * TimeStamp, a GPX waypoint. The filter is a period, `{ start, end }`, either
 * bound '' for open, compared as days on the map (`addedLayer.js`) and counted
 * here.
 *
 * **Indexed once per snapshot, then asked cheaply.** A layer holds up to a
 * hundred thousand features and the strip is redrawn on every drag, so the days
 * are sorted once per group and every question after that — how many in this
 * bar, how many in this period — is two binary searches per group.
 */

const DAY_MS = 86_400_000;

/** A day as a number of days since 1970-01-01, or null for anything else. */
export function dayNumber(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(ms) ? Math.round(ms / DAY_MS) : null;
}

/** …and back. */
export function isoDay(number) {
  return new Date(number * DAY_MS).toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `12 Aug 2026`, the way GeoConfirmed and the rest of the row write a day. */
export function dayLabel(iso) {
  const number = dayNumber(iso);
  if (number === null) return '';
  const date = new Date(number * DAY_MS);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * Every dated feature's day, sorted per group, or null for a layer with none.
 *
 * @param {{ features?: object[] } | null} collection
 * @returns {{ first: number, last: number, groups: Map<string, Int32Array> } | null}
 */
export function indexDates(collection) {
  const lists = new Map();
  let first = Infinity;
  let last = -Infinity;
  for (const feature of collection?.features ?? []) {
    const day = dayNumber(feature?.properties?.date);
    if (day === null) continue;
    const group = feature.properties.category ?? '';
    if (!lists.has(group)) lists.set(group, []);
    lists.get(group).push(day);
    if (day < first) first = day;
    if (day > last) last = day;
  }
  if (!lists.size) return null;
  const groups = new Map();
  for (const [group, days] of lists) groups.set(group, Int32Array.from(days).sort());
  return { first, last, groups };
}

/** The first position in a sorted list holding a value at or past `value`. */
function lowerBound(sorted, value) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** How many of a sorted list fall on days `from` to `to`, both included. */
function between(sorted, from, to) {
  return lowerBound(sorted, to + 1) - lowerBound(sorted, from);
}

/**
 * The bars the strip is drawn in: a day each for up to three months, a week each
 * for up to two years, a month each past that — so a strip holds between one and
 * about a hundred bars whatever the layer spans.
 *
 * @returns {Array<{ from: number, to: number }>} days, both included
 */
export function bars(first, last) {
  const span = last - first + 1;
  if (span <= 92) return steps(first, last, 1);
  if (span <= 731) return steps(first, last, 7);
  const out = [];
  const start = new Date(first * DAY_MS);
  let year = start.getUTCFullYear();
  let month = start.getUTCMonth();
  for (;;) {
    const from = Math.round(Date.UTC(year, month, 1) / DAY_MS);
    const to = Math.round(Date.UTC(year, month + 1, 1) / DAY_MS) - 1;
    if (from > last) break;
    out.push({ from: Math.max(from, first), to: Math.min(to, last) });
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
  }
  return out;
}

function steps(first, last, size) {
  const out = [];
  for (let from = first; from <= last; from += size) {
    out.push({ from, to: Math.min(from + size - 1, last) });
  }
  return out;
}

/** How many features of the groups not switched off fall in each bar. */
export function histogram(index, hidden = [], edges = []) {
  if (!index) return edges.map(() => 0);
  const off = new Set(hidden);
  const lists = [...index.groups].filter(([group]) => !off.has(group)).map(([, days]) => days);
  return edges.map(({ from, to }) =>
    lists.reduce((total, days) => total + between(days, from, to), 0)
  );
}

/** Whether a period narrows anything at all. */
export function active(period) {
  return Boolean(period?.start || period?.end);
}

/** A period as the days it spans, its open bounds filled with the layer's own. */
export function span(period, index) {
  const from = dayNumber(period?.start) ?? index?.first ?? -Infinity;
  const to = dayNumber(period?.end) ?? index?.last ?? Infinity;
  return { from, to };
}

/**
 * How many dated features of the visible groups fall in the period, in all and
 * per group — what the row's counter and the legend say while a period is set.
 */
export function within(index, hidden = [], period = null) {
  const byGroup = {};
  let total = 0;
  if (!index) return { total, byGroup };
  const off = new Set(hidden);
  const { from, to } = span(period, index);
  for (const [group, days] of index.groups) {
    const count = between(days, from, to);
    byGroup[group] = count;
    if (!off.has(group)) total += count;
  }
  return { total, byGroup };
}

/** Whether one day is inside a period. An undated feature is outside any. */
export function inPeriod(iso, period) {
  if (!active(period)) return true;
  const day = dayNumber(iso);
  if (day === null) return false;
  const from = dayNumber(period.start);
  const to = dayNumber(period.end);
  return (from === null || day >= from) && (to === null || day <= to);
}

/**
 * Two days as the period the strip hands back: a bound sitting on the layer's
 * own edge is left open, so a period dragged back out to both ends is no
 * period at all rather than one that silently excludes whatever is added next.
 */
export function periodFrom(from, to, index) {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const start = index && low <= index.first ? '' : isoDay(low);
  const end = index && high >= index.last ? '' : isoDay(high);
  return start || end ? { start, end } : null;
}
