import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import SavedSearch from './SavedSearch.svelte';
import { sortSaved } from '../../lib/geoTree.js';

const source = readFileSync(new URL('./SavedSearch.svelte', import.meta.url), 'utf8');

const rows = [
  {
    id: 'p1',
    kind: 'place',
    title: 'checkpoint north',
    lat: 48.0159,
    lon: 37.8029,
    geo: { state: 'ok', country: 'Ukraine', country_code: 'ua', region: 'Donetsk Oblast' },
    continent: 'Europe',
    fetched_at: '2026-07-20T09:12:04Z',
    folder: 'recon',
  },
  {
    id: 'c1',
    kind: 'capture',
    title: 'bridge',
    lat: 52.23,
    lon: 21.01,
    provider: 'Esri World Imagery',
    geo: { state: 'ok', country: 'Poland', country_code: 'pl', region: 'Mazovia' },
    continent: 'Europe',
    fetched_at: '2026-07-19T09:12:04Z',
    path: 'media/a.png',
    thumbnail: 'media/thumbs/a.jpg',
    folder: 'recon/bridges',
  },
  {
    id: 's1',
    kind: 'screenshot',
    title: 'yandex view',
    lat: null,
    lon: null,
    site: 'yandex-maps',
    source_url: 'https://yandex.com/maps/?ll=1,2',
    geo: { state: 'nocoords' },
    continent: null,
    fetched_at: '2026-07-18T09:12:04Z',
  },
];

const noop = () => {};
const at = (props = {}) =>
  render(SavedSearch, {
    props: {
      rows,
      caseId: 'case-1',
      coords: (row) => `${row.lat}, ${row.lon}`,
      onclose: noop,
      onopen: noop,
      onedit: noop,
      ondelete: noop,
      onproof: noop,
      ...props,
    },
  }).body;

describe('SavedSearch', () => {
  it('searches title, country and provider across every kind', () => {
    expect(at({ query: 'checkpoint' })).toContain('checkpoint north');
    expect(at({ query: 'checkpoint' })).not.toContain('bridge');
    expect(at({ query: 'poland' })).toContain('bridge');
    expect(at({ query: 'esri' })).toContain('bridge');
    expect(at({ query: 'yandex' })).toContain('yandex view');
  });

  it('filters by kind alongside the search', () => {
    expect(at({ kind: 'places' })).not.toContain('bridge');
    expect(at({ kind: 'captures' })).not.toContain('checkpoint north');
  });

  it('offers the three sorts, with distance disabled until the map has a centre', () => {
    expect(at()).toContain('Newest');
    expect(at()).toContain('Title');
    expect(at()).toContain('Distance from map centre');
    expect(at()).toContain('disabled');
    expect(at({ centre: { lat: 48, lon: 37 } })).toContain('Distance from map centre');
  });

  it('gives a coordinate-less screenshot its source URL instead of a fly-to', () => {
    expect(at({ query: 'yandex' })).toContain('https://yandex.com/maps/?ll=1,2');
  });

  it('counts what it is showing, and says so when it has to stop short', () => {
    expect(at()).toContain('3 of 3 saved');
    const many = Array.from({ length: 250 }, (_, i) => ({ ...rows[0], id: `x${i}` }));
    expect(at({ rows: many })).toContain('Showing the first 200 of 250');
  });

  it('says what an empty case and a dead search each found', () => {
    expect(at({ rows: [] })).toContain('Nothing is saved in this case yet');
    expect(at({ query: 'zzzz' })).toContain('No saved item matches that');
  });
});

describe('SavedSearch has no folder browser', () => {
  it('leaves browsing by folder to the panel, so there is one road to a folder', () => {
    expect(source).not.toContain('FolderBrowser');
    expect(source).not.toContain('folderBrowse');
    expect(source).not.toContain('browsing');
    // the sort is always there now: nothing hides it any more
    expect(at({})).toContain('Distance from map centre');
  });
});

describe('SavedSearch sorting', () => {
  it('orders by newest, by title, and by distance from the map centre', () => {
    expect(sortSaved(rows, 'newest').map((r) => r.id)).toEqual(['p1', 'c1', 's1']);
    expect(sortSaved(rows, 'title').map((r) => r.id)).toEqual(['c1', 'p1', 's1']);
    // near Donetsk: the checkpoint first, Warsaw second, the placeless last
    expect(sortSaved(rows, 'distance', { lat: 48.0, lon: 37.8 }).map((r) => r.id)).toEqual([
      'p1',
      'c1',
      's1',
    ]);
  });

  it('falls back to newest when distance has no origin to measure from', () => {
    expect(sortSaved(rows, 'distance', null).map((r) => r.id)).toEqual(['p1', 'c1', 's1']);
  });
});

describe('SavedSearch wiring', () => {
  it('reads the index already in memory — no fetch, no network', () => {
    expect(source).not.toContain('api.');
    expect(source).not.toContain('fetch(');
  });

  it('is a Modal, so it works over a fullscreen map', () => {
    expect(source).toContain("import Modal from '../../components/Modal.svelte'");
  });
});
