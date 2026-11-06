/**
 * The frames cut from a video and its scenes: which scenes a frame falls in, and
 * which frames a scene's proof starts from.
 *
 * A capture never makes a scene. A frame belongs to a scene by its time, inside one
 * of its passages or on one of its instants, and a proof about the whole video by
 * the frames it rests on. The strip marks it with a dot in that scene's colour, and
 * Make the proof offers the scene's frames, all ticked. A draft about the whole
 * video marks no frame, since it would mark them all, but it offers every one.
 */
import { DEFAULT_FPS } from './inspectPlayer.js';
import { isAbandoned, isStretch, sceneMoments, sceneStart, sceneTitle } from './scenes.js';

/** A frame's length in seconds: the clip's, else a thirtieth while its rate is unknown. */
const frameLength = (frame) => (frame > 0 ? frame : 1 / DEFAULT_FPS);

/**
 * Whether the frame cut at `time`, `frame` seconds long, falls in a moment. Decided by
 * the frame, never by the float: the time a frame keeps is read off the file, the
 * time S keeps is counted by the player, and the two part by a hair (238.446542
 * against 238.44678 at 23.976 fps). So each boundary gives half a frame. A frame is
 * in a passage when most of it is, its middle between the start and the end, and it
 * shows an instant when it starts within half a frame of it.
 */
export function frameInMoment(time, moment, frame) {
  if (!Number.isFinite(time) || !Number.isFinite(moment?.start)) return false;
  const half = frameLength(frame) / 2;
  if (isStretch(moment)) return time + half >= moment.start && time + half < moment.end;
  return time - half <= moment.start && moment.start < time + half;
}

/** The scenes the frame cut at `time` belongs to, in the order they are listed. */
export function scenesAt(time, scenes, frame) {
  return (scenes ?? []).filter((scene) => {
    const moments = sceneMoments(scene);
    if (moments.length) return moments.some((m) => frameInMoment(time, m, frame));
    return scene.kind === 'proof' && (scene.at ?? []).some((t) => frameInMoment(time, { start: t, end: null }, frame));
  });
}

/** `a`, `a and b`, `a, b and c`. */
const listed = (words) => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0] ?? '');

/** What a scene is called beside a frame: its title, or what it is when it has none. */
function sceneName(scene) {
  if (isAbandoned(scene)) return scene.label ? `${scene.label} (abandoned)` : 'an abandoned scene';
  return scene.kind === 'draft' && !scene.label ? 'a scene to geolocate' : sceneTitle(scene);
}

/**
 * By frame id, the scenes each frame cut from the clip falls in, `{ key, color,
 * title }`. An abandoned scene still holds its frames, so none of them is offered a
 * scene of its own, and its dot is greyed (`abandoned`).
 */
export function frameScenes(frames, scenes, frame) {
  const out = new Map();
  for (const f of frames ?? []) {
    if (f.time == null) continue;
    const held = scenesAt(f.time, scenes, frame);
    if (held.length) {
      out.set(f.id, held.map((s) => ({
        key: s.key, color: s.color, title: sceneName(s), ...(isAbandoned(s) ? { abandoned: true } : {}),
      })));
    }
  }
  return out;
}

/** What a frame's dots say on hover: `In Bridge and a scene to geolocate`. */
export const inScenes = (held) => `In ${listed(held.map((sc) => sc.title))}`;

/** What a frame says of the proofs it is a panel of: `Used in Proof 29`, or nothing. */
export function usedIn(proofs) {
  const titles = [...new Set((proofs ?? []).map((p) => p.title || p.proof))];
  return titles.length ? `Used in ${listed(titles)}` : '';
}

/** By frame id, what each frame saved to the case says of the proofs using it. */
export function frameUses(frames, used) {
  const out = new Map();
  for (const f of frames ?? []) {
    const words = f.filed?.path ? usedIn(used?.[f.filed.path]) : '';
    if (words) out.set(f.id, words);
  }
  return out;
}

/**
 * The frames a scene's proof starts from, in clip order: inside its passage, on its
 * instant, or every one for the whole video. A frame with no picture yet, or none it
 * could get, is left out.
 */
export function framesOfScene(scene, frames, frame) {
  const moments = sceneMoments(scene);
  return (frames ?? [])
    .filter((f) => f.time != null && f.url && !f.missing)
    .filter((f) => !moments.length || moments.some((m) => frameInMoment(f.time, m, frame)))
    .sort((a, b) => a.time - b.time);
}

/**
 * Where to capture for a scene that holds no frame: the sharpest one a scan found
 * in it, else the frame it starts on, else the one on screen. `why` says which:
 * `sharpest`, `instant`, `start` or `screen`.
 */
export function frameToCapture(scene, { scan = null, now = 0, frame }) {
  const moments = sceneMoments(scene);
  if (moments.length && !moments.some(isStretch)) return { time: moments[0].start, why: 'instant' };
  const scored = [
    ...(scan?.frames ?? []).map((f) => ({ time: f.time, score: f.score })),
    ...(scan?.shots ?? []).map((s) => ({ time: s.best, score: s.score })),
  ].filter(
    (c) => Number.isFinite(c.time) && Number.isFinite(c.score)
      && (!moments.length || moments.some((m) => frameInMoment(c.time, m, frame))),
  );
  if (scored.length) return { time: scored.reduce((a, b) => (b.score > a.score ? b : a)).time, why: 'sharpest' };
  const start = sceneStart(scene);
  return start != null ? { time: start, why: 'start' } : { time: now, why: 'screen' };
}

/**
 * What Geo Proof is handed to open a proof of a scene (`uiState.proofScene`): the
 * video, the scene's moments, the draft it takes up, its panels and the draft's
 * label. The panels are the saved frames in clip order, then the captures the scene
 * gathered on the map, in the order they came.
 */
export function proofHandoff(scene, video, panels) {
  return {
    video,
    moments: sceneMoments(scene).map(({ start, end }) => ({ start, end: end ?? null })),
    draft: scene.kind === 'proof' ? null : scene.id,
    panels: [...panels],
    label: scene.kind === 'proof' ? sceneTitle(scene) : scene.label ?? '',
  };
}
