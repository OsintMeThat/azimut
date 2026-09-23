import { describe, expect, it } from 'vitest';
import {
  answerProbe,
  between,
  bracketSentence,
  entryOf,
  lookupPath,
  lookupWindow,
  nextProbe,
  sidePatch,
  startBracket,
  stripArchive,
  stripEntries,
  thumbTiles,
  undoAnswer,
} from './passStrip.js';

const s2 = (date) => ({ present: true, provider: 'sentinel2', sentinel: { date, layer: 'TRUE_COLOR', maxcc: 100 } });
const DAYS = ['2026-05-03', '2026-05-08', '2026-05-13', '2026-05-18', '2026-05-23', '2026-05-28', '2026-06-02'];
const optical = { dates: DAYS.map((date, i) => ({ date, cloud: i === 2 ? 80 : 5, granules: 1 })).reverse() };

describe('the archive both sides show', () => {
  it('is a dated archive shared by A and B, or nothing', () => {
    expect(stripArchive(s2(''), s2(''))).toBe('sentinel2');
    expect(stripArchive({ present: true, provider: 'sentinel1' }, { present: true, provider: 'sentinel1' })).toBe('sentinel1');
    expect(stripArchive(s2(''), { present: true, provider: 'esri-wayback' })).toBe(null);
    expect(stripArchive({ present: true, provider: 'osm' }, { present: true, provider: 'osm' })).toBe(null);
    expect(stripArchive(s2(''), { ...s2(''), present: false })).toBe(null);
  });

  it('is looked up around the pair, never past today, a year at most', () => {
    const today = new Date('2026-09-23T12:00:00Z');
    expect(lookupWindow(s2('2026-05-03'), s2('2026-06-02'), today)).toEqual({ start: '2026-02-02', end: '2026-07-02' });
    expect(lookupWindow(s2(''), s2(''), today)).toEqual({ start: '2026-03-27', end: '2026-09-23' });
    expect(lookupWindow(s2('2024-01-01'), s2('2026-09-01'), today).start).toBe('2025-08-19');
    expect(lookupPath('sentinel1', { lat: 1, lon: 2, zoom: 14 }, { start: 'x', end: 'y' })).toContain('collection=sentinel1');
    expect(lookupPath('esri-wayback', { lat: 1, lon: 2, zoom: 14.6 }, null)).toContain('/wayback/changes?lat=1&lon=2&zoom=15');
  });
});

describe('the strip', () => {
  it('runs oldest to newest, and greys a day over the cloud ceiling', () => {
    const rows = stripEntries('sentinel2', optical, { maxcc: 30 });
    expect(rows.map((row) => row.date)).toEqual(DAYS);
    expect(rows[2]).toMatchObject({ usable: false, note: '80% cloud' });
  });

  it('holds radar to one track and Wayback to the releases that changed', () => {
    const radar = stripEntries('sentinel1', { dates: [
      { date: '2026-05-14', time: '17:33:02', orbit: 'ascending' },
      { date: '2026-05-14', time: '05:42:10', orbit: 'descending' },
      { date: '2026-05-02', time: '05:42:40', orbit: 'descending' },
    ] }, { track: '05:42:00' });
    expect(radar.map((row) => [row.key, row.usable])).toEqual([
      ['2026-05-02T05:42:40', true], ['2026-05-14T05:42:10', true], ['2026-05-14T17:33:02', false]]);
    const wayback = stripEntries('esri-wayback', { changes: [
      { release: 55, acquired: '2025-02-20' }, { release: 41, acquired: '2023-06-11' }] });
    expect(wayback.map((row) => row.release)).toEqual([41, 55]);
    expect(entryOf(wayback, 'esri-wayback', { wayback_release: null })).toBe(wayback[1]);
    expect(sidePatch('esri-wayback', wayback[0])).toEqual({ wayback_release: 41 });
    expect(sidePatch('sentinel1', radar[0])).toEqual({ radar: { date: '2026-05-02', time: '05:42:40' } });
  });
});

describe('dating a change', () => {
  const rows = stripEntries('sentinel2', optical, { maxcc: 30 });
  const start = () => startBracket(rows, rows[0], rows[6]);

  it('needs A older than B, both on the strip', () => {
    expect(startBracket(rows, rows[6], rows[0])).toBe(null);
    expect(startBracket(rows, null, rows[0])).toBe(null);
    expect(between(rows, start()).map((row) => row.date)).toEqual(
      ['2026-05-08', '2026-05-18', '2026-05-23', '2026-05-28']);   // the cloudy 13th left out
  });

  it('halves the gap an answer at a time until the ends are neighbours', () => {
    let bracket = start();
    const ask = () => ({ ...bracket, probe: nextProbe(rows, bracket).key });
    bracket = ask();
    expect(bracket.probe).toBe('2026-05-18');
    bracket = answerProbe(bracket, 'there');           // it is on the 18th
    bracket = ask();
    expect(bracket.probe).toBe('2026-05-08');
    bracket = answerProbe(bracket, 'absent');          // not yet on the 8th
    expect(nextProbe(rows, bracket)).toBe(null);
    expect(bracketSentence(rows, bracket, 'Sentinel-2')).toBe(
      'Absent on 2026-05-08, present on 2026-05-18 (Sentinel-2); one picture between them could not tell.');
  });

  it('drops a picture that settles nothing, and takes an answer back', () => {
    let bracket = { ...start(), probe: '2026-05-18' };
    bracket = answerProbe(bracket, 'unclear');
    expect(between(rows, bracket).map((row) => row.date)).not.toContain('2026-05-18');
    const undone = undoAnswer(bracket);
    expect(between(rows, undone).map((row) => row.date)).toContain('2026-05-18');
    expect(undoAnswer(undone)).toBe(undone);
  });
});

describe('pictures of the view', () => {
  const sentinel = { tile_size: 512, max_native_zoom: 14, max_zoom: 18 };

  it('draws the view from a tile or a few, never past the native level', () => {
    const tiles = thumbTiles({ lat: 51.95, lon: 4.05, zoom: 15, viewWidth: 1000 }, sentinel);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(tiles.length).toBeLessThanOrEqual(4);
    expect(tiles.every((tile) => tile.z === 11)).toBe(true);
    const deep = thumbTiles({ lat: 51.95, lon: 4.05, zoom: 22, viewWidth: 400 }, sentinel);
    expect(deep.every((tile) => tile.z === 13)).toBe(true);
  });

  it('puts the middle of the view in the middle of the picture', () => {
    const [tile] = thumbTiles({ lat: 0, lon: 0, zoom: 10, viewWidth: 132 }, { tile_size: 256, max_zoom: 19 });
    // the equator and the meridian meet at a tile corner, drawn at the centre
    const corners = thumbTiles({ lat: 0, lon: 0, zoom: 10, viewWidth: 132 }, { tile_size: 256, max_zoom: 19 });
    expect(corners).toHaveLength(4);
    const right = corners.find((entry) => entry.left >= 0 && entry.top >= 0);
    expect(right.left).toBeCloseTo(66, 0);
    expect(right.top).toBeCloseTo(42, 0);
    expect(tile.z).toBe(10);
  });
});
