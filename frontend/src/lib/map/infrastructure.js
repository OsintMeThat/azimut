/**
 * Power lines, towers and substations, with pipelines and telecom masts, drawn
 * from Open Infrastructure Map's vector tiles.
 *
 * Pylons and the lines strung between them are among the steadiest clues in a
 * photograph: a line's route survives decades of imagery, and its voltage
 * shows in the size of the towers. OSM maps them in detail, and Open
 * Infrastructure Map serves that as vector tiles (data ODbL, analysis CC-BY),
 * which is what this style reads.
 *
 * The style is ours and deliberately small: lines coloured by voltage on Open
 * Infrastructure Map's own scale, so a reader who knows that map reads this one,
 * then towers, substations, plants, pipelines and masts. No labels, because
 * the engine loads no glyphs (`engine.js` asks the network for tiles and
 * nothing else). Zooms here are the engine's own, one shallower than the app's.
 */

const TILES = 'https://openinframap.org/map';

const VOLTAGE = ['to-number', ['coalesce', ['get', 'voltage'], 0]];

/** Open Infrastructure Map's voltage scale, in kV. */
export const VOLTAGE_COLOUR = [
  'step',
  VOLTAGE,
  '#7A7A85',
  10,
  '#6E97B8',
  25,
  '#55B555',
  52,
  '#B59F10',
  132,
  '#B55D00',
  220,
  '#C73030',
  310,
  '#B54EB2',
  550,
  '#00C1CF',
];

/** A line drawn in the air, which is the only kind a satellite picture shows. */
const OVERHEAD = [
  'all',
  ['!', ['in', ['get', 'location'], ['literal', ['underground', 'underwater']]]],
  ['!=', ['get', 'tunnel'], true],
];

export const INFRASTRUCTURE = {
  sources: {
    power: `${TILES}/power/{z}/{x}/{y}.pbf`,
    telecoms: `${TILES}/telecoms/{z}/{x}/{y}.pbf`,
    petroleum: `${TILES}/petroleum/{z}/{x}/{y}.pbf`,
  },
  maxZoom: 17,
  layers: [
    {
      id: 'pipeline',
      type: 'line',
      source: 'petroleum',
      'source-layer': 'petroleum_pipeline',
      minzoom: 6,
      paint: {
        'line-color': '#B37D3C',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 14, 2],
        'line-dasharray': [3, 2],
      },
    },
    {
      id: 'plant-area',
      type: 'fill',
      source: 'power',
      'source-layer': 'power_plant',
      minzoom: 8,
      paint: { 'fill-color': '#B59F10', 'fill-opacity': 0.18 },
    },
    {
      id: 'substation-area',
      type: 'fill',
      source: 'power',
      'source-layer': 'power_substation',
      minzoom: 12,
      paint: { 'fill-color': VOLTAGE_COLOUR, 'fill-opacity': 0.22 },
    },
    {
      id: 'line-buried',
      type: 'line',
      source: 'power',
      'source-layer': 'power_line',
      minzoom: 11,
      filter: ['!', OVERHEAD],
      paint: {
        'line-color': VOLTAGE_COLOUR,
        'line-width': 1,
        'line-opacity': 0.6,
        'line-dasharray': [2, 2],
      },
    },
    {
      id: 'line-minor',
      type: 'line',
      source: 'power',
      'source-layer': 'power_line',
      minzoom: 9,
      filter: ['all', OVERHEAD, ['<', VOLTAGE, 100]],
      paint: {
        'line-color': VOLTAGE_COLOUR,
        'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.6, 16, 2.2],
      },
    },
    {
      id: 'line-major',
      type: 'line',
      source: 'power',
      'source-layer': 'power_line',
      minzoom: 3,
      filter: ['all', OVERHEAD, ['>=', VOLTAGE, 100]],
      paint: {
        'line-color': VOLTAGE_COLOUR,
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 10, 1.6, 16, 3.4],
      },
    },
    {
      id: 'substation',
      type: 'circle',
      source: 'power',
      'source-layer': 'power_substation_point',
      minzoom: 8,
      // past this the substation is drawn as its own outline instead
      maxzoom: 12,
      paint: {
        'circle-color': VOLTAGE_COLOUR,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 1.5, 12, 3.5],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 0.6,
      },
    },
    {
      id: 'plant',
      type: 'circle',
      source: 'power',
      'source-layer': 'power_plant_point',
      minzoom: 5,
      maxzoom: 11,
      paint: {
        'circle-color': '#E0B040',
        'circle-radius': 3,
        'circle-stroke-color': '#1b1b1b',
        'circle-stroke-width': 0.8,
      },
    },
    {
      id: 'tower',
      type: 'circle',
      source: 'power',
      'source-layer': 'power_tower',
      minzoom: 13,
      paint: {
        'circle-color': '#C9CDD2',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 1.4, 18, 4],
        'circle-stroke-color': '#1b1b1b',
        'circle-stroke-width': 0.8,
      },
    },
    {
      id: 'mast',
      type: 'circle',
      source: 'telecoms',
      'source-layer': 'telecoms_mast',
      minzoom: 11,
      paint: {
        'circle-color': '#7EC8E3',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.6, 17, 4],
        'circle-stroke-color': '#0B2A36',
        'circle-stroke-width': 0.8,
      },
    },
  ],
};
