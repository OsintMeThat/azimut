/**
 * Creating a filed Markdown note. Its title and folder stay on the entity;
 * its body is written to notes/<entity id>.md by the case API. Lifted out of
 * the case sidebar so the desktop organizer can create notes the same way.
 *
 * Does not reload the case: the caller refetches once it returns.
 */
import { api } from './api.js';

export async function createNote(caseId, { title, folder = '', content = '' }) {
  const label = (title ?? '').trim();
  if (!label) throw new Error('Title required');
  return api.post(`/api/cases/${caseId}/notes`, {
    title: label,
    folder: (folder ?? '').trim(),
    content: content ?? '',
  });
}

export function resetCaseNotes(caseId) {
  return api.put(`/api/cases/${caseId}/notes`, { text: '' });
}

export function deleteNote(caseId, noteId) {
  return api.del(`/api/cases/${caseId}/entities/${noteId}`);
}
