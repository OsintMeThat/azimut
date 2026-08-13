const DATE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?([~?%])?$/;
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?)(Z|[+-]\d{2}:\d{2})?$/;

export const TEMPORAL_FORMATS = [
  { value: 'date', label: 'Date' },
  { value: 'timestamp', label: 'Date and time' },
  { value: 'range', label: 'Date range' },
  { value: 'time-range', label: 'Time range' },
  { value: 'advanced', label: 'Advanced syntax' },
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

export function readTemporalInput(value) {
  const raw = typeof value === 'string' ? value : '';
  const date = DATE.exec(raw);
  if (date) {
    const precision = date[3] ? 'day' : date[2] ? 'month' : 'year';
    return {
      mode: 'date', precision, certainty: date[4] ?? '', date: raw.slice(0, raw.length - (date[4] ? 1 : 0)),
      datetime: '', zone: 'local', offset: '+00:00', start: '', end: '',
      startTime: '', endTime: '', rangeZone: 'utc', rangeOffset: '+00:00', raw,
    };
  }
  const timestamp = TIMESTAMP.exec(raw);
  if (timestamp) {
    const suffix = timestamp[2] ?? '';
    return {
      mode: 'timestamp', precision: 'day', certainty: '', date: '',
      datetime: timestamp[1], zone: suffix === 'Z' ? 'utc' : suffix ? 'offset' : 'local',
      offset: suffix && suffix !== 'Z' ? suffix : '+00:00', start: '', end: '',
      startTime: '', endTime: '', rangeZone: 'utc', rangeOffset: '+00:00', raw,
    };
  }
  const interval = raw.split('/');
  if (interval.length === 2 && interval.every((part) => /^\d{4}-\d{2}-\d{2}$/.test(part))) {
    return {
      mode: 'range', precision: 'day', certainty: '', date: '', datetime: '',
      zone: 'local', offset: '+00:00', start: interval[0], end: interval[1],
      startTime: '', endTime: '', rangeZone: 'utc', rangeOffset: '+00:00', raw,
    };
  }
  if (interval.length === 2) {
    const start = TIMESTAMP.exec(interval[0]);
    const end = TIMESTAMP.exec(interval[1]);
    const startZone = start?.[2] ?? '';
    const endZone = end?.[2] ?? '';
    if (start && end && startZone && startZone === endZone) {
      return {
        mode: 'time-range', precision: 'day', certainty: '', date: '', datetime: '',
        zone: 'local', offset: '+00:00', start: '', end: '',
        startTime: start[1], endTime: end[1],
        rangeZone: startZone === 'Z' ? 'utc' : 'offset',
        rangeOffset: startZone === 'Z' ? '+00:00' : startZone, raw,
      };
    }
  }
  return {
    mode: raw ? 'advanced' : 'date', precision: 'day', certainty: '', date: '',
    datetime: '', zone: 'local', offset: '+00:00', start: '', end: '',
    startTime: '', endTime: '', rangeZone: 'utc', rangeOffset: '+00:00', raw,
  };
}

function timestampWithSeconds(value) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
}

export function writeTemporalInput(state) {
  if (state.mode === 'date') return state.date ? `${state.date}${state.certainty}` : '';
  if (state.mode === 'range') return state.start && state.end ? `${state.start}/${state.end}` : '';
  if (state.mode === 'time-range') {
    if (!state.startTime || !state.endTime) return '';
    const zone = state.rangeZone === 'utc' ? 'Z' : state.rangeOffset;
    return `${timestampWithSeconds(state.startTime)}${zone}/${timestampWithSeconds(state.endTime)}${zone}`;
  }
  if (state.mode === 'advanced') return state.raw ?? '';
  if (!state.datetime) return '';
  const zone = state.zone === 'utc' ? 'Z' : state.zone === 'offset' ? state.offset : '';
  return `${timestampWithSeconds(state.datetime)}${zone}`;
}
