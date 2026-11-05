/**
 * A proof as it goes into a note: its picture at the page's width, captioned with
 * the analyst's own sentence and the material's date, then one line per point,
 * named, with what the point is (where the camera stood, or what is shown).
 *
 * Nothing here is a conclusion of the tool's: the sentence and the date are the
 * ones the analyst stated on the proof, and the points are theirs as typed.
 */
import { picturePut } from '../../lib/notes/syntax.js';
import { postDate } from '../../lib/post.js';
import { parseLatLon } from '../../lib/sheetRoles.js';

/** A plain decimal pair, `15.36941, 44.19104`, which the note already reads as a point. */
const DECIMAL_PAIR = /^-?\d{1,2}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/;

/**
 * A point's coordinates as the note writes them. A decimal pair stays as typed,
 * so a coarse point is not dressed up as a precise one; another spelling the
 * proof can read (hemisphere letters, degrees and minutes) becomes decimals at the
 * precision it was read with; anything else stays as typed.
 */
export function pointCoords(text) {
  const typed = String(text ?? '').trim();
  if (DECIMAL_PAIR.test(typed)) return typed;
  const parsed = parseLatLon(typed);
  if (!parsed || parsed.outOfBounds) return typed;
  const places = Math.min(Math.max(parsed.decimals, 0), 6);
  return `${parsed.lat.toFixed(places)}, ${parsed.lon.toFixed(places)}`;
}

/** One point as a line: `Rooftop (point of view): 15.36940, 44.19100`. */
export function pointLine({ coords, label = '', pov = false }) {
  const where = pointCoords(coords);
  if (!where) return '';
  const role = pov ? 'point of view' : 'shown';
  const name = String(label ?? '').trim();
  return `- ${name ? `${name} (${role})` : role[0].toUpperCase() + role.slice(1)}: ${where}`;
}

/** What the proof's caption says: its sentence, then the date the material was taken. */
export function proofCaption({ description = '', when = '', whenZone = null } = {}) {
  return [String(description ?? '').trim(), postDate(when, whenZone)].filter(Boolean).join(' · ');
}

/**
 * The Markdown a saved proof puts in a note. `entity` is the proof's record (its
 * `attrs.path` is the PNG), `lines` its points as `{ coords, label, pov }`.
 */
export function proofNoteText(entity, { description = '', when = '', whenZone = null, lines = [] } = {}) {
  const picture = picturePut(entity, { width: '100%', caption: proofCaption({ description, when, whenZone }) });
  if (!picture) return '';
  const points = lines.map(pointLine).filter(Boolean);
  // A blank line between: the picture is a block of its own, the points a list.
  return points.length ? `${picture}\n\n${points.join('\n')}` : picture;
}

/**
 * The proof's offer to a pinned note. `saved()` saves the proof when it is not
 * (the composer's own save, its point check and name question included) and
 * answers its record and what it states; it throws when the save did not land.
 */
export function proofOffer({ saved, unsaved = () => false }) {
  return {
    id: 'proof',
    label: 'This proof',
    get hint() {
      return unsaved() ? 'Saves the proof, then puts it in with its points' : 'Its picture, its sentence and its points';
    },
    icon: 'proof',
    picture: true,
    busy: 'Saving the proof…',
    put: async ({ signal } = {}) => {
      const { entity, ...stated } = await saved({ signal });
      const text = proofNoteText(entity, stated);
      if (!text) throw new Error('The proof has no picture yet. Save it again');
      return { text, filed: [] };
    },
  };
}
