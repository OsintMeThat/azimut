/**
 * The saved proofs as Geo Proof lists them: its home (Continue, the search) and the Open
 * proof list. The rows are `GET /cases/{id}/proofs`, newest first; a proof resting on a
 * video says which, what the case calls it and where it stands among that video's
 * slides (`video`, `video_title`, `order`, `slide` of `slides`, `engine/scenes.proof_slides`),
 * and a proof on photos says nothing of the kind, so it reads exactly as it always did.
 */
import { matchesTerms } from './folderBrowse.js';
import { itemLabel } from './naming.js';
import { videoName } from './proofScene.js';
import { sceneColorAt } from './scenes.js';

/** How many proofs the home's Continue shows. */
export const CONTINUE_SHOWN = 6;

/** Whether a listed proof is a slide of a video. */
export const onVideo = (entry) => typeof entry?.video === 'string' && !!entry.video && Number.isInteger(entry.slide);

/**
 * The small coloured line a proof of a video carries, or null for one on photos: its
 * video's `name`, and `where` it stands, `2/4` where room is short and `slide 2 of 4` in
 * the list. A video's only slide has no place to state, so its `where` is empty. A long
 * name gives way on screen and `where` never does; `text` is the whole line, for a hover.
 * Its colour is the one Inspect's bar and the strip give the proof's scene.
 */
export function slideTag(entry, { short = false } = {}) {
  if (!onVideo(entry)) return null;
  const name = videoName(entry.video, entry.video_title);
  const where = entry.slides > 1 ? (short ? `${entry.slide}/${entry.slides}` : `slide ${entry.slide} of ${entry.slides}`) : '';
  return { name, where, text: where ? `${name} · ${where}` : name, color: sceneColorAt(entry.order) };
}

/**
 * How many of the last proofs the home's Continue shows in a grid `columns` wide, so no
 * card stands alone on a line: one full row, or two where the grid is too narrow for
 * three. Every one while the grid has not been measured.
 */
export function continueShown(columns, shown = CONTINUE_SHOWN) {
  if (!Number.isInteger(columns) || columns < 1) return shown;
  return Math.min(shown, columns >= 3 ? columns : columns * 2);
}

/** The proofs the home's Continue shows: the last ones saved. */
export const recentProofs = (entries, shown = CONTINUE_SHOWN) => (entries ?? []).slice(0, shown);

/**
 * What a listed proof is called (`naming.itemLabel`): its name when the analyst gave it
 * one; else where its conclusion stands as the case knows it (`place`, `GET /proofs` and
 * the scenes' rows) and its day (its date, else when it was made); else its point.
 */
export function proofLabel(entry, now = new Date()) {
  const point = (entry?.points ?? []).find((one) => Number.isFinite(one?.lat) && Number.isFinite(one?.lon));
  return itemLabel('proof', entry?.title ?? entry?.name, {
    place: entry?.place,
    when: [entry?.when, entry?.created_at],
    coords: point ?? null,
  }, now);
}

/**
 * The proofs a search finds by their label, in the list's order: by the name the analyst
 * gave, or by where one with none stands. A technical name, never shown, finds nothing.
 */
export function findProofs(entries, query) {
  if (!String(query ?? '').trim()) return [];
  return (entries ?? []).filter((entry) => matchesTerms(proofLabel(entry), query));
}

/**
 * The videos the listed proofs rest on, for the Open list's filter: each with its name
 * and how many proofs, by name. `none` counts the proofs on photos.
 */
export function proofVideos(entries) {
  const counts = new Map();
  const titles = new Map();
  let none = 0;
  for (const entry of entries ?? []) {
    if (onVideo(entry)) {
      counts.set(entry.video, (counts.get(entry.video) ?? 0) + 1);
      if (entry.video_title) titles.set(entry.video, entry.video_title);
    } else none += 1;
  }
  const videos = [...counts].map(([video, count]) => ({ video, name: videoName(video, titles.get(video)), count }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.video.localeCompare(b.video));
  return { videos, none };
}

/** The filter's value for the proofs on no video. */
export const NO_VIDEO = '\u0000photos';

/** Whether a listed proof passes the video filter: '' for every proof. */
export function inVideo(entry, filter) {
  if (!filter) return true;
  if (filter === NO_VIDEO) return !onVideo(entry);
  return onVideo(entry) && entry.video === filter;
}
