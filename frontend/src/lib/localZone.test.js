import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn(async (url) => {
  const lon = Number(new URL(url, 'http://x').searchParams.get('lon'));
  return { name: lon > 20 ? 'Europe/Kyiv' : 'Europe/Lisbon' };
});
vi.mock('./api.js', () => ({ api: { get } }));

const {
  dayReading, forgetZones, isDateOnly, isUnzonedTime, offsetAt, pointOf, withZone, zoneAt,
  zoneReading, zonesOf,
} = await import('./localZone.js');

beforeEach(() => {
  get.mockClear();
  forgetZones();
});

describe('offsetAt', () => {
  it('gives the offset the zone keeps at that very time, daylight saving included', () => {
    expect(offsetAt('2026-08-11T17:05:00', 'Europe/Kyiv')).toBe('+03:00');
    expect(offsetAt('2026-01-11T17:05:00', 'Europe/Kyiv')).toBe('+02:00');
    expect(offsetAt('2026-08-11T17:05:00', 'America/New_York')).toBe('-04:00');
    expect(offsetAt('2026-08-11T17:05:00', 'Asia/Kolkata')).toBe('+05:30');
  });

  it('only zones one time that has no zone yet', () => {
    expect(withZone('2026-08-11T17:05:00', 'Europe/Kyiv')).toBe('2026-08-11T17:05:00+03:00');
    expect(withZone('2026-08-11T17:05:00Z', 'Europe/Kyiv')).toBe('2026-08-11T17:05:00Z');
    expect(withZone('2026-08-11', 'Europe/Kyiv')).toBe('2026-08-11');
    expect(isUnzonedTime('2026-08-11T17:05:00.250')).toBe(true);
    expect(isUnzonedTime('2026-08-11T17:05:00+02:00')).toBe(false);
  });

  it('says the rule it applied', () => {
    expect(zoneReading('2026-08-11T17:05:00', 'Europe/Kyiv', 'Kharkiv'))
      .toBe('17:05 at Kharkiv (Europe/Kyiv, UTC+03:00)');
  });
});

describe('a day and its zone', () => {
  it('knows a date from a time', () => {
    for (const raw of ['2024', '2024-03', '2024-03-12', '2024-03~', '2024-03-12/2024-03-14?']) {
      expect(isDateOnly(raw), raw).toBe(true);
    }
    for (const raw of ['', '2024-03-12T14:30:00', '2024-03-12T14:30:00Z', 'March']) {
      expect(isDateOnly(raw), raw).toBe(false);
    }
  });

  it('says whose day it is', () => {
    expect(dayReading('12 Mar 2024', 'Europe/Kyiv', 'Kharkiv')).toBe('12 Mar 2024, the day at Kharkiv (Europe/Kyiv)');
    expect(dayReading('12 Mar 2024', 'Europe/Kyiv', '')).toBe('12 Mar 2024 (Europe/Kyiv)');
    expect(dayReading('12 Mar 2024', null, 'Kharkiv')).toBe('12 Mar 2024');
  });
});

describe('pointOf', () => {
  it('reads a place or a proof with a point, and nothing else', () => {
    expect(pointOf({ type: 'place', attrs: { lat: 49.9, lon: 36.2 } })).toEqual({ lat: 49.9, lon: 36.2 });
    expect(pointOf({ type: 'proof', attrs: { lat: '49.9', lon: '36.2' } })).toEqual({ lat: 49.9, lon: 36.2 });
    expect(pointOf({ type: 'place', attrs: {} })).toBeNull();
    expect(pointOf({ type: 'place', attrs: { lat: 95, lon: 0 } })).toBeNull();
    expect(pointOf({ type: 'person', attrs: { lat: 1, lon: 1 } })).toBeNull();
  });
});

describe('zoneAt and zonesOf', () => {
  it('asks the local server once per point', async () => {
    await zoneAt({ lat: 49.99, lon: 36.23 });
    await zoneAt({ lat: 49.99, lon: 36.23 });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe('/api/geo/zone?lat=49.99&lon=36.23');
  });

  it('takes the one zone the places agree on, and none when they disagree', async () => {
    const kharkiv = { type: 'place', label: 'Kharkiv', attrs: { lat: 49.99, lon: 36.23 } };
    const lviv = { type: 'place', label: 'Lviv', attrs: { lat: 49.84, lon: 24.03 } };
    const lisbon = { type: 'place', label: 'Lisbon', attrs: { lat: 38.72, lon: -9.14 } };

    expect((await zonesOf([kharkiv, lviv])).only).toEqual({ zone: 'Europe/Kyiv', place: 'Kharkiv' });
    const split = await zonesOf([kharkiv, lisbon]);
    expect(split.only).toBeNull();
    expect(split.zones.map((entry) => entry.place)).toEqual(['Kharkiv', 'Lisbon']);
    expect((await zonesOf([{ type: 'person', label: 'Ivan' }])).zones).toEqual([]);
  });
});
