/**
 * Analyzers of your own: a list of rules, read the way the engine reads them
 * (engine/detect_rules.py). A rule is a quantity, the date it is read on (A,
 * B, or the change from A to B) and the line it has to cross. Values travel in
 * the engine's units: an index from -1 to 1, reflectance from 0 to 1, radar in
 * decibels. Only the words and the sliders here show reflectance in percent.
 */
import { CHANGE_INDICES, indexThreshold } from './changeAssist.js';

export const MEASURES = Object.freeze([
  { id: 'index', label: 'Index', hint: 'A published spectral index.' },
  { id: 'nd', label: 'My index', hint: 'Two bands of your choice: (first − second) / (first + second).' },
  { id: 'band', label: 'Band', hint: 'One band’s reflectance.' },
  { id: 'brightness', label: 'Brightness', hint: 'The visible bands, averaged.' },
  { id: 'colour', label: 'Colour change', hint: 'How far the visible bands moved together.' },
  { id: 'class', label: 'Ground class', hint: 'Sentinel-2’s own classification of the ground.' },
  { id: 'radar', label: 'Radar', hint: 'Sentinel-1 backscatter, through cloud and at night.' },
]);

export const INDICES = CHANGE_INDICES;

export const BAND_NAMES = Object.freeze({
  B01: 'coastal', B02: 'blue', B03: 'green', B04: 'red', B05: 'red edge 1', B06: 'red edge 2',
  B07: 'red edge 3', B08: 'near infrared', B8A: 'narrow near infrared', B09: 'water vapour',
  B11: 'short-wave 1.6 µm', B12: 'short-wave 2.2 µm',
});

/** Normalised differences worth a name, offered as a start for My index. */
export const PAIRS = Object.freeze([
  { id: 'ndmi', label: 'NDMI', hint: 'Moisture', bands: ['B8A', 'B11'] },
  { id: 'ndsi', label: 'NDSI', hint: 'Snow', bands: ['B03', 'B11'] },
  { id: 'ndre', label: 'NDRE', hint: 'Red edge', bands: ['B8A', 'B05'] },
  { id: 'nbr2', label: 'NBR2', hint: 'Burns and dry soil', bands: ['B11', 'B12'] },
  { id: 'gndvi', label: 'GNDVI', hint: 'Chlorophyll', bands: ['B08', 'B03'] },
]);

export const CLASS_NAMES = Object.freeze({
  vegetation: 'vegetation', bare: 'bare ground', water: 'water', snow: 'snow or ice',
  cloud: 'cloud', shadow: 'cloud shadow', dark: 'dark ground',
});

export const POLARISATIONS = Object.freeze([
  { id: 'vv', label: 'VV' }, { id: 'vh', label: 'VH' }, { id: 'ratio', label: 'VV − VH' },
]);

/** One colour a rule, on its row and on the map, in order. */
export const RULE_COLOURS = Object.freeze(['#facc15', '#38bdf8', '#f472b6', '#a3e635', '#fb923c', '#c084fc']);

/** The engine's own lists, for when a catalogue does not carry them. */
export const L2A_BANDS = Object.freeze(['B01', 'B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B8A', 'B09', 'B11', 'B12']);
const SPECTRAL_BANDS = Object.freeze({
  ndvi: ['B08', 'B04'], ndwi: ['B03', 'B08'], mndwi: ['B03', 'B11'], nbr: ['B08', 'B12'],
  ndbi: ['B11', 'B08'], bsi: ['B11', 'B04', 'B08', 'B02'],
});
const VISIBLE = ['B02', 'B03', 'B04'];
/** Bits of the preview mask past the rules' own. */
export const MEASURED_BIT = 6;
export const KEPT_BIT = 7;

/** Which scale a rule's value lives on. */
export function unitOf(rule) {
  if (rule.measure === 'class') return 'class';
  if (rule.measure === 'radar') return 'db';
  if (['band', 'brightness', 'colour'].includes(rule.measure)) return 'reflectance';
  return 'index';
}

/** Ops a rule can use, given what it measures and when. */
export function opsFor(rule) {
  if (rule.measure === 'class') return [['is', 'is'], ['not', 'is not']];
  if (rule.measure === 'colour') return [['ge', 'at least'], ['le', 'at most'], ['between', 'between']];
  const ops = [['ge', 'at least'], ['le', 'at most'], ['between', 'between']];
  return rule.on === 'change' ? [...ops, ['moved', 'either way, at least']] : ops;
}

/**
 * The slider a rule's value moves on, in the units shown: reflectance in
 * percent, the rest as they are. `factor` turns an engine value into a shown one.
 */
export function scaleOf(rule) {
  const unit = unitOf(rule);
  const magnitude = rule.op === 'moved' || rule.measure === 'colour';
  const change = rule.on === 'change' || rule.around > 0;
  if (unit === 'reflectance') {
    return { factor: 100, suffix: '%', step: 0.5,
      min: magnitude ? 0 : change ? -50 : 0, max: magnitude ? 50 : change ? 50 : 100 };
  }
  if (unit === 'db') {
    if (magnitude) return { factor: 1, suffix: ' dB', step: 0.5, min: 0, max: 20 };
    if (change) return { factor: 1, suffix: ' dB', step: 0.5, min: -20, max: 20 };
    return rule.polarisation === 'ratio'
      ? { factor: 1, suffix: ' dB', step: 0.5, min: -5, max: 25 }
      : { factor: 1, suffix: ' dB', step: 0.5, min: -35, max: 15 };
  }
  if (magnitude) return { factor: 1, suffix: '', step: 0.01, min: 0, max: 1 };
  return { factor: 1, suffix: '', step: 0.01, min: -1, max: 1 };
}

/** A value as the builder shows it, signed where the rule reads a change. */
export function formatValue(rule, value, { signed = false } = {}) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '–';
  const { factor, suffix } = scaleOf(rule);
  const shown = Number(value) * factor;
  const digits = unitOf(rule) === 'index' ? 2 : 1;
  const text = Math.abs(shown).toFixed(digits);
  const sign = shown < 0 ? '−' : signed && shown > 0 ? '+' : '';
  return `${sign}${text}${suffix}`;
}

/** A shown value (percent for reflectance) back to the engine's units. */
export function toEngine(rule, shown) {
  const { factor } = scaleOf(rule);
  return Number((Number(shown) / factor).toFixed(6));
}

// Where a new rule starts: the published marks where there are some, so the
// first preview already means something. A change reads B minus A.
const INDEX_LINES = {
  ndvi: { change: ['le', -0.25], state: ['ge', 0.4] },
  nbr: { change: ['le', -0.27], state: ['le', 0.1] },
  ndwi: { change: ['ge', 0.25], state: ['ge', 0] },
  mndwi: { change: ['ge', 0.25], state: ['ge', 0] },
  ndbi: { change: ['ge', 0.1], state: ['ge', 0] },
  bsi: { change: ['ge', 0.1], state: ['ge', 0] },
};

function line(rule) {
  const change = rule.on === 'change';
  switch (rule.measure) {
    case 'index': return INDEX_LINES[rule.index][change ? 'change' : 'state'];
    case 'nd': return change ? ['le', -0.2] : ['ge', 0];
    case 'band': return change ? ['moved', 0.05] : ['ge', 0.25];
    case 'brightness': return change ? ['moved', 0.05] : ['ge', 0.2];
    case 'colour': return ['ge', 0.05];
    case 'class': return ['is', 0];
    case 'radar':
      if (change) return ['moved', 3];
      return rule.polarisation === 'ratio' ? ['ge', 8] : ['ge', rule.polarisation === 'vh' ? -12 : -4];
    default: return ['ge', 0];
  }
}

/**
 * A new rule, whole, as the engine's model spells it. It starts on the usual
 * line for what it measures unless `extra` names its own op, value or upper.
 */
export function newRule(measure = 'index', on = 'change', extra = {}) {
  const { op, value, upper, ...rest } = extra;
  const rule = {
    measure, index: 'ndvi', bands: ['B08', 'B04'], band: 'B08', polarisation: 'vv', classes: [],
    on: measure === 'colour' ? 'change' : measure === 'class' && on === 'change' ? 'b' : on,
    op: 'ge', value: 0, upper: 0, around: 0, ...rest,
  };
  if (rule.measure === 'class' && !rule.classes.length) rule.classes = ['water'];
  const lined = withLine(rule);
  return {
    ...lined,
    ...(op === undefined ? {} : { op }),
    ...(value === undefined ? {} : { value }),
    ...(upper === undefined ? {} : { upper }),
  };
}

function withLine(rule) {
  const [op, value] = line(rule);
  const scale = scaleOf({ ...rule, op });
  return { ...rule, op, value, upper: op === 'between' ? value + (scale.max - scale.min) / scale.factor / 10 : 0 };
}

/**
 * A rule after one of its fields changed. Changing what it measures, or when,
 * puts it back on that quantity's usual line; the rest keeps what was set, as
 * long as the combination still means something.
 */
export function retarget(rule, patch) {
  const next = { ...rule, ...patch };
  if (next.measure === 'colour') next.on = 'change';
  if (next.measure === 'class') {
    if (next.on === 'change') next.on = 'b';
    if (!next.classes.length) next.classes = ['water'];
    next.around = 0;
  }
  if ('measure' in patch || 'on' in patch || 'index' in patch || 'polarisation' in patch) return withLine(next);
  if ('op' in patch) {
    if (next.op === 'moved') next.value = Math.abs(next.value);
    if (next.op === 'between' && next.upper <= next.value) {
      const scale = scaleOf(next);
      next.upper = Number((next.value + (scale.max - scale.min) / scale.factor / 10).toFixed(4));
    }
  }
  return next;
}

/** Why a rule cannot run, or '' when it can, as the engine would refuse it. */
export function ruleProblem(rule) {
  if (rule.measure === 'class') {
    if (!rule.classes?.length) return 'Choose at least one ground class.';
    return '';
  }
  if (!Number.isFinite(Number(rule.value))) return 'Give the rule a value.';
  if (rule.op === 'between' && !(Number(rule.upper) > Number(rule.value))) return 'The upper bound must be above the lower one.';
  if (rule.measure === 'nd' && rule.bands[0] === rule.bands[1]) return 'Pick two different bands.';
  return '';
}

/** The bands a rule reads. */
export function ruleBands(rule) {
  if (rule.measure === 'index') return SPECTRAL_BANDS[rule.index] ?? [];
  if (rule.measure === 'nd') return [...rule.bands];
  if (rule.measure === 'band') return [rule.band];
  if (rule.measure === 'brightness' || rule.measure === 'colour') return VISIBLE;
  return [];
}

export function recipeBands(recipe) {
  const wanted = new Set((recipe?.rules ?? []).flatMap(ruleBands));
  return L2A_BANDS.filter((band) => wanted.has(band));
}

export const isRules = (recipe) => recipe?.method === 'rules';
export const readsRadar = (recipe) => isRules(recipe) && recipe.rules.some((rule) => rule.measure === 'radar');
export const readsOneDate = (recipe) => isRules(recipe) && recipe.rules.every((rule) => rule.on === 'b');

/** Band products one date costs: every three bands are one request. */
export function productCount(recipe) {
  if (readsRadar(recipe)) return 1;
  return Math.max(1, Math.ceil(recipeBands(recipe).length / 3));
}

/** Why the recipe cannot run, or '' when it can. */
export function recipeProblem(recipe, limits = {}) {
  const rules = recipe?.rules ?? [];
  if (!rules.length) return 'Add a rule.';
  const most = limits.max_rules ?? 6;
  if (rules.length > most) return `An analyzer holds at most ${most} rules.`;
  for (const rule of rules) {
    const problem = ruleProblem(rule);
    if (problem) return problem;
  }
  const radar = new Set(rules.filter((rule) => rule.measure !== 'class').map((rule) => rule.measure === 'radar'));
  if (radar.size > 1) return 'Radar and optical rules read two satellites; keep them in two analyzers.';
  if (radar.has(true) && rules.some((rule) => rule.measure === 'class')) return 'Ground classes come from Sentinel-2, which a radar analyzer does not read.';
  const bands = limits.max_bands ?? 6;
  if (recipeBands(recipe).length > bands) return `An analyzer reads at most ${bands} bands.`;
  return '';
}

/**
 * What the panel asks of a recipe's method, worked out from its rules for an
 * analyzer of your own: which dates, which satellite, what a tile costs, and
 * the sizes and smoothing that fit.
 */
export function recipeCapability(recipe, methods = []) {
  const base = methods.find((entry) => entry.id === recipe?.method) ?? {};
  if (!isRules(recipe)) return base;
  const radar = readsRadar(recipe);
  const single = readsOneDate(recipe);
  const radarChange = methods.find((entry) => entry.id === 'sar-change') ?? {};
  return {
    ...base,
    single,
    sensor: radar ? 'sentinel1' : 'sentinel2',
    clouds: !radar,
    frames: (single ? 1 : 2) * (1 + productCount(recipe)),
    sizes: radar ? radarChange.sizes ?? base.sizes : base.sizes,
    smoothing_m: radar ? radarChange.smoothing_m ?? null : null,
  };
}

/** The rule that ranks candidates: the first that measures something. */
export const signalOf = (recipe) => (recipe?.rules ?? []).findIndex((rule) => rule.measure !== 'class');

function pairName(bands) {
  return PAIRS.find((pair) => pair.bands[0] === bands[0] && pair.bands[1] === bands[1])?.label;
}

/** What a rule measures, in a few words. */
export function quantityLabel(rule) {
  switch (rule.measure) {
    case 'index': return INDICES.find((entry) => entry.id === rule.index)?.label ?? rule.index.toUpperCase();
    case 'nd': return pairName(rule.bands) ?? `(${rule.bands[0]} − ${rule.bands[1]}) / (${rule.bands[0]} + ${rule.bands[1]})`;
    case 'band': return `${rule.band} (${BAND_NAMES[rule.band] ?? 'band'})`;
    case 'brightness': return 'brightness';
    case 'colour': return 'colour';
    case 'radar': return POLARISATIONS.find((entry) => entry.id === rule.polarisation)?.label ?? 'VV';
    case 'class': return 'ground';
    default: return rule.measure;
  }
}

const sideName = (on) => (on === 'a' ? 'A' : 'B');

/** A rule as a clause: "NDVI dropped by 0.25 or more", "ground on B is water". */
export function describeRule(rule) {
  const quantity = quantityLabel(rule);
  if (rule.measure === 'class') {
    const names = rule.classes.map((id) => CLASS_NAMES[id] ?? id);
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0] ?? 'nothing';
    return `ground on ${sideName(rule.on)} ${rule.op === 'not' ? 'is not' : 'is'} ${list}`;
  }
  const around = rule.around ? ` against the ground within ${rule.around} m` : '';
  const value = (v, signed = false) => formatValue(rule, v, { signed });
  if (rule.on !== 'change') {
    const on = `${quantity} on ${sideName(rule.on)}`;
    if (rule.op === 'between') return `${on} between ${value(rule.value)} and ${value(rule.upper)}${around}`;
    if (rule.around) return `${on} at ${rule.op === 'ge' ? 'least' : 'most'} ${value(rule.value, true)}${around}`;
    return `${on} at ${rule.op === 'ge' ? 'least' : 'most'} ${value(rule.value)}`;
  }
  if (rule.measure === 'colour') {
    if (rule.op === 'between') return `colour moved by between ${value(rule.value)} and ${value(rule.upper)}${around}`;
    return `colour moved by ${rule.op === 'ge' ? 'at least' : 'at most'} ${value(rule.value)}${around}`;
  }
  const size = (v) => formatValue(rule, Math.abs(v));
  if (rule.op === 'moved') return `${quantity} moved by ${size(rule.value)} or more either way${around}`;
  if (rule.op === 'between') return `${quantity} changed by between ${value(rule.value, true)} and ${value(rule.upper, true)}${around}`;
  if (rule.op === 'le' && rule.value <= 0) return `${quantity} dropped by ${size(rule.value)} or more${around}`;
  if (rule.op === 'ge' && rule.value >= 0) return `${quantity} rose by ${size(rule.value)} or more${around}`;
  return `${quantity} changed by ${rule.op === 'ge' ? 'at least' : 'at most'} ${value(rule.value, true)}${around}`;
}

/** The whole analyzer as one sentence, for "Reads as" and a default description. */
export function describeRecipe(recipe, { clouds = true } = {}) {
  const clauses = (recipe?.rules ?? []).map(describeRule);
  if (!clauses.length) return '';
  const joiner = recipe.match === 'any' ? 'or' : 'and';
  const list = clauses.length > 1 ? `${clauses.slice(0, -1).join(', ')} ${joiner} ${clauses.at(-1)}` : clauses[0];
  const sky = clouds && !readsRadar(recipe) && recipe.parameters?.ignore_clouds ? ', outside cloud' : '';
  const text = `Keeps ground where ${list}${sky}.`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A candidate's reading, from its analyzer's signal rule. */
export function describeReading(recipe, measure) {
  const index = signalOf(recipe);
  if (index < 0 || !measure) return '';
  const rule = recipe.rules[index];
  const quantity = quantityLabel(rule);
  if (rule.on === 'change' && rule.measure !== 'colour' && Number.isFinite(measure.before)) {
    const change = formatValue(rule, measure.signed, { signed: true });
    return `${quantity} ${formatValue(rule, measure.before)} → ${formatValue(rule, measure.after)} (${change}${rule.around ? ' against its ground' : ''})`;
  }
  if (!Number.isFinite(measure.value)) return '';
  const shown = formatValue(rule, measure.value, { signed: !!rule.around });
  return rule.around ? `${quantity} ${shown} against its ground` : `${quantity} ${shown}`;
}

/** The engine's parameter defaults, which a recipe starts from. */
export const DEFAULT_PARAMETERS = Object.freeze({
  sensitivity: 60, min_area: 0, max_area: 0, cleanup: 0, smoothing: 0, index: 'ndvi', direction: 'both',
  sar_ground: 'any', ignore_clouds: true, ignore_shadows: true, cloud_margin: 5, merge_metres: 0, shape: 'any',
});

/** A new analyzer of your own: one change rule, at the medium size. */
export function newRecipe(methods = []) {
  const sizes = methods.find((entry) => entry.id === 'rules')?.sizes;
  return {
    id: 'custom', name: '', description: '', phenomenon: 'Candidate', method: 'rules',
    parameters: { ...DEFAULT_PARAMETERS, ...(sizes?.medium ?? {}) },
    colour: '#f6a81a', style: 'both', rules: [newRule('index', 'change')], match: 'all', checks: [],
  };
}

/**
 * Difference's index reading as an analyzer of your own: the same index, the
 * same line, the same way it moved, the same cleanup. Difference counts its
 * cloud margin in metres; Detect grows its mask in 10 m pixels.
 */
export function fromDifference(settings) {
  const index = INDICES.find((entry) => entry.id === settings.index) ?? INDICES[0];
  const threshold = Number(indexThreshold(settings.sensitivity).toFixed(2));
  const classes = settings.classes ?? [];
  const loss = classes.includes('loss') && !classes.includes('gain');
  const gain = classes.includes('gain') && !classes.includes('loss');
  const rule = newRule('index', 'change', { index: index.id });
  const tuned = loss ? { op: 'le', value: -threshold } : gain ? { op: 'ge', value: threshold } : { op: 'moved', value: threshold };
  const way = loss ? index.loss : gain ? index.gain : `${index.label} change`;
  return {
    id: 'custom', name: `${index.label}: ${way}`, description: '', phenomenon: way, method: 'rules',
    parameters: {
      ...DEFAULT_PARAMETERS,
      min_area: Math.max(0, Number(settings.min_area) || 0),
      cleanup: Math.min(3, Math.max(0, Math.round(settings.cleanup ?? 0))),
      smoothing: Math.min(3, Math.max(0, Math.round(settings.smoothing ?? 0))),
      ignore_clouds: !!settings.ignore_clouds,
      ignore_shadows: !!settings.ignore_shadows,
      cloud_margin: Math.min(10, Math.max(0, Math.round((settings.cloud_margin ?? 0) / 10))),
    },
    colour: '#f6a81a', style: 'both', rules: [{ ...rule, ...tuned }], match: 'all', checks: [],
  };
}

function rgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * The preview mask painted in the rules' colours: each shown rule lays its
 * pixels in its colour, later ones over earlier, and a hovered rule alone,
 * brighter. `bits` is one byte a pixel, the engine's mask.
 */
export function paintMask(bits, { shown = [], hover = null, colours = RULE_COLOURS, alpha = 110 } = {}) {
  const out = new Uint8ClampedArray(bits.length * 4);
  const order = hover === null ? shown.map((on, i) => (on ? i : -1)).filter((i) => i >= 0) : [hover];
  const tints = colours.map(rgb);
  const strength = hover === null ? alpha : 190;
  for (let p = 0; p < bits.length; p++) {
    const value = bits[p];
    if (!value) continue;
    for (const i of order) {
      if (!(value & (1 << i))) continue;
      const [r, g, b] = tints[i % tints.length];
      out[p * 4] = r; out[p * 4 + 1] = g; out[p * 4 + 2] = b; out[p * 4 + 3] = strength;
    }
  }
  return out;
}

/** A share of the measured ground, as the funnel prints it. */
export function formatShare(share) {
  if (!Number.isFinite(share)) return '–';
  const percent = share * 100;
  if (percent === 0) return '0 %';
  if (percent < 0.1) return '< 0.1 %';
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)} %`;
}

// -- checks ---------------------------------------------------------------------------

/** JSON with its keys sorted, so the same recipe always reads the same. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * A short digest of what a reading depends on: the rules, how they combine
 * and the parameters. A check's result keeps the one it was read with, so a
 * result from rules changed since shows as stale rather than as an answer.
 */
export function signature(recipe) {
  const text = canonical({ rules: recipe?.rules ?? [], match: recipe?.match ?? 'all', parameters: recipe?.parameters ?? {} });
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** A check of the view on screen and the passes shown, with no marks yet. */
export function newCheck({ name, a, b, bounds }) {
  const id = `check-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { id, name, a: { ...a }, b: { ...b }, bounds: { ...bounds }, marks: [], result: null };
}

/**
 * A check with one more mark. Its view grows to hold the mark, and its last
 * result goes, since it answered for the marks it had.
 */
export function withMark(check, point, expect) {
  const [lon, lat] = point;
  const bounds = {
    west: Math.min(check.bounds.west, lon - 0.002), south: Math.min(check.bounds.south, lat - 0.002),
    east: Math.max(check.bounds.east, lon + 0.002), north: Math.max(check.bounds.north, lat + 0.002),
  };
  return { ...check, bounds, marks: [...check.marks, { point: [lon, lat], expect }], result: null };
}

export function withoutMark(check, index) {
  return { ...check, marks: check.marks.filter((_, i) => i !== index), result: null };
}

/** Mark by mark, whether it came out as expected, from the last result. */
export function markOutcomes(check) {
  const covered = check.result?.covered ?? [];
  return check.marks.map((mark, i) => (covered.length ? covered[i] === (mark.expect === 'found') : null));
}

/**
 * Where a check stands: 'pass' when every mark came out as it should,
 * 'fail' when one did not, 'counted' for a check with no marks, 'stale' when
 * its last result was read with other rules, 'unrun' when it has none.
 */
export function checkState(check, current) {
  const result = check.result;
  if (!result) return 'unrun';
  if (result.signature !== current) return 'stale';
  if (!check.marks.length) return 'counted';
  return markOutcomes(check).every(Boolean) ? 'pass' : 'fail';
}

/** A check's last result in a few words: "2 of 2 found · none flagged". */
export function describeOutcome(check, current) {
  const state = checkState(check, current);
  if (state === 'unrun') return 'Not run yet';
  if (state === 'stale') return 'Not rerun since the rules changed';
  if (state === 'counted') return `${check.result.count} candidate${check.result.count === 1 ? '' : 's'}`;
  const outcomes = markOutcomes(check);
  const found = check.marks.map((mark, i) => [mark, outcomes[i]]).filter(([mark]) => mark.expect === 'found');
  const empty = check.marks.map((mark, i) => [mark, outcomes[i]]).filter(([mark]) => mark.expect === 'empty');
  const parts = [];
  if (found.length) parts.push(`${found.filter(([, ok]) => ok).length} of ${found.length} found`);
  if (empty.length) {
    const flagged = empty.filter(([, ok]) => !ok).length;
    parts.push(flagged ? `${flagged} of ${empty.length} flagged` : empty.length === 1 ? 'stayed empty' : 'all stayed empty');
  }
  return parts.join(' · ');
}

/** Every check of a recipe counted by where it stands. */
export function checksSummary(recipe) {
  const current = signature(recipe);
  const states = (recipe?.checks ?? []).map((check) => checkState(check, current));
  const count = (state) => states.filter((entry) => entry === state).length;
  return { total: states.length, pass: count('pass'), fail: count('fail'), counted: count('counted'),
    waiting: count('stale') + count('unrun') };
}

/** The summary as the library prints it under an analyzer. */
export function describeChecks(recipe) {
  const { total, pass, fail, waiting } = checksSummary(recipe);
  if (!total) return '';
  const head = `${total} check${total === 1 ? '' : 's'}`;
  if (fail) return `${head} · ${fail} fail${fail === 1 ? 's' : ''}`;
  if (waiting === total) return `${head} · not run`;
  if (pass && !waiting) return `${head} · all pass`;
  return `${head} · ${pass} pass`;
}

// -- layers ---------------------------------------------------------------------------

const firstOf = (wanted, ids) => wanted.find((id) => ids.includes(id));

/**
 * The Copernicus layer that shows best what a rule reads: vegetation in NDVI,
 * burns and heat in short-wave infrared, water and hulls in false colour, among
 * the layers the configuration offers.
 */
export function suggestedLayer(rule, layers = []) {
  const ids = layers.map((layer) => layer.id);
  const fallback = ids.includes('TRUE_COLOR') ? 'TRUE_COLOR' : ids[0] ?? 'TRUE_COLOR';
  if (!rule) return fallback;
  const swir = ['B11', 'B12'];
  const nir = ['B05', 'B06', 'B07', 'B08', 'B8A'];
  let wanted = ['TRUE_COLOR'];
  if (rule.measure === 'index') {
    wanted = {
      ndvi: ['NDVI', 'FALSE_COLOR'], nbr: ['SWIR', 'MOISTURE_INDEX'], ndwi: ['NDWI', 'FALSE_COLOR'],
      mndwi: ['NDWI', 'FALSE_COLOR'], ndbi: ['FALSE_COLOR_URBAN', 'SWIR'], bsi: ['SWIR', 'FALSE_COLOR_URBAN'],
    }[rule.index] ?? wanted;
  } else if (rule.measure === 'nd' || rule.measure === 'band') {
    const bands = ruleBands(rule);
    wanted = bands.some((band) => swir.includes(band)) ? ['SWIR', 'FALSE_COLOR']
      : bands.some((band) => nir.includes(band)) ? ['FALSE_COLOR', 'NDVI'] : ['TRUE_COLOR'];
  } else if (rule.measure === 'class') {
    wanted = ['SCENE_CLASSIFICATION', 'TRUE_COLOR'];
  }
  return firstOf(wanted, ids) ?? fallback;
}
