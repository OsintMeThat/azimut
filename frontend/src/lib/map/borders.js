/**
 * The borders, drawn from OpenFreeMap's vector tiles.
 *
 * Country, region and district lines, and the names of countries, regions and
 * cities standing upright over them. Lines rather than a picture: a region's
 * line reads at every zoom, and on the relief the names stand up instead of
 * lying on the slopes. Towns and smaller stay with the place names.
 *
 * Same tiles as the place names (`placeNames.js`): OpenMapTiles from
 * OpenFreeMap, free, key-less, read through the TileJSON that names the current
 * build. Zooms here are the engine's own, one shallower than the app's.
 */

import { FONT, PLACE_NAMES } from './placeNames.js';

/** The places these borders name, largest first, which is also who wins a collision. */
export const NAMED_CLASSES = ['country', 'state', 'province', 'city'];

const CLASS = ['get', 'class'];
const LEVEL = ['get', 'admin_level'];
// sea borders are lines across the water, read off the coast instead
const ON_LAND = ['!=', ['get', 'maritime'], 1];
const DISPUTED = ['==', ['get', 'disputed'], 1];
const LINE = '#f2efe6';
/** How wide a country line is drawn, by zoom; its dark edge is drawn wider under it. */
const COUNTRY_WIDTH = ['interpolate', ['linear'], ['zoom'], 2, 1, 12, 2.4];

export const BORDER_LINES = {
  sources: { openmaptiles: PLACE_NAMES.sources.openmaptiles },
  maxZoom: PLACE_NAMES.maxZoom,
  layers: [
    {
      id: 'district',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      minzoom: 7,
      filter: ['all', ['in', LEVEL, ['literal', [5, 6]]], ON_LAND],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': LINE,
        'line-opacity': 0.75,
        'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.9, 13, 1.6],
        'line-dasharray': [3, 2],
      },
    },
    {
      // a dark edge under the region line, so it reads over pale ground too
      id: 'region-edge',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['all', ['in', LEVEL, ['literal', [3, 4]]], ON_LAND],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': 'rgba(0, 0, 0, 0.35)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.2, 12, 3.6],
      },
    },
    {
      id: 'region',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['all', ['in', LEVEL, ['literal', [3, 4]]], ON_LAND],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': LINE,
        'line-opacity': 0.9,
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1, 12, 2],
        'line-dasharray': [4, 2],
      },
    },
    {
      id: 'country-edge',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['all', ['==', LEVEL, 2], ON_LAND],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': 'rgba(0, 0, 0, 0.45)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 2.5, 12, 5],
      },
    },
    {
      id: 'country',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['all', ['==', LEVEL, 2], ON_LAND, ['!', DISPUTED]],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': LINE, 'line-width': COUNTRY_WIDTH },
    },
    {
      id: 'disputed',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['all', ['==', LEVEL, 2], ON_LAND, DISPUTED],
      paint: { 'line-color': LINE, 'line-width': COUNTRY_WIDTH, 'line-dasharray': [3, 2] },
    },
    {
      id: 'names',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: [
        'all',
        ['in', CLASS, ['literal', NAMED_CLASSES]],
        ['any', ['has', 'name:en'], ['has', 'name:latin']],
      ],
      layout: {
        // Esri's names are English ones, and the engine joins up no Arabic
        'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name:latin']],
        'text-font': FONT,
        'text-size': [
          'interpolate',
          ['linear'],
          ['zoom'],
          3,
          ['match', CLASS, 'country', 11, 'city', 11, 10],
          10,
          ['match', CLASS, 'country', 14, 'city', 16, 13],
        ],
        'text-transform': ['match', CLASS, 'country', 'uppercase', 'none'],
        'text-letter-spacing': ['match', CLASS, 'country', 0.15, 0],
        'text-max-width': 8,
        'text-padding': 3,
        'symbol-sort-key': [
          '+',
          ['*', 100, ['index-of', CLASS, ['literal', NAMED_CLASSES]]],
          ['coalesce', ['get', 'rank'], 50],
        ],
      },
      paint: {
        'text-color': ['match', CLASS, 'city', '#ffffff', '#ece6d6'],
        'text-halo-color': 'rgba(0, 0, 0, 0.85)',
        'text-halo-width': 1.4,
        'text-halo-blur': 0.4,
      },
    },
  ],
};
