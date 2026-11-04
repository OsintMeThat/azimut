import { describe, expect, it } from 'vitest';
import { byDay, byHour, dayPart, daysPlayed, hasHours, keptByHour, momentsAs, timed, withHours } from './hours.js';
import { MAX_STEPS, PAGE } from './page.js';
import { asOf, stateAt } from '../map/layerHistory.js';

const point = (lon) => ({ type: 'Point', coordinates: [lon, 0] });

describe('a plate played hour by hour or day by day', () => {
  it('tells a moment with a time from a day and from the page', () => {
    expect(timed('2026-11-02T14:30')).toBe(true);
    expect(timed('2026-11-02')).toBe(false);
    expect(timed(PAGE)).toBe(false);
    expect(timed(null)).toBe(false);
    expect(dayPart('2026-11-02T14:30')).toBe('2026-11-02');
    expect(dayPart(PAGE)).toBe(PAGE);
    expect(hasHours(['2026-11-01', '2026-11-02T14:30'])).toBe(true);
    expect(hasHours(['2026-11-01'])).toBe(false);
  });

  it('plays day by day unless told, or unless it keeps work under an hour from before the choice', () => {
    expect(byHour({ time: {} })).toBe(false);
    expect(byHour({ time: { hours: true } })).toBe(true);
    expect(byHour({ time: { hours: false }, steps: { '2026-11-02T14:30': [{ id: 's1' }] } })).toBe(false);
    for (const kept of [{ steps: { '2026-11-02T14:30': [{ id: 's1' }] } }, { holds: { '2026-11-02T14:30': 2 } },
      { framing: { '2026-11-02T14:30': { map: {} } } }, { days: ['2026-11-02T14:30'] }, { skipped: ['2026-11-02T14:30'] }]) {
      expect(keptByHour(kept)).toBe(true);
      expect(byHour({ time: { hours: null }, ...kept })).toBe(true);
    }
    // a step's framing is kept under its id, and a day emptied of its steps keeps nothing
    expect(keptByHour({ framing: { s1: { map: {} } }, steps: { '2026-11-02T14:30': [] } })).toBe(false);
  });

  it('plays each moment hour by hour, each day once day by day', () => {
    const moments = ['2026-11-01', '2026-11-02T09:00', '2026-11-02T14:30', '2026-11-03T08:00'];
    expect(momentsAs(moments, true)).toEqual(moments);
    expect(momentsAs(moments, false)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);
    // day by day, an hour played or stepped hour by hour is no day of its own
    const spec = { days: ['2026-11-05', '2026-11-04T10:00'], steps: { '2026-11-06': [{ id: 'a' }], '2026-11-07T10:00': [{ id: 'b' }] } };
    expect(daysPlayed(spec, ['2026-11-01'], false)).toEqual(['2026-11-01', '2026-11-05', '2026-11-06']);
    expect(daysPlayed(spec, ['2026-11-01'], true)).toEqual(['2026-11-01', '2026-11-04T10:00', '2026-11-05', '2026-11-06', '2026-11-07T10:00']);
  });
});

describe('a layer read day by day', () => {
  const moved = { type: 'Feature', geometry: point(3), properties: { key: 'post', states: [
    { at: '2026-11-01', geometry: point(0) },
    { at: '2026-11-02T09:00', geometry: point(1) },
    { at: '2026-11-02T14:30', geometry: point(2), status: 'damaged' },
    { at: '2026-11-03T08:00', geometry: point(3) },
  ] } };
  const strike = { type: 'Feature', geometry: point(5), properties: { key: 'strike', event: true, date: '2026-11-02T16:10', date_end: '2026-11-04T02:00' } };
  const plain = { type: 'Feature', geometry: point(6), properties: { key: 'gate', date: '2026-10-30' } };

  it('shows each day as it ended, every change of the day in', () => {
    const layer = { type: 'FeatureCollection', features: [moved, strike, plain] };
    const read = byDay(layer);
    expect(read.features[0].properties.states.map((state) => [state.at, state.geometry.coordinates[0]]))
      .toEqual([['2026-11-01', 0], ['2026-11-02', 2], ['2026-11-03', 3]]);
    expect(read.features[0].properties.states[1].status).toBe('damaged');
    expect([read.features[1].properties.date, read.features[1].properties.date_end]).toEqual(['2026-11-02', '2026-11-04']);
    expect(read.features[2]).toBe(plain);
    // read on the bare day, the day's last state is the one in force, where the hours left it at midnight
    expect(stateAt(read.features[0], '2026-11-02').geometry.coordinates[0]).toBe(2);
    expect(stateAt(moved, '2026-11-02').geometry.coordinates[0]).toBe(0);
    expect(stateAt(read.features[1], '2026-11-02')).not.toBeNull();
    expect(stateAt(strike, '2026-11-02')).toBeNull();
    // the state before is the day before's
    const drawn = asOf(read, '2026-11-02', { trail: true });
    expect(drawn.features.find((feature) => feature.properties.$trail).geometry.coordinates[0]).toBe(0);
  });

  it('leaves a feature gone by the end of the day off that day', () => {
    const brief = { type: 'Feature', geometry: point(1), properties: { key: 'brief', states: [
      { at: '2026-11-02T09:00', geometry: point(1) }, { at: '2026-11-02T18:00', gone: true }] } };
    expect(stateAt(byDay({ features: [brief] }).features[0], '2026-11-02')).toBeNull();
  });

  it('hands back the layer itself when nothing carries a time, and one reading of a layer every time', () => {
    const plainLayer = { type: 'FeatureCollection', features: [plain] };
    expect(byDay(plainLayer)).toBe(plainLayer);
    const layer = { type: 'FeatureCollection', features: [moved] };
    expect(byDay(layer)).toBe(byDay(layer));
    expect(byDay(null)).toBeNull();
  });
});

describe('switching a plate between hours and days', () => {
  const spec = () => ({
    time: { at: '2026-11-02T14:30', step: 's3', hours: true },
    steps: {
      '2026-11-02': [{ id: 's1' }],
      '2026-11-02T14:30': [{ id: 's3', name: 'Fire' }],
      '2026-11-02T09:00': [{ id: 's2' }],
      '2026-11-03T08:00': [{ id: 's4' }],
    },
    holds: { '2026-11-02T14:30': 4 },
  });

  it('plays the steps of each hour after its day\'s own, in the order of the hours, each keeping its hour', () => {
    const made = withHours(spec(), false);
    expect(made.steps).toEqual({
      '2026-11-02': [{ id: 's1' }, { id: 's2', hour: '09:00' }, { id: 's3', name: 'Fire', hour: '14:30' }],
      '2026-11-03': [{ id: 's4', hour: '08:00' }],
    });
    expect(made.time).toEqual({ at: '2026-11-02', step: 's3', hours: false });
    expect(made.holds).toBeUndefined();
  });

  it('puts them back on their hours, standing on the hour of the step it shows', () => {
    const folded = { ...spec(), ...withHours(spec(), false) };
    const made = withHours(folded, true);
    expect(made.steps).toEqual(spec().steps);
    expect(made.time).toEqual({ at: '2026-11-02T14:30', step: 's3', hours: true });
  });

  it('stands on the last moment of its day it plays when no step is shown, and keeps a step made day by day on its day', () => {
    const folded = { time: { at: '2026-11-02', step: null, hours: false }, steps: { '2026-11-02': [{ id: 'new' }] } };
    const made = withHours(folded, true, ['2026-11-01T10:00', '2026-11-02', '2026-11-02T09:00', '2026-11-02T14:30', '2026-11-03T08:00']);
    expect(made.time.at).toBe('2026-11-02T14:30');
    expect(made.steps).toEqual({ '2026-11-02': [{ id: 'new' }] });
    expect(withHours(folded, true, []).time.at).toBe('2026-11-02');
  });

  it('refuses to fold more steps into a day than it holds, naming the day', () => {
    const many = (hour, count) => Array.from({ length: count }, (_, index) => ({ id: `${hour}-${index}` }));
    const crowded = { time: { at: '2026-11-02T09:00' }, steps: { '2026-11-02T09:00': many('a', 20), '2026-11-02T10:00': many('b', MAX_STEPS - 19) } };
    expect(withHours(crowded, false)).toEqual({ full: '2026-11-02' });
  });
});
