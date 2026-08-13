import { describe, expect, it } from 'vitest';
import {
  TEMPORAL_MARKERS,
  TEMPORAL_SYNTAX,
  readTemporalInput,
  writeTemporalInput,
} from './temporalInput.js';

describe('the temporal input adapter', () => {
  it.each([
    '2026',
    '2026-08',
    '2026-08-11?',
    '2026-08-11T18:40:00',
    '2026-08-11T16:40:00Z',
    '2026-08-11T18:40:00+02:00',
    '2026-08-11/2026-08-14',
    '2026-08~/2026-10?',
    '2026-08-11T10:15:00Z/2026-08-11T11:40:00Z',
    '2026-08-11T10:15:00+02:00/2026-08-11T11:40:00+02:00',
  ])('round-trips %s without rewriting it', (raw) => {
    expect(writeTemporalInput(readTemporalInput(raw))).toBe(raw);
  });

  it('adds the seconds required by the backend profile', () => {
    expect(writeTemporalInput({
      mode: 'timestamp', datetime: '2026-08-11T18:40', zone: 'utc', offset: '+00:00',
    })).toBe('2026-08-11T18:40:00Z');
  });

  it('keeps an unrecognised existing value in the advanced editor', () => {
    const state = readTemporalInput('circa late summer');

    expect(state.mode).toBe('advanced');
    expect(writeTemporalInput(state)).toBe('circa late summer');
  });

  it('documents every supported family with a pattern and an example', () => {
    expect(TEMPORAL_SYNTAX.map(({ meaning }) => meaning)).toEqual([
      'Year', 'Month', 'Day', 'Local time', 'UTC time', 'UTC offset',
      'Subseconds', 'Date range', 'Time range',
    ]);
    expect(TEMPORAL_SYNTAX.every(({ pattern, example }) => pattern && example)).toBe(true);
    expect(TEMPORAL_MARKERS).toEqual([
      { value: '~', meaning: 'Approximate' },
      { value: '?', meaning: 'Uncertain' },
      { value: '%', meaning: 'Approximate and uncertain' },
    ]);
  });
});
