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
