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

/**
 * The dates a file offers, from its Timeline rows: `{ kind, value, words, hint }`,
 * the camera first and the post last. `value` is what a press puts in the field.
 */
export function fileDateOffers(items, ownerId) {
  const seen = new Set();
  return (items ?? [])
    .filter((item) => item.owner_id === ownerId && item.raw && FILE_DATE_KINDS.includes(item.kind))
    .sort((a, b) => FILE_DATE_KINDS.indexOf(a.kind) - FILE_DATE_KINDS.indexOf(b.kind))
    .map((item) => {
      const value = shortClock(item.raw);
      const kind = temporalKindLabel(item.kind).toLowerCase();
      return { kind, value, words: `${kind} ${formatTemporalValue(value).label}`, hint: HINTS[item.kind] ?? '' };
    })
    .filter((offer) => (seen.has(offer.value) ? false : seen.add(offer.value)));
}

export async function fetchFileDates(caseId, entityId, { get = api.get } = {}) {
  const params = new URLSearchParams({ entity: entityId, include_undated: 'false', limit: '50' });
  params.append('category', 'media');
  const page = await get(`/api/cases/${caseId}/timeline?${params}`);
  return fileDateOffers(page?.items, entityId);
}
