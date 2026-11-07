/**
 * A scene to geolocate given a new time from outside Inspect: the Collage tool
 * changes the moment its collage was marked over, by the path Inspect itself takes,
 * the work saved for the video (`PUT /inspect/work`), its scene's start and end moved.
 *
 * Inspect saves its work whole, so a tab holding the same video would write the old
 * time back with its next save. `retimed` tells it, and it takes the new one up
 * (`tools/Inspector.svelte`).
 */
import { api } from './api.js';

/** The last scene given a new time here: `{ caseId, video, draft, start, end, n }`. */
export const retimed = $state({ caseId: null, video: null, draft: null, start: null, end: null, n: 0 });

const workUrl = (caseId) => `/api/cases/${caseId}/inspect/work`;

/**
 * Give scene `draft` of `video` the time `{ start, end }` (both null for the whole
 * video, no end for an instant), and answer the time it had.
 */
export async function retimeScene(caseId, video, draft, { start = null, end = null }) {
  const { work } = await api.get(`${workUrl(caseId)}?path=${encodeURIComponent(video)}`);
  const spec = work?.spec;
  const scenes = Array.isArray(spec?.scenes) ? spec.scenes : [];
  const held = scenes.find((scene) => scene.id === draft);
  if (!held) throw new Error('That scene is no longer in its video');
  const before = { start: held.start ?? null, end: held.end ?? null };
  const next = scenes.map((scene) => (scene.id === draft ? { ...scene, start, end: start == null ? null : end } : scene));
  await api.put(workUrl(caseId), { path: video, spec: { ...spec, scenes: next } });
  Object.assign(retimed, { caseId, video, draft, start, end: start == null ? null : end, n: retimed.n + 1 });
  return before;
}
