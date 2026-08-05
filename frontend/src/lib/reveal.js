/**
 * Open a folder in the system's own file manager.
 *
 * The browser can't do this, so the backend does it (`engine/reveal.py`). Neither
 * call sends a path: the case id, or nothing at all for the workspace, is the
 * whole input, so the button can only ever open the folder it names.
 */

import { api } from './api.js';

export function revealCaseFolder(caseId) {
  return api.post(`/api/cases/${encodeURIComponent(caseId)}/reveal`);
}

export function revealWorkspaceFolder() {
  return api.post('/api/settings/reveal-workspace');
}

/**
 * Show the folder holding one of a case's files.
 *
 * This one does send a path, because the file is what the analyst pointed at. It
 * is a case-relative path like every other media route takes, resolved inside the
 * case server-side; what opens is the folder, never the file.
 */
export function revealMediaFolder(caseId, path) {
  return api.post(`/api/cases/${encodeURIComponent(caseId)}/media/reveal`, { path });
}
