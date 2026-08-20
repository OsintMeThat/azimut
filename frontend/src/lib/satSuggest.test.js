import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RECENTS_KEY,
  buildGroups,
  flatten,
  matchSaved,
  pushRecent,
  readRecents,
  recentItems,
  step,
} from './satSuggest.js';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

const savedRow = (id, opts = {}) => ({
  id,
  kind: 'place',
  title: id,
  lat: 48.0159,
  lon: 37.8029,
  notes: '',
  fetched_at: '2026-07-20T09:12:04Z',
  geo: { state: 'ok', country: 'Україна', country_code: 'ua', region: 'Donetsk' },
  country_en: 'Ukraine',
  continent: 'Europe',
  ...opts,
});

const city = (name, opts = {}) => ({
  name,
  region: 'Donetsk',
  country: 'ua',
  country_name: 'Ukraine',
  lat: 48.7311,
  lon: 37.5678,
  population: 147145,
  ...opts,
});

describe('matchSaved', () => {
  it('finds saved work by title, note or place, and carries the row along', () => {
    const rows = [savedRow('checkpoint north'), savedRow('bridge', { lat: 52.23, lon: 21.01 })];
    const [hit] = matchSaved(rows, 'checkp');
    expect(hit.label).toBe('checkpoint north');
    expect(hit.detail).toBe('Ukraine, Donetsk');
    expect(hit.row.id).toBe('checkpoint north');
  });

  it('leaves out what has no point to fly to', () => {
    const rows = [savedRow('screenshot', { lat: null, lon: null })];
    expect(matchSaved(rows, 'screen')).toEqual([]);
  });

  it('proposes nothing for an empty query', () => {
    expect(matchSaved([savedRow('a')], '  ')).toEqual([]);
  });
});

describe('buildGroups', () => {
  it('offers recents, and only recents, while the bar is empty', () => {
    const groups = buildGroups({ query: '', recents: [{ label: 'Kyiv', lat: 50.45, lon: 30.52 }] });
    expect(groups.map((g) => g.id)).toEqual(['recents']);
    expect(groups[0].items[0].label).toBe('Kyiv');
  });

  it('says nothing at all when there is nothing to say', () => {
    expect(buildGroups({ query: '' })).toEqual([]);
    expect(buildGroups({ query: 'zzz' })).toEqual([]);
  });

  it('puts coordinates first, then saved work, then cities, then the geocoder', () => {
    const groups = buildGroups({
      query: 'kram',
      coords: { lat: 50.4501, lon: 30.5234 },
      saved: matchSaved([savedRow('kramatorsk checkpoint')], 'kram'),
      cities: [city('Kramatorsk')],
      places: [{ lat: 48.74, lon: 37.6, display_name: 'Kramatorska Street, Sloviansk' }],
    });
    expect(groups.map((g) => g.id)).toEqual(['coords', 'saved', 'cities', 'places']);
    expect(groups[0].items[0].label).toBe('50.45010, 30.52340');
    expect(groups[3].items[0].label).toBe('Kramatorska Street');
    expect(groups[3].items[0].detail).toBe('Sloviansk');
  });

  it('drops a group rather than heading an empty one', () => {
    const groups = buildGroups({ query: 'kram', cities: [city('Kramatorsk')] });
    expect(groups.map((g) => g.id)).toEqual(['cities']);
  });

  it('keeps one line per place when two sources name the same point', () => {
    // the city is already saved in the case: it is the saved row, not a second line
    const groups = buildGroups({
      query: 'kram',
      saved: matchSaved([savedRow('Kramatorsk', { lat: 48.7311, lon: 37.5678 })], 'kram'),
      cities: [city('Kramatorsk')],
    });
    expect(groups.map((g) => g.id)).toEqual(['saved']);
  });

  it('states how far each match is from the map centre', () => {
    const [group] = buildGroups({
      query: 'kram',
      cities: [city('Kramatorsk')],
      centre: { lat: 50.4547, lon: 30.5238 },
    });
    expect(group.items[0].away).toMatch(/km$/);
  });

  it('follows the unit preference', () => {
    const imperial = buildGroups({
      query: 'kram',
      cities: [city('Kramatorsk')],
      centre: { lat: 50.4547, lon: 30.5238 },
      units: 'imperial',
    });
    expect(imperial[0].items[0].away).toMatch(/mi$/);
  });

  it('gives a city a wider zoom than a street', () => {
    const groups = buildGroups({
      query: 'kram',
      cities: [city('Kramatorsk')],
      places: [{ lat: 1, lon: 2, display_name: 'Kramatorska Street, Sloviansk' }],
    });
    expect(groups[0].items[0].zoom).toBeLessThan(groups[1].items[0].zoom);
  });
});

describe('keyboard walking', () => {
  it('flattens the groups into the order the arrows follow', () => {
    const groups = buildGroups({
      query: 'kram',
      coords: { lat: 1, lon: 2 },
      cities: [city('Kramatorsk')],
    });
    expect(flatten(groups).map((item) => item.group)).toEqual(['coords', 'cities']);
  });

  it('wraps at both ends and starts from either', () => {
    expect(step(-1, 1, 3)).toBe(0);
    expect(step(-1, -1, 3)).toBe(2);
    expect(step(2, 1, 3)).toBe(0);
    expect(step(0, -1, 3)).toBe(2);
  });

  it('highlights nothing when there is nothing to highlight', () => {
    expect(step(-1, 1, 0)).toBe(-1);
  });
});

describe('recents', () => {
  beforeEach(() => vi.stubGlobal('localStorage', storage()));

  it('remembers a pick, newest first', () => {
    pushRecent({ label: 'Kyiv', detail: 'Ukraine', lat: 50.45, lon: 30.52, zoom: 12 });
    pushRecent({ label: 'Kramatorsk', detail: 'Donetsk, Ukraine', lat: 48.73, lon: 37.57 });
    expect(readRecents().map((entry) => entry.label)).toEqual(['Kramatorsk', 'Kyiv']);
  });

  it('keeps one entry per place rather than a pile of repeats', () => {
    pushRecent({ label: 'Kyiv', lat: 50.45, lon: 30.52 });
    pushRecent({ label: 'Lviv', lat: 49.84, lon: 24.03 });
    pushRecent({ label: 'Kyiv', lat: 50.45, lon: 30.52 });
    expect(readRecents().map((entry) => entry.label)).toEqual(['Kyiv', 'Lviv']);
  });

  it('caps the list', () => {
    for (let n = 0; n < 12; n += 1) pushRecent({ label: `city ${n}`, lat: n, lon: n });
    expect(readRecents()).toHaveLength(8);
  });

  it('refuses an entry with no point to return to', () => {
    pushRecent({ label: 'nowhere', lat: null, lon: null });
    expect(readRecents()).toEqual([]);
  });

  it('survives a corrupt store', () => {
    localStorage.setItem(RECENTS_KEY, 'not json');
    expect(readRecents()).toEqual([]);
    expect(recentItems(readRecents())).toEqual([]);
  });
});
