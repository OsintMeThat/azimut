/**
 * A video thread's contact sheet, drawn in the browser from its places' saved pictures
 * (`lib/proofSheet.js`) and filed in the case's Media (`POST /scenes/sheet`), so the
 * thread's first post carries it like any picture: copied, downloaded, or attached by
 * the extension. The same picture filed again is the file already there.
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
