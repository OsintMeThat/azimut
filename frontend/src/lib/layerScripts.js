/**
 * Scripts written from a form instead of by hand.
 *
 * Copernicus Browser has three ways to make a layer and so does this: three
 * bands on red, green and blue; one normalised difference on a colour ramp; or
 * JavaScript. The first two are the ones people actually reach for, and neither
 * is worth typing out — but both produce a script, not a special kind of layer,
 * so everything downstream stays one idea. The generated text is the text the
 * editor shows, so switching to Custom script hands over something readable
 * that can then be taken anywhere.
 *
 * `evaluatePixel` always returns `dataMask` as the fourth channel: where the
 * pass has no pixels the tile must be transparent, so a hole reads as a hole
 * rather than as black ground.
 */

/** The gain a reflectance band needs to fill a channel. Copernicus's own
 *  examples use 2.5, and so does every composite in their gallery. */
export const DEFAULT_GAIN = 2.5;

/**
 * What each Sentinel-2 L2A band sees, and at what wavelength.
 *
 * "B12" says nothing about why you would pick it; "SWIR 2 · 2.19 µm" does, and
 * it is also how a figure's caption names it ("B11 hotspot 1.61 µm"). Central
 * wavelengths are Sentinel-2A's. B10 is absent because the atmospheric
 * correction consumes it and Level-2A does not carry it.
 */
export const BANDS = Object.freeze({
  B01: { label: 'Coastal aerosol', um: 0.443 },
  B02: { label: 'Blue', um: 0.49 },
  B03: { label: 'Green', um: 0.56 },
  B04: { label: 'Red', um: 0.665 },
  B05: { label: 'Red edge 1', um: 0.705 },
  B06: { label: 'Red edge 2', um: 0.74 },
  B07: { label: 'Red edge 3', um: 0.783 },
  B08: { label: 'Near infrared', um: 0.842 },
  B8A: { label: 'Near infrared, narrow', um: 0.865 },
  B09: { label: 'Water vapour', um: 0.945 },
  B11: { label: 'Short-wave infrared 1', um: 1.61 },
  B12: { label: 'Short-wave infrared 2', um: 2.19 },
});

/** A band as a picker row reads it: "B12 · SWIR 2 · 2.19 µm". */
export function bandLabel(id) {
  const known = BANDS[id];
  return known ? `${id} · ${known.label} · ${known.um} µm` : id;
}

/** The same, short enough for a readout beside a slider. */
export function bandShort(id) {
  const known = BANDS[id];
  return known ? `${id} · ${known.um} µm` : id;
}

/** Colour ramps, as value→RGB stops over a normalised difference (−1…1). */
export const RAMPS = Object.freeze([
  {
    id: 'grey',
    label: 'Greyscale',
    stops: [[-1, [0, 0, 0]], [1, [1, 1, 1]]],
  },
  {
    id: 'vegetation',
    label: 'Vegetation',
    stops: [
      [-0.2, [0.05, 0.05, 0.05]],
      [0, [0.75, 0.72, 0.68]],
      [0.3, [0.9, 0.85, 0.3]],
      [0.6, [0.2, 0.6, 0.2]],
      [0.9, [0, 0.27, 0]],
    ],
  },
  {
    id: 'water',
    label: 'Water',
    stops: [
      [-0.5, [0.72, 0.66, 0.52]],
      [0, [0.85, 0.82, 0.72]],
      [0.2, [0.4, 0.68, 0.84]],
      [0.6, [0.1, 0.33, 0.68]],
      [1, [0.02, 0.1, 0.35]],
    ],
  },
  {
    id: 'heat',
    label: 'Heat',
    stops: [
      [-0.2, [0.02, 0.02, 0.06]],
      [0.1, [0.4, 0.05, 0.3]],
      [0.4, [0.85, 0.2, 0.1]],
      [0.7, [0.98, 0.72, 0.1]],
      [1, [1, 1, 0.85]],
    ],
  },
  {
    id: 'divergent',
    label: 'Loss to gain',
    stops: [
      [-1, [0.7, 0.1, 0.1]],
      [-0.1, [0.92, 0.6, 0.5]],
      [0, [0.96, 0.96, 0.96]],
      [0.1, [0.5, 0.75, 0.55]],
      [1, [0.05, 0.4, 0.15]],
    ],
  },
]);

export function ramp(id) {
  return RAMPS.find((entry) => entry.id === id) ?? RAMPS[0];
}

/**
 * A ramp as a CSS gradient, so the form can show the colours instead of naming
 * them. The stops run over −1…1, which is where a normalised difference lives,
 * and the bar is drawn across that whole range so two ramps can be compared.
 */
export function rampGradient(id) {
  const stops = ramp(id).stops;
  const at = (value) => Math.round(((Number(value) + 1) / 2) * 1000) / 10;
  const parts = stops.map(
    ([value, [r, g, b]]) =>
      `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)}) ${at(value)}%`
  );
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

/** The bands a script asks for, each once, with the nodata mask last. */
function inputs(bands) {
  return [...new Set(bands.filter(Boolean)), 'dataMask'].map((band) => `"${band}"`).join(', ');
}

/** A number as JavaScript, without a float's trailing noise. */
function num(value) {
  return String(Math.round(Number(value) * 1000) / 1000);
}

/**
 * Three bands as colour.
 *
 * @param {{red: string, green: string, blue: string, gain?: number}} choice
 */
export function compositeScript({ red, green, blue, gain = DEFAULT_GAIN } = {}) {
  const bands = [red, green, blue];
  const factor = num(gain);
  const channels = bands.map((band) => `${factor} * p.${band}`).join(', ');
  const same = new Set(bands).size === 1;
  return `//VERSION=3
// ${same ? `${red} alone, as grey` : `${red} → red, ${green} → green, ${blue} → blue`}.
// Gain ${factor}: reflectance is 0…1 and a channel needs filling.
function setup() {
  return {
    input: [${inputs(bands)}],
    output: { bands: 4 },
  };
}
function evaluatePixel(p) {
  // dataMask last: no pass here has to read as a hole, not as black ground
  return [${channels}, p.dataMask];
}
`;
}

/**
 * One normalised difference on a colour ramp.
 *
 * @param {{high: string, low: string, rampId?: string, threshold?: number|null}} choice
 *   `threshold` darkens everything at or below it, which is how a hotspot or a
 *   burn is read off a ramp without guessing where the colour changes.
 */
export function indexScript({ high, low, rampId = 'grey', threshold = null } = {}) {
  const chosen = ramp(rampId);
  const stops = chosen.stops
    .map(([at, [r, g, b]]) => `  [${num(at)}, [${num(r)}, ${num(g)}, ${num(b)}]],`)
    .join('\n');
  const cut = threshold === null || threshold === undefined || threshold === '' ? null : num(threshold);
  return `//VERSION=3
// (${high} − ${low}) / (${high} + ${low}), on the ${chosen.label.toLowerCase()} ramp.
${cut === null ? '' : `// Everything at or below ${cut} is left dark.\n`}function setup() {
  return {
    input: [${inputs([high, low])}],
    output: { bands: 4 },
  };
}
const stops = [
${stops}
];
// The colour of the last stop this value has reached.
function colour(value) {
  let found = stops[0][1];
  for (const [at, rgb] of stops) if (value >= at) found = rgb;
  return found;
}
function evaluatePixel(p) {
  const sum = p.${high} + p.${low};
  const index = sum === 0 ? 0 : (p.${high} - p.${low}) / sum;
${cut === null ? '' : `  if (index <= ${cut}) return [0.04, 0.04, 0.04, p.dataMask];\n`}  const [r, g, b] = colour(index);
  return [r, g, b, p.dataMask];
}
`;
}

/**
 * The visible bands averaged, as grey.
 *
 * What a `brightness` rule measures, drawn. Its own generator rather than a
 * composite of the three, because a composite puts each band on its own channel
 * — which is true colour, not the one number the rule reads.
 */
export function brightnessScript({ gain = DEFAULT_GAIN } = {}) {
  const factor = num(gain);
  return `//VERSION=3
// B02, B03 and B04 averaged, as grey.
// Gain ${factor}: reflectance is 0…1 and a channel needs filling.
function setup() {
  return {
    input: [${inputs(['B02', 'B03', 'B04'])}],
    output: { bands: 4 },
  };
}
function evaluatePixel(p) {
  const mean = (p.B02 + p.B03 + p.B04) / 3;
  // dataMask last: no pass here has to read as a hole, not as black ground
  return [${factor} * mean, ${factor} * mean, ${factor} * mean, p.dataMask];
}
`;
}

/** The three ways to make one, in the order Copernicus Browser offers them. */
export const WAYS = Object.freeze([
  {
    id: 'composite',
    label: 'Composite',
    hint: 'Put three bands on red, green and blue, like a false-colour image',
  },
  {
    id: 'index',
    label: 'Index',
    hint: 'Measure one difference between two bands and colour it',
  },
  {
    id: 'script',
    label: 'Custom script',
    hint: 'Write the evalscript yourself, or edit what the forms wrote',
  },
]);

/**
 * Composites worth starting from, as the figures people publish use them.
 * Offered as presses rather than defaults: the form opens on the first.
 */
export const COMPOSITE_PRESETS = Object.freeze([
  { id: 'swir', label: 'SWIR', hint: 'Hot ground and burn scars', bands: ['B12', 'B11', 'B04'] },
  { id: 'natural', label: 'Natural', hint: 'What the eye would see', bands: ['B04', 'B03', 'B02'] },
  { id: 'infrared', label: 'Infrared', hint: 'Vegetation in red', bands: ['B08', 'B04', 'B03'] },
  { id: 'agriculture', label: 'Agriculture', hint: 'Crop vigour and bare soil', bands: ['B11', 'B08', 'B02'] },
]);

/**
 * Indices worth starting from: the named ones Detect already measures, so the
 * two tools read the same arithmetic off the same pairs.
 */
export const INDEX_PRESETS = Object.freeze([
  { id: 'ndvi', label: 'NDVI', hint: 'Vegetation', high: 'B08', low: 'B04', rampId: 'vegetation' },
  { id: 'ndwi', label: 'NDWI', hint: 'Open water', high: 'B03', low: 'B08', rampId: 'water' },
  { id: 'nbr', label: 'NBR', hint: 'Burn severity', high: 'B08', low: 'B12', rampId: 'heat' },
  { id: 'ndbi', label: 'NDBI', hint: 'Built-up ground', high: 'B11', low: 'B08', rampId: 'grey' },
]);

/** The script a form's state says, for whichever way is open. */
export function scriptFor(way, choice) {
  if (way === 'composite') return compositeScript(choice.composite);
  if (way === 'index') return indexScript(choice.index);
  return choice.script;
}
