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

/** Entity types backed by a file on disk — deleting them drops the file too.
 *  Mirrors `engine/artifacts.KINDS`, and `test_sheets.py` fails when the two lists
 *  disagree: a sheet gained a file and this promised the analyst it had none. */
export const FILE_BACKED = new Set([
  'media',
  'capture',
  'proof',
  'post',
  'inspect-session',
  'note',
  'sheet',
]);

/**
 * What a delete asks before it runs, for one row or for a whole selection.
 *
 * One dialog for one gesture wherever the click came from, so the board's ticked
 * rows and the organizer's selected tiles cannot drift into two promises about
 * the same act. A single target previews the plan the backend will enforce over
 * the dependents endpoint; a selection does not, since that is one request per
 * row for a list nobody would read.
 */
export async function entityDeletePrompt(caseId, entities, { get = api.get } = {}) {
  const many = entities.length > 1;
  let consequences = null;
  if (!many && entities.length) {
    try {
      consequences = await get(`/api/cases/${caseId}/entities/${entities[0].id}/dependents`);
    } catch {
      /* no preview — the delete still enforces the plan server-side */
    }
  }
  const files = entities.some((entity) => FILE_BACKED.has(entity.type));
  return {
    title: many ? `Delete ${entities.length} items?` : 'Delete everywhere?',
    message: many
      ? `${entities.length} items will be removed from the case and their tools.`
      : `“${entities[0]?.label}” will be removed from the case and its tool.`,
    detail: files
      ? `Moves ${many ? 'the items and their files' : 'the item and its files'} to the case trash.`
      : `Moves ${many ? 'the items' : 'the item'} to the case trash.`,
    consequences,
    restorable: RESTORABLE,
    confirmLabel: many ? 'Delete all' : 'Delete everywhere',
    tone: 'default',
    icon: 'trash',
  };
}

/**
 * Run that delete, and answer with what the case did.
 *
 * A selection goes over the bulk route so the whole act lands in the trash as
 * **one** group: undoing a mis-click row by row would take as long as the
 * mis-click did, which is the same as having no way back.
 */
export function deleteEntities(caseId, ids) {
  return ids.length > 1
    ? api.post(`/api/cases/${caseId}/entities/delete`, { ids })
    : api.del(`/api/cases/${caseId}/entities/${ids[0]}`);
}

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
