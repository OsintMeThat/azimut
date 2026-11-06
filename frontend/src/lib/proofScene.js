/**
 * A proof's scene as Geo Proof shows it: which video the proof is about, when in it
 * the place shows, and how its panels stand against that time.
 *
 * A panel cut from a video by Inspect knows the clip and the instant on its record
 * (`source.type = 'inspect'`, `op = 'frame'`, `from`, `time`). The video the proof is
 * about, the ★, is the one the proof states, else the one its first such panel came
 * from, which is how the server reads it (`engine/scenes.proof_scene`). Any other
 * video among the panels is a confirmation, ☆: a panel and a source, nothing more.
 *
 * A proof that states no moment is about the whole video, and prints no timecode
 * anywhere. The instants its frames were cut at only pin it on a bar.
 */
import { isStretch, momentTime, momentsTime, sceneList, sceneTime, sortMoments } from './scenes.js';

/** How long the player holds an instant before it moves on to the next moment, in seconds. */
export const INSTANT_HOLD = 1.5;
/** How near an instant a panel's frame still shows it: the same shot, give or take a beat. */
const INSTANT_SLACK = 0.5;
/** How far past a passage's ends a frame still falls in it: under a frame at any rate. */
const PASSAGE_SLACK = 0.02;

/** The file's own name, which is what the field and the badge say: `clip.mp4`. */
export function videoName(path) {
  return String(path ?? '').split(/[\\/]/).pop() ?? '';
}

/** The video and the instant a case file was cut at by Inspect, or null when it was not. */
export function frameOrigin(item) {
  const source = item?.source;
  if (source?.type !== 'inspect' || source.op !== 'frame') return null;
  if (typeof source.from !== 'string' || !source.from || !Number.isFinite(source.time)) return null;
  return { video: source.from, time: source.time };
}

/**
 * The panels cut from a video, in the panels' order: `{ panel, video, time }` each.
 * `mediaByPath` maps a case path to its media item, as the media list gives it.
 */
export function panelFrames(panels, mediaByPath) {
  const out = [];
  for (const panel of panels ?? []) {
    const origin = frameOrigin(mediaByPath?.get?.(panel.src));
    if (origin) out.push({ panel: panel.id, src: panel.src, ...origin });
  }
  return out;
}

/**
 * A stated scene in its one shape, `{ video, moments, draft }`, or null when it names
 * no video. The shape before moments, one `start` and `end` on the scene, reads as
 * that one moment, as the server reads it (`engine/scenes.read_scene`).
 */
export function readStatedScene(scene) {
  if (!scene || typeof scene !== 'object' || typeof scene.video !== 'string' || !scene.video) return null;
  const held = Array.isArray(scene.moments) ? scene.moments : [{ start: scene.start, end: scene.end }];
  const moments = held
    .filter((m) => Number.isFinite(m?.start) && m.start >= 0)
    .map((m) => ({ start: m.start, end: isStretch(m) ? m.end : null }));
  return {
    video: scene.video,
    moments: sortMoments(moments),
    draft: typeof scene.draft === 'string' && scene.draft ? scene.draft : null,
  };
}

/** The video the proof is about: the one it states, else the first one a panel was cut from. */
export function starVideo(frames, stated) {
  return stated?.video ?? frames?.[0]?.video ?? null;
}

/**
 * Every video the proof rests on, the ★ first and then the others in the order of
 * their first panel. Each with the instants its panels were cut at.
 */
export function proofVideos(frames, stated) {
  const star = starVideo(frames, stated);
  if (!star) return [];
  const order = [star, ...(frames ?? []).map((f) => f.video)];
  return [...new Set(order)].map((video) => ({
    video,
    name: videoName(video),
    star: video === star,
    frames: (frames ?? []).filter((f) => f.video === video),
  }));
}

/** The moments the ★ video is stated at: none is the whole video. */
export const statedMoments = (stated, star) => (stated && stated.video === star ? stated.moments : []);

/**
 * Whether a frame cut at `time` shows in `moment`. A fixed reading, never the clip's
 * rate, so the picture a proof exports does not hang on whether its player was open.
 */
export function momentHolds(moment, time) {
  if (!Number.isFinite(time)) return false;
  if (isStretch(moment)) return time >= moment.start - PASSAGE_SLACK && time <= moment.end + PASSAGE_SLACK;
  return Math.abs(time - moment.start) <= INSTANT_SLACK;
}

/** The ★ video's panels whose frame shows in none of the moments. None for the whole video. */
export function outsideFrames(frames, star, moments) {
  if (!moments?.length) return [];
  return (frames ?? []).filter((f) => f.video === star && !moments.some((m) => momentHolds(m, f.time)));
}

/** What a video's field says: `clip.mp4 · 2:10–2:38`, or `· Whole video` with no moment stated. */
export function sceneLine(video, moments) {
  return `${videoName(video)} · ${sceneTime({ kind: 'proof', moments: moments ?? [] })}`;
}

/**
 * The time a panel's badge prints on the exported picture, or null for none. The
 * moment its frame shows in, else every moment the proof states; never anything for
 * the whole video, which has no timecode.
 */
export function badgeText(video, moments, time = null) {
  if (!video || !moments?.length) return null;
  const own = moments.find((m) => momentHolds(m, time));
  return `${videoName(video)} · ${own ? momentTime(own) : momentsTime(moments)}`;
}

/**
 * The badges the picture carries, by panel id: one on each ★ panel while the switch
 * is on and the proof states a time.
 */
export function sceneBadges(on, frames, star, moments) {
  const out = new Map();
  if (!on || !star || !moments?.length) return out;
  for (const f of frames ?? []) {
    if (f.video === star) out.set(f.panel, badgeText(star, moments, f.time));
  }
  return out;
}

/**
 * What the player runs through, in clip order: each passage played, each instant
 * held a moment. With no moment stated, the whole video from `from`, the first frame
 * a panel was cut at.
 */
export function playSegments(moments, from = 0) {
  if (!moments?.length) return [{ kind: 'whole', start: Math.max(0, Number(from) || 0), end: null }];
  return sortMoments(moments).map((m) => (isStretch(m)
    ? { kind: 'passage', start: m.start, end: m.end }
    : { kind: 'instant', start: m.start, end: null }));
}

/** Which segment a time falls in, else the next one after it, else the first. */
export function segmentAt(segments, time) {
  const inside = segments.findIndex((s) => s.kind === 'passage' && time >= s.start && time < s.end);
  if (inside >= 0) return inside;
  const next = segments.findIndex((s) => s.start >= time);
  return next >= 0 ? next : 0;
}

/**
 * The scene's colour on Inspect's bar, so the same passage reads in the same colour
 * in both tools: the saved proof's, else the draft it came from, else the first.
 */
export function sceneColor(listed, { proof = null, draft = null } = {}) {
  const drafts = (listed ?? []).filter((s) => s.kind === 'draft');
  const list = sceneList(listed, drafts);
  const own = list.find((s) => (proof && s.kind === 'proof' && s.proof === proof) || (draft && s.kind === 'draft' && s.id === draft));
  return own?.color ?? sceneList([{ kind: 'proof', proof: '', moments: [] }], [])[0].color;
}

/** A Make the proof handoff as the composer holds it, or null when it names no video. */
export function readHandoff(handoff) {
  const stated = readStatedScene(handoff);
  if (!stated) return null;
  const panels = (Array.isArray(handoff.panels) ? handoff.panels : []).filter((p) => typeof p === 'string' && p);
  return { scene: stated, panels: [...new Set(panels)], title: handoffTitle(handoff.label) };
}

/**
 * The proof's name from the scene's label, without the question it was kept with
 * (`Road bridge?` names `Road bridge`), or '' for none. A label says what to find;
 * the proof's description is a sentence about what it shows, which the label is not.
 */
export function handoffTitle(label) {
  return String(label ?? '').trim().replace(/\s*[?？]+$/, '').trim();
}
