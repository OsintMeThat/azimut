/**
 * What a file says about its own dates: the camera's clock, the date it was
 * published, the day an image was taken from orbit.
 *
 * Offered beside the date an analyst gives an event, one press each, and never put
 * in by itself (D3): a date filled in automatically is accepted without being read,
 * which is the argument Geo Proof settled. A press is the analyst's own gesture, like
 * a click on the axis, and what it fills is theirs to correct: a post's date is when
 * it went online, rarely when it happened. The dates come from the Timeline's own
 * projection of the file (`/timeline?entity=…`), so nothing is read twice.
 *
 * What an analyst already concluded comes first: the date typed on a proof is stated
 * for the footage the proof rests on (`api/proofs.py`, `_date_the_material`), and a
 * correction of a file's date is the same kind of statement. Both are events about the
 * file with the `observed` role, in the same projection.
 */
import { api } from './api.js';
import { formatTemporalValue, temporalKindLabel } from './timeline.js';

/** The types whose own dates are worth offering: files, map captures, proofs. */
export const FILE_TYPES = new Set(['media', 'capture', 'proof']);

/** The kinds that date what a file shows, most trusted first. When it was collected
 *  or added says when the analyst had it, not what happened, so those stay out. */
export const FILE_DATE_KINDS = ['captured', 'taken', 'imagery', 'imagery-a', 'imagery-b', 'published'];

/** What pressing each one takes, and what to keep in mind about it. */
const HINTS = {
  captured: "Use the camera's date, whose clock can be off",
  taken: "Use the camera's date, whose clock can be off",
  imagery: 'Use the day the picture was taken from orbit',
  'imagery-a': 'Use the day picture A was taken',
  'imagery-b': 'Use the day picture B was taken',
  published: "Use the post's date, rarely when it happened",
};

/** A camera clock read to the microsecond says the same thing to the second, which
 *  is as far as anybody reads it beside a field. */
function shortClock(raw) {
  return String(raw).replace(/(T\d\d:\d\d:\d\d)\.\d+/, '$1');
}

/** The dates already stated for the file: a proof's first, then a correction. */
function statedOffers(items, fileId) {
  return (items ?? [])
    .filter((item) => item.kind === 'claim' && item.raw && item.time_role === 'observed'
      && (item.subject_entities ?? []).some((entity) => entity.id === fileId))
    .map((item) => {
      const value = shortClock(item.raw);
      const proof = (item.source_entities ?? []).some((entity) => entity.type === 'proof');
      const kind = proof ? 'proof' : 'stated';
      return {
        kind,
        value,
        words: `${kind} ${formatTemporalValue(value, item.tz, item.time_role).label}`,
        hint: proof ? 'Use the date its proof gives' : 'Use the date already stated for this file',
      };
    })
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'proof' ? -1 : 1));
}

/**
 * The dates a file offers, from its Timeline rows: `{ kind, value, words, hint }`.
 * What was already stated for it comes first, then the camera, and the post last.
 * `value` is what a press puts in the field.
 */
export function fileDateOffers(items, ownerId) {
  const seen = new Set();
  const own = (items ?? [])
    .filter((item) => item.owner_id === ownerId && item.raw && FILE_DATE_KINDS.includes(item.kind))
    .sort((a, b) => FILE_DATE_KINDS.indexOf(a.kind) - FILE_DATE_KINDS.indexOf(b.kind))
    .map((item) => {
      const value = shortClock(item.raw);
      const kind = temporalKindLabel(item.kind).toLowerCase();
      return { kind, value, words: `${kind} ${formatTemporalValue(value).label}`, hint: HINTS[item.kind] ?? '' };
    });
  return [...statedOffers(items, ownerId), ...own]
    .filter((offer) => (seen.has(offer.value) ? false : seen.add(offer.value)));
}

export async function fetchFileDates(caseId, entityId, { get = api.get } = {}) {
  const params = new URLSearchParams({ entity: entityId, include_undated: 'false', limit: '50' });
  params.append('category', 'media');
  params.append('category', 'statement');
  const page = await get(`/api/cases/${caseId}/timeline?${params}`);
  return fileDateOffers(page?.items, entityId);
}
