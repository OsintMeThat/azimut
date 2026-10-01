/**
 * One copy of the open case's to-do lists, for every surface that shows them:
 * Home and the case sidebar. Each held its own copy before the sidebar had one,
 * and a tick in one would have made the other's next save a stale write.
 *
 * Saving sends the revision the copy was read at; the server refuses a write
 * over a newer one (another browser tab) with 409, and the copy then waits for
 * a reload rather than overwrite what it has not seen.
 */
import { api } from './api.js';

export const todos = $state({ caseId: null, data: null, busy: false, error: '', conflict: false });

const endpoint = (caseId) => `/api/cases/${encodeURIComponent(caseId)}/todos`;

export async function loadTodos(caseId) {
  if (todos.caseId !== caseId) {
    todos.caseId = caseId;
    todos.data = null;
  }
  todos.busy = true;
  todos.error = '';
  try {
    const data = await api.get(endpoint(caseId));
    if (todos.caseId !== caseId) return;
    todos.data = data;
    todos.conflict = false;
  } catch (e) {
    if (todos.caseId === caseId) todos.error = e.message;
  } finally {
    if (todos.caseId === caseId) todos.busy = false;
  }
}

/** Write `lists` over the copy; false when it was refused or not attempted. */
export async function saveTodos(caseId, lists) {
  if (todos.caseId !== caseId || !todos.data || todos.busy || todos.conflict) return false;
  todos.busy = true;
  todos.error = '';
  try {
    const saved = await api.put(endpoint(caseId), { revision: todos.data.revision, lists });
    if (todos.caseId === caseId) todos.data = saved;
    return true;
  } catch (e) {
    todos.error = e.message;
    todos.conflict = e.status === 409;
    return false;
  } finally {
    todos.busy = false;
  }
}
