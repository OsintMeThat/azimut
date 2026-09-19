/**
 * One text field for a date, read the way people write one.
 *
 * The case stores dates in one profile (`lib/timeline.js`: `2025-10-24~`,
 * `2025-10`, `2025-10-24T14:30:00Z`, `start/end`), and the backend refuses
 * anything else. Asking an analyst to pick a format, a precision and a
 * certainty from three lists before typing a day was the long way round, so
 * this reads what they type into that same profile:
 *
 * - anything already in the stored profile is kept exactly as typed, so the
 *   advanced syntax still works and nothing a proof holds can be re-read into
 *   something else;
 * - otherwise a day is day-first (`24/10/2025`, `24.10.2025`), a month is
 *   `10/2025` or a name (`Oct 2025`, `octobre 2025`), a year is four digits;
 * - `~` or "about" means approximate, a `?` means uncertain, both mean both;
 * - a time (`14:30`, `14h30`) makes it a timestamp, local unless a zone
 *   follows (`UTC`, `Z`, `+02:00`, `UTC+2`);
 * - two of them joined by "to" or a spaced dash make a range.
 *
 * `friendlyDate` writes a stored value back in that everyday form, and reading
 * it again gives the same stored value — `looseDate.test.js` holds both
 * directions to every example the profile documents.
 */
import { validateTemporalValue } from './timeline.js';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// English and French month names, accents folded, full and short.
const MONTH_WORDS = new Map(
  [
    ['january', 'jan', 'janvier', 'janv'],
    ['february', 'feb', 'fevrier', 'fevr', 'fev'],
    ['march', 'mar', 'mars'],
    ['april', 'apr', 'avril', 'avr'],
    ['may', 'mai'],
    ['june', 'jun', 'juin'],
    ['july', 'jul', 'juillet', 'juil'],
    ['august', 'aug', 'aout'],
    ['september', 'sep', 'sept', 'septembre'],
    ['october', 'oct', 'octobre'],
    ['november', 'nov', 'novembre'],
    ['december', 'dec', 'decembre'],
  ].flatMap((words, index) => words.map((word) => [word, index + 1]))
);

export const LOOSE_DATE_HINT =
  'A day as dd/mm/yyyy, or Oct 2025, or 2025. Start with ~ for about, end with ? if unsure. A time like 14:30 UTC, or two dates joined by "to", work too.';

const HELP = 'Try 24/10/2025, Oct 2025, 2025, 24/10/2025 14:30 UTC, or two dates joined by "to".';

const fold = (text) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const pad = (value, size = 2) => String(value).padStart(size, '0');

/** `{ value }` in the stored profile, or `{ value: null, error }`. Empty reads as ''. */
export function parseLooseDate(input) {
  const text = String(input ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return { value: '', error: '' };
  if (validateTemporalValue(text).valid) return { value: text, error: '' };

  const parts = splitRange(text);
  if (parts.length === 2) {
    const [first, second] = parts.map(readOne);
    if (first.error || second.error) return fail(first.error || second.error);
    let [a, b] = [first, second];
    // "24/10/2025 10:00 to 12:30 UTC": the end borrows the start's day, and a
    // zone written once is meant for both ends.
    if (b.timeOnly && a.time) b = { ...b, date: a.date, timeOnly: false };
    if (a.time && b.time && Boolean(a.zone) !== Boolean(b.zone)) {
      a = { ...a, zone: a.zone || b.zone };
      b = { ...b, zone: b.zone || a.zone };
    }
    if (a.timeOnly || b.timeOnly) return fail(HELP);
    return checked(`${write(a)}/${write(b)}`);
  }

  const one = readOne(text);
  if (one.error) return fail(one.error);
  if (one.timeOnly) return fail('Give the day this time belongs to.');
  return checked(write(one));
}

/** A stored value, written the way `parseLooseDate` reads it back. */
export function friendlyDate(raw) {
  const value = String(raw ?? '');
  if (!value || !validateTemporalValue(value).valid) return value;
  const parts = value.split('/');
  return parts.map(friendlyPart).join(' to ');
}

const BUILT = /^(\d{4}(?:-\d{2}(?:-\d{2})?)?)([~?%])?$/;

/**
 * A stored value from the pieces a builder collects: one or two dates, each as
 * deep as the analyst went (a year, a month, a day), and the two marks of doubt.
 *
 * The marks ride on both ends of a range, because they describe how well the
 * date is known rather than which end of it is meant.
 */
export function composeLooseDate({ start = '', end = '', approximate = false, uncertain = false } = {}) {
  if (!start) return '';
  const marker = approximate && uncertain ? '%' : approximate ? '~' : uncertain ? '?' : '';
  const one = `${start}${marker}`;
  return end ? `${one}/${end}${marker}` : one;
}

/**
 * …and back, so a builder opens on what the field already holds.
 *
 * Null for anything it cannot draw — a timestamp, a range of two times — which
 * is the builder saying "type that", not the field refusing it.
 */
export function decomposeLooseDate(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return { start: '', end: '', approximate: false, uncertain: false };
  const parts = value.split('/');
  if (parts.length > 2) return null;
  const read = parts.map((part) => BUILT.exec(part));
  if (read.some((match) => !match)) return null;
  const marker = read[0][2] ?? '';
  return {
    start: read[0][1],
    end: read[1]?.[1] ?? '',
    approximate: marker === '~' || marker === '%',
    uncertain: marker === '?' || marker === '%',
  };
}

function friendlyPart(part) {
  const date = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?([~?%])?$/.exec(part);
  if (date) {
    const [, year, month, day, marker = ''] = date;
    const body = day ? `${day}/${month}/${year}` : month ? `${MONTH_ABBR[Number(month) - 1]} ${year}` : year;
    const approx = marker === '~' || marker === '%' ? '~' : '';
    const unsure = marker === '?' || marker === '%' ? '?' : '';
    return `${approx}${body}${unsure}`;
  }
  const stamp = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})?$/.exec(part);
  if (!stamp) return part;
  const [, year, month, day, hour, minute, second, fraction = '', zone = ''] = stamp;
  const seconds = second !== '00' || fraction ? `:${second}${fraction}` : '';
  const where = zone === 'Z' ? ' UTC' : zone ? ` ${zone}` : '';
  return `${day}/${month}/${year} ${hour}:${minute}${seconds}${where}`;
}

function fail(error) {
  return { value: null, error };
}

function checked(value) {
  const check = validateTemporalValue(value);
  if (check.valid) return { value, error: '' };
  // The parts were written in the stored shape, so a generic refusal here means
  // the calendar said no: a 31 February, a 25:00.
  return fail(check.error === 'Use a supported date or timestamp.' ? 'That date does not exist.' : check.error);
}

function splitRange(text) {
  const between = /^(?:between|from|entre|du)\s+(.+?)\s+(?:and|to|et|au)\s+(.+)$/i.exec(text);
  if (between) return [between[1], between[2]];
  // A dash only joins two dates with a space on both sides, so the minus of a
  // UTC offset ("14:30 -05:00") is never read as one.
  const joined = text.split(/\s+(?:to|until|till|au|à)\s+|\s+[-–—]\s+/i);
  return joined.length === 2 ? joined : [text];
}

/** One date or one timestamp, into its parts; never a range. */
function readOne(input) {
  let text = input.trim();
  let approx = false;
  let unsure = false;
  for (;;) {
    const lead = /^(?:~|about|approx\.?|approximately|around|circa|c\.|ca\.|vers|environ)\s*/i.exec(text);
    if (lead && lead[0]) {
      approx = true;
      text = text.slice(lead[0].length);
      continue;
    }
    if (text.startsWith('%')) {
      approx = unsure = true;
      text = text.slice(1).trim();
      continue;
    }
    if (text.startsWith('?')) {
      unsure = true;
      text = text.slice(1).trim();
      continue;
    }
    break;
  }
  for (;;) {
    if (/[?]$/.test(text)) unsure = true;
    else if (/[~]$/.test(text)) approx = true;
    else if (/[%]$/.test(text)) approx = unsure = true;
    else break;
    text = text.slice(0, -1).trim();
  }

  const time = readTime(text);
  if (time.error) return time;
  text = time.rest;
  if (time.time && (approx || unsure)) {
    return fail('A time cannot be marked ~ or ?. Drop the time, or the mark.');
  }
  if (!text) {
    return time.time ? { timeOnly: true, time: time.time, zone: time.zone } : fail(HELP);
  }
  const date = readDate(text);
  if (date.error) return date;
  if (time.time && date.precision !== 'day') return fail('A time needs a full day before it.');
  return { ...date, approx, unsure, time: time.time, zone: time.zone };
}

// A time and the zone after it, taken off the end: "14:30", "14h30",
// "14:30:05.25", then "Z", "UTC", "GMT", "+02:00", "UTC+2", "-0530".
const TIME =
  /(?:^|[\sT])(\d{1,2})(?::|h)(\d{2})(?::(\d{2})(\.\d{1,6})?)?\s*(z|utc|gmt)?\s*(?:([+-])(\d{1,2})(?::?(\d{2}))?)?$/i;

function readTime(text) {
  const match = TIME.exec(text);
  if (!match) return { rest: text, time: '', zone: '' };
  const [whole, hour, minute, second = '00', fraction = '', named, sign, offHour, offMinute = '00'] = match;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return fail('That time does not exist.');
  let zone = '';
  if (sign) zone = `${sign}${pad(offHour)}:${pad(offMinute)}`;
  else if (named) zone = 'Z';
  if (zone === '+00:00' && named) zone = 'Z';
  return {
    rest: text.slice(0, text.length - whole.length).replace(/[\s,T]+$/, '').trim(),
    time: `${pad(hour)}:${minute}:${second}${fraction}`,
    zone,
  };
}

function readDate(text) {
  let match = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(text);
  if (match) return day(match[1], match[2], match[3]);
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(text);
  if (match) return day(match[3], match[2], match[1]);
  match = /^(\d{1,2})[/.-](\d{2,4})$/.exec(text);
  if (match) return day(match[2], match[1]);
  match = /^(\d{2,4})$/.exec(text);
  if (match) return day(match[1]);

  // Words: a month name, a year, and perhaps a day, in either order.
  const tokens = fold(text).replace(/[,.]/g, ' ').split(/\s+/).filter(Boolean);
  let year = '';
  let month = 0;
  let dayOf = '';
  for (const token of tokens) {
    const word = MONTH_WORDS.get(token);
    if (word && !month) month = word;
    else if (/^\d{4}$/.test(token) && !year) year = token;
    else if (/^\d{1,2}(?:st|nd|rd|th|er)?$/.test(token) && !dayOf) dayOf = token.replace(/\D/g, '');
    else return fail(HELP);
  }
  if (!year || !month) return fail(HELP);
  return day(year, String(month), dayOf || undefined);
}

function day(year, month, dayOf) {
  if (year.length !== 4) return fail('Write the year in full, like 2025.');
  const precision = dayOf ? 'day' : month ? 'month' : 'year';
  const date = [year, month && pad(month), dayOf && pad(dayOf)].filter(Boolean).join('-');
  return { date, precision };
}

function write(part) {
  if (part.time) return `${part.date}T${part.time}${part.zone}`;
  const marker = part.approx && part.unsure ? '%' : part.approx ? '~' : part.unsure ? '?' : '';
  return `${part.date}${marker}`;
}
