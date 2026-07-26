import { describe, expect, it } from 'vitest';
import { groupSavedMarkers, markerPrecision, stackOrder } from './savedMarkers.js';

const at = (id, lat, lon, extra = {}) => ({ id, kind: 'capture', lat, lon, ...extra });

describe('groupSavedMarkers', () => {
  it('collapses items saved at the same spot into one mark', () => {
    const marks = groupSavedMarkers([
      at('a', 48.015912, 37.802901),
      at('b', 48.015913, 37.802899), // same metre
    ]);

    expect(marks).toHaveLength(1);
    expect(marks[0].items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('keeps distinct spots apart', () => {
    expect(groupSavedMarkers([at('a', 48.0159, 37.8029), at('b', 48.02, 37.81)])).toHaveLength(2);
  });

  it('places a mark on its first item, not on the rounded key', () => {
    const [mark] = groupSavedMarkers([at('a', 48.015912, 37.802901)], 2);

    expect(mark.lat).toBe(48.015912);
    expect(mark.lon).toBe(37.802901);
  });

  it('leaves out rows with no coordinates', () => {
    const marks = groupSavedMarkers([
      at('a', 48.0159, 37.8029),
      at('b', null, null),
      at('c', undefined, undefined),
    ]);

    expect(marks).toHaveLength(1);
    expect(marks[0].items.map((i) => i.id)).toEqual(['a']);
  });

  it('reports every kind stacked on one mark', () => {
    const marks = groupSavedMarkers([
      at('a', 48.0159, 37.8029, { kind: 'place' }),
      at('b', 48.0159, 37.8029, { kind: 'capture' }),
      at('c', 48.0159, 37.8029, { kind: 'capture' }),
    ]);

    expect(marks[0].kinds).toEqual(['place', 'capture']);
    expect(marks[0].items).toHaveLength(3);
  });

  it('merges more coarsely at a lower precision', () => {
    const rows = [at('a', 48.0159, 37.8029), at('b', 48.4, 37.9)];

    expect(groupSavedMarkers(rows, 5)).toHaveLength(2);
    expect(groupSavedMarkers(rows, 0)).toHaveLength(1);
  });

  it('handles an empty or missing list', () => {
    expect(groupSavedMarkers([])).toEqual([]);
    expect(groupSavedMarkers()).toEqual([]);
  });
});

describe('markerPrecision', () => {
  it('merges only the same spot at street zoom, and whole regions at world zoom', () => {
    expect(markerPrecision(18)).toBe(5);
    expect(markerPrecision(16)).toBe(5);
    expect(markerPrecision(12)).toBe(3);
    expect(markerPrecision(6)).toBe(1);
    expect(markerPrecision(3)).toBe(0);
  });

  it('falls back to same-spot grouping when the zoom is unknown', () => {
    expect(markerPrecision(undefined)).toBe(5);
    expect(markerPrecision(NaN)).toBe(5);
  });
});

describe('stackOrder', () => {
  it('reads as a timeline of the ground, newest imagery first', () => {
    const ordered = stackOrder([
      { id: 'a', imagery_date: '2021-06' },
      { id: 'b', imagery_date: '2024-03' },
      { id: 'c', imagery_date: '2023-01' },
    ]);

    expect(ordered.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('sends undated items to the end, newest save first', () => {
    const ordered = stackOrder([
      { id: 'a', fetched_at: '2026-01-01T00:00:00Z' },
      { id: 'b', imagery_date: '2024-03' },
      { id: 'c', fetched_at: '2026-05-01T00:00:00Z' },
    ]);

    expect(ordered.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });
});
