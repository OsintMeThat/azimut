/**
 * The typefaces a note prints in, shown in the Look panel in their own face.
 *
 * The server names the four families it ships (`GET /api/notes/fonts`) and serves
 * each one's regular face (`/api/notes/fonts/{key}.ttf`). Both are asked for only
 * when the Look panel opens, once per tab. A face that does not load leaves its
 * card in the interface's own font, and the list falls back to `FONTS` from
 * `look.js` when the server cannot be asked.
 */
import { api } from '../api.js';
import { FONTS } from './look.js';

/** The family a face is known by in this page: its own name, so it never shadows one of the app's. */
export const faceFamily = (key) => `azimut-note-${key}`;

let listing = null;
const faces = new Map();

/** The choices the Look panel offers, "" (the style's own) first, labelled with the families' real names. */
export function noteFonts() {
  listing ??= api.get('/api/notes/fonts')
    .then((answer) => {
      const named = new Map((Array.isArray(answer?.fonts) ? answer.fonts : [])
        .filter((item) => item && typeof item.key === 'string' && typeof item.label === 'string' && item.label.trim())
        .map((item) => [item.key, item.label.trim()]));
      const known = FONTS.filter((font) => font.id);
      // the server's order, then any of ours it left out
      const ordered = [...named.keys()].map((key) => known.find((font) => font.id === key)).filter(Boolean);
      const rest = known.filter((font) => !named.has(font.id));
      return [FONTS[0], ...[...ordered, ...rest].map((font) => ({ ...font, label: named.get(font.id) ?? font.label }))];
    })
    .catch(() => {
      listing = null;
      return FONTS;
    });
  return listing;
}

/**
 * The face `key` drawn in this page: resolves true once it can be used, false
 * when it could not be loaded (the card keeps the interface's font).
 */
export function loadNoteFont(key) {
  if (!key || !FONTS.some((font) => font.id === key)) return Promise.resolve(false);
  if (typeof FontFace === 'undefined' || typeof document === 'undefined' || !document.fonts) return Promise.resolve(false);
  if (!faces.has(key)) {
    const face = new FontFace(faceFamily(key), `url(/api/notes/fonts/${key}.ttf)`, { display: 'swap' });
    faces.set(key, face.load()
      .then((loaded) => {
        document.fonts.add(loaded);
        return true;
      })
      .catch(() => {
        // asked again the next time the panel opens
        faces.delete(key);
        return false;
      }));
  }
  return faces.get(key);
}

/** For tests: forget what was listed and loaded. */
export function forgetNoteFonts() {
  listing = null;
  faces.clear();
}
