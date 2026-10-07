/**
 * An area, or a group of them, as a file between two Azimut analysts.
 *
 * Not a map file: GeoJSON and KML already come in as followed layers and
 * answer another question. This carries the names, the colours and the folder,
 * which no generic format keeps.
 */
import { api } from './api.js';

export function areaFileUrl(caseId, kind, ident) {
  return `/api/cases/${encodeURIComponent(caseId)}/analysis/${kind}/${encodeURIComponent(ident)}/share`;
}

/** Download it the way a case bundle downloads: a link the browser follows. */
export function downloadAreas(caseId, kind, ident) {
  const link = document.createElement('a');
  link.href = areaFileUrl(caseId, kind, ident);
  link.download = '';
  document.body.append(link);
  link.click();
  link.remove();
}

export async function importAreasFile(caseId, file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('This file is not JSON. Use the Share action on an area or a group to make one.');
  }
  return api.post(`/api/cases/${encodeURIComponent(caseId)}/analysis/areas/import`, parsed);
}

/** What arrived, in one line. */
export function importedGround(result) {
  const parts = [];
  const areas = result?.areas?.length ?? 0;
  const groups = result?.groups?.length ?? 0;
  parts.push(`${areas} area${areas === 1 ? '' : 's'}`);
  if (groups) parts.push(`${groups} group${groups === 1 ? '' : 's'}`);
  return parts.join(' and ');
}

/**
 * What the analyst has to know about ground that just arrived, a line each.
 * Nothing here stops it being used; it says where it differs from the case it
 * was sent from.
 */
export function importAreaNotes(result) {
  const notes = [];
  const renamed = result?.renamed ?? [];
  if (renamed.length) {
    notes.push(`This case already had ${renamed.join(', ')}, so what arrived is numbered.`);
  }
  const ignored = result?.ignored_fields ?? [];
  if (ignored.length) {
    const by = result.written_by ? `Azimut ${result.written_by}` : 'a newer Azimut';
    notes.push(`Written by ${by}, so ${ignored.join(', ')} went unread here.`);
  }
  return notes;
}
