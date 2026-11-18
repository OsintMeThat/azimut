/**
 * The WordPress site a note is sent to as a draft (`api/publishing.py`, `engine/notes_wordpress.py`).
 *
 * Reading, saving and forgetting the site stay on this machine; only Test connection
 * and Send reach the site, each on its press. The password goes up once, when typed,
 * and never comes back: the server answers whether one is kept and its last four
 * characters.
 */
import { api } from './api.js';
import { drawDiagrams } from './notesExport.js';
import { webLink } from './wordpressSetup.js';

/** The site as Settings shows it: `{ site, user, password: { set, hint } }`. */
export async function readWordPress() {
  const answer = await api.get('/api/publishing');
  return readState(answer?.wordpress);
}

export function readState(state) {
  return {
    site: String(state?.site ?? ''),
    user: String(state?.user ?? ''),
    password: { set: Boolean(state?.password?.set), hint: String(state?.password?.hint ?? '') },
  };
}

/** Save what changed; a password left empty keeps the one kept. */
export async function saveWordPress(patch) {
  return readState(await api.put('/api/publishing/wordpress', patch));
}

/** Forget the site, the username and the password, from this machine. */
export async function forgetWordPress() {
  return readState(await api.del('/api/publishing/wordpress'));
}

/** Sign in with the kept password: `{ ok, name, site_name, detail }`. */
export function testWordPress() {
  return api.post('/api/publishing/wordpress/test');
}

const noteOf = (noteId) => noteId || 'case';

/** What a draft would hold and leave out, from the note as saved: nothing is sent. */
export function checkDraft(caseId, noteId, { signal } = {}) {
  return api.post(`/api/cases/${caseId}/notes/${noteOf(noteId)}/wordpress`, { check: true }, { signal });
}

/**
 * Send a note's public edition to the site as a draft. Its Mermaid diagrams are drawn
 * here as PNG first, since WordPress takes no SVG. The answer holds the post, its edit
 * and preview links (kept only when they are web addresses), whether an earlier draft
 * was updated, and what stayed out.
 */
export async function sendDraft(caseId, noteId, { roundPov = false, ...drawing } = {}) {
  const note = noteOf(noteId);
  const { diagrams: pending } = await api.post(`/api/cases/${caseId}/notes/pdf/diagrams`, { notes: [note], edition: 'public' });
  const diagrams = pending?.length ? await drawDiagrams(pending, drawing) : {};
  const answer = await api.post(`/api/cases/${caseId}/notes/${note}/wordpress`, { diagrams, round_pov: Boolean(roundPov) });
  return { ...answer, edit: webLink(answer?.edit), preview: webLink(answer?.preview) };
}
