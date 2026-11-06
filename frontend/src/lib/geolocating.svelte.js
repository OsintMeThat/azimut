/**
 * The scene the open case is geolocating, and the queue of scenes still to prove, for
 * every surface that shows them: Inspect's scenes drawer, the pill over the tools, the
 * To-do's "To geolocate" group (`engine/geolocate.py`).
 *
 * The server holds which scene is being geolocated, one per case and for the session
 * only, and attaches every capture filed meanwhile to it, the extension's included.
 * So this copy is only what the app shows: read from the server, read again when the
 * server says it changed (the `geolocating` nudge, `api/events.py`), and never the
 * thing that decides where a capture goes.
 */
import { api } from './api.js';
import { onEvent } from './events.js';
import { uiState } from './state.svelte.js';

/** `scene` is the queue's row for it (`video`, `id`, `start`, `end`, `label`, `state`,
 *  `captures`, `abandoned`, `since`), or null. */
export const geolocating = $state({ caseId: null, scene: null, error: '' });

/** The queue: `files` of `{video, title, scenes}`, or null until read. */
export const sceneQueue = $state({ caseId: null, files: null, busy: false, error: '' });

const base = (caseId) => `/api/cases/${encodeURIComponent(caseId)}`;

function hold(caseId, scene) {
  geolocating.caseId = caseId;
  geolocating.scene = scene ?? null;
  geolocating.error = '';
}

/** Read which scene the case is geolocating. */
export async function readGeolocating(caseId) {
  if (!caseId) return null;
  try {
    const { geolocating: scene } = await api.get(`${base(caseId)}/geolocating`);
    hold(caseId, scene);
    return scene;
  } catch (e) {
    if (geolocating.caseId === caseId) geolocating.error = e.message;
    return null;
  }
}

/** Geolocate one scene to prove: from now on every capture filed is attached to it. */
export async function startGeolocating(caseId, video, draft) {
  const { geolocating: scene } = await api.put(`${base(caseId)}/geolocating`, { video, draft });
  hold(caseId, scene);
  return scene;
}

/**
 * Geolocate a scene and go to the map, its video open as a reference window with the
 * scene marked on its bar (`uiState.geolocateRef`, which Satellite takes up). The one
 * entry point of every Geolocate press: Inspect's drawer, the To-do, the pill.
 * `scene` is a queue row or a drawer's draft: `{video, id}` at least.
 */
export async function geolocateScene(caseId, scene) {
  const held = await startGeolocating(caseId, scene.video, scene.id);
  uiState.geolocateRef = {
    video: held.video, draft: held.id, start: held.start, end: held.end, label: held.label,
  };
  uiState.tool = 'satellite';
  return held;
}

/** Stop geolocating. True when there was one to stop. */
export async function stopGeolocating(caseId) {
  const { ended } = await api.del(`${base(caseId)}/geolocating`);
  hold(caseId, null);
  return ended;
}

/** Read the scenes still to prove, by file. */
export async function readSceneQueue(caseId) {
  if (!caseId) return null;
  if (sceneQueue.caseId !== caseId) {
    sceneQueue.caseId = caseId;
    sceneQueue.files = null;
  }
  sceneQueue.busy = true;
  sceneQueue.error = '';
  try {
    const answer = await api.get(`${base(caseId)}/scenes/queue`);
    if (sceneQueue.caseId !== caseId) return null;
    sceneQueue.files = answer.files;
    hold(caseId, answer.geolocating);
    return answer;
  } catch (e) {
    if (sceneQueue.caseId === caseId) sceneQueue.error = e.message;
    return null;
  } finally {
    if (sceneQueue.caseId === caseId) sceneQueue.busy = false;
  }
}

/** Give up on a scene, with a word if there is one. Answers with its row. */
export async function abandonScene(caseId, video, draft, reason = '') {
  const { scene } = await api.put(`${base(caseId)}/scenes/${encodeURIComponent(draft)}/abandon`, { video, reason });
  if (geolocating.caseId === caseId && geolocating.scene?.id === draft) hold(caseId, null);
  await refreshQueue(caseId);
  return scene;
}

/** Take an abandoned scene up again. Answers with its row. */
export async function restoreScene(caseId, video, draft) {
  const query = new URLSearchParams({ video });
  const { scene } = await api.del(`${base(caseId)}/scenes/${encodeURIComponent(draft)}/abandon?${query}`);
  await refreshQueue(caseId);
  return scene;
}

/** Read the queue again if a surface holds it for this case. */
function refreshQueue(caseId) {
  return sceneQueue.caseId === caseId && sceneQueue.files ? readSceneQueue(caseId) : null;
}

// A file's scenes saved or a proof's time stated (`scenes`), or something deleted or
// restored (`saved`), which can give a scene back or take one up: a queue held for the
// case is read again, once for a burst.
const REQUEUE_MS = 300;
let requeuing = null;
function requeue(caseId) {
  if (caseId !== sceneQueue.caseId || !sceneQueue.files) return;
  clearTimeout(requeuing);
  requeuing = setTimeout(() => {
    requeuing = null;
    readSceneQueue(caseId);
  }, REQUEUE_MS);
}
onEvent('scenes', (event) => requeue(event.case_id));
onEvent('saved', (event) => requeue(event.case_id));

// Started, ended, or a capture attached, from this tab, another, or the extension.
onEvent('geolocating', (event) => {
  if (event.case_id !== geolocating.caseId && event.case_id !== sceneQueue.caseId) return;
  if (event.case_id === sceneQueue.caseId && sceneQueue.files) readSceneQueue(event.case_id);
  else readGeolocating(event.case_id);
});
