import { describe, expect, it } from 'vitest';
import { ALL, areaOf, DEFAULT_SPAN, layerRequest, RANGE, WINDOWS } from './geoconfirmed.js';

/**
 * What the GeoConfirmed dialog posts. The backend checks all of it again
 * (`engine/geoconfirmed.py`); this is what keeps the Add button honest about
 * whether there is anything to send.
 */

const VIEW = { west: 30.1234567, south: 44, east: 40, north: 52 };

describe('the windows on offer', () => {
  it('open on thirty days, which is one of the presses', () => {
    expect(WINDOWS.map((entry) => entry.span)).toContain(DEFAULT_SPAN);
  });

  it('end on the whole history', () => {
    expect(WINDOWS.at(-1)).toEqual({ span: ALL, label: 'All history' });
  });
});

describe('the area', () => {
  it('is the view as west, south, east, north, to six decimals', () => {
    expect(areaOf(VIEW)).toEqual([30.123457, 44, 40, 52]);
  });

  it('refuses a view across the antimeridian, whose west lands east of its east', () => {
    expect(areaOf({ west: 170, south: 0, east: -170, north: 10 })).toBeNull();
  });

  it('holds a view wider than the world to the world', () => {
    expect(areaOf({ west: -200, south: -95, east: 200, north: 95 })).toEqual([
      -180, -90, 180, 90,
    ]);
  });

  it('has nothing to say without a view', () => {
    expect(areaOf(null)).toBeNull();
  });
});

describe('the request', () => {
  it('asks for a number of days', () => {
    expect(layerRequest({ conflict: 'Ukraine', span: 30 })).toEqual({
      conflict: 'Ukraine',
      days: 30,
    });
  });

  it('asks for the whole history with no dates at all', () => {
    expect(layerRequest({ conflict: 'Ukraine', span: ALL, start: '2026-08-01' })).toEqual({
      conflict: 'Ukraine',
      everything: true,
    });
  });

  it('asks for a range, with or without its last day', () => {
    expect(layerRequest({ conflict: 'Iran', span: RANGE, start: '2026-08-01', end: '' })).toEqual(
      { conflict: 'Iran', start: '2026-08-01' }
    );
    expect(
      layerRequest({ conflict: 'Iran', span: RANGE, start: '2026-08-01', end: '2026-08-31' })
    ).toEqual({ conflict: 'Iran', start: '2026-08-01', end: '2026-08-31' });
  });

  it('carries the view only when asked to keep to it', () => {
    expect(layerRequest({ conflict: 'Ukraine', span: 7, limited: false, bounds: VIEW }).area).toBe(
      undefined
    );
    expect(
      layerRequest({ conflict: 'Ukraine', span: 7, limited: true, bounds: VIEW }).area
    ).toEqual([30.123457, 44, 40, 52]);
  });

  it('has nothing to send without a conflict, a window, or a usable view', () => {
    expect(layerRequest({ conflict: '', span: 7 })).toBeNull();
    expect(layerRequest({ conflict: 'Ukraine', span: RANGE, start: '' })).toBeNull();
    expect(
      layerRequest({
        conflict: 'Ukraine',
        span: 7,
        limited: true,
        bounds: { west: 170, south: 0, east: -170, north: 10 },
      })
    ).toBeNull();
  });
});
