/**
 * Pictures sent to Geo Proof from a map tab: Horizon's Send to Geo Proof, and the Send
 * to Geo Proof of Satellite's saved rows, Compare's comparisons among them.
 *
 * While the case geolocates a scene that gathered them (the server attaches every
 * capture filed meanwhile to it, `engine/geolocate.py`), they make that scene's proof as
 * Make the proof does (`uiState.proofScene`): a new proof holding the scene, taken up at
 * its first save with nothing left to offer, or the proof open when it holds that scene
 * already (`join`). A picture marked to geolocate is laid out first, as its Make the proof
 * lays it out.
 *
 * Otherwise Horizon's view (`view`), the photo and the terrain through one frame, is a
 * proof of its own: it joins the proof open only while that one was never saved, a proof
 * being put together. A saved proof open is somebody's finished work, possibly published
 * and open for days, and the view laid into it went out under its name. The new proof
 * holds the video the photo was cut from, when one is (`footageOf`). Any other picture
 * joins the proof open, as it always did (`uiState.composeQueue`).
 */
import { geolocating } from './geolocating.svelte.js';
import { pictureHandoff, proofHandoff } from './sceneFrames.js';
import { uiState } from './state.svelte.js';

/**
 * The Make the proof handoff for these pictures, or null when the scene geolocated did
 * not gather every one. `held` is the scene the pill holds (`geolocating.scene`), and
 * `kept` what the server answered as it filed them, `{ path, scene }` each, `scene` the
 * one it attached the picture to.
 */
export function geolocatedHandoff(kept, held) {
  const pictures = (kept ?? []).filter((one) => typeof one?.path === 'string' && one.path);
  if (!held?.id || !held.video || !pictures.length) return null;
  const gathered = new Set(held.captures ?? []);
  const ours = (one) => gathered.has(one.path) || (one.scene?.id === held.id && one.scene?.video === held.video);
  if (!pictures.every(ours)) return null;
  const paths = pictures.map((one) => one.path);
  const handoff = held.file_kind === 'image'
    ? pictureHandoff(held, held.video, paths)
    : proofHandoff({ ...held, kind: 'draft' }, held.video, paths);
  return { ...handoff, join: true };
}

/**
 * The handoff of a Horizon view not gathered by a scene: its pictures, the case file of
 * the photo laid (`photo`, or null for one from disk or another case), and `view`, which
 * has the composer join only a proof never saved (`ProofComposer.makeSceneProof`).
 */
export function viewHandoff(kept, photo = null) {
  const panels = (kept ?? []).map((one) => one?.path).filter((path) => typeof path === 'string' && path);
  return { panels: [...new Set(panels)], photo: typeof photo === 'string' && photo ? photo : null, view: true };
}

/**
 * Send these pictures to Geo Proof, `{ path, scene? }` each: the proof of the scene the
 * case geolocates when it gathered them; else, for Horizon's view (`view`, with the case
 * file of its photo), a proof of its own; else panels of the proof open. Answers the
 * handoff made, or null.
 */
export function sendToGeoProof(caseId, kept, { view = false, photo = null } = {}) {
  const held = geolocating.caseId === caseId ? geolocating.scene : null;
  const handoff = geolocatedHandoff(kept, held) ?? (view ? viewHandoff(kept, photo) : null);
  if (handoff) {
    uiState.proofScene = handoff;
  } else {
    for (const { path } of kept ?? []) if (path && !uiState.composeQueue.includes(path)) uiState.composeQueue.push(path);
  }
  uiState.tool = 'proof';
  return handoff;
}

/**
 * Keep pictures drawn at once in the order given: every one encoded together (`encode`,
 * the browser's PNG), then filed one after the other (`keep(blob, part)`), so the scene
 * that gathers them lists them in that order. Answers what each `keep` answered.
 */
export async function keepInOrder(frames, parts, { encode, keep }) {
  const blobs = await Promise.all(frames.map((frame) => encode(frame)));
  const kept = [];
  for (const [at, part] of parts.entries()) kept.push(await keep(blobs[at], part));
  return kept;
}
