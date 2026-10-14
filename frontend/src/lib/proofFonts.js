/**
 * The typefaces a proof is set in, shipped with the app.
 *
 * The system's own font is a different font on every machine (Segoe UI, San
 * Francisco, Cantarell…), so a proof set in it changed width from one computer to
 * the next: a tag outgrew its box, a label moved off its point, and a re-export
 * no longer matched what was published. These ship in the build, so a proof
 * reads the same everywhere, offline included. Each carries Latin, and Cyrillic
 * where the face has it; a script a face lacks falls back to the system's. The
 * faces themselves are loaded by `proofFontFaces.js`, where a proof is drawn.
 */
const SYSTEM = 'system-ui, sans-serif';

export const PROOF_FONTS = [
  { id: 'inter', label: 'Inter', family: 'Inter' },
  { id: 'barlow', label: 'Barlow Condensed', family: 'Barlow Condensed' },
  { id: 'oxanium', label: 'Oxanium', family: 'Oxanium' },
  { id: 'plexmono', label: 'IBM Plex Mono', family: 'IBM Plex Mono' },
  { id: 'system', label: "This computer's font", family: null },
];

/** What a new proof is set in. One saved before fonts existed keeps the system's. */
export const DEFAULT_PROOF_FONT = 'inter';

/** A font id the app knows, or the system's for anything else. */
export function proofFontId(id) {
  return PROOF_FONTS.some((f) => f.id === id) ? id : 'system';
}

/** The CSS family list a canvas text is set in: the face, then the system's. */
export function fontStack(id) {
  const face = PROOF_FONTS.find((f) => f.id === id)?.family;
  return face ? `"${face}", ${SYSTEM}` : SYSTEM;
}

/**
 * Have the face's two weights ready before a canvas measures text with it: a
 * canvas does not wait for a font, and a word measured in the fallback keeps the
 * fallback's width once the real face arrives.
 */
export function loadProofFont(id) {
  const face = PROOF_FONTS.find((f) => f.id === id)?.family;
  if (!face || typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  return Promise.all(
    ['400', '700'].map((weight) => document.fonts.load(`${weight} 16px "${face}"`, 'Az Жж')),
  ).catch(() => undefined);
}
