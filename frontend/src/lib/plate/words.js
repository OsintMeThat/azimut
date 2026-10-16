/**
 * The words an element of a plate writes, as one Text section of the inspector sets
 * them for every kind that writes: their size, face, weight, style, colour, and what
 * stands behind them.
 *
 * Each kind keeps them where it always has. A text's colour is `colour`, while a
 * zone's `colour` paints its area, so a zone's words take theirs from `ink`. A text
 * shows a halo or a box with `halo` and `fill`, and words on the ground with `back`.
 * This module is the one place that knows which, so the inspector and the drawing
 * read the same thing.
 */

/** The kinds that write their words over the ground, along or inside what they draw. */
export const GROUND_WORDS = ['arrow', 'ring', 'cone', 'zone', 'measure', 'line'];

/** The size each kind writes in, in points, when none is set. */
const SIZES = { text: 10, label: 9, credits: 5.5, legend: 8, key: 8, table: 7, timeline: 7, scale: 7, signature: 7, video: 7,
  arrow: 8, ring: 7, cone: 8, zone: 8, measure: 7, line: 8 };
/** The weight each kind writes in when none is set. */
const WEIGHTS = { label: 600 };

/** What can stand behind the words, by kind: `[value, label]`. */
const BACKS = {
  text: [['none', 'None'], ['halo', 'Halo'], ['box', 'Box']],
  ground: [['halo', 'Halo'], ['none', 'None'], ['box', 'Box']],
  credits: [['band', 'Band'], ['none', 'None'], ['box', 'Box']],
  label: [['halo', 'Halo'], ['none', 'None']],
  boxed: [['none', 'None'], ['box', 'Box']],
  video: [['box', 'Band'], ['none', 'None']],
};

/** The controls the Text section shows for an element; empty for one that writes nothing. */
export function wordControls({ kind, style = 'plain' }) {
  if (GROUND_WORDS.includes(kind) || kind === 'text') return ['size', 'font', 'weight', 'style', 'colour', 'back'];
  // a plain label stands on a halo; a bubble or a box is its own backing, set with its look
  if (kind === 'label') return ['size', 'font', 'weight', 'style', 'colour', ...((style ?? 'plain') === 'plain' ? ['back'] : [])];
  if (kind === 'signature') return ['size', 'font', 'weight', 'style', 'colour'];
  if (['credits', 'legend', 'key', 'table', 'timeline', 'scale', 'video'].includes(kind)) return ['size', 'font', 'colour', 'back'];
  if (kind === 'brand') return ['font', 'colour'];
  return [];
}

/** The choices of what stands behind a kind's words. */
export function backChoices(kind) {
  if (GROUND_WORDS.includes(kind)) return BACKS.ground;
  if (kind === 'label') return BACKS.label;
  if (kind === 'text') return BACKS.text;
  if (kind === 'credits') return BACKS.credits;
  if (kind === 'video') return BACKS.video;
  return BACKS.boxed;
}

/** Whether a kind's words take their colour from `ink`, its `colour` painting something else. */
const inked = (kind) => GROUND_WORDS.includes(kind) || kind === 'video';

/** The weight a kind writes in when none is set: words on the ground are bold. */
export const defaultWeight = (kind) => (GROUND_WORDS.includes(kind) ? 700 : WEIGHTS[kind] ?? 400);

/** The size a kind writes in when none is set, in points. */
export const defaultSize = (kind) => SIZES[kind] ?? 10;

/** What stands behind an element's words now: one of `backChoices(kind)`'s values. */
export function backOf(element) {
  const { kind } = element;
  if (GROUND_WORDS.includes(kind)) return element.back === 'none' || element.back === 'box' ? element.back : 'halo';
  if (kind === 'text') return element.fill ? 'box' : element.halo ? 'halo' : 'none';
  if (kind === 'label') return element.back === 'none' ? 'none' : 'halo';
  if (kind === 'credits') return element.back === 'none' ? 'none' : element.back === 'box' || element.fill ? 'box' : 'band';
  if (kind === 'video') return element.back === 'none' ? 'none' : 'box';
  return element.fill ? 'box' : 'none';
}

/** The words' colour, as the element draws them; `theme` gives the page's ink and accent. */
export function inkOf(element, theme = {}) {
  if (inked(element.kind)) return element.ink || (element.kind === 'video' ? '#ffffff' : element.colour || theme.accent || '#c8102e');
  return element.colour || theme.ink || '#15181e';
}

/** The colour of the box behind the words, when there is one. */
export function backColourOf(element, theme = {}) {
  if (element.kind === 'video') return element.fill || '#000000';
  return element.fill || theme.paper || '#ffffff';
}

/**
 * The element's words as the Text section shows them: `{ size, font, weight, italic,
 * upper, colour, back, backColour }`, each as drawn when the element sets none.
 */
export function wordsOf(element, theme = {}) {
  return {
    size: element.size ?? defaultSize(element.kind),
    font: element.font ?? '',
    weight: element.weight ?? defaultWeight(element.kind),
    italic: !!element.italic,
    upper: !!element.upper,
    colour: inkOf(element, theme),
    back: backOf(element),
    backColour: backColourOf(element, theme),
  };
}

/**
 * The fields to write so the element's words take `value` for `key` (one of
 * `wordsOf`'s), each where the element's kind keeps it.
 */
export function wordsPatch(element, key, value, theme = {}) {
  const { kind } = element;
  switch (key) {
    case 'size': return { size: Number(value) };
    case 'font': return { font: value || null };
    case 'weight': return { weight: Number(value) };
    case 'italic': return { italic: !!value };
    case 'upper': return { upper: !!value };
    case 'colour': return inked(kind) ? { ink: value } : { colour: value };
    case 'backColour': return { fill: value };
    case 'back': {
      const box = element.fill || (kind === 'video' ? null : theme.paper) || null;
      if (kind === 'text') return value === 'box' ? { fill: box, halo: false } : { fill: null, halo: value === 'halo' };
      if (kind === 'label') return { back: value === 'none' ? 'none' : '' };
      if (GROUND_WORDS.includes(kind) || kind === 'video') return { back: value === 'halo' ? '' : value, ...(value === 'box' && !element.fill ? { fill: box } : {}) };
      if (kind === 'credits') return value === 'band' ? { back: '', fill: null } : value === 'none' ? { back: 'none', fill: null } : { back: 'box', fill: box };
      return { fill: value === 'box' ? box : null };
    }
    default: return {};
  }
}
