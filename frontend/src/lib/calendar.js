/**
 * A month, as a grid of days — the arithmetic behind a calendar that is drawn
 * rather than asked of the browser.
 *
 * `<input type="date">` brings its own calendar, and that calendar is browser
 * chrome: it opens at whatever size the browser wants, in the browser's own
 * locale, and it is laid over the page rather than inside it. In a panel docked
 * to the right edge of the window, or floated over somebody else's map, it
 * opens half outside what it belongs to and reads `12/09/2026` in an app whose
 * every other date is written `2026-09-12`.
 *
 * So the days are computed here and drawn in the panel, where they can fit.
 * Everything is UTC, which is the clock `map/firms.js` already keeps: a day is
 * the name of a day, not an instant, and reading it locally would move it by
 * one either side of midnight.
 */

/** Monday first: the week the rest of the world starts on, two letters so no
 *  two columns wear the same initial. */
export const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

/** A `YYYY-MM-DD` as a UTC date, or null — the same strictness as the service
 *  routes, so a half-typed field never becomes a request. */
export function parseDay(iso) {
  if (!DAY.test(String(iso ?? ''))) return null;
  const at = new Date(`${iso}T00:00:00Z`);
  // '2026-02-31' parses to March 3rd, which is not the day that was typed
  return Number.isNaN(at.getTime()) || dayOf(at) !== iso ? null : at;
}

/** …and back. */
export function dayOf(at) {
  return at.toISOString().slice(0, 10);
}

/** Today, in the same form. */
export function today(now = new Date()) {
  return dayOf(now);
}

/** The month a day belongs to, as the cursor a calendar is drawn from. */
export function monthOf(iso, fallback = today()) {
  const day = String(iso ?? '');
  if (DAY.test(day)) return day.slice(0, 7);
  if (MONTH.test(day)) return day;
  return String(fallback).slice(0, 7);
}

/** That cursor, moved by whole months — what `‹` and `›` press. */
export function shiftMonth(cursor, by) {
  const [year, month] = monthOf(cursor).split('-').map(Number);
  const at = new Date(Date.UTC(year, month - 1 + by, 1));
  return at.toISOString().slice(0, 7);
}

/** `Sep 2026`, the heading between the two arrows. */
export function monthLabel(cursor) {
  const [year, month] = monthOf(cursor).split('-').map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

/**
 * The cells of one month, in rows of seven.
 *
 * The days either side are included so a week is always seven boxes, and
 * flagged `inMonth: false` so they can be drawn faintly. The number of rows
 * follows the month rather than always being six: a trailing empty week is a
 * panel that jumps by 28 px between February and March.
 */
export function monthDays(cursor) {
  const [year, month] = monthOf(cursor).split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Sunday is 0 in JS, and last here
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weeks = Math.ceil((lead + length) / 7);
  const cells = [];
  for (let i = 0; i < weeks * 7; i += 1) {
    const at = new Date(Date.UTC(year, month - 1, 1 - lead + i));
    cells.push({ iso: dayOf(at), day: at.getUTCDate(), inMonth: at.getUTCMonth() === month - 1 });
  }
  return cells;
}

/** Whether a day is outside what the field accepts — an empty bound is no
 *  bound, which is how a range with no end is stated. */
export function outOfRange(iso, min = '', max = '') {
  if (!DAY.test(String(iso ?? ''))) return true;
  if (DAY.test(String(min)) && iso < min) return true;
  return Boolean(DAY.test(String(max)) && iso > max);
}

/** Whether a whole month is, which is what greys an arrow rather than letting
 *  it walk into years the service cannot answer for. */
export function monthOutOfRange(cursor, min = '', max = '') {
  const cells = monthDays(cursor).filter((cell) => cell.inMonth);
  return cells.every((cell) => outOfRange(cell.iso, min, max));
}
