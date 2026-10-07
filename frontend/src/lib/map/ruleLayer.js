/**
 * A rule, drawn as a Copernicus layer.
 *
 * A test paints a verdict: the ground that passes, the ground that does not.
 * That answers whether the line is crossed, never where the line should be. For
 * that you have to see the *quantity* itself, continuous, over the whole frame
 * — which is exactly what a layer does.
 *
 * Nothing here is guessed. A rule already names the bands it reads
 * (`ruleBands`), and the same generators the writing bench uses turn them into
 * a script (`lib/layerScripts.js`), so the layer is the rule's own arithmetic
 * rather than the least-bad configured layer the Display menu can suggest.
 *
 * **No threshold is baked in**, on purpose. `indexScript` can darken everything
 * below a line, but the script's digest is the draft's name and therefore the
 * tile cache's key: a threshold in it would mean new tiles, and new Copernicus
 * requests, every time the slider moved. The ramp shows where every value falls,
 * which is what the line is set against.
 */

import { brightnessScript, compositeScript, indexScript } from '../layerScripts.js';
import { ruleBands } from './analyzerRules.js';

/** The ramp each published index reads best on, matching `INDEX_PRESETS`. */
const INDEX_RAMPS = Object.freeze({
  ndvi: 'vegetation', ndwi: 'water', mndwi: 'water', nbr: 'heat', ndbi: 'grey',
});

/**
 * The script that draws what a rule measures, or '' when it is not one picture.
 *
 * @param {{measure: string, index?: string, bands?: string[], band?: string}} rule
 */
export function ruleLayerScript(rule) {
  if (!rule) return '';
  const bands = ruleBands(rule);
  // A normalised difference is a normalised difference whether the analyst
  // chose the bands or picked a published name for the pair.
  if (rule.measure === 'nd' && bands.length === 2) {
    return indexScript({ high: bands[0], low: bands[1], rampId: 'divergent' });
  }
  if (rule.measure === 'index' && bands.length === 2) {
    return indexScript({ high: bands[0], low: bands[1], rampId: INDEX_RAMPS[rule.index] ?? 'grey' });
  }
  if (rule.measure === 'band' && rule.band) {
    return compositeScript({ red: rule.band, green: rule.band, blue: rule.band });
  }
  if (rule.measure === 'brightness') return brightnessScript();
  return '';
}

/**
 * Why a rule cannot be drawn, in one clause, or '' when it can.
 *
 * Said rather than hidden: the button is on every rule, and a rule that cannot
 * be drawn says so where you press it.
 */
export function whyNoLayer(rule) {
  if (ruleLayerScript(rule)) return '';
  switch (rule?.measure) {
    // Two acquisitions subtracted. One picture of one day cannot hold it.
    case 'colour': return 'a colour change is the move between two dates, not one picture';
    case 'class': return 'ground classes are a classification, not a quantity';
    case 'radar': return 'radar reads another collection';
    case 'index': return `${String(rule.index ?? '').toUpperCase()} is more than two bands`;
    default: return 'nothing to draw';
  }
}

/** What the drawn layer shows, for the button's tooltip. */
export function ruleLayerWords(rule) {
  if (!ruleLayerScript(rule)) return '';
  const bands = ruleBands(rule);
  if (rule.measure === 'band') return `${rule.band} reflectance, as grey`;
  if (rule.measure === 'brightness') return `${bands.join(' · ')} averaged, as grey`;
  return `(${bands[0]} − ${bands[1]}) / (${bands[0]} + ${bands[1]}), on a ramp`;
}
