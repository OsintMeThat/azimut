/**
 * A video thread's recap pictures, drawn in the browser and filed in the case's Media so
 * the thread's first post carries them like any picture: copied, downloaded, or attached
 * by the extension. The contact sheet is drawn from its places' saved pictures
 * (`lib/proofSheet.js`, `POST /scenes/sheet`); the recap map comes drawn
 * (`RecapMap.svelte`, `POST /scenes/map`). The same picture filed again is the file
 * already there.
 */
import { api } from '../../lib/api.js';
import { buildProofSheet } from '../../lib/proofSheet.js';

/** Draw and file the sheet of `slides`, made from `video`. Answers its case path. */
export async function fileThreadSheet(caseId, { video, slides = [] }, { build = buildProofSheet, post = api.post } = {}) {
  const blob = await build(slides, { caseId });
  const form = new FormData();
  form.append('video', video);
  form.append('image', blob, 'contact-sheet.jpg');
  const answer = await post(`/api/cases/${encodeURIComponent(caseId)}/scenes/sheet`, form);
  if (typeof answer?.path !== 'string' || !answer.path) throw new Error('the sheet was not filed');
  return answer.path;
}

/** File the recap map drawn of `video`'s places. Answers its case path. */
export async function fileRecapMap(caseId, { video, blob }, { post = api.post } = {}) {
  const form = new FormData();
  form.append('video', video);
  form.append('image', blob, 'recap-map.jpg');
  const answer = await post(`/api/cases/${encodeURIComponent(caseId)}/scenes/map`, form);
  if (typeof answer?.path !== 'string' || !answer.path) throw new Error('the map was not filed');
  return answer.path;
}
