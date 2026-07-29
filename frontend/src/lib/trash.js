/**
 * The case trash, from the UI side.
 *
 * A delete answers with the group it went into, so the toast that follows can
 * offer to undo it. The server is what decides: no group in the response means
 * nothing was kept — an artifact the graph never claimed — and the toast says so
 * by simply not offering an undo.
 *
 * The copy below is shared so every tool says the same thing about the same
 * gesture. Deleting an artifact is recoverable; emptying the trash, purging one
 * group and deleting a case are not.
 */
import { api } from './api.js';
import { reloadCase, toast } from './state.svelte.js';

/** What a delete dialog promises when the artifact goes to the trash. */
export const RESTORABLE = 'You can restore it from Trash until you empty it.';

export function trashUrl(caseId) {
  return `/api/cases/${caseId}/trash`;
}

/** Read the trash: its groups, how many items they hold and their size. */
export function readTrash(caseId) {
  return api.get(trashUrl(caseId));
}

export async function restoreGroup(caseId, groupId) {
  const result = await api.post(`${trashUrl(caseId)}/${groupId}/restore`, {});
  await reloadCase();
  return result;
}

export async function purgeGroup(caseId, groupId) {
  await api.del(`${trashUrl(caseId)}/${groupId}`);
}

export async function emptyTrash(caseId) {
  return api.del(trashUrl(caseId));
}

/** Bytes as the node shows them: whole units, no decimals below a megabyte. */
export function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / (1024 * 1024))} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * The way back from a delete, or null when the server kept nothing.
 *
 * `result` is the delete response. Restoring reloads the case itself, so a
 * caller only has to hand over what it just deleted.
 */
export function undoAction(caseId, result) {
  if (!result?.trash) return null;
  return {
    label: 'Undo',
    onClick: async () => {
      try {
        await restoreGroup(caseId, result.trash);
        toast('Restored', 'ok', 2200);
      } catch (e) {
        toast(e.message, 'danger');
      }
    },
  };
}

/** Say what was deleted, and offer the way back when there is one. */
export function deletedToast(caseId, result, label) {
  const count = result?.deleted?.length ?? 0;
  const message = count > 1 ? `Deleted ${count} items` : `Deleted “${label}”`;
  toast(message, 'info', 7000, undoAction(caseId, result));
}
