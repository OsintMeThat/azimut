/**
 * Town, village and hamlet names, drawn from OpenFreeMap's vector tiles.
 *
 * Esri's borders name countries, regions and cities, and little under them
 * wherever its own data is thin: a valley in Yemen reads blank at zoom 13 while
 * OpenStreetMap holds a name for every hamlet in it. OpenFreeMap serves that
 * data as OpenMapTiles vector tiles, free, key-less and with no request quota,
 * and this style reads only its `place` layer.
 *
 * The tile paths carry the date of the weekly build and the old build is
 * removed once a new one lands, so the source is the TileJSON that names the
 * current one rather than a template.
 *
 * Cities and anything larger are left to the borders, which already name them:
 * both on at once would draw each city twice. What is drawn is `name:latin`,
 * the name as written when it is Latin and a transliteration otherwise. An
 * Arabic or Cyrillic name would need the engine's right-to-left plugin, and
 * none of it is loaded.
 *
 * The text is drawn by the browser, in the app's own face: with no glyph URL
 * the engine renders each character locally, so switching this on fetches
 * tiles and nothing else. Zooms here are the engine's own, one shallower than
 * the app's.
 */

/** Settlement kinds from largest to smallest, which is also who wins a collision. */
export const PLACE_CLASSES = [
  'town',
  'village',
  'suburb',
  'quarter',
  'hamlet',
  'neighbourhood',
  'isolated_dwelling',
];

const CLASS = ['get', 'class'];

/** The app's sans-serif stack (`--font-sans`), which the engine hands to the browser. */
const FONT = ['ui-sans-serif', 'system-ui', 'sans-serif'];

export const PLACE_NAMES = {
  sources: { openmaptiles: { url: 'https://tiles.openfreemap.org/planet' } },
  maxZoom: 14,
  layers: [
    {
      id: 'label',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['all', ['in', CLASS, ['literal', PLACE_CLASSES]], ['has', 'name:latin']],
      layout: {
        'text-field': ['get', 'name:latin'],
        'text-font': FONT,
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          9,
          ['match', CLASS, 'town', 12, 'village', 11, 10],
          14,
          ['match', CLASS, 'town', 15, 'village', 14, 12],
        ],
        'text-max-width': 8,
        'text-padding': 3,
        // the list's order, then OSM's own rank inside a kind
        'symbol-sort-key': [
          '+',
          ['*', 100, ['index-of', CLASS, ['literal', PLACE_CLASSES]]],
          ['coalesce', ['get', 'rank'], 50],
        ],
      },
      paint: {
        'text-color': ['match', CLASS, ['town', 'village'], '#ffffff', '#e2e2e2'],
        'text-halo-color': 'rgba(0, 0, 0, 0.85)',
        'text-halo-width': 1.4,
        'text-halo-blur': 0.4,
      },
    },
  ],
};
