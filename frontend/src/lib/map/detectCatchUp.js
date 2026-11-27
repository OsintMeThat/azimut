/**
 * The passes a routine missed, from one lookup over its areas.
 *
 * A routine run by hand misses the days nobody pressed Run. The catalogue says
 * which passes flew over the areas since the routine began; set against the
 * passes its runs read, the rest is what it missed. The newer ones are ticked
 * when the rule that picks the newest pass would take them (under the cloud
 * ceiling, the whole area covered, a radar pass on the routine's track), and
 * every other one can still be ticked by hand: a day chosen is read whatever
 * its sky. Pure: the lookup is the panel's (`POST /satellite/sentinel/acquisitions`).
 */
import { FULL_COVER, passKey } from './acquisitions.js';
import { sameTrack } from '../radar.js';

/** The most passes one catch-up queues, as the server holds it (`MAX_CATCH_UP`). */
export const MAX_CATCH_UP = 30;
/** How far back the list looks for a routine that has never read a pass. */
export const FIRST_LOOKBACK = 30;

/**
 * The days to look between: from the first pass the routine read, or a month back, to
 * today. A routine that compares every pass with one fixed day (`since`) looks from that
 * day, when it comes first: each pass since is a change it can read.
 */
export function catchUpSpan(readDays, today = new Date().toISOString().slice(0, 10), since = '') {
  const first = [...(readDays ?? []), since].filter(Boolean).sort()[0];
  if (first) return { start: first, end: today };
  const start = new Date(Date.parse(`${today}T00:00:00Z`) - FIRST_LOOKBACK * 86400000).toISOString().slice(0, 10);
  return { start, end: today };
}

/**
 * Each pass found, newest first, with where it stands: `read` (the routine read
 * it), `gap` (missed between two passes it read), why the newest-pass rule would
 * pass it over (`why`: 'cloud', 'cover', 'track' or ''), and whether it starts
 * ticked (`picked`: a pass newer than the last one read that the rule would take).
 */
export function missedPasses(found, readDays, { maxcc = 100, radar = false, track = '' } = {}) {
  const read = new Set(readDays ?? []);
  const last = [...read].sort().at(-1) ?? '';
  const seen = new Set();
  const rows = [];
  for (const entry of found ?? []) {
    const key = passKey(entry);
    if (!entry?.date || seen.has(key)) continue;
    seen.add(key);
    const why = radar
      ? (track && entry.time && !sameTrack(entry.time, track) ? 'track' : !((entry.coverage ?? 0) >= FULL_COVER) ? 'cover' : '')
      : !(entry.cloud != null && entry.cloud <= maxcc) ? 'cloud' : !((entry.coverage ?? 0) >= FULL_COVER) ? 'cover' : '';
    const isRead = read.has(entry.date);
    rows.push({
      ...entry,
      read: isRead,
      gap: !isRead && !!last && entry.date < last,
      why,
      picked: !isRead && entry.date > last && !why,
    });
  }
  return rows.sort((one, two) => passKey(two).localeCompare(passKey(one)));
}

/** Why the rule passed a pass over, in a few words. */
export function whyLabel(row, maxcc) {
  if (row.why === 'cloud') return row.cloud == null ? 'cloud unknown' : `over the ${maxcc}% cloud limit`;
  if (row.why === 'cover') return `${Math.round((row.coverage ?? 0) * 100)}% of the areas`;
  if (row.why === 'track') return 'another track';
  return '';
}

/** The passes ticked, oldest first, as the server takes them. */
export function chosenPasses(rows, ticked) {
  return (rows ?? []).filter((row) => ticked.has(passKey(row)) && !row.read)
    .sort((one, two) => passKey(one).localeCompare(passKey(two)))
    .map((row) => ({ date: row.date, ...(row.time ? { time: row.time } : {}) }));
}
