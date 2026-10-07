/**
 * Copernicus layers written in Azimut rather than in the Copernicus dashboard.
 *
 * A layer is a *name* the rest of the app already carries everywhere — the
 * provider id, the tile cache, a capture's provenance — plus, here, a script
 * that says how to turn bands into pixels. What is new is only where the
 * rendering comes from; nothing downstream has to learn a new idea.
 *
 * A script renders through a **base layer**, which supplies the data
 * collection: an evalscript replaces a layer's style, never its source. That is
 * the arrangement the radar basemap has always used.
 *
 * Settings manages the list and the picker writes them, so both read this.
 * `engine/sentinel.py` owns the same rules on the backend.
 */

import { COMPOSITE_PRESETS, DEFAULT_GAIN, INDEX_PRESETS } from './layerScripts.js';

/** The shape every layer name has to hold: it is also a path segment and a
 *  directory name, so it is an allowlist rather than something to escape. */
export const NAME_RE = /^[A-Z0-9_]{1,40}$/;

/** The name a layer being previewed renders under. It carries a digest of the
 *  script, because the name is the tile cache's key (`engine/sentinel.py`). */
export const DRAFT_PREFIX = 'AZIMUT_DRAFT_';

export function isDraftLayer(id) {
  return String(id ?? '').startsWith(DRAFT_PREFIX);
}

/** Default script budget. The real figure comes from the backend
 *  (`max_script`), which owns it; this is what a form starts with. */
export const SCRIPT_MAX = 4000;

/** What a name becomes as it is typed: the only characters a layer name holds. */
export function asName(text) {
  return String(text ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, '_')
    .replace(/^_+/, '')
    .slice(0, 40);
}

/**
 * Why this layer cannot be saved, in one clause, or '' when it can.
 *
 * @param {{id?: string, script?: string, base?: string}} draft
 * @param {{taken?: string[], scriptMax?: number}} [limits] `taken` is the names
 *   already in use by something else, which saving over would silently change.
 */
export function layerProblem(draft, { taken = [], scriptMax = SCRIPT_MAX } = {}) {
  const name = String(draft?.id ?? '');
  if (!name) return 'Name the layer.';
  if (!NAME_RE.test(name)) return 'A name holds capitals, digits and underscores, up to 40.';
  if (taken.includes(name)) return 'That name is already a layer in your configuration.';
  if (!String(draft?.script ?? '').trim()) return 'Write the script.';
  if (String(draft.script).length > scriptMax) return `A script is at most ${scriptMax} characters.`;
  if (!NAME_RE.test(String(draft?.base ?? ''))) return 'Choose the layer to read through.';
  return '';
}

/**
 * Which configured layer a new script should read its data from.
 *
 * Not simply the first one on the list: a configuration that has a radar layer
 * often lists it first, and a Sentinel-2 script reading through it renders
 * nothing. True colour is the layer every setup guide builds, so it is the
 * answer whenever it is there.
 */
export function preferredBase(bases, radarLayer = '') {
  const usable = (bases ?? []).filter((id) => id && id !== radarLayer);
  return usable.find((id) => id === 'TRUE_COLOR') ?? usable[0] ?? 'TRUE_COLOR';
}

/** The layers a script can read its data from: the configured ones, less radar. */
export function dataSources(layers, radarLayer = '') {
  return (layers ?? [])
    .filter((entry) => !entry.custom && entry.id !== radarLayer)
    .map((entry) => entry.id);
}

/**
 * A layer being written, as the editor holds it while it is open.
 *
 * Owned by whoever opened the editor, not by the form, so closing the panel to
 * look at the map and reopening it keeps what was typed. The form reads and
 * mutates this object; it never starts a second one.
 */
export function startForm({ layer = null, bases = [], bands = [], radarLayer = '' } = {}) {
  const band = (wanted) => (bands.length && !bands.includes(wanted) ? bands[0] : wanted);
  const [red, green, blue] = COMPOSITE_PRESETS[0].bands;
  const first = INDEX_PRESETS[0];
  // How the layer was written, when a form wrote it. Without it a saved layer
  // could only reopen as JavaScript, including the ones nobody typed.
  const memo = layer?.form ?? null;
  return {
    // The layer this is an edit of, or '' for a new one. A saved layer keeps
    // its name, which is what every capture and cache is filed under.
    editing: layer?.id ?? '',
    id: layer?.id ?? '',
    label: layer?.label ?? '',
    hint: layer?.hint ?? '',
    base: layer?.base || preferredBase(bases, radarLayer),
    way: memo?.way ?? (layer ? 'script' : 'composite'),
    composite:
      memo?.way === 'composite'
        ? {
            red: band(memo.red),
            green: band(memo.green),
            blue: band(memo.blue),
            gain: memo.gain ?? DEFAULT_GAIN,
          }
        : { red: band(red), green: band(green), blue: band(blue), gain: DEFAULT_GAIN },
    index:
      memo?.way === 'index'
        ? {
            high: band(memo.high),
            low: band(memo.low),
            rampId: memo.ramp || first.rampId,
            threshold: memo.threshold ?? '',
          }
        : { high: band(first.high), low: band(first.low), rampId: first.rampId, threshold: '' },
    typed: layer?.script ?? '',
  };
}

/**
 * What a form wrote, as the layer remembers it — or null for a script somebody
 * typed, which has nothing to remember.
 *
 * An index is the one that earns its keep twice: it is also a quantity Detect
 * measures (a normalised difference of two bands), so the same arithmetic a
 * layer paints can be read as a rule.
 */
export function formMemo(form) {
  if (form?.way === 'composite') {
    const { red, green, blue, gain } = form.composite;
    return { way: 'composite', red, green, blue, gain: Number(gain) };
  }
  if (form?.way === 'index') {
    const { high, low, rampId, threshold } = form.index;
    const cut = threshold === '' || threshold === null || threshold === undefined
      ? null
      : Number(threshold);
    return { way: 'index', high, low, ramp: rampId, threshold: cut };
  }
  return null;
}

/**
 * Exactly the body the save route takes, and nothing else.
 *
 * The editor's draft holds more than a layer: which form is open, the text of
 * the other ways, the name it is an edit of. The route forbids what it does not
 * know (`CustomLayerIn`), and rightly — so the payload is spelled out here
 * rather than being whatever the draft happened to be carrying.
 * `tests/test_sentinel_custom_layers.py` reads this list.
 */
export function layerPayload(form, script) {
  return {
    id: form.id,
    label: form.label,
    base: form.base,
    hint: form.hint,
    script,
    form: formMemo(form),
  };
}

/**
 * A layer as a Detect rule, or null when it is not one quantity.
 *
 * A rule measures a number per pixel, so a layer comes over when what it paints
 * *is* a number. Two of the forms are:
 *
 * - an index, `(A − B) / (A + B)`, which is the `nd` measure exactly, so the
 *   threshold the layer darkens below becomes the line the rule crosses;
 * - a composite that paints one band into all three channels — grey, not
 *   colour — which is that band's reflectance, the `band` measure.
 *
 * A colour composite is three channels and no single number, and a hand-written
 * script is JavaScript nobody can read a quantity out of. `whyNotARule` says
 * which, so the menu can show the layer and the reason rather than hide it.
 */
export function layerAsRule(layer) {
  const memo = layer?.form;
  // `on` is left out on purpose: which dates a rule reads is the analyzer's
  // question, not the layer's.
  if (memo?.way === 'index' && memo.high && memo.low) {
    return { measure: 'nd', bands: [memo.high, memo.low], op: 'ge', value: memo.threshold ?? 0 };
  }
  if (memo?.way === 'composite' && memo.red && memo.red === memo.green && memo.green === memo.blue) {
    // No line comes with it: a grey band has a gain, which is how bright it is
    // drawn, never where the ground stops passing. The rule takes its own.
    return { measure: 'band', band: memo.red };
  }
  return null;
}

/**
 * Why this layer cannot become a rule, in one clause, or '' when it can.
 *
 * Said rather than hidden: a layer missing from the menu with no reason reads
 * as "rules cannot be built from my layers at all", which is the opposite of
 * what is true.
 */
export function whyNotARule(layer) {
  if (layerAsRule(layer)) return '';
  const memo = layer?.form;
  if (!memo) return 'written as a script, so no quantity to read';
  if (memo.way === 'composite') return 'three bands in colour, not one quantity';
  return 'nothing measurable in it';
}

/**
 * The arithmetic a layer turns into, in the menu's words, or '' when it is none.
 */
export function layerRuleWords(layer) {
  const rule = layerAsRule(layer);
  if (!rule) return '';
  if (rule.measure === 'band') return `${rule.band} reflectance`;
  const [high, low] = rule.bands;
  const line = layer.form.threshold == null ? '' : ` ≥ ${layer.form.threshold}`;
  return `(${high} − ${low}) / (${high} + ${low})${line}`;
}

/** The layers the list already holds, and what the editor is allowed to keep. */
export async function readCustomLayers(api) {
  const body = await api.get('/api/satellite/sentinel/custom-layers');
  return {
    layers: body.layers ?? [],
    max: body.max ?? 40,
    scriptMax: body.max_script ?? SCRIPT_MAX,
    bands: body.bands ?? [],
    radarLayer: body.radar_layer ?? '',
  };
}

export function saveCustomLayer(api, layer) {
  return api.put('/api/satellite/sentinel/custom-layers', layer);
}

export function deleteCustomLayer(api, ident) {
  return api.del(`/api/satellite/sentinel/custom-layers/${encodeURIComponent(ident)}`);
}

/**
 * Render a script before it is saved. The name comes back carrying a digest of
 * the script, so pressing Preview again after an edit fetches tiles instead of
 * serving the last attempt's from the disk cache.
 */
export async function previewLayer(api, { base, script }) {
  const body = await api.put('/api/satellite/sentinel/draft-layer', { base, script });
  return body.id;
}

export function clearPreview(api) {
  return api.del('/api/satellite/sentinel/draft-layer');
}
