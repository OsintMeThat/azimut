/**
 * RTL-safe tweet text. A GeoConfirmed post often mixes RTL prose (Arabic,
 * Hebrew) with LTR runs — decimal coordinates, plus codes, @mentions, URLs.
 * Without direction control the Unicode bidi algorithm visually reorders
 * those runs on X: the comma swaps around, punctuation jumps ends, the URL
 * lands mid-sentence. Wrapping each LTR run in a Left-to-Right Isolate
 * (U+2066 … U+2069) pins it in place; text without RTL passes through
 * untouched, so LTR-only users never see a difference.
 */

// Hebrew, Arabic (incl. supplements/extended), and presentation forms.
const RTL_CHARS = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

export const LRI = '\u2066'; // LEFT-TO-RIGHT ISOLATE
export const FSI = '\u2068'; // FIRST STRONG ISOLATE
export const PDI = '\u2069'; // POP DIRECTIONAL ISOLATE

// LTR runs worth isolating: URLs, @mentions, plus codes, coordinate pairs.
const LTR_RUN =
  /https?:\/\/\S+|@\w+|\b[A-Z0-9]{4,8}\+[A-Z0-9]{2,3}\b|[-+]?\d{1,3}\.\d+\s*,\s*[-+]?\d{1,3}\.\d+/g;

export function hasRtl(text) {
  return RTL_CHARS.test(text ?? '');
}

/** Isolate direction-sensitive LTR runs when the text contains RTL script. */
export function bidiSafe(text) {
  if (!text || !hasRtl(text)) return text ?? '';
  return text.replace(LTR_RUN, (run, offset, str) =>
    str[offset - 1] === LRI ? run : LRI + run + PDI
  );
}

/**
 * A label drawn where no `dir="auto"` reaches: a canvas node name, an SVG plate.
 *
 * Both lay text out in a left-to-right paragraph, so an Arabic name with a number in
 * it (`مسجد 12`) came out with the number on the wrong side, and a trailing `…` at
 * the wrong end. A First Strong Isolate takes the direction from the label's own
 * first letter, as `dir="auto"` does in HTML, and keeps it from reordering what is
 * drawn beside it. Text without RTL passes through untouched.
 */
export function bidiIsolate(text) {
  const value = String(text ?? '');
  return hasRtl(value) ? `${FSI}${value}${PDI}` : value;
}
