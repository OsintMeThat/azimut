/**
 * Export for review (`engine/reviewexport.py`): one note and only what its public web page
 * needs, as an Azimut file to send to somebody who publishes it.
 *
 * Reading what would leave asks the server alone; the press queues the export, which runs as
 * a bundle job (`lib/bundles.js` waits on it) and writes the file in the bundles folder.
 */
import { api } from '../api.js';
import { waitForBundle } from '../bundles.js';

/** Where a guest sends the file. */
export const CONTRIBUTE = 'https://osintmethat.com/contribute';
/** What the pictures and files carry as they go. */
export const METADATA = 'Pictures and files go as they are in the case, their metadata included; a published page strips it.';

const base = (caseId, noteId) => `/api/cases/${encodeURIComponent(caseId)}/notes/${encodeURIComponent(noteId)}/review`;

/** What an export would carry and leave out, and who would sign it; `picture` asks with that choice. */
export function readReview(caseId, noteId, picture = null) {
  return api.get(`${base(caseId, noteId)}${picture === null ? '' : `?picture=${encodeURIComponent(picture)}`}`);
}

/** The press: queue the export, then wait for its file. Resolves to the finished job, whose `id`
 * the whole case's download takes (`lib/bundles.js`). */
export async function exportForReview(caseId, noteId, { author, picture }, options = {}) {
  const started = await api.post(base(caseId, noteId), { author, picture });
  const job = await waitForBundle(caseId, started.job_id, options);
  return { ...job, id: job.id ?? started.job_id, file: job.file ?? started.file };
}

/** The folder the file was written in, in the system's file manager. */
export function revealBundles(caseId) {
  return api.post(`/api/cases/${encodeURIComponent(caseId)}/bundle/reveal`);
}

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** A group's names as the dialog lists them, the rest counted. */
export function namesWords(group) {
  const names = group?.names ?? [];
  const more = (group?.count ?? names.length) - names.length;
  return `${names.join(', ')}${more > 0 ? `, and ${more} more` : ''}`;
}

/** What stays behind: the internal passages left out, then the rest of the case. */
export function staysWords(internal) {
  const left = Number(internal) || 0;
  return left ? `${plural(left, 'internal passage')}, left out of the text, and the rest of the case.` : 'The rest of the case.';
}
