import { offsetAt } from './localZone.js';

const DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?([~?%])?$/;
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)(Z|[+-]\d{2}:\d{2})?$/;

export const TEMPORAL_FORMATS = [
  { value: 'date', label: 'Date', hint: 'a day, a month or a year, and how sure' },
  { value: 'timestamp', label: 'Date and time', hint: 'a time of day, on the clock picked below' },
  { value: 'range', label: 'Date range', hint: 'from one day to another' },
  { value: 'time-range', label: 'Time range', hint: 'between two times, on one clock' },
  { value: 'advanced', label: 'Advanced syntax', hint: 'the stored form, for what the others cannot say' },
];

export const TEMPORAL_SYNTAX = [
  { meaning: 'Year', pattern: 'YYYY', example: '2026' },
  { meaning: 'Month', pattern: 'YYYY-MM', example: '2026-08' },
  { meaning: 'Day', pattern: 'YYYY-MM-DD', example: '2026-08-11' },
  {
    meaning: 'Local time',
    pattern: 'YYYY-MM-DDThh:mm:ss',
    example: '2026-08-11T18:40:00',
  },
  { meaning: 'UTC time', pattern: '…ssZ', example: '2026-08-11T16:40:00Z' },
  { meaning: 'UTC offset', pattern: '…ss±hh:mm', example: '2026-08-11T18:40:00+02:00' },
  { meaning: 'Subseconds', pattern: '…ss.ffffffZ', example: '2026-08-11T16:40:00.123Z' },
  { meaning: 'Date range', pattern: 'start/end', example: '2026-08~/2026-10?' },
  { meaning: 'Time range', pattern: 'time/time', example: '2026-08-11T10:15:00Z/2026-08-11T11:40:00Z' },
];

export const TEMPORAL_MARKERS = [
  { value: '~', meaning: 'Approximate' },
  { value: '?', meaning: 'Uncertain' },
  { value: '%', meaning: 'Approximate and uncertain' },
];

/**
 * The editor's state for a stored value. A time's clock is `zone` (a zone name or
 * `UTC`), or the `offset` it was written with and no zone named, or neither while
 * no clock is known. A date's clock lives beside it, with the field's owner.
 */
export function readTemporalInput(value) {
  const raw = typeof value === 'string' ? value : '';
  const blank = {
    mode: 'date', precision: 'day', certainty: '', date: '', datetime: '', zone: '', offset: '',
    start: '', end: '', startTime: '', endTime: '', raw,
  };
  const clock = (suffix) => (suffix === 'Z' ? { zone: 'UTC', offset: '' } : { zone: '', offset: suffix ?? '' });
  const date = DATE.exec(raw);
  if (date) {
    const precision = date[3] ? 'day' : date[2] ? 'month' : 'year';
    return { ...blank, precision, certainty: date[4] ?? '', date: raw.slice(0, raw.length - (date[4] ? 1 : 0)) };
  }
  const timestamp = TIMESTAMP.exec(raw);
  if (timestamp) return { ...blank, mode: 'timestamp', datetime: timestamp[1], ...clock(timestamp[2]) };
  const interval = raw.split('/');
  if (interval.length === 2 && interval.every((part) => /^\d{4}-\d{2}-\d{2}$/.test(part))) {
    return { ...blank, mode: 'range', start: interval[0], end: interval[1] };
  }
  if (interval.length === 2) {
    const start = TIMESTAMP.exec(interval[0]);
    const end = TIMESTAMP.exec(interval[1]);
    if (start && end && (start[2] ?? '') === (end[2] ?? '')) {
      return { ...blank, mode: 'time-range', startTime: start[1], endTime: end[1], ...clock(start[2]) };
    }
  }
  return { ...blank, mode: raw ? 'advanced' : 'date' };
}

function timestampWithSeconds(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
}

/** A wall time on the state's clock. A zone is written as the offset it keeps at that
 *  very time, so the stored value is an ordinary zoned timestamp. */
function onClock(time, state) {
  const wall = timestampWithSeconds(time);
  if (state.zone === 'UTC') return `${wall}Z`;
  if (state.zone) return `${wall}${offsetAt(wall, state.zone)}`;
  return `${wall}${state.offset ?? ''}`;
}

export function writeTemporalInput(state) {
  if (state.mode === 'date') return state.date ? `${state.date}${state.certainty}` : '';
  if (state.mode === 'range') return state.start && state.end ? `${state.start}/${state.end}` : '';
  if (state.mode === 'time-range') {
    if (!state.startTime || !state.endTime) return '';
    return `${onClock(state.startTime, state)}/${onClock(state.endTime, state)}`;
  }
  if (state.mode === 'advanced') return state.raw ?? '';
  return state.datetime ? onClock(state.datetime, state) : '';
}
