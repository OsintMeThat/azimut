/**
 * What to ask NASA FIRMS for, as the Layers panel asks it.
 *
 * The layer answers two different questions with the same marks. **Live** is
 * the last day, three days or week, which FIRMS keeps as layers of its own.
 * **A date** is the archive, which is the same detections asked with a range —
 * and it is the half a case actually needs: whether that field, that depot,
 * that street was burning on the day in question.
 *
 * Everything here is arithmetic over the analyst's choice, so the range rules
 * are read off a test rather than off a map (`firms.test.js`). The key, the
 * WMS and the tiles are the backend's (`engine/firms.py`); the browser never
 * sees any of them.
 */

/** The rolling windows, newest first — what "live" can mean. */
export const WINDOWS = [
  { id: '24h', label: '24 h' },
  { id: '48h', label: '48 h' },
  { id: '72h', label: '72 h' },
  { id: '7d', label: '7 days' },
];

/** Asking by date rather than by how recent. Not a window: a question. */
export const DATED = 'dates';

/** FIRMS refuses a longer range, and counts a long one as several requests. */
export const MAX_RANGE_DAYS = 31;

/** `YYYY-MM-DD`, the only form the service and the input agree on. */
export function asDay(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? String(value) : '';
}

/** Today, in the same form — what an empty date field opens on. */
export function today(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * The end of a range the service will accept, given where it starts.
 *
 * Returned rather than enforced, so the panel can say what the limit is on the
 * input itself instead of refusing a date after it was typed.
 */
export function lastDayOf(first, maxDays = MAX_RANGE_DAYS) {
  const start = asDay(first);
  if (!start) return '';
  const end = new Date(`${start}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + maxDays - 1);
  return end.toISOString().slice(0, 10);
}

/**
 * Is this choice one the service can answer?
 *
 * A dated window with no date is the normal state of a panel someone has just
 * switched to Dates, not an error — so the layer waits rather than asking for
 * tiles that would come back as an exception report.
 */
export function askable({ window, first, last } = {}) {
  if (window !== DATED) return WINDOWS.some((entry) => entry.id === window);
  const start = asDay(first);
  if (!start) return false;
  const end = asDay(last) || start;
  if (end < start) return false;
  return end <= lastDayOf(start);
}

/**
 * …and the query the tile route is asked with.
 *
 * A rolling window carries no dates: they would be two more things to keep in
 * step with a layer that already means "the last 24 hours".
 */
export function tileParams({ sensor, window, first, last } = {}) {
  if (window !== DATED) return { sensor, window };
  const start = asDay(first);
  return { sensor, window: DATED, first: start, last: asDay(last) || start };
}

/** How the row says what it is showing, in the space a layer row has. */
export function summary({ sensor, window, first, last } = {}, sensors = []) {
  const name = sensors.find((entry) => entry.id === sensor)?.label ?? sensor ?? '';
  const short = name.replace(/\s*\(.*\)\s*$/, '');
  if (window !== DATED) {
    return [short, WINDOWS.find((entry) => entry.id === window)?.label].filter(Boolean).join(' · ');
  }
  const start = asDay(first);
  if (!start) return [short, 'pick a date'].filter(Boolean).join(' · ');
  const end = asDay(last);
  return [short, end && end !== start ? `${start} → ${end}` : start].filter(Boolean).join(' · ');
}
