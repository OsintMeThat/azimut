/**
 * A scene's two counts, which say at a glance whether it is ready to prove: what the
 * map gave it and what its file gives it.
 *
 * - **Map**: the captures gathered for it while it was geolocated (Satellite, Compare,
 *   Horizon, the extension's map screenshots), its `captures`.
 * - **Video**: the frames of its video's strip that fall in it, filed or not, and the
 *   video's collages there, its `footage`. A picture marked to geolocate gives one: the
 *   picture itself.
 *
 * Both come with the server's rows (`engine/scenes.draft_row`), so the To-do, the pill
 * and Geo Proof say the same numbers. Inspect counts its own strip as it stands
 * (`lib/sceneFrames.sceneFootage`), by the same rule.
 */
import { captureCount } from './sceneQueue.js';

/** Whether a scene is a picture marked to geolocate, rather than a scene of a video. */
const isPictureScene = (scene) => scene?.file_kind === 'image';

/** What the map gave the scene: the captures gathered for it. */
export const mapCount = (scene) => captureCount(scene);

/** What its file gives it: its video's frames and collages in it, or 1 for a picture. */
export function videoCount(scene) {
  if (isPictureScene(scene)) return 1;
  return Number.isInteger(scene?.footage) && scene.footage > 0 ? scene.footage : 0;
}

/**
 * Where a scene stands, as its small mark shows it: `live` while it is the one being
 * geolocated, `abandoned`, `progress` once a capture is gathered for it, else `todo`.
 */
export function sceneStage(scene, live = false) {
  if (live) return 'live';
  if (scene?.state === 'abandoned') return 'abandoned';
  return scene?.state === 'progress' && mapCount(scene) > 0 ? 'progress' : 'todo';
}

const STAGE_WORDS = { live: 'Geolocating', progress: 'In progress', todo: 'To geolocate', abandoned: 'Abandoned' };

/** `To geolocate`, `In progress`, `Geolocating`, `Abandoned`. */
export const stageWords = (stage) => STAGE_WORDS[stage] ?? STAGE_WORDS.todo;

/** `no map capture yet`, `1 map capture`, `3 map captures`. */
export function mapWords(n) {
  if (!n) return 'no map capture yet';
  return n === 1 ? '1 map capture' : `${n} map captures`;
}

/** `nothing from the video yet`, `1 picture from the video`, …, or `the picture itself`. */
export function videoWords(n, picture = false) {
  if (picture) return 'the picture itself';
  if (!n) return 'nothing from the video yet';
  return n === 1 ? '1 picture from the video' : `${n} pictures from the video`;
}

/** The counts in words, for a hover: `In progress: 2 map captures, 5 pictures from the video`. */
export function countWords(scene, live = false) {
  const said = `${mapWords(mapCount(scene))}, ${videoWords(videoCount(scene), isPictureScene(scene))}`;
  return `${stageWords(sceneStage(scene, live))}: ${said}`;
}
