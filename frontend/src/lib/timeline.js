export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const MIN_WINDOW = 2 * SECOND;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const TIMELINE_CATEGORIES = [
  { id: 'statement', label: 'Statements', short: 'Statements' },
  { id: 'media', label: 'Media dates', short: 'Media' },
  { id: 'case_activity', label: 'Case activity', short: 'Activity' },
];

function clamp(value, low = 0, high = 1) {
  return Math.min(high, Math.max(low, value));
}

// ── the zone the axis is read in ─────────────────────────────────────────────
//
// **Storage is UTC and stays UTC.** Every instant on disk, in a query and in a
// stated value is unchanged by anything below: this is presentation, the way the
// display preferences are (SPEC §9), and the switch moves where the ticks fall and
// what they are called, never what the case holds.
//
// It exists because an investigator argues in the *event's* local time. A photo
// posted at 19:40 is checked against the light at the place it was taken, not
// against a clock in the analyst's own country — and reading a UTC axis while
// thinking in local time is where an hour goes missing in a chronology.
//
// The rule for ticks: **above a day the step is a calendar one**, so a day tick is
// local midnight whatever the offset was doing that week; **below it a fixed
// interval**, so an hour tick keeps its exact spacing and a zone that jumps an hour
// shows the jump — 01:00 then 03:00 — instead of hiding it.

/** The zone every reading defaults to, and the one the case is stored in. */
export const UTC = 'UTC';

/** This machine's own zone, for the analyst who wants their own working day. It is
 *  a legitimate reading and a poor default, which is why UTC is the default. */
export function machineZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || UTC;
  } catch {
    return UTC;
  }
}

/** Whether this browser can read that zone at all. A zone name carried in from
 *  another machine must never throw the axis away. */
export function knownZone(zone) {
  if (!zone || zone === UTC) return true;
  try {
    partsFor(zone).format(0);
    return true;
  } catch {
    return false;
  }
}

const FORMATTERS = new Map();

function partsFor(zone) {
  let held = FORMATTERS.get(zone);
  if (!held) {
    held = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    FORMATTERS.set(zone, held);
  }
  return held;
}

/** The wall-clock reading of an instant in a zone, as plain numbers. */
export function zonedFields(millis, zone = UTC) {
  const date = new Date(millis);
  if (!zone || zone === UTC) {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
    };
  }
  const held = {};
  for (const part of partsFor(zone).formatToParts(date)) {
    if (part.type !== 'literal') held[part.type] = Number(part.value);
  }
  return {
    year: held.year,
    month: held.month,
    day: held.day,
    // Midnight comes back as 24 in some engines even under h23; both spellings mean
    // the start of the day, and only one of them survives arithmetic.
    hour: held.hour === 24 ? 0 : held.hour,
    minute: held.minute,
    second: held.second,
  };
}

/** A wall clock as an instant, built through `Date` rather than `Date.UTC` so a
 *  two-digit year stays itself instead of landing in the twentieth century. */
function fieldsToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

/** How far ahead of UTC the zone runs at that instant, in milliseconds. */
export function zoneOffset(millis, zone = UTC) {
  if (!zone || zone === UTC) return 0;
  return fieldsToUtc(zonedFields(millis, zone)) - Math.floor(millis / SECOND) * SECOND;
}

/**
 * The instant a wall clock names in a zone.
 *
 * Corrected twice, which is what a zone lookup costs when only the inverse is on
 * offer: the first pass lands within an hour of the answer, and the second settles
 * it — including on the two days a year when the offset moves under the guess. A wall
 * clock a spring change skipped over lands an hour later, in the offset now in force,
 * which is what every calendar does with a time that never happened.
 */
export function instantOf(fields, zone = UTC) {
  const wanted = fieldsToUtc(fields);
  if (!zone || zone === UTC) return wanted;
  let millis = wanted - zoneOffset(wanted, zone);
  millis = wanted - zoneOffset(millis, zone);
  return millis;
}

const pad = (value, size = 2) => String(value).padStart(size, '0');

/** The zone as the analyst sees it named: the short abbreviation the zone itself
 *  uses, or its numeric offset where it has no word for the season. */
export function zoneAbbreviation(zone, at = 0) {
  if (!zone || zone === UTC) return 'UTC';
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'short',
    }).formatToParts(new Date(at));
    return parts.find((part) => part.type === 'timeZoneName')?.value ?? zone;
  } catch {
    return zone;
  }
}

/**
 * Every zone this browser can name, sorted.
 *
 * An investigation is rarely in the analyst's own zone and often in no zone the case
 * has a saved point for yet, so the reading has to be choosable outright. The list is
 * the platform's own copy of the IANA database — no dependency, nothing fetched — and
 * naming a zone rather than an offset is what makes a stated hour survive the two days
 * a year the offset moves.
 *
 * Empty where the engine will not list them (`supportedValuesOf` landed in 2022), and
 * the picker says so rather than pretending the world is UTC.
 */
export function worldZones() {
  try {
    const held = Intl.supportedValuesOf?.('timeZone') ?? [];
    return [...held].sort((one, other) => one.localeCompare(other));
  } catch {
    return [];
  }
}

/** A zone's offset at an instant, as `UTC+02:00`. What tells two zones of the same
 *  name apart, and what an analyst reads a stated `+03:00` against. */
export function offsetLabel(zone, at = 0) {
  const minutes = Math.round(zoneOffset(at, zone) / MINUTE);
  if (!minutes) return 'UTC';
  const sign = minutes < 0 ? '-' : '+';
  const size = Math.abs(minutes);
  return `UTC${sign}${pad(Math.floor(size / 60))}:${pad(size % 60)}`;
}

/** The zone as a line in a menu: the place part first, since that is what is typed. */
export function zoneWords(zone) {
  const parts = String(zone ?? '').split('/');
  return {
    place: parts.at(-1).replace(/_/g, ' '),
    region: parts.length > 1 ? parts.slice(0, -1).join(' / ').replace(/_/g, ' ') : '',
  };
}

/**
 * Cities the database renamed, and the name an analyst is going to type.
 *
 * Which of the two a platform lists is not ours to decide: this machine's own copy
 * offers `Europe/Kiev` and `Asia/Calcutta` where a current browser offers `Europe/Kyiv`
 * and `Asia/Kolkata`. Both spellings load either way, so the only thing that breaks is
 * the *search* — and someone working Ukraine typing "kyiv" into a list that says Kiev
 * concludes the zone is missing. Matched both directions, so neither spelling hides a
 * zone the other name would have found.
 */
const ZONE_ALIASES = [
  ['kiev', 'kyiv'],
  ['calcutta', 'kolkata'],
  ['saigon', 'ho chi minh'],
  ['rangoon', 'yangon'],
  ['katmandu', 'kathmandu'],
  ['asmera', 'asmara'],
  ['dacca', 'dhaka'],
  ['ujung pandang', 'makassar'],
  ['bombay', 'mumbai'],
  ['madras', 'chennai'],
];

/**
 * Whether a zone answers what was typed.
 *
 * Matched on the whole name, on the city alone, on the offset and across the renames
 * above, so `kyiv`, `europe` and `+03` all reach the zone whichever way this platform
 * spells it. Underscores are not something anyone types.
 */
export function zoneMatches(zone, query, at = 0) {
  const term = String(query ?? '').trim().toLowerCase();
  if (!term) return true;
  const name = String(zone ?? '').toLowerCase().replace(/_/g, ' ');
  if (name.includes(term) || offsetLabel(zone, at).toLowerCase().includes(term)) return true;
  return ZONE_ALIASES.some(
    ([one, other]) =>
      (name.includes(one) && other.includes(term)) ||
      (name.includes(other) && one.includes(term)),
  );
}

/** One instant written out in the zone, for a readout rather than for a tick. */
export function zonedStamp(value, zone = UTC) {
  const millis = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(millis)) return '';
  const at = zonedFields(millis, zone);
  return (
    `${pad(at.year, 4)}-${pad(at.month)}-${pad(at.day)} ` +
    `${pad(at.hour)}:${pad(at.minute)}:${pad(at.second)}`
  );
}

export function isoDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}

export function isoInstant(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toISOString().replace('.000Z', 'Z');
}

function boundaryMillis(value, upper = false) {
  if (!value) return Number.NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const start = new Date(`${value}T00:00:00Z`).getTime();
    return upper ? start + DAY : start;
  }
  return new Date(value).getTime();
}

export function windowMillis(from, to) {
  const start = boundaryMillis(from);
  const end = boundaryMillis(to, true);
  return Number.isFinite(start) && Number.isFinite(end) && start < end
    ? { start, end, span: end - start }
    : null;
}

export function initialWindow(extent) {
  if (!extent?.from || !extent?.to) return { from: '', to: '' };
  const first = new Date(extent.from).getTime();
  const last = new Date(extent.to).getTime();
  if (!Number.isFinite(first) || !Number.isFinite(last)) return { from: '', to: '' };
  const span = Math.max(last - first, SECOND);
  const padding = Math.max(span <= DAY ? SECOND : DAY, span * 0.035);
  return { from: isoInstant(first - padding), to: isoInstant(last + padding) };
}

function rangeFromMillis(start, end) {
  return { from: isoInstant(start), to: isoInstant(end) };
}

export function shiftWindow(from, to, fraction) {
  const window = windowMillis(from, to);
  if (!window) return { from, to };
  const shift = window.span * fraction;
  return rangeFromMillis(window.start + shift, window.end + shift);
}

export function zoomWindow(from, to, factor, anchor = 0.5) {
  const window = windowMillis(from, to);
  if (!window) return { from, to };
  const nextSpan = Math.max(MIN_WINDOW, window.span * factor);
  const pivot = window.start + window.span * clamp(anchor);
  const start = pivot - nextSpan * clamp(anchor);
  return rangeFromMillis(start, start + nextSpan);
}

/**
 * The window in words, for the control that opens it.
 *
 * One reading replaces two date boxes on the toolbar: the boxes are how a window is
 * *typed*, which is the rare act, and the frequent one is checking what is on screen.
 * Read in the axis's own zone, so it agrees with the ticks under it.
 */
export function windowWords(from, to, zone = UTC) {
  const window = windowMillis(from, to);
  if (!window) return 'All dates';
  const start = zonedFields(window.start, zone);
  const end = zonedFields(window.end, zone);
  const day = (at) => `${at.day} ${MONTHS[at.month - 1]}`;
  const clock = (at) => `${pad(at.hour)}:${pad(at.minute)}`;
  if (start.year === end.year && start.month === end.month && start.day === end.day) {
    return `${day(start)} ${start.year}, ${clock(start)} – ${clock(end)}`;
  }
  // Under two days the hours are the point; above it they are noise, and the year is
  // stated once unless the window crosses one.
  if (window.span < 2 * DAY) {
    return `${day(start)} ${clock(start)} – ${day(end)} ${clock(end)}`;
  }
  const left = start.year === end.year ? day(start) : `${day(start)} ${start.year}`;
  return `${left} – ${day(end)} ${end.year}`;
}

/**
 * The spans the window can be set to, widest last.
 *
 * They replace a pair of zoom buttons: pressing − four times to see a year is
 * counting, and "Year" is the thing being asked for. A month and a year are the
 * round numbers a viewport wants, not calendar arithmetic — the ticks handle the
 * calendar.
 */
export const WINDOW_SPANS = [
  { label: 'Hour', ms: HOUR },
  { label: 'Day', ms: DAY },
  { label: 'Week', ms: 7 * DAY },
  { label: 'Month', ms: 30 * DAY },
  { label: 'Year', ms: 365 * DAY },
];

/** Resize the window around its middle, which is what the analyst is looking at. */
export function resizeWindow(from, to, span) {
  const window = windowMillis(from, to);
  if (!window) return { from, to };
  return zoomWindow(from, to, span / window.span, 0.5);
}

export function windowInputValue(value, zone = UTC) {
  const millis = boundaryMillis(value);
  if (!Number.isFinite(millis)) return '';
  if (!zone || zone === UTC) return new Date(millis).toISOString().slice(0, 19);
  const at = zonedFields(millis, zone);
  return (
    `${pad(at.year, 4)}-${pad(at.month)}-${pad(at.day)}` +
    `T${pad(at.hour)}:${pad(at.minute)}:${pad(at.second)}`
  );
}

/** The other direction: the boundary control holds a wall clock, and which instant
 *  that names depends on the zone the axis is being read in. */
export function inputWindowValue(value, zone = UTC) {
  if (!value) return '';
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
  if (!zone || zone === UTC) return `${withSeconds}Z`;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(withSeconds);
  if (!match) return '';
  const [, year, month, day, hour, minute, second] = match.map(Number);
  return isoInstant(
    instantOf({ year, month, day, hour, minute, second }, zone)
  );
}

export function timeAtRatio(from, to, ratio) {
  const window = windowMillis(from, to);
  if (!window) return '';
  const milliseconds = window.start + window.span * clamp(ratio);
  return isoInstant(Math.round(milliseconds / SECOND) * SECOND);
}

export function dateAtRatio(from, to, ratio) {
  const instant = timeAtRatio(from, to, ratio);
  return instant ? instant.slice(0, 10) : '';
}

export function draftWhen(from, to, startRatio, endRatio) {
  const window = windowMillis(from, to);
  if (!window) return '';
  const low = Math.min(startRatio, endRatio);
  const high = Math.max(startRatio, endRatio);
  if (window.span <= 3 * DAY) {
    const start = timeAtRatio(from, to, low);
    const end = timeAtRatio(from, to, high);
    return high - low < .004 ? start : `${start}/${end}`;
  }
  const a = dateAtRatio(from, to, low);
  const b = dateAtRatio(from, to, high);
  if (!a || !b) return '';
  return a === b ? a : `${a}/${b}`;
}

const DATE_TOKEN = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?([~?%])?$/;
const TIMESTAMP_TOKEN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))?$/;

function makeUtc(year, month, day) {
  const value = new Date(0);
  value.setUTCHours(0, 0, 0, 0);
  value.setUTCFullYear(year, month - 1, day);
  return value;
}

function validDateParts(year, month = 1, day = 1) {
  if (year < 1 || year > 9998 || month < 1 || month > 12 || day < 1) return false;
  const value = makeUtc(year, month, day);
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day;
}

function dateBounds(match) {
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : 1;
  const day = match[3] ? Number(match[3]) : 1;
  if (!validDateParts(year, month, day)) return null;
  const first = makeUtc(year, month, day);
  const last = new Date(first);
  if (match[3]) last.setUTCDate(last.getUTCDate() + 1);
  else if (match[2]) last.setUTCMonth(last.getUTCMonth() + 1);
  else last.setUTCFullYear(last.getUTCFullYear() + 1);
  return { first: first.getTime(), last: last.getTime() };
}

function validateDate(raw) {
  const match = DATE_TOKEN.exec(raw);
  return match ? dateBounds(match) : null;
}

function validateTimestamp(raw) {
  const match = TIMESTAMP_TOKEN.exec(raw);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, , zone, , offsetHour, offsetMinute] = match;
  if (!validDateParts(Number(year), Number(month), Number(day))) return false;
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (zone && zone !== 'Z') {
    const h = Number(offsetHour);
    const m = Number(offsetMinute);
    if (h > 14 || m > 59 || (h === 14 && m > 0)) return false;
  }
  return true;
}

function sortableTimestamp(raw) {
  return validateTimestamp(raw) && /(Z|[+-]\d{2}:\d{2})$/.test(raw);
}

export function validateTemporalValue(raw) {
  if (raw === '') return { valid: true, empty: true, error: '' };
  if (typeof raw !== 'string' || raw !== raw.trim()) {
    return { valid: false, empty: false, error: 'Remove spaces around the value.' };
  }
  if (!raw.includes('/')) {
    const valid = Boolean(validateDate(raw)) || validateTimestamp(raw);
    return {
      valid,
      empty: false,
      error: valid ? '' : 'Use a supported date or timestamp.',
    };
  }
  if (raw.split('/').length !== 2) {
    return { valid: false, empty: false, error: 'A range needs two dates.' };
  }
  const [start, end] = raw.split('/');
  const first = validateDate(start);
  const last = validateDate(end);
  if (first && last) {
    if (first.first >= last.last) {
      return { valid: false, empty: false, error: 'The end must come after the start.' };
    }
    return { valid: true, empty: false, error: '' };
  }
  if (!sortableTimestamp(start) || !sortableTimestamp(end)) {
    return { valid: false, empty: false, error: 'Use two dates or two times with timezones.' };
  }
  if (new Date(start).getTime() >= new Date(end).getTime()) {
    return { valid: false, empty: false, error: 'The end must come after the start.' };
  }
  return { valid: true, empty: false, error: '' };
}

function dateLabel(raw) {
  const match = DATE_TOKEN.exec(raw);
  if (!match) return raw;
  const year = Number(match[1]);
  if (!match[2]) return String(year);
  const month = MONTHS[Number(match[2]) - 1];
  if (!match[3]) return `${month} ${year}`;
  return `${Number(match[3])} ${month} ${year}`;
}

function timestampLabel(raw) {
  const match = TIMESTAMP_TOKEN.exec(raw);
  if (!match) return raw;
  const date = `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
  const fraction = match[7] ? `.${match[7]}` : '';
  const zone = match[8] === 'Z' ? ' UTC' : match[8] ? ` UTC${match[8]}` : ' local time';
  return `${date}, ${match[4]}:${match[5]}:${match[6]}${fraction}${zone}`;
}

function qualifierLabels(raw) {
  const labels = [];
  if (raw.includes('~') || raw.includes('%')) labels.push('Approximate');
  if (raw.includes('?') || raw.includes('%')) labels.push('Uncertain');
  return labels;
}

export function formatTemporalValue(raw) {
  const check = validateTemporalValue(raw ?? '');
  if (!raw) return { ...check, label: 'Undated', qualifiers: [] };
  if (!check.valid) return { ...check, label: raw, qualifiers: [] };
  const parts = raw.split('/');
  const label = parts.length === 2
    ? `${DATE_TOKEN.test(parts[0]) ? dateLabel(parts[0]) : timestampLabel(parts[0])} to ${DATE_TOKEN.test(parts[1]) ? dateLabel(parts[1]) : timestampLabel(parts[1])}`
    : DATE_TOKEN.test(raw) ? dateLabel(raw) : timestampLabel(raw);
  return { ...check, label, qualifiers: qualifierLabels(raw) };
}

function moveDateToken(raw, deltaMs) {
  const match = DATE_TOKEN.exec(raw);
  if (!match) return null;
  const marker = match[4] ?? '';
  if (match[3]) {
    const date = makeUtc(Number(match[1]), Number(match[2]), Number(match[3]));
    date.setUTCDate(date.getUTCDate() + Math.round(deltaMs / DAY));
    return `${isoDay(date)}${marker}`;
  }
  if (match[2]) {
    const date = makeUtc(Number(match[1]), Number(match[2]), 1);
    date.setUTCMonth(date.getUTCMonth() + Math.round(deltaMs / (DAY * 30.4375)));
    return `${date.toISOString().slice(0, 7)}${marker}`;
  }
  const year = Number(match[1]) + Math.round(deltaMs / (DAY * 365.2425));
  return year >= 1 && year <= 9998 ? `${String(year).padStart(4, '0')}${marker}` : null;
}

export function canDragTemporal(item) {
  if (item?.category !== 'statement' || !item.raw) return false;
  const parts = item.raw.split('/');
  const dates = parts.every((part) => DATE_TOKEN.test(part));
  const timestamps = parts.every((part) => sortableTimestamp(part));
  return parts.length <= 2 && (dates || timestamps);
}

const bareDate = (part) => part.replace(/[~?%]$/, '');

function ordered(parts) {
  return parts.length < 2 || validateTemporalValue(parts.join('/')).valid;
}

function timestampOffset(raw) {
  if (raw.endsWith('Z')) return { suffix: 'Z', minutes: 0 };
  const match = raw.match(/([+-])(\d{2}):(\d{2})$/);
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return { suffix: match[0], minutes: match[1] === '-' ? -minutes : minutes };
}

function shiftedTimestamp(raw, deltaMs) {
  const match = TIMESTAMP_TOKEN.exec(raw);
  const zone = timestampOffset(raw);
  if (!match || !zone) return null;
  const fraction = match[7] ?? '';
  const resolution = fraction ? Math.max(1, 10 ** (3 - Math.min(3, fraction.length))) : SECOND;
  const shifted = new Date(raw).getTime() + Math.round(deltaMs / resolution) * resolution;
  if (!Number.isFinite(shifted)) return null;
  const wall = new Date(shifted + zone.minutes * MINUTE);
  const base = wall.toISOString().slice(0, 19);
  let heldFraction = '';
  if (fraction) {
    const millis = String(wall.getUTCMilliseconds()).padStart(3, '0');
    heldFraction = `.${fraction.length <= 3 ? millis.slice(0, fraction.length) : millis + fraction.slice(3)}`;
  }
  return `${base}${heldFraction}${zone.suffix}`;
}

function timestampAtZone(value, template) {
  const millis = new Date(value).getTime();
  const original = new Date(template).getTime();
  return Number.isFinite(millis) && Number.isFinite(original)
    ? shiftedTimestamp(template, millis - original)
    : null;
}

export function moveTemporalRaw(item, deltaMs) {
  if (!canDragTemporal(item)) return null;
  const timestamp = item.raw.includes('T');
  const parts = item.raw.split('/').map((part) => timestamp ? shiftedTimestamp(part, deltaMs) : moveDateToken(part, deltaMs));
  if (parts.some((part) => part === null) || !ordered(parts)) return null;
  return parts.join('/');
}

export function resizeTemporalRaw(item, edge, value) {
  if (!canDragTemporal(item) || item.shape !== 'interval') return null;
  const [start, end] = item.raw.split('/');
  if (item.raw.includes('T')) {
    const template = edge === 'start' ? start : end;
    const restated = timestampAtZone(value, template);
    if (!restated) return null;
    const parts = edge === 'start' ? [restated, end] : [start, restated];
    return ordered(parts) ? parts.join('/') : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const marker = (edge === 'start' ? start : end).match(/[~?%]$/)?.[0] ?? '';
  const parts = edge === 'start' ? [`${value}${marker}`, end] : [start, `${value}${marker}`];
  return ordered(parts) ? parts.join('/') : null;
}

export function nudgeTemporalRaw(item, mode, direction) {
  if (!canDragTemporal(item) || ![-1, 1].includes(direction)) return null;
  if (item.raw.includes('T')) {
    if (mode === 'move') return moveTemporalRaw(item, SECOND * direction);
    if (item.shape !== 'interval') return null;
    const parts = item.raw.split('/');
    const index = mode === 'start' ? 0 : 1;
    parts[index] = shiftedTimestamp(parts[index], SECOND * direction);
    return parts[index] && ordered(parts) ? parts.join('/') : null;
  }
  if (mode === 'move') {
    const unit = item.raw.match(/^\d{4}(?!-)/) ? 365.2425 * DAY
      : item.raw.match(/^\d{4}-\d{2}(?:[~?%]|\/|$)/) ? 30.4375 * DAY : DAY;
    return moveTemporalRaw(item, unit * direction);
  }
  if (item.shape !== 'interval') return null;
  const parts = item.raw.split('/');
  const index = mode === 'start' ? 0 : 1;
  const moved = moveDateToken(parts[index], DAY * direction);
  if (!moved) return null;
  parts[index] = moved;
  return ordered(parts) ? parts.join('/') : null;
}

function itemBounds(item, window) {
  const first = new Date(item.earliest).getTime();
  const last = new Date(item.latest).getTime();
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  const left = clamp((first - window.start) / window.span);
  const right = clamp((last - window.start) / window.span);
  const midpoint = clamp(((first + last) / 2 - window.start) / window.span);
  return { left, right: Math.max(left, right), midpoint };
}

function pointWidth(item) {
  const date = formatTemporalValue(item.raw).label;
  return clamp(Math.max(String(item.label ?? '').length * 5.45, date.length * 5.1) + 40, 82, 230);
}

/** Pack the rendered geometry, not just the instant anchoring each item. */
export function layoutTimelineItems(items, from, to, axisWidth = 1000, maxItemRows = 6) {
  const window = windowMillis(from, to);
  if (!window) return { items: [], clusters: [], rows: 1 };
  const width = Math.max(320, axisWidth);
  const gap = 7 / width;
  const lanes = [];
  const placed = [];
  const hidden = new Map();
  const sorted = [...items].sort((a, b) =>
    Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
    || String(a.earliest).localeCompare(String(b.earliest))
    || String(a.id).localeCompare(String(b.id))
  );
  for (const item of sorted) {
    const bounds = itemBounds(item, window);
    if (!bounds) continue;
    const interval = item.shape === 'interval';
    const left = interval ? bounds.left : bounds.midpoint;
    const displayWidth = interval
      ? Math.max(28, (bounds.right - bounds.left) * width)
      : pointWidth(item);
    const endAligned = !interval && bounds.midpoint > 0.82;
    const visualLeft = interval ? left : endAligned
      ? left - (displayWidth - 8) / width
      : left - 8 / width;
    const visualRight = interval ? left + displayWidth / width : endAligned
      ? left + 8 / width
      : left + (displayWidth - 8) / width;
    let lane = lanes.findIndex((end) => end + gap < visualLeft);
    if (lane === -1 && (lanes.length < maxItemRows || item.pinned)) {
      lane = lanes.length;
      lanes.push(visualRight);
    } else if (lane !== -1) {
      lanes[lane] = visualRight;
    } else {
      const bucket = Math.floor(clamp(bounds.midpoint, 0, 0.9999) * width / 88);
      const group = hidden.get(bucket) ?? { count: 0, items: [], midpoint: bounds.midpoint };
      group.count += 1;
      group.items.push(item);
      group.midpoint = (group.midpoint * (group.count - 1) + bounds.midpoint) / group.count;
      hidden.set(bucket, group);
      continue;
    }
    placed.push({
      ...item,
      lane,
      left: left * 100,
      width: (displayWidth / width) * 100,
      displayWidth,
      endAligned,
      haloLeft: bounds.left * 100,
      haloWidth: Math.max(0, (bounds.right - bounds.left) * 100),
    });
  }
  const clusters = [...hidden.entries()].map(([bucket, group]) => ({
    id: `cluster:${bucket}`,
    lane: Math.max(maxItemRows, lanes.length),
    left: group.midpoint * 100,
    count: group.count,
    items: group.items,
    earliest: group.items[0]?.earliest ?? '',
  }));
  return {
    items: placed,
    clusters,
    rows: Math.max(1, lanes.length + (clusters.length ? 1 : 0)),
  };
}

const TICK_STEPS = [
  ['second', 1, SECOND], ['second', 5, 5 * SECOND], ['second', 10, 10 * SECOND],
  ['second', 30, 30 * SECOND], ['minute', 1, MINUTE], ['minute', 5, 5 * MINUTE],
  ['minute', 15, 15 * MINUTE], ['minute', 30, 30 * MINUTE], ['hour', 1, HOUR],
  ['hour', 3, 3 * HOUR], ['hour', 6, 6 * HOUR], ['hour', 12, 12 * HOUR],
  ['day', 1, DAY], ['day', 2, 2 * DAY], ['day', 7, 7 * DAY], ['day', 14, 14 * DAY],
  ['month', 1, 30.4375 * DAY], ['month', 3, 91.3125 * DAY], ['month', 6, 182.625 * DAY],
  ['year', 1, 365.25 * DAY], ['year', 2, 730.5 * DAY], ['year', 5, 1826.25 * DAY],
  ['year', 10, 3652.5 * DAY], ['year', 25, 9131.25 * DAY], ['year', 50, 18262.5 * DAY],
  ['year', 100, 36525 * DAY],
].map(([unit, step, ms]) => ({ unit, step, ms }));

function tickChoice(span, width = 1000) {
  const target = clamp(Math.round(width / 100), 8, 12);
  return TICK_STEPS.reduce((best, choice) => {
    const distance = Math.abs(span / choice.ms - target);
    return distance < best.distance ? { choice, distance } : best;
  }, { choice: TICK_STEPS.at(-1), distance: Infinity }).choice;
}

/** A whole number of local days added to a date, normalised through UTC so a month
 *  end and a leap day are the calendar's problem rather than this file's. */
function addDays(fields, count) {
  const date = new Date(fieldsToUtc({ ...fields, hour: 0, minute: 0, second: 0 }));
  date.setUTCDate(date.getUTCDate() + count);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: 0,
    minute: 0,
    second: 0,
  };
}

/**
 * Where the first tick falls, as an instant.
 *
 * Aligned to an anchor that does not depend on the window, or the ticks would slide
 * under a pan: a year to a multiple of the step, a month to an absolute month
 * number, a day to a local day number, and anything shorter to a multiple of its own
 * length off the zone's midnight.
 */
function alignTick(window, choice, zone) {
  const at = zonedFields(window.start, zone);
  if (choice.unit === 'year') {
    const year = Math.ceil(at.year / choice.step) * choice.step;
    return instantOf({ year, month: 1, day: 1 }, zone);
  }
  if (choice.unit === 'month') {
    const absolute = at.year * 12 + (at.month - 1);
    const aligned = Math.ceil(absolute / choice.step) * choice.step;
    return instantOf(
      { year: Math.floor(aligned / 12), month: (aligned % 12) + 1, day: 1 },
      zone,
    );
  }
  const shift = zoneOffset(window.start, zone);
  if (choice.unit === 'day') {
    const days = Math.ceil((window.start + shift) / DAY / choice.step) * choice.step;
    const midnight = new Date(days * DAY);
    return instantOf(
      {
        year: midnight.getUTCFullYear(),
        month: midnight.getUTCMonth() + 1,
        day: midnight.getUTCDate(),
      },
      zone,
    );
  }
  return Math.ceil((window.start + shift) / choice.ms) * choice.ms - shift;
}

function advanceTick(millis, choice, zone) {
  if (choice.unit === 'year' || choice.unit === 'month') {
    const at = zonedFields(millis, zone);
    const absolute =
      at.year * 12 + (at.month - 1) + (choice.unit === 'year' ? choice.step * 12 : choice.step);
    return instantOf(
      { year: Math.floor(absolute / 12), month: (absolute % 12) + 1, day: 1 },
      zone,
    );
  }
  if (choice.unit === 'day') {
    return instantOf(addDays(zonedFields(millis, zone), choice.step), zone);
  }
  return millis + choice.ms;
}

function tickLabel(millis, unit, zone) {
  const at = zonedFields(millis, zone);
  if (unit === 'year') return String(at.year);
  if (unit === 'month') return `${MONTHS[at.month - 1]} ${at.year}`;
  if (unit === 'day') return `${at.day} ${MONTHS[at.month - 1]}`;
  // An hour tick is on the hour in UTC and on the half hour in a zone whose offset
  // is not a whole one, so the minutes are printed rather than assumed to be zero.
  if (unit === 'hour') return `${pad(at.hour)}:${pad(at.minute)}`;
  if (unit === 'minute') return `${pad(at.hour)}:${pad(at.minute)}`;
  return `${pad(at.minute)}:${pad(at.second)}`;
}

function generateTicks(window, choice, labelled, zone) {
  let cursor = alignTick(window, choice, zone);
  const ticks = [];
  for (let guard = 0; cursor <= window.end && guard < 500; guard++) {
    if (cursor >= window.start) {
      ticks.push({
        at: new Date(cursor).toISOString(),
        left: ((cursor - window.start) / window.span) * 100,
        label: labelled ? tickLabel(cursor, choice.unit, zone) : '',
      });
    }
    const next = advanceTick(cursor, choice, zone);
    // A calendar step that fails to move — an hour a zone skipped, a guard against
    // any future unit — would spin the loop out on its own guard instead of drawing.
    if (next <= cursor) break;
    cursor = next;
  }
  return ticks;
}

export function axisTicks(from, to, width = 1000, zone = UTC) {
  const window = windowMillis(from, to);
  return window ? generateTicks(window, tickChoice(window.span, width), true, zone) : [];
}

export function axisMinorTicks(from, to, width = 1000, zone = UTC) {
  const window = windowMillis(from, to);
  if (!window) return [];
  const major = tickChoice(window.span, width);
  const index = TICK_STEPS.indexOf(major);
  const minor = TICK_STEPS[Math.max(0, index - 1)];
  if (window.span / minor.ms > 64 || minor === major) return [];
  const majorTimes = new Set(generateTicks(window, major, false, zone).map((tick) => tick.at));
  return generateTicks(window, minor, false, zone).filter((tick) => !majorTimes.has(tick.at));
}

export function axisScale(from, to, width = 1000) {
  const window = windowMillis(from, to);
  if (!window) return '';
  const unit = tickChoice(window.span, width).unit;
  return `${unit[0].toUpperCase()}${unit.slice(1)}s`;
}

export function axisBands(from, to, width = 1000, zone = UTC) {
  const window = windowMillis(from, to);
  if (!window) return [];
  const unit = tickChoice(window.span, width).unit;
  const bandUnit = ['second', 'minute', 'hour'].includes(unit) ? 'day' : unit === 'day' ? 'month' : 'year';
  const at = zonedFields(window.start, zone);
  // The band a window opens inside starts before it, so it is floored rather than
  // aligned: half a day at the left edge is still that day.
  let head =
    bandUnit === 'day'
      ? { year: at.year, month: at.month, day: at.day }
      : bandUnit === 'month'
        ? { year: at.year, month: at.month, day: 1 }
        : { year: at.year, month: 1, day: 1 };
  const bands = [];
  for (let guard = 0; guard < 200; guard++) {
    const cursor = instantOf(head, zone);
    if (cursor >= window.end) break;
    const after =
      bandUnit === 'day'
        ? addDays(head, 1)
        : bandUnit === 'month'
          ? { year: head.month === 12 ? head.year + 1 : head.year, month: head.month === 12 ? 1 : head.month + 1, day: 1 }
          : { year: head.year + 1, month: 1, day: 1 };
    const next = instantOf(after, zone);
    const start = Math.max(cursor, window.start);
    const end = Math.min(next, window.end);
    const label = bandUnit === 'day'
      ? `${head.day} ${MONTHS[head.month - 1]} ${head.year}`
      : bandUnit === 'month' ? `${MONTHS[head.month - 1]} ${head.year}`
        : String(head.year);
    if (end > start) {
      bands.push({
        label,
        left: ((start - window.start) / window.span) * 100,
        width: ((end - start) / window.span) * 100,
      });
    }
    if (next <= cursor) break;
    head = after;
  }
  return bands;
}

export function nowPosition(from, to, now = Date.now()) {
  const window = windowMillis(from, to);
  return window && now >= window.start && now <= window.end
    ? ((now - window.start) / window.span) * 100
    : null;
}

/** The instants a bucket key opens and closes: `2026`, `2026-08`, `2026-08-02`, `2026-08-02T14`. */
function bucketBounds(start) {
  const tail = { 4: '-01-01T00:00:00Z', 7: '-01T00:00:00Z', 10: 'T00:00:00Z', 13: ':00:00Z' };
  const suffix = tail[String(start ?? '').length];
  if (suffix === undefined) return null;
  const first = new Date(`${start}${suffix}`);
  if (!Number.isFinite(first.getTime())) return null;
  const last = new Date(first);
  if (start.length === 4) last.setUTCFullYear(last.getUTCFullYear() + 1);
  else if (start.length === 7) last.setUTCMonth(last.getUTCMonth() + 1);
  else if (start.length === 10) last.setUTCDate(last.getUTCDate() + 1);
  else last.setUTCHours(last.getUTCHours() + 1);
  return { first: first.getTime(), last: last.getTime() };
}

/**
 * Where clicking a bar takes the axis: onto what that bar holds.
 *
 * The entries themselves rather than the period they were counted under, so the
 * window the click opens is the one the bar draws — landing on the period would put
 * six entries from the first week of August under a window a month wide, and the
 * brush would come to rest somewhere other than on the bar that was clicked. A margin
 * on each side keeps the outermost entry off the very edge of the axis.
 */
export function bucketWindow(bucket) {
  const held = typeof bucket === 'string' ? null : bucketSpan(bucket);
  const start = typeof bucket === 'string' ? bucket : bucket?.start ?? '';
  if (held && held.last > held.first) {
    const margin = (held.last - held.first) * 0.06;
    return rangeFromMillis(held.first - margin, held.last + margin);
  }
  if (held) return rangeFromMillis(held.first - 12 * HOUR, held.first + 12 * HOUR);
  const bounds = bucketBounds(start);
  if (!bounds) return null;
  if (start.length === 10) return rangeFromMillis(bounds.first - 3 * DAY, bounds.first + 4 * DAY);
  return rangeFromMillis(bounds.first, bounds.last);
}

/**
 * How tall a bucket's column stands, against the fullest one.
 *
 * On the square root of the share rather than the share itself: a scraped batch puts
 * two hundred entries in one week and the rest of the case holds ones and twos, and
 * read straight those all sit on the floor together, indistinguishable. The exact
 * count is a hover away, which is what the minimap says it is for.
 */
export function bucketScale(buckets) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return buckets.map((bucket) => ({
    ...bucket,
    height: Math.max(12, Math.sqrt(Math.max(0, bucket.count) / max) * 100),
  }));
}

/**
 * Where a bucket's entries actually sit, which is what its bar is drawn across.
 *
 * The period a bucket is named after is the coarse thing: six rows in the first week
 * of August are not "August". The server reports the inner span with the counts, so a
 * bar marks the days something happened on. The period is the fallback for a reading
 * that predates that — a captured snapshot, mostly.
 */
export function bucketSpan(bucket) {
  const first = new Date(bucket?.first ?? '').getTime();
  const last = new Date(bucket?.last ?? '').getTime();
  if (Number.isFinite(first)) {
    return { first, last: Number.isFinite(last) && last > first ? last : first };
  }
  const bounds = bucketBounds(bucket?.start);
  return bounds ? { first: bounds.first, last: bounds.last } : null;
}

/**
 * The instants the overview draws between: the whole of what the case holds.
 *
 * The bars, the date scale and the visible-range brush are all placed on this one
 * mapping from instant to position, which is the only way the three can agree. Held
 * as the union of the extent and every bar, so nothing the overview draws can fall
 * off the end of the scale it is drawn on.
 */
export function densityScale(buckets, extent) {
  const from = new Date(extent?.from ?? '').getTime();
  const to = new Date(extent?.to ?? '').getTime();
  const bins = (buckets ?? []).map((bucket) => bucketBounds(bucket?.start)).filter(Boolean);
  const starts = [...bins.map((bin) => bin.first), ...(Number.isFinite(from) ? [from] : [])];
  const ends = [...bins.map((bin) => bin.last), ...(Number.isFinite(to) ? [to] : [])];
  if (!starts.length || !ends.length) return null;
  const start = Math.min(...starts);
  const end = Math.max(...ends);
  return end > start ? { first: start, last: end, span: end - start } : null;
}

/**
 * One column per bin, across the bin it counts.
 *
 * A histogram's columns are as wide as its bins, which is what makes the heights
 * comparable — and it is honest here only because the bins are cut fine enough to be
 * columns (`densityUnit`). Cut coarse, the same rule drew a month-wide block for six
 * entries in one week, and a mark at the month's opening claimed a date nothing
 * happened on: a January bucket holding the 14th and the 27th marked the 1st, ahead
 * of a window that opened on the 6th, so the bar for two entries on screen sat
 * outside the brush that was showing them.
 */
export function layoutDensityBuckets(buckets, extent) {
  const scale = densityScale(buckets, extent);
  if (!scale) return [];
  const { first, span } = scale;
  return bucketScale(buckets).flatMap((bucket) => {
    const bounds = bucketBounds(bucket.start);
    if (!bounds) return [];
    const left = clamp((bounds.first - first) / span) * 100;
    const right = clamp((bounds.last - first) / span) * 100;
    // A bin thinner than a hairline still has to be visible; the floor is a
    // `min-width` in the stylesheet, so the geometry here stays honest.
    return [{ ...bucket, left, width: right - left }];
  });
}

function stepPeriod(millis, unit) {
  const at = new Date(millis);
  if (unit === 'year') at.setUTCFullYear(at.getUTCFullYear() + 1);
  else if (unit === 'month') at.setUTCMonth(at.getUTCMonth() + 1);
  else if (unit === 'hour') at.setUTCHours(at.getUTCHours() + 1);
  else at.setUTCDate(at.getUTCDate() + 1);
  return at.getTime();
}

function floorPeriod(millis, unit) {
  const at = new Date(millis);
  if (unit === 'hour') at.setUTCMinutes(0, 0, 0);
  else at.setUTCHours(0, 0, 0, 0);
  if (unit === 'month' || unit === 'year') at.setUTCDate(1);
  if (unit === 'year') at.setUTCMonth(0);
  return at.getTime();
}

/**
 * How finely to cut the overview, so it reads as a histogram rather than as a stroke.
 *
 * The finest cut whose bins still have a column's width on screen. Cut by the period
 * a case happens to span — months, because the case runs over months — every bar was
 * a month wide, and two hundred entries in one week drew the same mark as one entry
 * that could be anywhere in May. Counted by day instead, that week is five columns
 * and May is one, which is the shape the case actually has.
 */
export function densityUnit(extent, width = 800) {
  const first = new Date(extent?.from ?? '').getTime();
  const last = new Date(extent?.to ?? '').getTime();
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return 'day';
  const span = last - first;
  // Around two pixels a bin — the floor the stylesheet gives a column — held between
  // a readable minimum and the server's ceiling on how many buckets a reading carries.
  const room = Math.min(500, Math.max(60, Math.round(width / 2)));
  for (const [unit, length] of [['hour', HOUR], ['day', DAY], ['month', 28 * DAY]]) {
    if (span / length <= room) return unit;
  }
  return 'year';
}

/** Room for the longest label a scale prints, so two never land on each other. */
const TICK_ROOM = 56;

/**
 * The scale under the minimap: one slot per period, named in the middle of its own.
 *
 * A bucket counts a period rather than an instant, so its name belongs under the
 * middle of the block that draws it. Named at the instant the period opens — which is
 * how the continuous ruler on the axis is labelled, and the wrong rule here — every
 * name sat to the right of the bar it named, and the reader had to pair each block
 * with the label after it.
 *
 * Only as many names as fit, so two years of months read as a scale rather than a
 * crowd; the unnamed slots still carry their share of the width. Read in UTC because
 * that is how the buckets themselves are cut, and naming them in another zone would
 * rename them.
 */
export function densityTicks(buckets, extent, width = 800) {
  const scale = densityScale(buckets, extent);
  if (!scale) return [];
  // Its own unit, not the bins': the bins are cut as fine as they can be drawn, and a
  // scale reading "3 Jan, 4 Jan, 5 Jan…" across eight months would name the columns
  // rather than the case. Months for a case that runs over months, hours for a day.
  const unit = scale.span <= 2 * DAY ? 'hour'
    : scale.span <= 62 * DAY ? 'day'
      : scale.span <= 6 * 365 * DAY ? 'month' : 'year';
  const slots = [];
  // Floored to the period the scale opens inside, so the slots are whole calendar
  // months rather than months counted from whatever day the case starts on. The two
  // outermost are clipped to the scale, which is what a period the case only holds
  // part of looks like.
  let cursor = floorPeriod(scale.first, unit);
  for (let guard = 0; cursor < scale.last && guard < 400; guard++) {
    const next = stepPeriod(cursor, unit);
    if (next <= cursor) break;
    slots.push({
      at: cursor,
      first: Math.max(cursor, scale.first),
      last: Math.min(next, scale.last),
    });
    cursor = next;
  }
  if (!slots.length) return [];
  const every = Math.max(1, Math.ceil(TICK_ROOM / Math.max(1, width / slots.length)));
  const last = slots.length - 1 - ((slots.length - 1) % every);
  let named = '';
  return slots.map((slot, index) => {
    const at = zonedFields(slot.at, UTC);
    const year = String(at.year);
    const names = index % every === 0;
    // The wider unit is stated when it changes, not on every slot: eight months in one
    // year do not need the year eight times, and the hours of one day need its date
    // once.
    const context = unit === 'hour' ? `${at.day} ${MONTHS[at.month - 1]}` : year;
    const label = !names ? ''
      : unit === 'year' ? year
        : unit === 'hour'
          ? (context === named ? `${pad(at.hour)}:00` : `${pad(at.hour)}:00 · ${context}`)
          : unit === 'day' ? `${at.day} ${MONTHS[at.month - 1]}`
            : year === named ? MONTHS[at.month - 1] : `${MONTHS[at.month - 1]} ${year}`;
    if (names) named = context;
    return {
      key: String(slot.at),
      left: ((slot.first - scale.first) / scale.span) * 100,
      width: ((slot.last - slot.first) / scale.span) * 100,
      label,
      // The outermost names are pinned to their own edge instead of centred, so a
      // label wider than its slot leans inward rather than off the minimap.
      anchor: !names ? '' : index === 0 ? 'start' : index === last ? 'end' : 'middle',
    };
  });
}

/**
 * Spans of absolute time as bands across the visible window.
 *
 * Used for the daylight ribbon (`/api/geo/daylight`), and it is deliberately not
 * zone-aware: when the sun was up is a fact about instants, so it is placed on the
 * axis the same way whichever clock the axis is labelled with. Clipped rather than
 * dropped, so the run that opens before the window still fills the left edge.
 */
export function ribbonBands(spans, from, to) {
  const window = windowMillis(from, to);
  if (!window || !Array.isArray(spans)) return [];
  const bands = [];
  for (const span of spans) {
    const first = new Date(span?.from ?? '').getTime();
    const last = new Date(span?.to ?? '').getTime();
    if (!Number.isFinite(first) || !Number.isFinite(last)) continue;
    const left = clamp((first - window.start) / window.span);
    const right = clamp((last - window.start) / window.span);
    if (right <= left) continue;
    bands.push({ key: span.from, left: left * 100, width: (right - left) * 100 });
  }
  return bands;
}

// ── how far apart two entries are ────────────────────────────────────────────
//
// The one figure a chronology is read for and the one it never printed: an axis
// shows that two things are near each other, and the finding is *four hours and
// twelve minutes*, measured by hand off two tooltips.
//
// It is arithmetic over the **bounds the case derived**, never over the words a
// source used, and that is what keeps it honest. A stated day is a window a day
// wide (``engine/temporal``: bounds are half-open, ``earliest`` inclusive and
// ``latest`` exclusive), so two dated statements are not a number apart — they are a
// *range* apart, and printing the difference of the two midnights as a fact is how a
// chronology ends up claiming precision nobody has. Two exact timestamps do give one
// number, and then it is given.

/** The window an entry occupies, or null when it has no place on the axis. */
export function itemWindow(item) {
  const first = new Date(item?.earliest ?? '').getTime();
  const last = new Date(item?.latest ?? '').getTime();
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  return { first, last: Math.max(first, last) };
}

/** Whether a window is tight enough to be read as one instant. A second-precision
 *  timestamp carries a one-second window, which is a point for every purpose here. */
const isInstant = (window) => window.last - window.first <= SECOND;

/**
 * How much of an entry's width is *not knowing*, as opposed to lasting.
 *
 * The distinction the gap arithmetic turns on. A point dated to the day is a day-wide
 * window of ignorance, and everything measured from it inherits that. An interval's
 * two bounds are what the analyst stated its extent to be — vagueness about either
 * end is carried by the value's own `~`/`?` qualifier, which the panel shows
 * separately — so its edges are taken as given. Without this, two exact periods four
 * hours apart came back as "between 2 h and 12 h", which is the invented uncertainty
 * this whole file exists to avoid.
 */
function slackOf(item, window) {
  if (item?.shape === 'interval') return 0;
  const width = window.last - window.first;
  return width <= SECOND ? 0 : width;
}

/**
 * What an entry's own width means: a period lasts, a point is merely imprecise.
 *
 * The distinction the panel exists to keep: *this closure ran for three days* and
 * *this photo is dated to some point in one day* are the same three-day-ish number on
 * screen and opposite readings of the case.
 */
export function itemExtent(item) {
  const window = itemWindow(item);
  if (!window) return null;
  const ms = window.last - window.first;
  if (item.shape === 'interval') return { ms, kind: 'duration', precision: item.precision ?? '' };
  if (isInstant(window)) return null;
  return { ms, kind: 'precision', precision: item.precision ?? '' };
}

/**
 * Where two entries stand relative to each other.
 *
 * ``gap.min``/``gap.max`` bracket what the bounds allow, ``gap.stated`` is the
 * difference between the two values as written, and ``gap.exact`` says whether the
 * three are the same number. Overlapping windows report the overlap and refuse to
 * order the pair: either could be first, and saying which would be invention.
 */
export function compareTimelineItems(a, b) {
  const one = itemWindow(a);
  const other = itemWindow(b);
  if (!one || !other || a?.id === b?.id) return null;
  const forwards = one.first <= other.first;
  const [early, late] = forwards ? [one, other] : [other, one];
  const [earlyItem, lateItem] = forwards ? [a, b] : [b, a];
  const apart = early.last <= late.first;
  // Measured from where the first one **ends** to where the second one **starts**,
  // which is the same thing as instant-to-instant once both are points, and the only
  // right reading once either is a period.
  const slack = { early: slackOf(earlyItem, early), late: slackOf(lateItem, late) };
  const ends = early.first + (earlyItem.shape === 'interval' ? early.last - early.first : 0);
  return {
    order: apart ? 'sequence' : 'overlap',
    earlier: earlyItem,
    later: lateItem,
    gap: apart
      ? {
          min: Math.max(0, late.first - early.last),
          max: late.first + slack.late - ends,
          // As the two values were written, ignoring what each one leaves open. Only
          // ever shown beside a range, and there it is the number the analyst expects
          // to see: the difference between the two dates on the page.
          stated: late.first - ends,
          exact: !slack.early && !slack.late,
        }
      : null,
    overlap: apart ? null : Math.min(early.last, late.last) - late.first,
    extents: [
      { item: earlyItem, extent: itemExtent(earlyItem) },
      { item: lateItem, extent: itemExtent(lateItem) },
    ].filter((row) => row.extent),
  };
}

const SPAN_UNITS = [
  { ms: 365.2425 * DAY, word: 'year' },
  { ms: DAY, word: 'day' },
  { ms: HOUR, word: 'hour' },
  { ms: MINUTE, word: 'minute' },
  { ms: SECOND, word: 'second' },
];

/**
 * A length of time as its parts: at most two, largest first.
 *
 * Two rather than all of them because the second one is where the reading stops being
 * useful: *2 days 6 hours* is a fact and *2 days 6 hours 14 minutes 3 seconds* is a
 * serial number.
 */
function spanParts(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0));
  const parts = [];
  let rest = total;
  for (const unit of SPAN_UNITS) {
    if (parts.length === 2) break;
    const count = Math.floor(rest / unit.ms);
    if (!count && !parts.length) continue;
    if (!count) break;
    parts.push({ count, word: unit.word });
    rest -= count * unit.ms;
  }
  return parts;
}

/** Words, not symbols. A panel that reads *2 d 6 h* is a panel written for whoever
 *  already knew what it said. */
const spanWords = (parts) =>
  parts.map(({ count, word }) => `${count} ${word}${count === 1 ? '' : 's'}`).join(' ');

/** A length of time in plain words, or an honest shrug under one second. */
export function formatSpan(ms) {
  const parts = spanParts(ms);
  return parts.length ? spanWords(parts) : 'under a second';
}

/**
 * A gap the dates only pin down to a range, as one phrase.
 *
 * *Between 2 and 4 days* rather than *2 days to 4 days*: the unit is factored out when
 * both ends land on the same one, which is the common case and the only version that
 * reads like a sentence. A minimum of nothing is not a range at all — *up to 4 days*
 * is what two consecutive dates actually license, where "between 0 and 4" invites the
 * reader to average it.
 */
export function formatSpanRange(min, max) {
  const low = spanParts(min);
  const high = spanParts(max);
  if (!low.length) return `up to ${formatSpan(max)}`;
  if (low.length === 1 && high.length === 1 && low[0].word === high[0].word) {
    return `between ${low[0].count} and ${spanWords(high)}`;
  }
  return `between ${spanWords(low)} and ${spanWords(high)}`;
}

/** How coarse a value is, in the words the panel uses for it. */
const PRECISION_READS = {
  year: 'to the year',
  month: 'to the month',
  day: 'to the day',
  second: 'to the second',
  subsecond: 'to the fraction',
  mixed: 'unevenly',
};

/**
 * The pair as the inspector reads it out: one headline, one supporting clause and
 * the notes that stop the headline being read as more than it is.
 *
 * The wording lives here rather than in the component for the reason every other
 * count in this app states its own caveat: a figure printed bare is true and
 * misleading in the same breath.
 */
export function describePair(a, b) {
  const read = compareTimelineItems(a, b);
  if (!read) {
    return {
      ok: false,
      headline: 'Nothing to measure',
      detail: 'One of these two has no place on the UTC axis.',
      notes: [],
      extents: [],
    };
  }
  const notes = read.extents.map(({ item, extent }) =>
    extent.kind === 'duration'
      ? `${item.label} runs for ${formatSpan(extent.ms)}.`
      : `${item.label} is dated ${PRECISION_READS[extent.precision] ?? 'coarsely'}.`
  );
  if (read.order === 'overlap') {
    return {
      ok: true,
      headline: read.overlap > 0 ? `Overlapping by ${formatSpan(read.overlap)}` : 'Overlapping',
      detail: 'Either could come first, so these dates do not order them.',
      notes,
      extents: read.extents,
    };
  }
  const { min, max, stated, exact } = read.gap;
  const first = `${read.earlier.label} first`;
  if (exact) {
    return {
      ok: true,
      headline: stated === 0 ? 'At the same instant' : `${formatSpan(stated)} apart`,
      detail: stated === 0 ? 'Both are the same timestamp.' : first,
      notes,
      extents: read.extents,
    };
  }
  const range = formatSpanRange(min <= SECOND ? 0 : min, max);
  return {
    ok: true,
    // Capitalised here rather than in the phrase, which is also read mid-sentence.
    headline: `${range[0].toUpperCase()}${range.slice(1)} apart`,
    detail: first,
    notes: [`As written, ${formatSpan(stated)} apart.`, ...notes],
    extents: read.extents,
  };
}
