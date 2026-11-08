/**
 * The scenes still to geolocate, as a list words them: the To-do's group in the app
 * (`tools/overview/ToGeolocate.svelte`) and the map panel over another site's map
 * (`extension/maptools.js`, which copies this and is checked against it in
 * `extensionMapTools.test.js`).
 *
 * The rows are the server's (`GET /scenes/queue`, `engine/geolocate.py`): a scene
 * kept in Inspect that no proof takes up yet, `todo` with no capture, `progress`
 * once one is attached, `abandoned` with a word if the analyst gave one.
 */
import { isStretch, sceneColorAt, sceneTime } from './scenes.js';

/** What a picture's scene says instead of a time: a picture is only ever marked whole. */
export const WHOLE_PICTURE = 'Whole picture';

/** Whether a row, or a file of the queue, is a picture rather than a video. */
export const isPicture = (row) => (row?.file_kind ?? row?.kind) === 'image';

/** A scene's time as a row says it: `3:58–4:12`, Whole video, or Whole picture. */
export const queueTime = (scene) => (scene?.file_kind === 'image' ? WHOLE_PICTURE : sceneTime(scene));

/** What a row calls a scene: the analyst's label, else its time. */
export const queueName = (scene) => scene?.label || queueTime(scene);

/**
 * The colour Inspect's bar draws a scene in: by its place among its video's scenes,
 * proofs included (`order`, `engine/geolocate.py`).
 */
export const queueColor = (scene) => sceneColorAt(scene?.order);

/** How a scene is marked on its video's bar: a band, a pin, or nothing for the whole
 *  video and for a picture, which has no bar. */
export function queueMark(scene) {
  if (scene?.file_kind === 'image' || !Number.isFinite(scene?.start)) return null;
  return isStretch(scene) ? 'passage' : 'instant';
}

/** `1 capture`, `3 captures`. */
export const captureWords = (n) => (n === 1 ? '1 capture' : `${n} captures`);

/** How many captures a scene holds: the number the server's last nudge gave, until
 *  its rows are read again (`captureCount`, `lib/geolocating.svelte.js`), else its list's. */
export const captureCount = (scene) =>
  Number.isInteger(scene?.captureCount) ? scene.captureCount : (scene?.captures?.length ?? 0);

/**
 * A scene as a `geolocating` nudge leaves it, before the server is read again: the
 * capture it names attached, and the number it says the scene now holds kept as
 * `captureCount` when the list says otherwise (`api/events.py`). A scene still to
 * geolocate is in progress from its first capture.
 */
export function gatheredScene(scene, event) {
  const next = { ...scene, captures: [...(scene?.captures ?? [])] };
  delete next.captureCount;
  const path = event?.capture;
  if (typeof path === 'string' && path && !next.captures.includes(path)) next.captures.push(path);
  const told = Number.isInteger(event?.captures) && event.captures >= 0 ? event.captures : null;
  if (told != null && told !== next.captures.length) next.captureCount = told;
  if ((told ?? next.captures.length) > 0 && next.state === 'todo') next.state = 'progress';
  return next;
}

/** A scene's state as its row says it; `live` is the one being geolocated. */
export function queueState(scene, live = false) {
  const n = captureCount(scene);
  if (live) return n ? `Geolocating · ${captureWords(n)}` : 'Geolocating';
  if (scene?.state === 'progress' && n) return `In progress · ${captureWords(n)}`;
  return 'To geolocate';
}

/**
 * The files with each one's proofs that state no place yet among its scenes, in the
 * order its bar draws them: what the app's To-do lists and counts. Only the app reads
 * the queue with `proofs`; the extension's never carries them.
 */
export function withProofs(files) {
  return (files ?? []).map((file) => (file.proofs?.length
    ? { ...file, scenes: [...(file.scenes ?? []), ...file.proofs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) }
    : file));
}

/** The files holding scenes `keep` accepts, each with only those scenes. */
export function queueFiles(files, keep) {
  return (files ?? [])
    .map((file) => ({ ...file, scenes: (file.scenes ?? []).filter(keep) }))
    .filter((file) => file.scenes.length);
}

/** The scenes still open, by file: what Geolocate is offered on. */
export const openScenes = (files) => queueFiles(files, (scene) => scene.state !== 'abandoned');

/** The scenes given up on, by file. */
export const abandonedScenes = (files) => queueFiles(files, (scene) => scene.state === 'abandoned');

/** How many scenes the files hold. */
export const sceneCount = (files) => (files ?? []).reduce((n, file) => n + file.scenes.length, 0);

/** `1 scene to geolocate`, `3 scenes to geolocate`. */
export const waitingWords = (n) => (n === 1 ? '1 scene to geolocate' : `${n} scenes to geolocate`);

/**
 * The first `shown` rows across the files, and any row `always` names wherever it
 * falls: the scene being geolocated is never the one counted away.
 */
export function firstScenes(files, shown, always = () => false) {
  let n = 0;
  return queueFiles(files, (scene) => n++ < shown || always(scene));
}
