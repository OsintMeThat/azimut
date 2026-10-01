/**
 * Folder actions shared by Files and the case sidebar: renaming a folder,
 * removing one, and the case's work folder. One wording and one Undo, whichever
 * of the two surfaces the analyst pressed them in.
 *
 * Each call reloads the case: the folder list, the sidebar's counts and every
 * picker read it from there.
 */
import { api } from './api.js';
import { caseState, reloadCase, toast, uiState } from './state.svelte.js';

export const leafOf = (path) => (path ?? '').split('/').pop();
export const parentOf = (path) => (path ?? '').split('/').slice(0, -1).join('/');

/** The folder new files and saved work land in, or null. */
export const workFolder = () => caseState.current?.work_folder ?? null;

/** The path and every folder above it, outermost first. */
export function ancestorsOf(path) {
  const segments = (path ?? '').split('/').filter(Boolean);
  return segments.map((_, i) => segments.slice(0, i + 1).join('/'));
}

/** True when `path` is `root` or sits under it. */
export const inSubtree = (path, root) => Boolean(path) && (path === root || path.startsWith(`${root}/`));

/**
 * Where a folder goes when its own name changes to `name`: same parent, new last
 * segment. Null when the name cannot be one segment, or does not change anything.
 */
export function renamedPath(path, name) {
  const leaf = (name ?? '').trim();
  if (!leaf || leaf.includes('/')) return null;
  const parent = parentOf(path);
  const target = parent ? `${parent}/${leaf}` : leaf;
  return target === path ? null : target;
}

/** Rename `source` to `target`, offering the way back on the toast. */
export async function renameFolder(caseId, source, target) {
  await api.post(`/api/cases/${caseId}/folders/rename`, { source, target });
  await reloadCase();
  toast(`Renamed to ${leafOf(target)}`, 'ok', 6000, {
    label: 'Undo',
    onClick: async () => {
      try {
        await api.post(`/api/cases/${caseId}/folders/rename`, { source: target, target: source });
        await reloadCase();
      } catch (e) {
        toast(e.message, 'danger');
      }
    },
  });
}

/** Drop a folder and its subfolders. Its items are unfiled by the server. */
export async function removeFolder(caseId, path) {
  await api.del(`/api/cases/${caseId}/folders?name=${encodeURIComponent(path)}`);
  await reloadCase();
}

/** Work in `folder`, or stop with null. */
export async function setWorkFolder(caseId, folder) {
  await api.put(`/api/cases/${caseId}/work-folder`, { folder: folder || null });
  await reloadCase();
}

/** The confirmation both surfaces show before removing a folder. */
export function removeFolderPrompt(path, folders) {
  const subs = folders.filter((f) => f.startsWith(`${path}/`)).length;
  return {
    title: 'Remove this folder?',
    message: subs
      ? `“${leafOf(path)}” and its ${subs} subfolder${subs === 1 ? '' : 's'} will be removed.`
      : `“${leafOf(path)}” will be removed.`,
    detail: 'Items inside are unfiled. No files are deleted.',
    confirmLabel: 'Remove folder',
    tone: 'default',
    icon: 'folderMinus',
  };
}

/**
 * Say that something was filed, and where, when the work folder took it.
 *
 * Nothing was asked on the way in (an upload, a download, a quick place, the
 * extension), so the toast is the one place the analyst hears which folder it
 * went to, and its Move is the way out when it was filed for another thread.
 * `lead` reads before the folder ("2 files filed"); `fallback` is the message
 * when no work folder was involved. A toast that already offers something
 * (`action`) keeps it and names the folder in its words only.
 */
export function filedToast(lead, entities, { fallback = lead, action = null, timeout = 3800 } = {}) {
  const folder = workFolder();
  const filed = (entities ?? []).filter(Boolean);
  if (!folder || !filed.length || !filed.every((e) => e.attrs?.folder === folder)) {
    return toast(fallback, 'ok', action ? Math.max(timeout, 6000) : timeout, action);
  }
  return toast(`${lead} in ${leafOf(folder)}`, 'ok', 7000, action ?? {
    label: 'Move',
    onClick: () => (uiState.moving = filed),
  });
}
