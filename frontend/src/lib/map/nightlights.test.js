import { describe, expect, it } from 'vitest';
import {
  COMPOSITE,
  askable,
  firstNight,
  lastNight,
  summary,
  tileParams,
  tileTemplate,
} from './nightlights.js';

const NOW = new Date('2026-09-13T10:00:00Z');

describe('which night can be asked for', () => {
  it('ends the night before today, since today’s pass is still being processed', () => {
    expect(lastNight(NOW)).toBe('2026-09-12');
  });

  it('starts where each sensor’s record does', () => {
    expect(firstNight('noaa20')).toBe('2024-03-25');
    expect(firstNight('snpp')).toBe('2020-11-18');
    expect(firstNight(COMPOSITE.id)).toBe('');
  });

  it('answers a night inside the record and nothing outside it', () => {
    expect(askable({ source: 'noaa20', day: '2026-09-12' }, NOW)).toBe(true);
    expect(askable({ source: 'noaa20', day: '2024-03-24' }, NOW)).toBe(false);
    expect(askable({ source: 'snpp', day: '2022-02-24' }, NOW)).toBe(true);
    expect(askable({ source: 'snpp', day: '2026-09-13' }, NOW)).toBe(false);
  });

  it('waits for a night rather than asking for tiles without one', () => {
    expect(askable({ source: 'noaa20', day: '' }, NOW)).toBe(false);
    expect(askable({ source: 'noaa20', day: '12/09/2026' }, NOW)).toBe(false);
    expect(askable({ source: 'landsat', day: '2026-09-12' }, NOW)).toBe(false);
  });

  it('always answers the composite, which has one date of its own', () => {
    expect(askable({ source: COMPOSITE.id }, NOW)).toBe(true);
  });
});

describe('what GIBS is asked', () => {
  it('names the sensor’s layer and the night, on the Web Mercator grid', () => {
    expect(tileTemplate({ source: 'noaa20', day: '2026-09-12' })).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/' +
        'VIIRS_NOAA20_DayNightBand_At_Sensor_Radiance/default/2026-09-12/' +
        'GoogleMapsCompatible_Level8/{z}/{y}/{x}.png'
    );
  });

  it('asks the composite for its own year, whatever day is in the field', () => {
    expect(tileTemplate({ source: COMPOSITE.id, day: '2026-09-12' })).toContain(
      '/VIIRS_Black_Marble/default/2016-01-01/'
    );
    expect(tileParams({ source: COMPOSITE.id, day: '2026-09-12' })).toEqual({ source: 'composite' });
  });

  it('builds nothing from a question it cannot state', () => {
    expect(tileTemplate({ source: 'noaa20', day: 'yesterday' })).toBe('');
    expect(tileTemplate({ source: 'landsat', day: '2026-09-12' })).toBe('');
  });
});

describe('how the row reads', () => {
  it('names the sensor and the night, or asks for one', () => {
    expect(summary({ source: 'snpp', day: '2022-02-24' })).toBe('Suomi NPP · 2022-02-24');
    expect(summary({ source: 'noaa20', day: '' })).toBe('NOAA-20 · pick a night');
    expect(summary({ source: COMPOSITE.id })).toBe('composite · 2016');
  });
});
