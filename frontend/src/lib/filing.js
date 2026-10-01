/**
 * Filing an artifact into a My-work folder. Media and captures keep their
 * sidecar in sync through the media endpoint; every other entity stores the
 * folder on the entity itself. Same routing the case sidebar has always used —
 * lifted here so the desktop organizer files items the exact same way.
 *
 * Neither call reloads the case: the caller decides when to refetch (once after
 * a batch, not once per item).
 */
import { api } from './api.js';

export async function assignFolder(caseId, entity, folder) {
  const val = folder || '';
  if ((entity.type === 'media' || entity.type === 'capture') && entity.attrs?.path) {
    await api.patch(`/api/cases/${caseId}/media`, { path: entity.attrs.path, folder: val });
  } else {
    await api.patch(`/api/cases/${caseId}/entities/${entity.id}`, { attrs: { folder: val } });
  }
}

/** File several entities into one folder, in order. */
export async function assignFolderBatch(caseId, entities, folder) {
  for (const entity of entities) await assignFolder(caseId, entity, folder);
}

/**
 * Rename an entity the way Details does. A media or a capture is its file, so
 * the name goes through its own route and renames the file on disk; a note,
 * a proof or a session follows its label on the server.
 */
export async function renameEntity(caseId, entity, name) {
  const title = (name ?? '').trim();
  if (!title) return;
  if (entity.type === 'capture' && entity.attrs?.path) {
    await api.patch(`/api/cases/${caseId}/satellite`, { path: entity.attrs.path, title });
  } else if (entity.type === 'media' && entity.attrs?.path) {
    await api.patch(`/api/cases/${caseId}/media`, { path: entity.attrs.path, title });
  } else {
    await api.patch(`/api/cases/${caseId}/entities/${entity.id}`, { label: title });
  }
}
