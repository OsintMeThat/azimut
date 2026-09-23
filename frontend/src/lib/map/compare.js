/** Pure parts of the two-surface imagery comparison tool. */

/**
 * How the pair is shown at the camera you are on. Difference is not one of
 * them: it is a layer of highlights laid over whichever of these is on.
 */
export const COMPARE_MODES = Object.freeze([
  { id: 'side', label: 'Side by side', short: 'Side', icon: 'columns', key: '1' },
  { id: 'swipe', label: 'Swipe', short: 'Swipe', icon: 'swipe', key: '2' },
  { id: 'opacity', label: 'Fade', short: 'Fade', icon: 'fade', key: '3' },
  { id: 'blink', label: 'Blink', short: 'Blink', icon: 'blink', key: '4' },
]);

export const DIFFERENCE_KEY = '5';

/** A saved view mode, with the one that used to be Difference read as side by side. */
export function compareMode(value) {
  return COMPARE_MODES.some((entry) => entry.id === value) ? value : 'side';
}

export const DEFAULT_DIVIDER = 50;
export const DEFAULT_OPACITY = 50;
export const DEFAULT_BLINK_INTERVAL = 800;
export const BLINK_SPEEDS = Object.freeze([
  { id: 400, label: 'Fast' },
  { id: 800, label: 'Normal' },
  { id: 1600, label: 'Slow' },
]);

/** Reference layers Compare can persist, grouped the way the sheet lists them. */
export const COMPARE_LAYERS = Object.freeze([
  { id: 'labels', label: 'Labels', hint: 'Roads and place names', group: 'reference' },
  { id: 'boundaries', label: 'Borders', hint: 'Country, region and district borders', group: 'reference' },
  { id: 'roads', label: 'Roads', hint: 'Road network', group: 'reference' },
  { id: 'railway', label: 'Railways', hint: 'Tracks, sidings and stations', group: 'reference' },
  { id: 'power', label: 'Power lines', hint: 'Lines, towers and substations', group: 'reference' },
  { id: 'seamarks', label: 'Sea marks', hint: 'Buoys, lights, harbours and fairways', group: 'reference' },
  { id: 'gpstraces', label: 'GPS traces', hint: 'Raw GPS tracks from OpenStreetMap', group: 'reference' },
  { id: 'firms', label: 'Active fires', hint: 'Thermal detections from NASA FIRMS', group: 'events' },
  { id: 'nightlights', label: 'Night lights', hint: 'The ground at night from NASA VIIRS', group: 'events' },
  { id: 'saved', label: 'Saved work', hint: 'Places and captures in this case', group: 'case' },
]);

export const LAYER_GROUPS = Object.freeze([
  { id: 'reference', label: 'Reference' },
  { id: 'events', label: 'Dated observations' },
  { id: 'case', label: 'This case' },
]);

const LAYER_IDS = new Set(COMPARE_LAYERS.map((layer) => layer.id));

/** Keep a session's layer list ordered, unique and supported. */
export function comparisonLayers(value) {
  const asked = new Set(Array.isArray(value) ? value.filter((id) => LAYER_IDS.has(id)) : []);
  return COMPARE_LAYERS.map((layer) => layer.id).filter((id) => asked.has(id));
}

/** A range value that is safe to use as a percentage in CSS. */
export function percentage(value, fallback = 50) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(100, Math.max(0, Math.round(number)));
}

/** How a provider is offered in the picker: imagery, a dated archive, or a map. */
export function providerKind(provider) {
  if (['esri-wayback', 'sentinel2', 'sentinel1'].includes(provider?.id)) return 'archive';
  return provider?.imagery === false ? 'map' : 'imagery';
}

export const PROVIDER_KINDS = Object.freeze([
  { id: 'archive', label: 'Dated archives', hint: 'Pick the date of each side' },
  { id: 'imagery', label: 'Current imagery' },
  { id: 'map', label: 'Maps' },
]);

/**
 * Two-sided starting points. Each names the providers it needs, so one whose
 * provider is missing or keyless is simply not offered.
 */
export const COMPARE_PRESETS = Object.freeze([
  {
    id: 'archive',
    label: 'Then and now',
    hint: 'An Esri Wayback release against today’s World Imagery',
    a: 'esri-wayback',
    b: 'esri-world-imagery',
  },
  {
    id: 'sentinel',
    label: 'Two satellite passes',
    hint: 'Sentinel-2 on both sides, each on its own day',
    a: 'sentinel2',
    b: 'sentinel2',
  },
  {
    id: 'radar',
    label: 'Two radar passes',
    hint: 'Sentinel-1 on both sides, through cloud and at night',
    a: 'sentinel1',
    b: 'sentinel1',
  },
  {
    id: 'map',
    label: 'Imagery and map',
    hint: 'World Imagery beside OpenStreetMap',
    a: 'esri-world-imagery',
    b: 'osm',
  },
]);

/** What Compare opens on: an archive against today, both key-less. */
export const DEFAULT_PRESET = 'archive';

/** The presets this catalogue can actually start. */
export function availablePresets(providers) {
  const usable = new Set(
    (providers ?? []).filter((provider) => !provider.needs_key).map((provider) => provider.id)
  );
  return COMPARE_PRESETS.filter((preset) => usable.has(preset.a) && usable.has(preset.b));
}
