/**
 * What a file says about its own dates, in words: the camera's clock, the date it
 * was published, the day an image was taken from orbit.
 *
 * Shown beside the date an analyst gives an event and never put into it (D3): a file
 * date offered as the event's date would be accepted without being read, which is
 * the argument Geo Proof settled. The dates come from the Timeline's own projection
 * of the file (`/timeline?entity=…`), so nothing is read twice.
 */
import { api } from './api.js';
import { formatTemporalValue, temporalKindLabel } from './timeline.js';

/** The types whose own dates are worth saying: files, map captures, proofs. */
export const FILE_TYPES = new Set(['media', 'capture', 'proof']);

/** The kinds that date what a file shows. When it was collected or added says when
 *  the analyst had it, not what happened, so those stay out. */
export const FILE_DATE_KINDS = ['captured', 'taken', 'published', 'imagery', 'imagery-a', 'imagery-b'];

/** "captured 12 Mar 2026, 14:02 · published 14 Mar 2026", from timeline rows. */
export function fileDateWords(items, ownerId) {
  return (items ?? [])
    .filter((item) => item.owner_id === ownerId && item.raw && FILE_DATE_KINDS.includes(item.kind))
    .sort((a, b) => FILE_DATE_KINDS.indexOf(a.kind) - FILE_DATE_KINDS.indexOf(b.kind))
    .map((item) => `${temporalKindLabel(item.kind).toLowerCase()} ${formatTemporalValue(shortClock(item.raw)).label}`)
    .join(' · ');
}

/** A camera clock read to the microsecond says the same thing to the second, which
 *  is as far as anybody reads it beside a field. */
function shortClock(raw) {
  return String(raw).replace(/(T\d\d:\d\d:\d\d)\.\d+/, '$1');
}

export async function fetchFileDates(caseId, entityId, { get = api.get } = {}) {
  const params = new URLSearchParams({ entity: entityId, include_undated: 'false', limit: '50' });
  params.append('category', 'media');
  const page = await get(`/api/cases/${caseId}/timeline?${params}`);
  return fileDateWords(page?.items, entityId);
}
