import { describe, expect, it } from 'vitest';
import {
  UTC,
  clockInstant,
  clockOf,
  isTimed,
  recentClocks,
  rememberClockPick,
  settleClock,
  withClock,
  writesOwnClock,
} from './clock.js';

function memory() {
  const held = new Map();
  return {
    getItem: (key) => (held.has(key) ? held.get(key) : null),
    setItem: (key, value) => held.set(key, String(value)),
  };
}

describe('the clock a stored value reads on', () => {
  it('reads a day on its stated zone, and on UTC without one', () => {
    expect(clockOf('2026-09-10', 'Asia/Tokyo')).toEqual({ zone: 'Asia/Tokyo', fixed: '' });
    expect(clockOf('2026-09-10')).toEqual({ zone: UTC, fixed: '' });
    expect(clockOf('2026-09~/2026-10?')).toEqual({ zone: UTC, fixed: '' });
  });

  it('reads a time on the clock it writes, or on none', () => {
    expect(clockOf('2026-09-10T14:30:00Z')).toEqual({ zone: UTC, fixed: '' });
    expect(clockOf('2026-09-10T14:30:00+04:30')).toEqual({ zone: null, fixed: '+04:30' });
    expect(clockOf('2026-09-10T14:30:00')).toEqual({ zone: null, fixed: '' });
    // a stated zone names a local time, and an offset it keeps then
    expect(clockOf('2026-09-10T14:30:00', 'Europe/Kyiv')).toEqual({ zone: 'Europe/Kyiv', fixed: '' });
    expect(clockOf('2026-09-10T14:30:00+03:00', 'Europe/Kyiv')).toEqual({ zone: 'Europe/Kyiv', fixed: '' });
    // but never an offset it does not keep
    expect(clockOf('2026-09-10T14:30:00+05:00', 'Europe/Kyiv')).toEqual({ zone: null, fixed: '+05:00' });
  });

  it('knows a time from a date, and a time that says its own clock', () => {
    expect(isTimed('2026-09-10T14:30:00')).toBe(true);
    expect(isTimed('2026-09-10T10:00:00Z/2026-09-10T11:00:00Z')).toBe(true);
    expect(isTimed('2026-09-10')).toBe(false);
    expect(isTimed('')).toBe(false);
    expect(writesOwnClock('2026-09-10T14:30:00Z')).toBe(true);
    expect(writesOwnClock('2026-09-10T14:30:00')).toBe(false);
    expect(writesOwnClock('2026-09-10')).toBe(false);
  });
});

describe('putting a value on a clock', () => {
  it('keeps a day as typed and states its zone beside it, UTC as none', () => {
    expect(withClock('2026-09-10', 'Asia/Tokyo')).toEqual({ raw: '2026-09-10', zone: 'Asia/Tokyo' });
    expect(withClock('2026-09-10', UTC)).toEqual({ raw: '2026-09-10', zone: null });
  });

  it('writes a time with the offset its zone keeps then, and names the zone', () => {
    expect(withClock('2026-08-11T17:05:00', 'Europe/Kyiv'))
      .toEqual({ raw: '2026-08-11T17:05:00+03:00', zone: 'Europe/Kyiv' });
    expect(withClock('2026-01-11T17:05:00', 'Europe/Kyiv'))
      .toEqual({ raw: '2026-01-11T17:05:00+02:00', zone: 'Europe/Kyiv' });
    expect(withClock('2026-08-11T17:05:00', UTC)).toEqual({ raw: '2026-08-11T17:05:00Z', zone: null });
    expect(withClock('2026-08-11T17:05:00', null)).toEqual({ raw: '2026-08-11T17:05:00', zone: null });
  });

  it('re-reads a written time at the same wall time on a new clock', () => {
    // picking a clock says which clock that 17:05 was read on
    expect(withClock('2026-08-11T17:05:00Z', 'Asia/Tokyo').raw).toBe('2026-08-11T17:05:00+09:00');
    expect(withClock('2026-08-11T10:00:00Z/2026-08-11T11:00:00Z', 'Europe/Kyiv').raw)
      .toBe('2026-08-11T10:00:00+03:00/2026-08-11T11:00:00+03:00');
  });

  it('leaves what it cannot read alone', () => {
    expect(withClock('circa late summer', 'Asia/Tokyo')).toEqual({ raw: 'circa late summer', zone: null });
    expect(withClock('', 'Asia/Tokyo')).toEqual({ raw: '', zone: null });
  });
});

describe('settling what a date field holds', () => {
  it('opens a new value on the fallback, and a pick replaces it', () => {
    expect(settleClock('2026-09-10', { fallback: 'Europe/Kyiv' }))
      .toEqual({ clock: { zone: 'Europe/Kyiv', fixed: '' }, raw: '2026-09-10', zone: 'Europe/Kyiv' });
    expect(settleClock('2026-09-10', { fallback: 'Europe/Kyiv', picked: UTC }))
      .toEqual({ clock: { zone: UTC, fixed: '' }, raw: '2026-09-10', zone: null });
    expect(settleClock('2026-09-10T14:30:00', { picked: null }))
      .toEqual({ clock: { zone: null, fixed: '' }, raw: '2026-09-10T14:30:00', zone: null });
  });

  it('keeps a stored clock over the fallback', () => {
    expect(settleClock('2026-09-11', { stated: 'Asia/Tokyo', fallback: UTC }).zone).toBe('Asia/Tokyo');
  });

  it('lets a time typed with its own clock keep it until one is picked', () => {
    expect(settleClock('2026-09-10T14:30:00Z', { fallback: 'Europe/Kyiv' }))
      .toEqual({ clock: { zone: UTC, fixed: '' }, raw: '2026-09-10T14:30:00Z', zone: null });
    expect(settleClock('2026-09-10T14:30:00+03:00', { stated: 'Europe/Kyiv' }).zone).toBe('Europe/Kyiv');
    expect(settleClock('2026-09-10T14:30:00+04:30', {}).clock).toEqual({ zone: null, fixed: '+04:30' });
  });

  it('shows offsets on the value’s own day', () => {
    expect(clockInstant('2026-01-11')).toBe(Date.UTC(2026, 0, 11, 12));
    expect(clockInstant('2026-08')).toBe(Date.UTC(2026, 7, 1, 12));
  });
});

describe('the clocks picked lately', () => {
  it('keeps the last three zones per case, newest first, and never UTC', () => {
    const storage = memory();
    for (const zone of ['Asia/Aden', 'Europe/Kyiv', UTC, 'Asia/Tokyo', 'Europe/Kyiv']) {
      rememberClockPick('case-a', zone, storage);
    }
    expect(recentClocks('case-a', storage)).toEqual(['Europe/Kyiv', 'Asia/Tokyo', 'Asia/Aden']);
    rememberClockPick('case-a', 'America/Lima', storage);
    expect(recentClocks('case-a', storage)).toEqual(['America/Lima', 'Europe/Kyiv', 'Asia/Tokyo']);
    expect(recentClocks('case-b', storage)).toEqual([]);
  });

  it('reads nothing from a storage that fails or holds junk', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(recentClocks('case-a', broken)).toEqual([]);
    expect(() => rememberClockPick('case-a', 'Asia/Tokyo', broken)).not.toThrow();
    const junk = memory();
    junk.setItem('azimut:clock-recent:case-a', '{"not":"a list"}');
    expect(recentClocks('case-a', junk)).toEqual([]);
    junk.setItem('azimut:clock-recent:case-a', '["Asia/Tokyo", "<script>", 42]');
    expect(recentClocks('case-a', junk)).toEqual(['Asia/Tokyo']);
  });
});
