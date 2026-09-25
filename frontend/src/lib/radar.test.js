import { describe, expect, it } from 'vitest';
import { RADAR_ID, onTrack, orbitMark, passLabel, radarId, sameTrack, validPass } from './radar.js';

describe('a Sentinel-1 pass on the provider id', () => {
  it('rides as a day and a time without colons', () => {
    const pass = { date: '2026-05-14', time: '05:42:10' };
    expect(radarId(RADAR_ID, pass)).toBe('sentinel1~2026-05-14~054210');
  });

  it('stays the plain id for the most recent pass, and on any other basemap', () => {
    expect(radarId(RADAR_ID, null)).toBe(RADAR_ID);
    expect(radarId(RADAR_ID, { date: '2026-05-14', time: '5:42' })).toBe(RADAR_ID);
    expect(radarId('sentinel2', { date: '2026-05-14', time: '05:42:10' })).toBe('sentinel2');
    expect(validPass({ date: '2026-05-14', time: '24:00:00' })).toBe(false);
  });

  it('reads as a day, a UTC time and a direction', () => {
    expect(passLabel({ date: '2026-05-14', time: '05:42:10' })).toBe('2026-05-14 · 05:42 UTC');
    expect(passLabel(null)).toBe('Most recent');
    expect(orbitMark('descending')).toBe('↓');
    expect(orbitMark('ascending')).toBe('↑');
  });
});

describe('one track', () => {
  it('repeats to the minute; the neighbouring track passes eight minutes off', () => {
    expect(sameTrack('17:49:10', '17:48:40')).toBe(true);
    expect(sameTrack('17:49:10', '17:41:05')).toBe(false);
    expect(sameTrack('23:59:30', '00:01:10')).toBe(true);
    expect(sameTrack('', '17:49:10')).toBe(false);
  });

  it('keeps the passes of a track, or all of them when there is none yet', () => {
    const list = [{ time: '05:42:10' }, { time: '17:33:02' }, { time: '05:41:50' }];
    expect(onTrack(list, '05:42:00')).toEqual([list[0], list[2]]);
    expect(onTrack(list, '')).toBe(list);
  });
});
