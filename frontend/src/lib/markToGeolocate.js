/**
 * "Mark to geolocate" from outside Inspect: a picture or a video put in the To-do's To
 * geolocate as a whole, from a menu of the Media Library or Files. Offering it, telling
 * the analyst, and the way back to the list are the same wherever it is pressed; Inspect
 * marks a moment of a video on its own road.
 */
import { markToGeolocate, restoreScene, sceneQueue } from './geolocating.svelte.js';
import { openTodo } from './navigate.js';
import { caseState, toast } from './state.svelte.js';

/** Whether the queue held for the open case has this file marked whole and not given
 *  up on. Unknown while the queue is unread, when the press finds out instead. */
export function markedWhole(path) {
  if (!path || sceneQueue.caseId !== caseState.current?.id) return false;
  const file = (sceneQueue.files ?? []).find((one) => one.video === path);
  return Boolean(file?.scenes.some((scene) => scene.start == null && scene.state !== 'abandoned'));
}

/**
 * Mark a file whole, `{ path, kind }`, and say so with the way to the list. A file
 * given up on is taken up again, since the press says otherwise; one already marked
 * only shows the list; a refusal (a frame of a video, say) is said calmly.
 */
export async function markWhole({ path, kind }) {
  if (markedWhole(path)) {
    openTodo();
    return;
  }
  const caseId = caseState.current?.id;
  if (!caseId) return;
  try {
    let scene = await markToGeolocate(caseId, path);
    const again = scene?.state === 'abandoned';
    if (again) scene = await restoreScene(caseId, path, scene.id);
    const what = kind === 'video' ? 'Whole video marked to geolocate' : 'Marked to geolocate';
    toast(again ? `${what} again` : what, 'ok', null, { label: 'Show', onClick: openTodo });
  } catch (e) {
    const said = String(e?.message || 'Could not mark it to geolocate');
    toast(said.charAt(0).toUpperCase() + said.slice(1), 'warn');
  }
}
