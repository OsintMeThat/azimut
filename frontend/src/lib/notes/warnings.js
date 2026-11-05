/**
 * What a note's PDF warns about, the same list in two places: under the Page
 * pane's bar as the note is typed (`preview.js` reads it from the page's headers),
 * and in the export dialog before anything is written (`checkNotes`).
 *
 * Each warning has its words, the 0-based line of the note it is about or null,
 * and a kind. The server renders the notes in memory for the check and writes
 * nothing (`POST notes/pdf/check`), in the edition asked for. The check also counts
 * each note's internal passages, and for the public edition says how many it leaves
 * out, as a warning of the kind `internal` that is no fault (`isLeftOut`).
 */
import { api } from '../api.js';

/** What a warning is about (`engine/notes_pdf.py`); anything else reads as `other`. */
export const WARNING_KINDS = ['missing', 'unsourced', 'open-task', 'local-link', 'empty-section', 'setting', 'other', 'internal'];

/** The internal passages a public edition leaves out: said, but nothing to fix. */
export function isLeftOut(warning) {
  return warning?.kind === 'internal';
}

export function warningKind(value) {
  return WARNING_KINDS.includes(value) ? value : 'other';
}

/** A warning as the server gave it: its words, its line or null, its kind. */
export function readWarning(item) {
  const line = item?.line;
  return {
    text: String(item?.text ?? ''),
    line: Number.isInteger(line) && line >= 0 ? line : null,
    kind: warningKind(item?.kind),
  };
}

/**
 * The notes of a check that have something to say, in the order asked, each with
 * its title (the case notes' own when the server gives none) and its warnings.
 */
export function readCheck(answer) {
  const notes = Array.isArray(answer?.notes) ? answer.notes : [];
  return notes
    .filter((item) => item && typeof item.note === 'string')
    .map((item) => ({
      note: item.note,
      title: String(item.title || (item.note === 'case' ? 'Case notes' : 'Untitled note')),
      warnings: (Array.isArray(item.warnings) ? item.warnings : []).map(readWarning).filter((warning) => warning.text),
    }))
    .filter((item) => item.warnings.length);
}

/** How many internal passages the checked notes hold between them, chapters included. */
export function internalCount(answer) {
  const notes = Array.isArray(answer?.notes) ? answer.notes : [];
  return notes.reduce((sum, item) => sum + (Number.isInteger(item?.internal) && item.internal > 0 ? item.internal : 0), 0);
}

/**
 * Ask what the PDFs of these notes would warn about, from the notes as saved, in
 * `edition`: `{ found, internal }`, the notes with something to say and the
 * internal passages they hold.
 */
export async function checkNotes(caseId, noteIds, { signal, edition = 'internal' } = {}) {
  const answer = await api.post(`/api/cases/${caseId}/notes/pdf/check`, { notes: noteIds, edition }, { signal });
  return { found: readCheck(answer), internal: internalCount(answer) };
}
