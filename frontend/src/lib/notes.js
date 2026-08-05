/**
 * Creating a filed Markdown note. Its title and folder stay on the entity;
 * its body is written to notes/<entity id>.md by the case API. Lifted out of
 * the case sidebar so the desktop organizer can create notes the same way.
 *
 * Does not reload the case: the caller refetches once it returns.
 */
import { api } from './api.js';

export async function createNote(caseId, { title, folder = '', content = '', sources = [] }) {
  const label = (title ?? '').trim();
  if (!label) throw new Error('Title required');
  return api.post(`/api/cases/${caseId}/notes`, {
    title: label,
    folder: (folder ?? '').trim(),
    content: content ?? '',
    // case-relative paths the note was written from, filed as derivation edges.
    // A note typed by hand sends none; a report sends the proof and media it embeds.
    sources: sources.filter(Boolean),
  });
}

export function resetCaseNotes(caseId) {
  return api.put(`/api/cases/${caseId}/notes`, { text: '' });
}

export function deleteNote(caseId, noteId) {
  return api.del(`/api/cases/${caseId}/entities/${noteId}`);
}
