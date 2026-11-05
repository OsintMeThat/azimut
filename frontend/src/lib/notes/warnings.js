/**
 * What a note's PDF warns about, the same list in two places: under the Page
 * pane's bar as the note is typed (`preview.js` reads it from the page's headers),
 * and in the export dialog before anything is written (`checkNotes`).
 *
 * Each warning has its words, the 0-based line of the note it is about or null,
 * and a kind. The server renders the notes in memory for the check and writes
 * nothing (`POST notes/pdf/check`).
 */
import { api } from '../api.js';

/** What a warning is about (`engine/notes_pdf.py`); anything else reads as `other`. */
export const WARNING_KINDS = ['missing', 'unsourced', 'open-task', 'local-link', 'empty-section', 'other'];

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

/** Ask what the PDFs of these notes would warn about, from the notes as saved. */
export async function checkNotes(caseId, noteIds, { signal } = {}) {
  return readCheck(await api.post(`/api/cases/${caseId}/notes/pdf/check`, { notes: noteIds }, { signal }));
}
