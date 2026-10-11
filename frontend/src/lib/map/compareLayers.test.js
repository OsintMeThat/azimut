import { describe, expect, it, vi } from 'vitest';
import {
  compareFireControls,
  compareFireNote,
  compareFireWords,
  compareNightControls,
  compareNightNote,
  compareNightWords,
  freshFires,
  freshLayers,
  freshNight,
  restoredLayers,
  sideFires,
  sideLayers,
  sideNight,
  toggledLayer,
  tradedSide,
  tradedSides,
} from './compareLayers.js';
import { lastNight } from './nightlights.js';

const SENSORS = [{ id: 'viirs', label: 'VIIRS (S-NPP, NOAA-20, NOAA-21)' }];
const DAYS = { a: '2024-03-12', b: '2025-06-02' };

describe('what each side of a pair draws', () => {
  it('starts a new pair on each side’s own day', () => {
    const fires = freshFires();
    expect(sideFires(fires, 'a', DAYS.a)).toMatchObject({ window: 'dates', first: '2024-03-12' });
    expect(sideFires(fires, 'b', DAYS.b)).toMatchObject({ window: 'dates', first: '2025-06-02' });
    expect(sideNight(freshNight(), 'b', DAYS.b)).toEqual({ source: 'noaa20', day: '2025-06-02' });
  });

  it('falls back on a side whose picture has no date', () => {
    expect(sideFires(freshFires(), 'a', '')).toMatchObject({ window: '24h' });
    expect(sideNight(freshNight(), 'a', '').day).toBe(lastNight());
  });

  it('draws the days picked for each side once they are picked', () => {
    const fires = { ...freshFires(), follow: false, a: { window: 'dates', first: '2023-01-01', last: '' } };
    expect(sideFires(fires, 'a', DAYS.a)).toEqual({ sensor: 'viirs', window: 'dates', first: '2023-01-01', last: '' });
    const night = { source: 'snpp', follow: false, a: '2022-02-02', b: '2022-03-03' };
    expect(sideNight(night, 'b', DAYS.b)).toEqual({ source: 'snpp', day: '2022-03-03' });
  });

  it('trades what each side held when A and B trade places', () => {
    expect(tradedSides({ follow: false, a: 'x', b: 'y' })).toEqual({ follow: false, a: 'y', b: 'x' });
  });
});

describe('the switcher over the list', () => {
  it('starts a new pair on borders and place names, drawn on both sides', () => {
    expect(freshLayers()).toEqual({ ids: ['boundaries', 'placenames'], side: 'ab' });
  });

  it('moves the whole list onto the side it names', () => {
    const ids = ['boundaries', 'roads'];
    expect(sideLayers(ids, 'ab')).toEqual({ a: ids, b: ids });
    expect(sideLayers(ids, 'a')).toEqual({ a: ids, b: [] });
    expect(sideLayers(ids, 'b')).toEqual({ a: [], b: ids });
  });

  it('switches a layer in or out of the one list, in the catalogue’s order', () => {
    expect(toggledLayer(['roads'], 'boundaries')).toEqual(['boundaries', 'roads']);
    expect(toggledLayer(['boundaries', 'roads'], 'roads')).toEqual(['boundaries']);
  });

  it('keeps the list on its picture when A and B trade places', () => {
    expect(tradedSide('a')).toBe('b');
    expect(tradedSide('b')).toBe('a');
    expect(tradedSide('ab')).toBe('ab');
  });
});

describe('a saved comparison read back', () => {
  it('starts a handed-over pair, which names no layer, as a new one', () => {
    expect(restoredLayers({ provider: 'esri-wayback' }, { provider: 'esri-world-imagery' })).toMatchObject(freshLayers());
  });

  it('reopens on the side that alone held layers, or on both', () => {
    expect(restoredLayers({ overlays: ['roads'] }, { overlays: [] })).toMatchObject({ ids: ['roads'], side: 'a' });
    expect(restoredLayers({ overlays: [] }, { overlays: ['railway', 'labels'] })).toMatchObject({ ids: ['railway'], side: 'b' });
    expect(restoredLayers({ overlays: ['roads'] }, { overlays: ['roads'] })).toMatchObject({ ids: ['roads'], side: 'ab' });
    expect(restoredLayers({ overlays: [] }, { overlays: [] })).toMatchObject({ ids: [], side: 'ab' });
  });

  it('draws two different lists saved before the switcher on both sides, so nothing goes missing', () => {
    expect(restoredLayers({ overlays: ['roads'] }, { overlays: ['railway'] })).toMatchObject({
      ids: ['roads', 'railway'],
      side: 'ab',
    });
  });

  it('keeps each side’s saved fire and night days, picked rather than followed', () => {
    const { fires, night } = restoredLayers(
      { overlays: ['firms', 'nightlights'], firms: { sensor: 'modis', window: 'dates', first: '2024-01-01' }, nightlights: { source: 'snpp', day: '2024-01-01' } },
      { overlays: ['firms', 'nightlights'], firms: { sensor: 'modis', window: '48h' }, nightlights: { source: 'snpp', day: '2024-02-01' } }
    );
    expect(fires).toEqual({
      sensor: 'modis',
      follow: false,
      a: { window: 'dates', first: '2024-01-01', last: '' },
      b: { window: '48h', first: '', last: '' },
    });
    expect(night).toEqual({ source: 'snpp', follow: false, a: '2024-01-01', b: '2024-02-01' });
  });

  it('follows the pictures again when the layer was not on', () => {
    const { fires, night } = restoredLayers({ overlays: [] }, {});
    expect(fires.follow).toBe(true);
    expect(night.follow).toBe(true);
  });
});

describe('the fire layer’s questions in Compare', () => {
  it('asks for no day while each side follows its picture', () => {
    const [, days] = compareFireControls(freshFires(), SENSORS, () => {}, DAYS);
    expect(days.value).toBe('picture');
    expect(days.days).toBeNull();
  });

  it('starts picked days on the day each side was showing', () => {
    const set = vi.fn();
    compareFireControls(freshFires(), SENSORS, set, DAYS)[1].pick('dates');
    expect(set).toHaveBeenCalledWith({
      follow: false,
      a: { window: 'dates', first: '2024-03-12', last: '' },
      b: { window: 'dates', first: '2025-06-02', last: '' },
    });
  });

  it('asks for one day per side once they are picked', () => {
    const set = vi.fn();
    const fires = { ...freshFires(), follow: false };
    const [, days] = compareFireControls(fires, SENSORS, set, DAYS);
    expect(days.days.map((day) => day.label)).toEqual(['A', 'B']);
    days.days[1].set('2025-01-01');
    expect(set).toHaveBeenCalledWith({ b: { window: 'dates', first: '2025-01-01', last: '' } });
  });

  it('says what each side draws in the room a row has', () => {
    expect(compareFireWords(freshFires(), SENSORS, DAYS)).toBe('A 2024-03-12 · B 2025-06-02');
    expect(compareFireWords(freshFires(), SENSORS, { a: DAYS.a, b: '' })).toBe('A 2024-03-12 · B 24 h');
    // one day for both sides is said once
    expect(compareFireWords(freshFires(), SENSORS, { a: DAYS.a, b: DAYS.a })).toBe('VIIRS · 2024-03-12');
  });

  it('asks for a day on a side picked with none', () => {
    const fires = { ...freshFires(), follow: false };
    expect(compareFireNote(fires, DAYS)).toBe('Pick a day on each side to draw the detections.');
    expect(compareFireNote(freshFires(), DAYS)).toBe('');
    expect(compareFireNote(freshFires(), DAYS, { until: 'later' })).toContain('allowance used up');
  });
});

describe('the night layer’s questions in Compare', () => {
  it('asks for no night for the composite', () => {
    const night = { ...freshNight(), source: 'composite' };
    expect(compareNightControls(night, () => {}, DAYS)).toHaveLength(1);
    expect(compareNightWords(night, DAYS)).toBe('composite · 2016');
  });

  it('starts picked nights on the night each side was showing', () => {
    const set = vi.fn();
    compareNightControls(freshNight(), set, DAYS)[1].pick('day');
    expect(set).toHaveBeenCalledWith({ follow: false, a: '2024-03-12', b: '2025-06-02' });
  });

  it('names the side whose picture predates the sensor', () => {
    expect(compareNightWords(freshNight(), DAYS)).toBe('A 2024-03-12 · B 2025-06-02');
    expect(compareNightWords(freshNight(), { a: DAYS.b, b: DAYS.b })).toBe('NOAA-20 · 2025-06-02');
    expect(compareNightNote(freshNight(), DAYS)).toBe("A: the picture's day is outside NOAA-20's record.");
    expect(compareNightNote({ ...freshNight(), source: 'snpp' }, DAYS)).toBe('');
  });
});
