import { describe, expect, it } from 'vitest';
import {
  bilingual,
  branchKeys,
  buildGeoTree,
  filterSaved,
  isMode,
  keyFor,
  KINDS,
  oneEach,
  pendingLocate,
} from './geoTree.js';

const ok = (country, code, region, extra = {}) => ({
  geo: { state: 'ok', country, country_code: code, ...(region ? { region } : {}) },
  ...extra,
});

const row = (id, opts = {}) => ({
  id,
  kind: 'place',
  title: id,
  lat: 48,
  lon: 37,
  notes: '',
  fetched_at: `2026-07-2${id.length}T10:00:00Z`,
  continent: null,
  ...opts,
});

const UA = (id, region, extra = {}) =>
  row(id, { continent: 'Europe', ...ok('Ukraine', 'ua', region), ...extra });
const PL = (id, extra = {}) =>
  row(id, { continent: 'Europe', ...ok('Poland', 'pl', 'Mazovia'), ...extra });
const KE = (id, extra = {}) =>
  row(id, { continent: 'Africa', ...ok('Kenya', 'ke', 'Nairobi'), ...extra });

const names = (nodes) => nodes.map((n) => n.name);

describe('buildGeoTree levels', () => {
  it('groups by continent, country and region when the case spans several', () => {
    const tree = buildGeoTree([UA('a', 'Donetsk Oblast'), PL('b'), KE('c')]);

    expect(tree.levels).toEqual(['continent', 'country', 'region']);
    expect(names(tree.nodes)).toEqual(['Africa', 'Europe']);
    expect(names(tree.nodes[1].children)).toEqual(['Poland', 'Ukraine']);
    expect(names(tree.nodes[1].children[1].children)).toEqual(['Donetsk Oblast']);
  });

  it('drops the continent level when everything sits in one continent', () => {
    const tree = buildGeoTree([UA('a', 'Donetsk Oblast'), PL('b')]);

    expect(tree.levels).toEqual(['country', 'region']);
    expect(names(tree.nodes)).toEqual(['Poland', 'Ukraine']);
  });

  it('opens straight on regions when everything sits in one country', () => {
    const tree = buildGeoTree([UA('a', 'Donetsk Oblast'), UA('bb', 'Kyiv Oblast')]);

    expect(tree.levels).toEqual(['region']);
    expect(names(tree.nodes)).toEqual(['Donetsk Oblast', 'Kyiv Oblast']);
  });

  it('decides the depth over the whole set, not per branch', () => {
    // Kenya has one country in its continent; the tree must not end a level
    // early there just because that branch could
    const tree = buildGeoTree([UA('a', 'Donetsk Oblast'), KE('c')]);

    expect(tree.levels).toEqual(['continent', 'country', 'region']);
    expect(tree.nodes[0].children[0].children[0].name).toBe('Nairobi');
  });

  it('names a region-less country after itself rather than ending short', () => {
    const tree = buildGeoTree([UA('a', 'Donetsk Oblast'), row('bb', { continent: 'Europe', ...ok('Monaco', 'mc') })]);

    expect(tree.levels).toEqual(['country', 'region']);
    const monaco = tree.nodes.find((n) => n.name === 'Monaco');
    expect(names(monaco.children)).toEqual(['Monaco']);
    expect(monaco.children[0].items).toHaveLength(1);
  });

  it('shelves a country with no known continent instead of losing it', () => {
    const tree = buildGeoTree([UA('a', 'Donetsk Oblast'), row('bb', { continent: null, ...ok('Atlantis', 'zz', 'North') })]);

    expect(names(tree.nodes)).toEqual(['Europe', 'Other']);
  });
});

describe('buildGeoTree counts and order', () => {
  it('counts what is beneath each node', () => {
    const tree = buildGeoTree([UA('a', 'Donetsk Oblast'), UA('bb', 'Donetsk Oblast'), PL('ccc')]);

    expect(tree.nodes.map((n) => [n.name, n.count])).toEqual([
      ['Poland', 1],
      ['Ukraine', 2],
    ]);
  });

  it('sorts alphabetically at every level and newest first inside a leaf', () => {
    const older = UA('a', 'Donetsk Oblast', { fetched_at: '2026-01-01T00:00:00Z' });
    const newer = UA('bb', 'Donetsk Oblast', { fetched_at: '2026-07-01T00:00:00Z' });
    const tree = buildGeoTree([older, newer]);

    expect(tree.nodes[0].items.map((i) => i.id)).toEqual(['bb', 'a']);
  });
});

describe('buildGeoTree unlocated bucket', () => {
  it('collects everything with no country, whatever the reason', () => {
    const tree = buildGeoTree([
      UA('a', 'Donetsk Oblast'),
      row('bb', { geo: null }),
      row('ccc', { geo: { state: 'failed' } }),
      row('dddd', { geo: { state: 'nocoords' }, lat: null, lon: null }),
      row('eeeee', { geo: { state: 'nocountry' } }),
    ]);

    expect(tree.unlocated.count).toBe(4);
    expect(tree.nodes).toHaveLength(1);
  });

  it('is present but empty when everything is located', () => {
    expect(buildGeoTree([UA('a', 'Donetsk Oblast')]).unlocated.count).toBe(0);
  });

  it('does not let unplaced items decide the depth', () => {
    const tree = buildGeoTree([UA('a', 'Donetsk Oblast'), row('bb', { geo: null })]);

    expect(tree.levels).toEqual(['region']);
  });
});

describe('buildGeoTree filtering', () => {
  const rows = [
    UA('a', 'Donetsk Oblast', { kind: 'place', title: 'checkpoint north' }),
    UA('bb', 'Kyiv Oblast', { kind: 'capture', provider: 'Esri World Imagery' }),
    UA('ccc', 'Kyiv Oblast', { kind: 'screenshot', site: 'yandex-maps' }),
  ];

  it('treats a screenshot as a capture in the kind filter', () => {
    expect(filterSaved(rows, { kind: 'captures' }).map((r) => r.id)).toEqual(['bb', 'ccc']);
    expect(filterSaved(rows, { kind: 'places' }).map((r) => r.id)).toEqual(['a']);
    expect(filterSaved(rows, { kind: 'all' })).toHaveLength(3);
  });

  it('switches to proofs rather than mixing them into the saved rows', () => {
    // A proof sits on the capture it composes, so drawing both at once would
    // stack two marks on one point. The fourth position swaps the source
    // instead: `isMode` tells the panel to fetch, not to filter.
    expect(KINDS.map((k) => k.id)).toEqual(['all', 'places', 'captures', 'proofs']);
    expect(isMode('proofs')).toBe(true);
    expect(isMode('all')).toBe(false);

    // and the filter itself never has to know about proofs
    expect(filterSaved(rows, { kind: 'proofs' })).toHaveLength(3);
  });

  it('lists a two-place proof once, however many marks it draws', () => {
    // the map is about places, a flat list is about things
    const twice = [
      { ...rows[0], id: 'pr1', key: 'pr1@50,30', kind: 'proof', title: 'Two cities' },
      { ...rows[0], id: 'pr1', key: 'pr1@48,2', kind: 'proof', title: 'Two cities' },
      { ...rows[1] },
    ];

    expect(oneEach(twice).map((r) => r.key ?? r.id)).toEqual(['pr1@50,30', 'bb']);
  });

  it('searches title, notes, provider, site and geography', () => {
    const noted = UA('dddd', 'Kyiv Oblast', { notes: 'two vehicles at the gate' });
    const all = [...rows, noted];

    expect(filterSaved(all, { query: 'checkpoint' }).map((r) => r.id)).toEqual(['a']);
    expect(filterSaved(all, { query: 'vehicles' }).map((r) => r.id)).toEqual(['dddd']);
    expect(filterSaved(all, { query: 'esri' }).map((r) => r.id)).toEqual(['bb']);
    expect(filterSaved(all, { query: 'yandex' }).map((r) => r.id)).toEqual(['ccc']);
    expect(filterSaved(all, { query: 'ukraine' })).toHaveLength(4);
    expect(filterSaved(all, { query: 'donetsk' }).map((r) => r.id)).toEqual(['a']);
  });

  it('matches coordinates as they are read off a row', () => {
    expect(filterSaved(rows, { query: '48.0000, 37.0000' })).toHaveLength(3);
  });

  it('filters before grouping, so counts describe what is shown', () => {
    const tree = buildGeoTree(rows, { kind: 'captures' });

    expect(tree.levels).toEqual(['region']);
    expect(tree.nodes.map((n) => [n.name, n.count])).toEqual([['Kyiv Oblast', 2]]);
  });

  it('re-decides the depth on the filtered set', () => {
    const tree = buildGeoTree([UA('a', 'Donetsk Oblast'), KE('c')], { query: 'kenya' });

    expect(tree.levels).toEqual(['region']);
    expect(names(tree.nodes)).toEqual(['Nairobi']);
  });
});

describe('bilingual labels', () => {
  // a Russian case as the index hands it over: native geo, English country
  // derived server-side, English region only where a lookup answered
  const RU = (id, region, region_en, extra = {}) =>
    row(id, {
      continent: 'Europe',
      country_en: 'Russia',
      geo: {
        state: 'ok',
        country: 'Россия',
        country_code: 'ru',
        region,
        ...(region_en ? { region_en } : {}),
      },
      ...extra,
    });

  it('reads English first and the native name in brackets', () => {
    expect(bilingual('Russia', 'Россия')).toBe('Russia (Россия)');
  });

  it('says a name once when both languages agree, or when only one is known', () => {
    expect(bilingual('France', 'France')).toBe('France');
    expect(bilingual('', 'Московская область')).toBe('Московская область');
    expect(bilingual('Moscow Oblast', '')).toBe('Moscow Oblast');
    expect(bilingual(null, null)).toBe('');
  });

  it('labels country and region branches in both languages', () => {
    const tree = buildGeoTree([
      RU('a', 'Московская область', 'Moscow Oblast'),
      KE('bb'),
    ]);

    expect(tree.levels).toEqual(['continent', 'country', 'region']);
    const europe = tree.nodes.find((n) => n.name === 'Europe');
    expect(europe.children.map((n) => n.label)).toEqual(['Russia (Россия)']);
    expect(europe.children[0].children.map((n) => n.label)).toEqual([
      'Moscow Oblast (Московская область)',
    ]);
  });

  it('keeps one bucket when only some of its rows carry an English region', () => {
    // rows saved before the tree spoke English sit in the same region as new
    // ones; grouping on the label would split the branch in two
    const tree = buildGeoTree([
      RU('a', 'Московская область', 'Moscow Oblast'),
      RU('bb', 'Московская область'),
    ]);

    expect(tree.nodes.map((n) => [n.name, n.label, n.count])).toEqual([
      ['Московская область', 'Moscow Oblast (Московская область)', 2],
    ]);
    // the key is the native name, so reveal-from-elsewhere still finds it
    expect(keyFor(RU('bb', 'Московская область'), tree.levels)).toBe(tree.nodes[0].key);
  });

  it('orders branches by what is on screen', () => {
    const tree = buildGeoTree([RU('a', 'Московская область', 'Moscow Oblast'), KE('bb')]);
    // Russia sorts under R, not under Р — the tree reads in English
    expect(tree.nodes.map((n) => n.label)).toEqual(['Africa', 'Europe']);
  });

  it('finds a natively-filed row from either language', () => {
    const rows = [RU('a', 'Московская область', 'Moscow Oblast')];

    expect(filterSaved(rows, { query: 'russia' })).toHaveLength(1);
    expect(filterSaved(rows, { query: 'Россия' })).toHaveLength(1);
    expect(filterSaved(rows, { query: 'moscow' })).toHaveLength(1);
    expect(filterSaved(rows, { query: 'московская' })).toHaveLength(1);
  });
});

describe('pendingLocate', () => {
  it('counts only what another pass could still resolve', () => {
    expect(
      pendingLocate([
        UA('a', 'Donetsk Oblast'),
        row('bb', { geo: null }),
        row('ccc', { geo: { state: 'failed' } }),
        row('dddd', { geo: { state: 'nocoords' } }),
        row('eeeee', { geo: { state: 'nocountry' } }),
      ])
    ).toBe(2);
  });
});

describe('addressing a row in the tree', () => {
  it('gives the leaf key for the levels in play', () => {
    expect(keyFor(UA('a', 'Donetsk Oblast'), ['continent', 'country', 'region'])).toBe(
      'Europe/Ukraine/Donetsk Oblast'
    );
    expect(keyFor(UA('a', 'Donetsk Oblast'), ['region'])).toBe('Donetsk Oblast');
    expect(keyFor(row('bb', { geo: null }), ['region'])).toBe('Unlocated');
  });

  it('expands exactly the branch a key lives in', () => {
    expect(branchKeys('Europe/Ukraine/Donetsk Oblast')).toEqual([
      'Europe',
      'Europe/Ukraine',
      'Europe/Ukraine/Donetsk Oblast',
    ]);
  });
});
