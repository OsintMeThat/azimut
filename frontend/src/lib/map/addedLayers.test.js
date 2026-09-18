import { describe, expect, it } from 'vitest';
import {
  ACCEPTS,
  attribution,
  categoryColour,
  countLabel,
  counts,
  drawable,
  GROUP_SPACE,
  freshness,
  legend,
  looksLikeUrl,
  PALETTE,
  refreshable,
  searchFeatures,
  SEARCH_LIMIT,
  sourceLabel,
  toggleCategory,
  UNNAMED,
} from './addedLayers.js';

/**
 * What a row says about a layer nobody in this case made.
 *
 * Two of these rules are the feature's whole honesty: the counter never lets the
 * number of drawn marks pass for the number of loaded ones, and a subscription
 * whose snapshot has aged says so on the row rather than after the fact.
 */

const NOW = Date.parse('2026-09-17T12:00:00Z');

const layer = (over = {}) => ({
  name: 'Sightings',
  title: 'Sightings',
  source: { kind: 'file', name: 'sightings.kml' },
  enabled: true,
  hidden: [],
  features: 3200,
  categories: [
    { name: 'Checkpoints', count: 2788, colour: '#ff0000', kinds: ['point'] },
    { name: 'Damage', count: 412, colour: '', kinds: ['area'] },
  ],
  fetched_at: '2026-09-17T10:00:00Z',
  checked_at: '2026-09-17T10:00:00Z',
  stale: false,
  ...over,
});

describe('the counter states both numbers', () => {
  it('counts what is loaded and what is not filtered out', () => {
    expect(counts(layer())).toEqual({ loaded: 3200, visible: 3200 });
    expect(counts(layer({ hidden: ['Damage'] }))).toEqual({ loaded: 3200, visible: 2788 });
  });

  it('never lets the drawn count pass for the loaded one', () => {
    // the whole rule: hiding a group changes what is shown and nothing else
    expect(countLabel(layer({ hidden: ['Checkpoints'] }))).toBe(`3${GROUP_SPACE}200 features · 412 shown`);
  });

  it('says one number when nothing is hidden, because two would be noise', () => {
    expect(countLabel(layer())).toBe(`3${GROUP_SPACE}200 features`);
    expect(countLabel(layer({ features: 1, categories: [] }))).toBe('1 feature');
  });

  it('groups the digits, because five of them run together otherwise', () => {
    expect(countLabel(layer({ features: 41209, categories: [] }))).toBe(`41${GROUP_SPACE}209 features`);
  });

  it('never goes negative on a hidden group the summary no longer holds', () => {
    expect(counts(layer({ hidden: ['Gone'] })).visible).toBe(3200);
  });
});

describe('the legend is the filter', () => {
  it('is one row per category, with its colour and its count', () => {
    expect(legend(layer())).toEqual([
      { name: 'Checkpoints', count: 2788, kinds: ['point'], colour: '#ff0000', on: true },
      { name: 'Damage', count: 412, kinds: ['area'], colour: PALETTE[1], on: true },
    ]);
  });

  it('marks a hidden category off rather than dropping it from the list', () => {
    // it is still there to be switched back on, and still counted as loaded
    expect(legend(layer({ hidden: ['Damage'] })).map((row) => row.on)).toEqual([true, false]);
  });

  it('honours the source colour and falls back to the palette only without one', () => {
    expect(categoryColour({ colour: '#ff0000' }, 3)).toBe('#ff0000');
    expect(categoryColour({ colour: '' }, 0)).toBe(PALETTE[0]);
    // keyed by position within one layer, so two layers' first groups differ
    // from their own second, not from each other
    expect(categoryColour(null, PALETTE.length)).toBe(PALETTE[0]);
  });

  it('toggles exactly one category, leaving the rest as they were', () => {
    expect(toggleCategory(layer(), 'Damage')).toEqual(['Damage']);
    expect(toggleCategory(layer({ hidden: ['Damage', 'Checkpoints'] }), 'Damage')).toEqual([
      'Checkpoints',
    ]);
  });
});

describe('how fresh what is drawn actually is', () => {
  it('says when a subscription was last read', () => {
    expect(freshness(layer({ source: { kind: 'url', url: 'https://x.test/a.kml' } }), NOW)).toBe(
      'read 2 h ago'
    );
  });

  it('says a stale snapshot is stale, which is the point of the readout', () => {
    const stale = layer({
      source: { kind: 'url', url: 'https://x.test/a.kml' },
      checked_at: '2026-09-10T10:00:00Z',
      stale: true,
    });

    expect(freshness(stale, NOW)).toBe('stale — last read 10 Sep 2026');
  });

  it('says a subscription nothing has ever read has never been read', () => {
    const fresh = layer({
      source: { kind: 'url', url: 'https://x.test/a.kml' },
      checked_at: '',
      fetched_at: '',
    });

    expect(freshness(fresh, NOW)).toBe('never read');
  });

  it('never calls a file stale: it is what was opened and it does not move', () => {
    expect(freshness(layer(), NOW)).toBe('opened 2 h ago');
  });
});

describe('where a row says it came from', () => {
  it('names the file, the platform or the host', () => {
    expect(sourceLabel(layer())).toBe('sightings.kml');
    expect(
      sourceLabel(layer({ source: { kind: 'url', url: 'https://www.google.com/maps/d/viewer?mid=x', my_maps: true } }))
    ).toBe('Google My Maps');
    expect(sourceLabel(layer({ source: { kind: 'url', url: 'https://www.example.org/a.kml' } }))).toBe(
      'example.org'
    );
  });

  it('credits the source, as the curated overlays credit theirs', () => {
    expect(attribution(layer())).toBe('Sightings — added by the analyst');
    expect(
      attribution(layer({ source: { kind: 'url', url: 'https://x.test/a.kml', my_maps: true } }))
    ).toBe('Sightings — Google My Maps');
  });
});

describe('what the map draws and what a case open re-reads', () => {
  it('draws the enabled layers and nothing else', () => {
    const rows = [layer(), layer({ name: 'Off', enabled: false })];

    expect(drawable(rows).map((row) => row.name)).toEqual(['Sightings']);
  });

  it('re-reads only a subscription that is enabled and asked to be', () => {
    // the network boundary, stated as data: a file has nothing to read, a
    // disabled layer costs nothing, and a subscription can opt out
    const rows = [
      layer({ name: 'File' }),
      layer({ name: 'Off', enabled: false, source: { kind: 'url', url: 'https://x.test/1' } }),
      layer({
        name: 'Manual',
        source: { kind: 'url', url: 'https://x.test/2' },
        refresh: { on_open: false },
      }),
      layer({ name: 'Followed', source: { kind: 'url', url: 'https://x.test/3' } }),
    ];

    expect(refreshable(rows).map((row) => row.name)).toEqual(['Followed']);
  });
});

describe('finding a pin in somebody else’s map', () => {
  const feature = (name, category, over = {}) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [2, 48] },
    properties: { name, category, colour: '', description: '', ...over },
  });

  const COLLECTION = {
    type: 'FeatureCollection',
    features: [
      feature('North gate', 'Checkpoints', { index: 0, colour: '#ff0000' }),
      feature('South gate', 'Checkpoints', { index: 1 }),
      feature('Gate house', 'Damage', { index: 2 }),
      feature('', 'Damage', { index: 3, description: 'a gate, seen from the east' }),
    ],
  };

  const find = (query, over = {}) =>
    searchFeatures(COLLECTION, query, { categories: layer().categories, ...over });

  it('matches a name however it was typed', () => {
    expect(find('gate').total).toBe(3);
    expect(find('GATE').results.map((hit) => hit.name)).toEqual([
      'North gate',
      'South gate',
      'Gate house',
    ]);
  });

  it('matches a group, so a whole folder can be pulled up by name', () => {
    expect(find('damage').results.map((hit) => hit.index)).toEqual([2, 3]);
  });

  it('wants every term, which is what narrowing a search means', () => {
    expect(find('gate north').results.map((hit) => hit.name)).toEqual(['North gate']);
    expect(find('gate harbour').total).toBe(0);
  });

  it('never reads a description, whatever it holds', () => {
    // the bound this feature is built on: MAX_DESCRIPTION × MAX_FEATURES is not
    // something to walk on a keystroke, and a name is what anyone remembers
    expect(find('seen from the east').total).toBe(0);
    expect(find('gate').results.some((hit) => hit.index === 3)).toBe(false);
  });

  it('finds nothing at all until something is typed', () => {
    expect(find('')).toEqual({ total: 0, results: [] });
    expect(find('   ')).toEqual({ total: 0, results: [] });
  });

  it('names a feature the source never named', () => {
    expect(find('damage').results[1].name).toBe(UNNAMED);
  });

  it('paints a match the colour its own mark is drawn in', () => {
    // the source's own where it painted one…
    expect(find('north').results[0].colour).toBe('#ff0000');
    // …its group's where it did not, and the palette where the group has none
    expect(find('south').results[0].colour).toBe('#ff0000');
    expect(find('gate house').results[0].colour).toBe(PALETTE[1]);
  });

  it('lists a match from a group the legend switched off, and says so', () => {
    const [hit] = find('gate house', { hidden: ['Damage'] }).results;

    expect(hit.hidden).toBe(true);
    expect(find('north', { hidden: ['Damage'] }).results[0].hidden).toBe(false);
  });

  it('counts every match and lists the first few', () => {
    const many = {
      features: Array.from({ length: SEARCH_LIMIT + 12 }, (_, index) =>
        feature(`Gate ${index}`, 'Checkpoints', { index })
      ),
    };

    const found = searchFeatures(many, 'gate');

    // the tally is what tells the analyst to narrow the search; a list that
    // silently stopped at twenty-five would let them read it as all there is
    expect(found.total).toBe(SEARCH_LIMIT + 12);
    expect(found.results).toHaveLength(SEARCH_LIMIT);
  });

  it('carries the number the backend gave a feature, not its own', () => {
    // what going to a match looks the feature up by
    expect(find('gate house').results[0].index).toBe(2);
  });
});

describe('what the + accepts', () => {
  it('tells an address from a file, so the button and the dialog agree', () => {
    expect(looksLikeUrl('https://www.google.com/maps/d/viewer?mid=x')).toBe(true);
    expect(looksLikeUrl('  http://example.org/a.kml  ')).toBe(true);
    expect(looksLikeUrl('sightings.kmz')).toBe(false);
    expect(looksLikeUrl('file:///etc/passwd')).toBe(false);
  });

  it('offers exactly the formats the parser reads', () => {
    expect(ACCEPTS.split(',')).toEqual(['.geojson', '.json', '.kml', '.kmz', '.gpx']);
  });
});
