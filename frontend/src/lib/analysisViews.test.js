import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  copyName,
  exactStamp,
  normalizeViewOrder,
  readViewOrder,
  sortViews,
  timeAgo,
  viewOrders,
  writeViewOrder,
} from './analysisViews.js';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const rows = [
  { id: 'v1', name: 'ports', surface: 'graph', updated_at: '2026-08-02T09:00:00Z' },
  { id: 'v2', name: 'Ammunition', surface: 'board', updated_at: '2026-08-11T18:30:00Z' },
  { id: 'v3', name: 'Bridges', surface: 'board', updated_at: '2026-08-11T18:30:00Z' },
];

describe('analysis view names', () => {
  it('finds an unused duplicate name without a failing save first', () => {
    expect(copyName('Ports', ['Ports', 'Ports copy', 'Ports copy 2'])).toBe('Ports copy 3');
  });
});

describe('ordering a views menu', () => {
  it('leaves the caller its own array', () => {
    const order = rows.map((row) => row.id);
    sortViews(rows, 'name');
    expect(rows.map((row) => row.id)).toEqual(order);
  });

  it('reads newest edit first, with the name breaking a tied second', () => {
    expect(sortViews(rows, 'recent').map((row) => row.id)).toEqual(['v2', 'v3', 'v1']);
  });

  it('sorts by name without letting case decide the order', () => {
    expect(sortViews(rows, 'name').map((row) => row.id)).toEqual(['v2', 'v3', 'v1']);
    expect(sortViews([{ name: 'b' }, { name: 'A' }], 'name').map((row) => row.name))
      .toEqual(['A', 'b']);
  });

  it('groups by surface, then by name inside it', () => {
    expect(sortViews(rows, 'surface').map((row) => row.id)).toEqual(['v2', 'v3', 'v1']);
    expect(sortViews([
      { name: 'Zulu', surface: 'board' },
      { name: 'Alpha', surface: 'graph' },
    ], 'surface').map((row) => row.name)).toEqual(['Zulu', 'Alpha']);
  });

  it('falls back to the order the case wrote when asked for nonsense', () => {
    expect(sortViews(rows, 'whatever').map((row) => row.id)).toEqual(['v2', 'v3', 'v1']);
    expect(sortViews(null)).toEqual([]);
  });

  it('offers Surface only where a family holds more than one', () => {
    expect(viewOrders('catalog').map((order) => order.id)).toEqual(['recent', 'name', 'surface']);
    expect(viewOrders('timeline').map((order) => order.id)).toEqual(['recent', 'name']);
    expect(normalizeViewOrder('surface', 'timeline')).toBe('recent');
    expect(normalizeViewOrder('surface', 'catalog')).toBe('surface');
  });
});

describe('remembering the chosen ordering', () => {
  beforeEach(() => vi.stubGlobal('localStorage', storage()));

  it('keeps one choice per family', () => {
    writeViewOrder('catalog', 'name');
    writeViewOrder('timeline', 'recent');
    expect(readViewOrder('catalog')).toBe('name');
    expect(readViewOrder('timeline')).toBe('recent');
  });

  it('refuses to remember an ordering its family cannot offer', () => {
    writeViewOrder('timeline', 'surface');
    expect(readViewOrder('timeline')).toBe('recent');
  });

  it('survives a store that is not there', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
    });
    expect(readViewOrder('catalog')).toBe('recent');
    expect(() => writeViewOrder('catalog', 'name')).not.toThrow();
  });
});

describe('dating a saved reading', () => {
  const now = Date.parse('2026-08-13T12:00:00Z');

  it('reads the distance in the register the rest of the app uses', () => {
    expect(timeAgo('2026-08-13T11:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-08-13T11:20:00Z', now)).toBe('40 min ago');
    expect(timeAgo('2026-08-13T04:00:00Z', now)).toBe('8 h ago');
    expect(timeAgo('2026-08-11T12:00:00Z', now)).toBe('2 d ago');
  });

  it('states the date once the distance stops meaning anything', () => {
    expect(timeAgo('2026-08-01T12:00:00Z', now)).toBe('1 Aug 2026');
    expect(timeAgo('2025-12-24T23:00:00Z', now)).toBe('24 Dec 2025');
  });

  it('says nothing about a stamp it cannot read', () => {
    expect(timeAgo('', now)).toBe('');
    expect(timeAgo('not a date', now)).toBe('');
    expect(exactStamp('not a date')).toBe('not a date');
  });

  it('spells the exact minute in UTC, whatever the machine reads in', () => {
    expect(exactStamp('2026-08-11T18:30:12Z')).toBe('2026-08-11 18:30 UTC');
  });
});
