/**
 * What "source" means wherever one is stated by hand.
 *
 * A paste, an import and a later correction write the same field, and the server
 * validates the three through one function (`stated_source`, api/media.py). This
 * is that rule on the near side, so a bad address is refused in the dialog rather
 * than coming back as a 422 — and so the three surfaces cannot drift into three
 * ideas of what an origin is.
 *
 * Links only. The field feeds the entity's `source_url`, the proof plate's source
 * line and the lineage a lost file leaves behind, all of which are addresses. An
 * origin that is not one — a hand-off, a disk — is a note.
 */
const HTTP_URL = /^https?:\/\/\S+$/i;

/** Whether a hand-typed origin is one the case can keep. */
export function isSourceUrl(url) {
  return HTTP_URL.test((url ?? '').trim());
}

/** What is wrong with a typed source, or '' when nothing is. */
export function sourceProblem(url) {
  const value = (url ?? '').trim();
  return value && !isSourceUrl(value) ? 'The source must be an http(s) address.' : '';
}

/** The files whose origin only the analyst can state: brought in off a disk, out
 *  of the clipboard, or adopted from the case folder. Mirrors
 *  `STATED_SOURCE_TYPES` (engine/media.py), which is what refuses the write. */
const STATED_SOURCE_TYPES = new Set(['upload', 'clipboard', 'manual']);

/** Whether this file's origin is the analyst's to state. A download's address is
 *  what the app fetched, and a derivative's origin is the file it came out of. */
export function canStateSource(item) {
  return STATED_SOURCE_TYPES.has(item?.source?.type);
}
