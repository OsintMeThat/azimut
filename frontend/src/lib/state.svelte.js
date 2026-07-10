/**
 * Global app state (Svelte 5 runes).
 *
 * `caseState.current` is the open case (or null). Tools read it to know where
 * to file their outputs; one-shot mode transparently creates a scratch case
 * on first write (see ensureCase).
 */
import { api } from './api.js';

export const caseState = $state({
  current: null, // { id, name, scratch, entities, links, ... }
  list: [],
  loading: false,
  rev: 0, // bumped on every reload so tools can re-fetch their own artifacts
});

export const uiState = $state({
  tool: 'media', // 'media' | 'inspect' | 'satellite' | 'proof' | 'post'
  sidebarOpen: true,
  toasts: [],
  // cross-tool handoffs (the workbench glue):
  composeQueue: [], // media paths queued for the Proof Composer
  postProof: null, // proof spec handed to the Post Composer
  openProof: null, // proof name to load in the Proof Composer
  openDraft: null, // draft name to load in the Post Composer
  inspectPath: null, // media path to open in the Inspect tool
  focusMedia: null, // media path to highlight & scroll to in the Media Library
  openInspect: null, // inspect-session name to reopen in the Inspect tool
  gotoCoords: null, // { lat, lon } to fly to in the Satellite tool
});

let toastSeq = 0;

export function toast(message, kind = 'info', timeout = 3800) {
  const id = ++toastSeq;
  uiState.toasts.push({ id, message, kind });
  setTimeout(() => {
    const i = uiState.toasts.findIndex((t) => t.id === id);
    if (i !== -1) uiState.toasts.splice(i, 1);
  }, timeout);
}

export async function refreshCaseList() {
  caseState.list = await api.get('/api/cases');
}

// Remember the last open case across page reloads so work is never "lost".
const LAST_CASE_KEY = 'ozimut:lastCase';

function rememberCase(id) {
  try {
    if (id) localStorage.setItem(LAST_CASE_KEY, id);
    else localStorage.removeItem(LAST_CASE_KEY);
  } catch {
    /* localStorage unavailable (private mode) — non-fatal */
  }
}

export async function openCase(id) {
  caseState.loading = true;
  try {
    caseState.current = await api.get(`/api/cases/${id}`);
    rememberCase(id);
  } finally {
    caseState.loading = false;
  }
}

/**
 * Startup: load the case list and reopen the last-used case (if it still
 * exists on disk). Called once from App on mount.
 */
export async function initSession() {
  await refreshCaseList();
  let lastId = null;
  try {
    lastId = localStorage.getItem(LAST_CASE_KEY);
  } catch {
    /* ignore */
  }
  if (lastId) {
    try {
      await openCase(lastId);
    } catch {
      rememberCase(null); // it was deleted — forget it
    }
  }
}

export async function reloadCase() {
  if (caseState.current) {
    caseState.current = await api.get(`/api/cases/${caseState.current.id}`);
    caseState.rev++;
  }
}

export async function createCase(name) {
  const created = await api.post('/api/cases', { name });
  await refreshCaseList();
  await openCase(created.id);
  return created;
}

/**
 * One-shot mode: make sure some case exists to receive tool output.
 * Creates a scratch case silently if none is open (spec §3.3).
 */
export async function ensureCase() {
  if (caseState.current) return caseState.current;
  const scratch = await api.post('/api/cases/scratch');
  await refreshCaseList();
  await openCase(scratch.id);
  toast('Scratch session started — “Keep as case…” to save it for good', 'info');
  return caseState.current;
}

/**
 * Rename a case in place (keeps the same id/folder — only the display name
 * changes). Refreshes the list, and the open case if it is the one renamed.
 */
export async function renameCase(id, name) {
  await api.patch(`/api/cases/${id}`, { name });
  await refreshCaseList();
  if (caseState.current?.id === id) await openCase(id);
}

export async function promoteCase(name) {
  if (!caseState.current?.scratch) return;
  const promoted = await api.post(`/api/cases/${caseState.current.id}/promote`, { name });
  await refreshCaseList();
  await openCase(promoted.id);
  toast(`Promoted to case “${name}”`, 'ok');
}

export function closeCase() {
  caseState.current = null;
  rememberCase(null);
}

/**
 * Permanently delete a case and everything it contains (the whole folder on
 * disk — media, satellite, proofs, exports). Irreversible; the caller is
 * responsible for the "type DELETE" confirmation. If the deleted case is the
 * one open, we drop back to one-shot mode.
 */
export async function deleteCase(id) {
  await api.del(`/api/cases/${id}`);
  if (caseState.current?.id === id) closeCase();
  await refreshCaseList();
}
