import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import SavedTree from './SavedTree.svelte';

const source = readFileSync(new URL('./SavedTree.svelte', import.meta.url), 'utf8');

const ua = (region) => ({
  state: 'ok',
  country: 'Ukraine',
  country_code: 'ua',
  region,
});

const rows = [
  {
    id: 'p1',
    kind: 'place',
    title: 'checkpoint north',
    lat: 48.0159,
    lon: 37.8029,
    zoom: 18,
    notes: 'two vehicles',
    geo: ua('Donetsk Oblast'),
    continent: 'Europe',
    fetched_at: '2026-07-20T09:12:04Z',
  },
  {
    id: 'c1',
    kind: 'capture',
    title: 'bridge',
    lat: 50.45,
    lon: 30.52,
    zoom: 17,
    provider: 'Esri World Imagery',
    geo: ua('Kyiv Oblast'),
    continent: 'Europe',
    fetched_at: '2026-07-19T09:12:04Z',
    path: 'media/a.png',
    thumbnail: 'media/.thumbs/a.jpg',
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
  render(SavedTree, {
    props: {
      rows,
      caseId: 'case-1',
      coords: (row) => `${row.lat}, ${row.lon}`,
      onopen: noop,
      onedit: noop,
      ondelete: noop,
      onproof: noop,
      onbrowse: noop,
      onlocate: noop,
      oncancelLocate: noop,
      ...props,
    },
  }).body;

describe('SavedTree', () => {
  it('groups located work by region and buckets the rest under Unlocated', () => {
    const body = at();

    expect(body).toContain('Donetsk Oblast');
    expect(body).toContain('Kyiv Oblast');
    expect(body).toContain('Unlocated');
  });

  it('labels a branch in English with the native name beside it', () => {
    const native = rows.map((r) =>
      r.geo.state === 'ok'
        ? {
            ...r,
            country_en: 'Russia',
            geo: {
              ...r.geo,
              country: 'Россия',
              country_code: 'ru',
              region: 'Московская область',
              region_en: 'Moscow Oblast',
            },
          }
        : r
    );

    expect(at({ rows: native })).toContain('Moscow Oblast (Московская область)');
  });

  it('filters by kind, with screenshots counted as captures', () => {
    expect(at()).toContain('Places');
    expect(at({ kind: 'places', query: 'a' })).toContain('checkpoint north');
    expect(at({ kind: 'places', query: 'a' })).not.toContain('bridge');
    // a screenshot rides the Captures position rather than getting its own
    const captures = at({ kind: 'captures', query: 'a' });
    expect(captures).toContain('bridge');
    expect(captures).toContain('yandex view');
    expect(captures).not.toContain('checkpoint north');
  });

  it('marks a capture a proof was built on rather than drawing a second point', () => {
    // a proof sits on its capture's coordinates, so a second mark there would
    // read as two places
    const worked = rows.map((r) => (r.id === 'c1' ? { ...r, proofs: 2 } : r));

    expect(at({ rows: worked, query: 'bridge' })).toContain('2 proofs built here');
    expect(at({ query: 'bridge' })).not.toContain('built here');
  });

  it('does not offer Locate on proofs, which the pass cannot resolve', () => {
    // Locate walks saved entities; a proof borrows or states its point, so the
    // button would run and change nothing
    const unplaced = { ...rows[0], id: 'pr1', key: 'pr1@x', kind: 'proof', geo: null };

    expect(at({ rows: [unplaced], kind: 'proofs' })).not.toContain('Locate');
    expect(at({ rows: [unplaced], kind: 'all' })).toContain('Locate');
  });

  it('groups proofs by folder too, since a proof is filed like anything else', () => {
    const proof = {
      id: 'pr1',
      key: 'pr1@50.45,30.52',
      kind: 'proof',
      name: 'kyiv-bridge',
      title: 'Kyiv bridge',
      lat: 50.45,
      lon: 30.52,
      geo: ua('Kyiv Oblast'),
      continent: 'Europe',
      fetched_at: '2026-07-21T09:12:04Z',
      posts: 0,
    };
    const body = at({ rows: [proof], kind: 'proofs', query: 'kyiv' });

    expect(body).toContain('Kyiv bridge');
    expect(body).toContain('Kyiv Oblast');
    // and the folder grouping works there like anywhere else
    expect(body).toContain('Group by My-work folder');
    expect(body).not.toContain('disabled=""');

    const filed = at({
      rows: [{ ...proof, folder: 'recon/bridges' }],
      kind: 'proofs',
      group: 'folders',
      folders: ['recon', 'recon/bridges'],
      query: 'kyiv',
    });
    expect(filed).toContain('bridges');
  });

  it('opens every branch while a search is running', () => {
    // a filter that hides its own matches behind chevrons is no filter
    expect(at({ query: 'bridge' })).toContain('bridge');
    expect(at()).not.toContain('bridge');
  });

  it('offers Locate only when something is still resolvable', () => {
    // nocoords and nocountry are settled — asking again would waste a lookup
    expect(at()).not.toContain('Locate');
    expect(at({ rows: [...rows, { ...rows[0], id: 'p2', geo: null }] })).toContain('Locate');
    expect(at({ rows: [...rows, { ...rows[0], id: 'p2', geo: { state: 'failed' } }] })).toContain(
      'Locate'
    );
  });

  it('reports progress and offers a way out while a pass runs', () => {
    const body = at({ locating: { done: 12, total: 134 }, rows: [...rows, { ...rows[0], id: 'p2', geo: null }] });

    expect(body).toContain('12');
    expect(body).toContain('134');
    expect(body).toContain('Cancel');
    expect(body).not.toContain('Locate');
  });

  it('gives a screenshot the link back to the site it came from', () => {
    const body = at({ query: 'yandex' });

    expect(body).toContain('https://yandex.com/maps/?ll=1,2');
  });

  it('says what an empty panel is empty of, and what a dead search found', () => {
    expect(at({ rows: [] })).toContain('Save a place or capture a crop');
    expect(at({ query: 'zzzz' })).toContain('Nothing saved matches that');
  });
});

describe('SavedTree wiring', () => {
  it('keeps the filter in view while the tree scrolls', () => {
    const controls = source.slice(source.indexOf('.controls {'), source.indexOf('.head {'));

    expect(controls).toContain('position: sticky');
    expect(controls).toContain('top: 0');
  });

  it('shares the search input and the term matcher the other pickers use', () => {
    expect(source).toContain("import SearchInput from '../../components/SearchInput.svelte'");
    expect(source).toContain("from '../../lib/geoTree.js'");
  });
});

describe('SavedTree folder view', () => {
  const filed = [
    { ...rows[0], folder: 'recon' },
    { ...rows[1], folder: 'recon/bridges' },
    { ...rows[2] }, // never filed
  ];
  const inFolders = (props = {}) =>
    at({ rows: filed, group: 'folders', folders: ['recon', 'recon/bridges', 'imagery'], ...props });

  it('offers both groupings, geography first', () => {
    const body = at();
    expect(body).toContain('Group by place');
    expect(body).toContain('Group by My-work folder');
  });

  it('groups by folder, and keeps the unfiled ones in their own bucket', () => {
    const body = inFolders();

    expect(body).toContain('recon');
    expect(body).toContain('Unfiled');
    expect(body).not.toContain('Donetsk Oblast'); // the geography tree is gone
    expect(body).not.toContain('Unlocated');
  });

  it("shows the case's empty folders, so anything can be dropped into them", () => {
    expect(inFolders()).toContain('imagery');
  });

  it('renders a folder that holds both subfolders and items', () => {
    // a search opens every branch, which is how the items become visible here
    const body = inFolders({ query: 'e' });

    expect(body).toContain('bridges');
    expect(body).toContain('checkpoint north'); // filed in recon itself
    expect(body).toContain('bridge'); // filed one level down
  });

  it('makes rows draggable in the folder view only', () => {
    expect(inFolders({ query: 'e' })).toContain('draggable="true"');
    expect(at({ rows: filed, query: 'e' })).not.toContain('draggable="true"');
  });

  it('offers no Locate errand in the folder view', () => {
    expect(inFolders()).not.toContain('Locate');
  });

  it('files a dropped row through onmove, and unfiles it on the Unfiled bucket', () => {
    expect(source).toContain('onmove?.(row, folder)');
    expect(source).toContain('ondrop={byFolder ? (event) => drop(event, node.key) : undefined}');
    expect(source).toContain("ondrop={byFolder ? (event) => drop(event, '') : undefined}");
    // dropping an item back where it already is costs no request
    expect(source).toContain("if (row && (row.folder || '') !== folder) onmove?.(row, folder)");
  });

  it('never files anything itself — the parent owns the request', () => {
    expect(source).not.toContain('api.');
    expect(source).not.toContain('assignFolder');
  });
});

describe('accepting a proposed point', () => {
  const proposed = [
    {
      id: 'p9',
      kind: 'place',
      title: 'roof match',
      lat: 48.8584,
      lon: 2.2945,
      status: 'suggested',
      geo: { state: 'ok', country: 'France', country_code: 'fr' },
      continent: 'Europe',
      fetched_at: '2026-07-20T09:12:04Z',
    },
  ];

  it('offers it on the row, where the map that decides is already open', () => {
    const body = at({ rows: proposed, query: 'roof', onaccept: noop });
    expect(body).toContain('Accept this point');
    expect(body).toContain('suggested');
  });

  it('stays off a point nobody proposed', () => {
    const settled = [{ ...proposed[0], status: 'confirmed' }];
    expect(at({ rows: settled, query: 'roof', onaccept: noop })).not.toContain(
      'Accept this point'
    );
  });

  it('stays off where a surface cannot reload after the change', () => {
    expect(at({ rows: proposed, query: 'roof' })).not.toContain('Accept this point');
  });
});
