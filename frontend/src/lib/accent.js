/**
 * The accent colour: what selection, the primary press, a tab's mark and a
 * switch turned on are drawn in. A preference of this computer, like the theme:
 * kept in localStorage, stamped on <html> as `data-accent` (index.html does it
 * before first paint), and app.css resolves the tokens. Amber, the default,
 * stamps nothing, so a missing or unknown value is plain Azimut.
 *
 * Only the interface follows it. The logo keeps its amber, and what Azimut
 * exports (plates, proofs, posts, PDFs) keeps its own colours.
 *
 * Vivid ones first, then the three quiet ones; `swatch` is the colour the
 * picker shows, `swatchLight` the deep ink a quiet one turns to in the light
 * theme. app.css holds a rule per id, and a test keeps the two lists in step.
 */

export const ACCENTS = [
  { id: 'amber', label: 'Amber', swatch: '#e8a33d' },
  { id: 'lemon', label: 'Lemon', swatch: '#e8d34f' },
  { id: 'teal', label: 'Teal', swatch: '#5dc9b3' },
  { id: 'cyan', label: 'Cyan', swatch: '#51c6d0' },
  { id: 'sky', label: 'Sky', swatch: '#5dc0ea' },
  { id: 'lavender', label: 'Lavender', swatch: '#b4a5f6' },
  { id: 'orchid', label: 'Orchid', swatch: '#d798e0' },
  { id: 'rose', label: 'Rose', swatch: '#ef90bb' },
  { id: 'sand', label: 'Sand', swatch: '#c8b89e', swatchLight: '#64563f', quiet: true },
  { id: 'slate', label: 'Slate', swatch: '#a5bacd', swatchLight: '#425565', quiet: true },
  { id: 'graphite', label: 'Graphite', swatch: '#d1d1d1', swatchLight: '#333333', quiet: true },
];

export const DEFAULT_ACCENT = 'amber';
export const ACCENT_KEY = 'azimut:accent';

/** Snap anything, stored, passed or garbage, to a known accent. */
export function normalizeAccent(id) {
  return ACCENTS.some((a) => a.id === id) ? id : DEFAULT_ACCENT;
}

export function loadAccent() {
  try {
    return normalizeAccent(localStorage.getItem(ACCENT_KEY));
  } catch {
    return DEFAULT_ACCENT; // no localStorage (private mode): plain amber
  }
}

export function saveAccent(id) {
  try {
    localStorage.setItem(ACCENT_KEY, normalizeAccent(id));
  } catch {
    /* ignore */
  }
}

/** Stamp the accent on <html>; amber takes the attribute away. */
export function applyAccent(id) {
  const accent = normalizeAccent(id);
  if (accent === DEFAULT_ACCENT) delete document.documentElement.dataset.accent;
  else document.documentElement.dataset.accent = accent;
}
