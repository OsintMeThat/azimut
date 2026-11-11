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
import {
  isStretch, isWholeVideo, liveScenes, momentTime, momentsTime, sceneList, sceneMoments, sceneTime, sortMoments,
} from './scenes.js';
import { scenesAt } from './sceneFrames.js';

/** How long the player holds an instant before it moves on to the next moment, in seconds. */
export const INSTANT_HOLD = 1.5;
/** How near an instant a panel's frame still shows it: the same shot, give or take a beat. */
const INSTANT_SLACK = 0.5;
/** How far past a passage's ends a frame still falls in it: under a frame at any rate. */
const PASSAGE_SLACK = 0.02;

/** A file's name without its folder or its extension: `media/clip.mp4` reads `clip`. */
export function fileStem(path) {
  const name = String(path ?? '').split(/[\\/]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * What the app calls a video wherever a scene or a proof names it: the title Media
 * gives it, else its file name without the extension, `clip`. `title` is the title, or
 * `(path) => title` to look it up.
 */
export function videoName(path, title = '') {
  const own = typeof title === 'function' ? title(path) : title;
  return (typeof own === 'string' && own.trim()) || fileStem(path);
}

/** A video's title in the case's media, by its path, for `videoName`. */
export const mediaTitles = (media) => {
  const titles = new Map((media ?? []).filter((one) => one?.path).map((one) => [one.path, one.title ?? '']));
  return (path) => titles.get(path) ?? '';
};

/**
 * The video and the instant a case file was cut at by Inspect, or null when it was not.
 * A collage filed before its pieces' instants were recorded names its video at no
 * instant, `time: null`.
 */
export function frameOrigin(item, mediaByPath = null) {
  const source = item?.source;
  if (source?.type !== 'inspect') return null;
  if (source.op === 'collage') return collageOrigin(source, mediaByPath, 0);
  if (source.op !== 'frame') return null;
  if (typeof source.from !== 'string' || !source.from || !Number.isFinite(source.time)) return null;
  return { video: source.from, time: source.time };
}

/** How deep a collage's pieces are followed through pictures composed from others. */
const COMPOSED_DEPTH = 3;

/**
 * A collage composed from one video's frames, read back to that video at its first
 * piece, as the server reads it (`engine/scenes._collage_origins`). Each piece is a
 * frame Inspect cut, the video itself, or a picture composed in turn (a straightened
 * collage), at every depth. A piece of another video, or any other picture, makes it a
 * picture of its own: null. A collage filed before its pieces' instants were recorded
 * (`source.times` missing) still names its video, at the instants known, `null` when
 * none is: the server reads them off the collage's document, which the media list does
 * not carry. Needs the case's media to look its pieces up.
 */
function collageOrigin(source, mediaByPath, depth) {
  const files = source?.sources;
  if (!mediaByPath?.get || depth >= COMPOSED_DEPTH) return null;
  if (!Array.isArray(files) || !files.length) return null;
  const times = Array.isArray(source.times) && source.times.length === files.length ? source.times : [];
  let video = null;
  let first = Infinity;
  for (let i = 0; i < files.length; i += 1) {
    const piece = mediaByPath.get(files[i]);
    const own = piece?.source?.type === 'inspect' && piece.source.op === 'collage'
      ? collageOrigin(piece.source, mediaByPath, depth + 1)
      : piece?.kind === 'video'
        ? { video: files[i], time: Number.isFinite(times[i]) ? times[i] : null }
        : frameOrigin(piece);
    if (!own || (video && own.video !== video)) return null;
    video = own.video;
    if (Number.isFinite(own.time)) first = Math.min(first, own.time);
  }
  return { video, time: Number.isFinite(first) ? first : null };
}

/**
 * The panels cut from a video, in the panels' order: `{ panel, video, time }` each.
 * `mediaByPath` maps a case path to its media item, as the media list gives it.
 */
export function panelFrames(panels, mediaByPath) {
  const out = [];
  for (const panel of panels ?? []) {
    const origin = frameOrigin(mediaByPath?.get?.(panel.src), mediaByPath);
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

/**
 * The video the proof is about: the one it states, else the first one a panel was cut
 * from, else the first one a panel is tied to without being cut from it (`ties`, what
 * `POST /scenes/ties` answers: a capture made over a collage of it, or one a scene of it
 * gathered).
 */
export function starVideo(frames, stated, ties = []) {
  return stated?.video ?? frames?.[0]?.video ?? ties?.[0]?.video ?? null;
}

/**
 * Every video the proof rests on, the ★ first and then the others in the order of
 * their first panel, those its panels are tied to last. Each with the instants its
 * panels were cut at, and its name (`videoName`, by `titleOf(path)`).
 */
export function proofVideos(frames, stated, titleOf = () => '', ties = []) {
  const star = starVideo(frames, stated, ties);
  if (!star) return [];
  const order = [star, ...(frames ?? []).map((f) => f.video), ...(ties ?? []).map((t) => t.video)];
  return [...new Set(order)].map((video) => ({
    video,
    name: videoName(video, titleOf),
    star: video === star,
    frames: (frames ?? []).filter((f) => f.video === video),
  }));
}

/** The moments the ★ video is stated at: none is the whole video. */
export const statedMoments = (stated, star) => (stated && stated.video === star ? stated.moments : []);

/**
 * The scene still to prove that a proof stating none is about, found by its panels, or
 * null: `sceneOffer`'s `found`. What Make the proof states for a proof made from a scene,
 * read back for one made by hand.
 */
export function sceneOfFrames(frames, star, answer, options = {}) {
  return sceneOffer(frames, star, answer, options).found;
}

/** A scene as the Scene tab names it: the draft, its moments, its label or else its time, its colour, how it was found. */
const offered = (scene, by) => ({
  id: scene.id,
  moments: sceneMoments(scene).map(({ start, end }) => ({ start, end: end ?? null })),
  title: scene.label || sceneTime(scene),
  color: scene.color,
  whole: isWholeVideo(scene),
  by,
});

/**
 * Which scene still to prove a proof stating none is about, read off its panels:
 * `{ found, choices }`. `found` is the one scene they point at, which a proof never saved
 * takes up at its first save and a saved one is offered; `choices` the scenes the analyst
 * picks from when the panels point at several, or say too little, nothing tied until one
 * is picked. Only a scene Inspect still lists to geolocate is ever found or offered: not
 * abandoned, not taken up by a proof.
 *
 * The panels speak in two ways. A time: each instant the ★ video's panels were cut at,
 * each piece of a collage of it included, and those a panel made from that footage
 * carries (`ties`, a capture made over a frame or a collage of it), which falls in a scene
 * by the rule Inspect's dots use (`frameInMoment`, at the clip's frame length `frame`).
 * And a pointer: a capture a scene gathered on the map points at that scene. A scene
 * about the whole video holds no time, so it is pointed at or taken as the one scene.
 *
 * - One scene still to prove pointed at, every time in it, or about the whole video:
 *   found. Some time outside it, or a proof's scene beside it: offered.
 * - Several: offered, the ones still to prove.
 * - None: the video's one scene, when it is the only one or no time says otherwise, is
 *   found; an open scene among proofs the times leave alone, and every open scene when
 *   no panel carries a time, are offered. Times that fall in no scene say nothing.
 *
 * `answer` is what `GET /cases/{id}/scenes?video=` answered for the ★ video, and `own`
 * the name the proof is listed under there, whose row is left out. Each scene comes as
 * `{ id, moments, title, color, whole, by }`, `by` saying how it was found: `frames`,
 * `captures` (gathered for it), `only` (the video's one scene) or `video` (any of its
 * scenes, when nothing says which).
 */
export function sceneOffer(frames, star, answer, { own = null, frame = 0, ties = [] } = {}) {
  const none = { found: null, choices: [] };
  if (!star || answer?.video !== star) return none;
  const cut = (frames ?? []).filter((f) => f.video === star);
  const tied = (ties ?? []).filter((t) => t?.video === star);
  if (!cut.length && !tied.length) return none;
  const pieces = new Map((answer.collages ?? []).filter((c) => c?.export).map((c) => [c.export, c.times ?? []]));
  const times = [
    ...cut.flatMap((f) => pieces.get(f.src) ?? [f.time]),
    ...tied.flatMap((t) => t.times ?? []),
  ].filter(Number.isFinite);
  const listed = (answer.scenes ?? []).filter((s) => s?.kind === 'proof' || s?.kind === 'draft');
  const scenes = liveScenes(sceneList(listed, listed.filter((s) => s.kind === 'draft'), answer.taken ?? []))
    .filter((s) => !(s.kind === 'proof' && s.proof === own));
  const drafts = scenes.filter((s) => s.kind === 'draft');
  // a pointer at a scene no longer to prove points nowhere
  const wanted = new Set(tied.map((t) => t.scene).filter(Boolean));
  const pointed = drafts.filter((s) => wanted.has(s.id));
  // a scene about the whole video holds no frame here, or it would hold them all
  const touched = new Set(times.flatMap((t) => scenesAt(t, scenes, frame)));
  // in clip order, as the strip and Inspect's bar lay them out
  const named = scenes.filter((s) => pointed.includes(s) || touched.has(s));
  const offer = (list, by) => ({ found: null, choices: list.map((s) => offered(s, by)) });
  if (named.length === 1) {
    const [one] = named;
    if (one.kind !== 'draft') return none;
    const by = pointed.includes(one) ? 'captures' : 'frames';
    if (isWholeVideo(one) || times.every((t) => scenesAt(t, [one], frame).length)) return { found: offered(one, by), choices: [] };
    return offer([one], by);
  }
  if (named.length > 1) return offer(named.filter((s) => s.kind === 'draft'), pointed.length ? 'captures' : 'frames');
  if (drafts.length !== 1) return times.length ? none : offer(drafts, 'video');
  const [only] = drafts;
  if (scenes.length === 1 && (isWholeVideo(only) || !times.length)) return { found: offered(only, 'only'), choices: [] };
  return isWholeVideo(only) || !times.length ? offer([only], 'only') : none;
}

/**
 * Whether a frame cut at `time` shows in `moment`. A fixed reading, never the clip's
 * rate, so the picture a proof exports does not hang on whether its player was open.
 */
export function momentHolds(moment, time) {
  if (!Number.isFinite(time)) return false;
  if (isStretch(moment)) return time >= moment.start - PASSAGE_SLACK && time <= moment.end + PASSAGE_SLACK;
  return Math.abs(time - moment.start) <= INSTANT_SLACK;
}

/**
 * The ★ video's panels whose frame shows in none of the moments. None for the whole
 * video, and never a collage that kept no instant: nothing says where it falls.
 */
export function outsideFrames(frames, star, moments) {
  if (!moments?.length) return [];
  return (frames ?? []).filter((f) => f.video === star && Number.isFinite(f.time) && !moments.some((m) => momentHolds(m, f.time)));
}

/**
 * The time a panel's badge prints on the exported picture, or null for none: the
 * timecode alone, never the video's name. The moment its frame shows in, else every
 * moment the proof states; never anything for the whole video, which has no timecode.
 */
export function badgeText(video, moments, time = null) {
  if (!video || !moments?.length) return null;
  const own = moments.find((m) => momentHolds(m, time));
  return own ? momentTime(own) : momentsTime(moments);
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

/**
 * A Make the proof handoff as the composer holds it, or null when it names neither a
 * video nor a picture. A picture's proof holds no scene (`scene: null`).
 */
export function readHandoff(handoff) {
  const panels = [...new Set((Array.isArray(handoff?.panels) ? handoff.panels : []).filter((p) => typeof p === 'string' && p))];
  // a picture marked to geolocate: its proof states no scene, the picture is its panel
  if (typeof handoff?.picture === 'string' && handoff.picture && !handoff.video) {
    return panels.length ? { scene: null, panels, title: handoffTitle(handoff.label) } : null;
  }
  const stated = readStatedScene(handoff);
  if (!stated) return null;
  return { scene: stated, panels, title: handoffTitle(handoff.label) };
}

/**
 * The proof's name from the scene's label, without the question it was kept with
 * (`Road bridge?` names `Road bridge`), or '' for none. A label says what to find;
 * the proof's description is a sentence about what it shows, which the label is not.
 */
export function handoffTitle(label) {
  return String(label ?? '').trim().replace(/\s*[?？]+$/, '').trim();
}
