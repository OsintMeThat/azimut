/**
 * A scene to geolocate given a new time from outside Inspect: the Collage tool
 * changes the moment its collage was marked over (`PUT /scenes/{draft}/time`), which
 * moves that scene's moments alone, so an Inspect save landing meanwhile is kept.
 *
 * Inspect saves its work whole, so a tab holding the same video would write the old
 * time back with its next save. `retimed` tells it, and it takes the new one up
 * (`tools/Inspector.svelte`).
 */
import { api } from './api.js';

/** The last scene given a new time here: `{ caseId, video, draft, start, end, more, n }`. */
export const retimed = $state({ caseId: null, video: null, draft: null, start: null, end: null, more: null, n: 0 });

/**
 * Give scene `draft` of `video` the time `{ start, end, more }` (both null for the
 * whole video, no end for an instant, `more` the moments after the first), and
 * answer the time it had.
 */
export async function retimeScene(caseId, video, draft, { start = null, end = null, more = null }) {
  const time = { start, end: start == null ? null : end, more: start != null && more?.length ? more : null };
  const { before } = await api.put(
    `/api/cases/${encodeURIComponent(caseId)}/scenes/${encodeURIComponent(draft)}/time`,
    { video, start: time.start, end: time.end, ...(time.more ? { more: time.more } : {}) },
  );
  Object.assign(retimed, { caseId, video, draft, ...time, n: retimed.n + 1 });
  return { start: before?.start ?? null, end: before?.end ?? null, more: before?.more ?? null };
}

/**
 * A scene the server gave a time of its own accord: marking a time on a video whose one
 * scene still to prove is about the whole of it hands that scene the time
 * (`POST /scenes/mark`, `engine/geolocate.mark`). Told as a retime, so a tab holding the
 * video takes it up; a scene it does not hold, or holds at that time, changes nothing.
 */
export function retimedBy(caseId, scene) {
  if (scene?.kind !== 'draft' || !Number.isFinite(scene.start)) return;
  const more = scene.more?.length ? scene.more : null;
  Object.assign(retimed, { caseId, video: scene.video, draft: scene.id, start: scene.start, end: scene.end ?? null, more, n: retimed.n + 1 });
}
