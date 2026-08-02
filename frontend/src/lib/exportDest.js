/**
 * Export destinations: where the notes PDFs, the media copies and the proof
 * PNGs land, and the folder browser that lets the analyst say so.
 *
 * The destination is remembered per kind, app-wide, in settings — a case folder
 * is not the right home for it, since the whole point is that the analyst files
 * finished work in the same place case after case. An empty destination means
 * the case's own `exports/` folder, which is the default and always exists.
 *
 * The browser cannot hand back a real filesystem path, so the picker walks the
 * backend's folder listing (`/api/folders`) instead of a file input.
 */

import { api } from './api.js';

/** The exports that remember a folder. Mirrors `KINDS` in engine/exportdir.py. */
export const KINDS = ['notes', 'media', 'proofs'];

/** What to call the default in the UI, once per kind so the wording can't drift. */
export const CASE_FOLDER_LABEL = "the case's exports folder";

export const folderRoots = () => api.get('/api/folders/roots');
export const listFolder = (path) => api.get(`/api/folders?path=${encodeURIComponent(path)}`);
export const createFolder = (parent, name) => api.post('/api/folders/create', { parent, name });

/** The saved destination per kind, as `{notes, media, proofs}` of paths. */
export async function readDestinations() {
  const settings = await api.get('/api/settings');
  return normalise(settings.export_dirs);
}

/** Save one kind's destination. An empty path goes back to the case folder. */
export async function saveDestination(kind, path) {
  const prefs = await api.put('/api/settings/prefs', { export_dirs: { [kind]: path ?? '' } });
  return normalise(prefs.export_dirs);
}

function normalise(dirs) {
  const out = {};
  for (const kind of KINDS) out[kind] = (dirs ?? {})[kind] ?? '';
  return out;
}

/**
 * How a destination reads in a button or a toast: the folder's own name, or the
 * default's label. The full path is for the tooltip, not the sentence.
 */
export function destinationLabel(path) {
  const text = String(path ?? '').trim();
  if (!text) return CASE_FOLDER_LABEL;
  const parts = text.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || text;
}
