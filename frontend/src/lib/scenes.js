/**
 * The scenes of a video: where in one clip each of its geolocations happens.
 *
 * Two kinds sit in one list. A proof resting on the video is a scene the case has
 * already proved, read back by the server (`GET /cases/{id}/scenes`): it states the
 * moments the place shows in, since one place often comes back in several extracts
 * of a clip, and each moment is an instant or a stretch. A scene the analyst kept
 * in Inspect and has not proved yet is a draft, held in the video's work until a
 * proof takes it up: one moment of its own (`start`, `end`), and the moments after it
 * (`more`) when the same place shows again further on.
 *
 * The code says moment; the screen says **passage**, since Inspect's Moments tab holds
 * the timecoded marks. A video is one place or several, never both: a scene about the
 * whole video is not offered beside scenes holding passages (`timedBeside`), and a new
 * time marked on a video whose one scene is about the whole of it goes to that scene
 * (`wholeTaker`).
 *
 * **A scene that states no time is about the whole video**, and says so rather
 * than print a timecode. A proof's frames still pin it on the bar, where they
 * were cut, and its first frame still places it in the list. The server stores
 * both kinds; this module only orders them, colours them and words them.
 */
import { uid } from './inspect.js';
import { DEFAULT_FPS } from './inspectPlayer.js';

/** Scene colours, cycled in clip order, from the annotation palette. */
const COLORS = ['var(--anno-2)', 'var(--anno-1)', 'var(--anno-4)', 'var(--anno-6)', 'var(--anno-5)', 'var(--anno-3)'];

/**
 * The colour of the scene at `order` among its video's scenes, proofs included: the
 * one Inspect's bar draws it in. The server gives a scene to prove its `order`
 * (`engine/geolocate.py`), so the pill and the reference window match the bar.
 */
export const sceneColorAt = (order) => COLORS[(Number.isInteger(order) && order >= 0 ? order : 0) % COLORS.length];

export const SCENE_LABEL_MAX = 200;
/** The most moments one proof states, as the server holds them (`engine/scenes.MAX_MOMENTS`). */
export const MAX_MOMENTS = 20;
/** What a scene with no time of its own says instead of a timecode. */
export const WHOLE_VIDEO = 'Whole video';
/** How many moments a row writes out before it counts the rest. */
const MOMENTS_SHOWN = 2;

/**
 * A time in the clip as a scene shows it: whole seconds, counted down like a
 * player's clock (59.96 is still 0:59), with the hours of a long video.
 */
export function shortClock(time) {
  const total = Math.max(0, Math.floor(Number(time) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
const short = shortClock;

/** `2:10–2:38`, the way a stretch of a clip is written everywhere it is shown. */
export function spanLabel(start, end) {
  return `${short(start)}–${short(end)}`;
}

/** Whether a moment is a stretch: a start, and an end after it. */
export const isStretch = (moment) =>
  Number.isFinite(moment?.start) && Number.isFinite(moment?.end) && moment.end > moment.start;

/**
 * The moments a scene states: a proof's list, or a draft's own time and the ones
 * after it (`more`), none for the whole video.
 */
export function sceneMoments(scene) {
  if (scene?.kind === 'proof') return scene.moments ?? [];
  if (!Number.isFinite(scene?.start)) return [];
  const more = Array.isArray(scene.more) ? scene.more.filter((m) => Number.isFinite(m?.start)) : [];
  return [{ start: scene.start, end: scene.end ?? null }, ...more.map((m) => ({ start: m.start, end: m.end ?? null }))];
}

/**
 * Moments as a scene still to prove keeps them: the first in clip order as its own
 * `start` and `end`, the rest under `more` only when there are some, so a scene of
 * one moment is written as it always was. None is the whole video.
 */
export function draftTime(moments) {
  const [first, ...rest] = sortMoments(moments);
  if (!first) return { start: null, end: null };
  const time = { start: first.start, end: isStretch(first) ? first.end : null };
  return rest.length ? { ...time, more: rest.map((m) => ({ start: m.start, end: isStretch(m) ? m.end : null })) } : time;
}

/** Give a draft these moments, in place: its start, its end, and `more` only when it holds several. */
export function setDraftTime(draft, moments) {
  const time = draftTime(moments);
  draft.start = time.start;
  draft.end = time.end;
  if (time.more) draft.more = time.more;
  else delete draft.more;
}

/** Whether a scene states no time, and so is about the whole video. */
export const isWholeVideo = (scene) => sceneMoments(scene).length === 0;

/**
 * Where a scene starts in its clip: its first moment, else the first frame a proof
 * rests on, else nowhere.
 */
export function sceneStart(scene) {
  const first = sceneMoments(scene)[0]?.start ?? scene?.at?.[0];
  return Number.isFinite(first) ? first : null;
}

/** The passage a scene's play button loops: its first, if it has one. */
export const scenePassage = (scene) => sceneMoments(scene).find(isStretch) ?? null;

/** The stretch a scanned shot covers: its start to the next shot's, or to the end. */
export function stretchFromShot(shots, index, duration) {
  const shot = shots?.[index];
  if (!shot) return null;
  const end = shots[index + 1]?.start ?? duration;
  return isStretch({ start: shot.start, end }) ? { start: shot.start, end } : null;
}

/** A new scene still to prove: an instant, unless it is given an end. */
export function newScene({ start, end = null }, label = '') {
  return { id: uid('sc'), start, end, label };
}

/** Where a scene sorts: a draft about the whole video first, then by its start. */
function order(scene) {
  if (scene.kind === 'draft' && !Number.isFinite(scene.start)) return [-Infinity, -Infinity];
  const start = sceneStart(scene) ?? Infinity;
  const end = sceneMoments(scene)[0]?.end ?? start;
  return [start, end];
}

/** The states of a scene still to prove, as the server reads them (`engine/geolocate.py`). */
export const TODO = 'todo';
export const PROGRESS = 'progress';
export const ABANDONED = 'abandoned';

/** Where a capture comes from: the map, the extension, Horizon, or a Compare render. */
const CAPTURE_SOURCES = new Set(['satellite', 'screenshot', 'horizon', 'compare']);

/**
 * Whether a picture can be marked to geolocate, the whole of it. Not a frame Inspect
 * cut from a video, which belongs to that video's scenes, and not a capture, which is
 * an answer from the map rather than a question (`engine/geolocate.mark`).
 */
export function markablePicture(item) {
  if (item?.kind !== 'image') return false;
  const source = item.source ?? {};
  if (source.type === 'inspect' && source.op === 'frame' && Number.isFinite(source.time)) return false;
  return !CAPTURE_SOURCES.has(source.type);
}

/**
 * Whether a scene was given up on: one still to prove, or a proof that states no place
 * yet (`engine/scenes.proof_state`). It stays, greyed, and can come back.
 */
export const isAbandoned = (scene) => (scene?.kind === 'draft' || scene?.kind === 'proof') && Boolean(scene.abandoned);

/**
 * Whether a proof states no place yet: made for a scene and saved, but not geolocated.
 * It reads In progress rather than Proved, until a point is saved on it. A row the
 * server never stated a state for (an older answer) is taken as proved.
 */
export const unplaced = (scene) => scene?.kind === 'proof' && scene.state === PROGRESS;

/** The scenes Inspect lists first and its Scenes tab counts: all but the abandoned. */
export const liveScenes = (scenes) => (scenes ?? []).filter((s) => !isAbandoned(s));

/**
 * How many scenes are still to prove, which tint the tab's count: the drafts not
 * abandoned, and the proofs that state no place yet.
 */
export const toProve = (scenes) => liveScenes(scenes).filter((s) => s.kind === 'draft' || unplaced(s)).length;

/**
 * The list the player shows: the proofs the server read back, and the drafts as
 * this tab holds them, minus any a proof has taken up. Each one gets its colour
 * by its place in the clip.
 *
 * The drafts come from the open work rather than the server, so a scene kept a
 * moment ago shows before the save lands. A draft a proof took up stays in the work,
 * hidden here, as is one the server names `taken` (a proof about another video now):
 * the proof deleted, it is back at its own time. What only the server writes on a
 * draft, the captures it gathered and the word it was abandoned with, comes from its
 * row there; a draft not saved yet has neither.
 */
export function sceneList(listed, drafts, taken = []) {
  const proofs = (listed ?? []).filter((s) => s.kind === 'proof');
  const rows = new Map((listed ?? []).filter((s) => s.kind === 'draft').map((s) => [s.id, s]));
  const hidden = new Set([...proofs.map((s) => s.draft).filter(Boolean), ...taken]);
  const open = (drafts ?? [])
    .filter((d) => !hidden.has(d.id))
    .map((d) => {
      const row = rows.get(d.id);
      const captures = Array.isArray(row?.captures) ? row.captures : [];
      const abandoned = row?.abandoned ?? null;
      return {
        kind: 'draft', id: d.id, start: d.start ?? null, end: d.end ?? null, ...(d.more?.length ? { more: d.more } : {}),
        label: d.label ?? '', state: abandoned ? ABANDONED : captures.length ? PROGRESS : TODO, captures, abandoned,
      };
    });
  return [...proofs, ...open]
    .map((scene) => ({ scene, at: order(scene) }))
    .sort((x, y) => x.at[0] - y.at[0] || x.at[1] - y.at[1])
    .map(({ scene }, i) => ({
      ...scene,
      key: scene.kind === 'proof' ? `proof:${scene.proof}` : scene.id,
      color: sceneColorAt(i),
    }));
}

/**
 * What the bar calls a scene's moment `index`, so one moment of many is told apart. A
 * draft's first moment keeps the scene's own key, as it had while a draft held one.
 */
export const momentKey = (scene, index) => (scene.kind === 'proof' || index > 0 ? `${scene.key}#${index}` : scene.key);

/**
 * What the player's bar draws: a band over each passage, a pin at each instant,
 * every moment of a proof in its colour. A proof with no moment of its own is
 * pinned at every frame it was built on; a draft about the whole video draws
 * nothing. Each mark names its scene (`scene`, its key), which a press on it opens.
 */
export function sceneMarks(scenes) {
  const marks = [];
  for (const s of scenes ?? []) {
    const label = sceneTitle(s);
    const moments = sceneMoments(s);
    // an abandoned scene still holds its stretch of the clip, drawn greyed and hollow
    const abandoned = isAbandoned(s);
    moments.forEach((m, i) =>
      marks.push({
        key: momentKey(s, i), scene: s.key, start: m.start, end: isStretch(m) ? m.end : null, color: s.color,
        label: abandoned ? `${label} · abandoned` : label, ...(abandoned ? { abandoned } : {}),
      }),
    );
    if (!moments.length && s.kind === 'proof') {
      (s.at ?? []).forEach((t, i) => marks.push({ key: `${s.key}@${i}`, scene: s.key, start: t, end: null, color: s.color, label }));
    }
  }
  return marks;
}

/** What a scene is called: the proof's title, else the analyst's label. */
export function sceneTitle(scene) {
  if (scene.kind === 'proof') return scene.title || scene.proof;
  return scene.label || 'To geolocate';
}

/** One moment's time: `2:10–2:38` for a passage, `0:03` for an instant. */
export const momentTime = (moment) => (isStretch(moment) ? spanLabel(moment.start, moment.end) : short(moment.start));

/** Several moments in full, `0:30–0:45 · 3:10–3:20`, or Whole video for none. */
export function momentsTime(moments) {
  return moments?.length ? moments.map(momentTime).join(' · ') : WHOLE_VIDEO;
}

/**
 * Moments as a row shows them: each one, the rest counted past two
 * (`0:30–0:45 +2`), and Whole video for none.
 */
export function shortMoments(moments) {
  if (moments?.length > MOMENTS_SHOWN) return `${momentTime(moments[0])} +${moments.length - 1}`;
  return momentsTime(moments);
}

/** A scene's time as its row shows it (`shortMoments`). */
export const sceneTime = (scene) => shortMoments(sceneMoments(scene));

/** A scene's time where room is short, the pill's: its first moment, the rest counted (`0:00–0:07 +1`). */
export function compactTime(scene) {
  const moments = sceneMoments(scene);
  return moments.length > 1 ? `${momentTime(moments[0])} +${moments.length - 1}` : momentsTime(moments);
}

/**
 * The kind of time a scene states, in the words its row writes before the time:
 * `Whole video`, `Instant`, `Passage`, or `3 passages` for a scene holding several.
 */
export function sceneKind(scene) {
  const moments = sceneMoments(scene);
  if (!moments.length) return WHOLE_VIDEO;
  if (moments.length > 1) return `${moments.length} passages`;
  return isStretch(moments[0]) ? 'Passage' : 'Instant';
}

/** A scene's kind and time together: `Passage · 0:30–0:45`, `Instant · 3:49`, `Whole video`. */
export function sceneWhen(scene) {
  const kind = sceneKind(scene);
  return kind === WHOLE_VIDEO ? kind : `${kind} · ${sceneTime(scene)}`;
}

/**
 * Whether another live scene of the video holds passages, a proof's included, so the
 * video is several places and a scene about the whole of it is not offered. `scene` is
 * the one asking, left out; none for a scene not kept yet. The abandoned do not count.
 */
export const timedBeside = (scenes, scene = null) =>
  liveScenes(scenes).some((s) => s.key !== scene?.key && sceneMoments(s).length > 0);

/**
 * The scene about the whole video that a new time marked on its video goes to, or null:
 * the one live scene still to prove, about the whole video, with no proof stating
 * passages beside it. It keeps its label, its captures and its geolocating, and takes
 * the time in place of a second scene. One among other scenes still to prove, an
 * older case's, stays as it is. A proof about the whole video is an answer, not a
 * question, and lets it take the time (`engine/geolocate.whole_taker`).
 */
export function wholeTaker(scenes) {
  const live = liveScenes(scenes);
  const drafts = live.filter((s) => s.kind === 'draft');
  if (drafts.length !== 1 || !isWholeVideo(drafts[0])) return null;
  return live.some((s) => s.kind === 'proof' && sceneMoments(s).length) ? null : drafts[0];
}

/**
 * The scenes Same place as… offers for `scene`: the clip's other scenes still to prove,
 * in clip order, each with a time. Nothing for a proof, an abandoned scene or one about
 * the whole video, which already holds every moment.
 */
export function samePlaceChoices(scenes, scene) {
  const timed = (s) => s?.kind === 'draft' && !isAbandoned(s) && !isWholeVideo(s);
  if (!timed(scene)) return [];
  return (scenes ?? []).filter((s) => timed(s) && s.key !== scene.key);
}

/** Where the latest of a scene's moments started before `time`, by its index, else -1. */
export function momentBefore(scene, time) {
  const moments = sceneMoments(scene);
  let found = -1;
  moments.forEach((m, i) => {
    if (m.start < time && (found === -1 || m.start >= moments[found].start)) found = i;
  });
  return found;
}

/**
 * The draft to end at `time`: the one with a moment started latest before it, not
 * abandoned, else none. That moment is the one ended (`momentBefore`).
 */
export function sceneToEnd(scenes, time) {
  const started = (s) => sceneMoments(s)[momentBefore(s, time)]?.start ?? -Infinity;
  const before = liveScenes(scenes).filter((s) => s.kind === 'draft' && momentBefore(s, time) !== -1);
  return before.length ? before.reduce((a, b) => (started(b) > started(a) ? b : a)) : null;
}

// -- changing a scene's time ------------------------------------------------------------

/** How long a passage runs when an instant becomes one with the clip not yet past it. */
export const DEFAULT_PASSAGE = 5;

/**
 * A time typed into a scene's field, in seconds: `65`, `1:05`, `1:05.5` or
 * `1:02:03`, with a comma as good as a point. Null when the text is not a time.
 */
export function parseClock(text) {
  const parts = String(text ?? '').trim().replace(',', '.').split(':');
  if (parts.length > 3) return null;
  const seconds = parts.pop();
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(seconds)) return null;
  if (!parts.every((p) => /^\d+$/.test(p))) return null;
  const [h, m] = parts.length === 2 ? parts.map(Number) : [0, Number(parts[0] ?? 0)];
  const s = Number(seconds);
  // past the first field, a field counts up to sixty like a clock
  if (parts.length && s >= 60) return null;
  if (parts.length === 2 && m >= 60) return null;
  return h * 3600 + m * 60 + s;
}

/** A time as a scene's field shows it: `0:03.48`, `1:05`, `1:02:03.5`, to the millisecond. */
export function editClock(time) {
  const ms = Math.round(Math.max(0, Number(time) || 0) * 1000);
  const fraction = ms % 1000 ? `.${String(ms % 1000).padStart(3, '0').replace(/0+$/, '')}` : '';
  return `${shortClock(Math.floor(ms / 1000))}${fraction}`;
}

/** The start of the frame nearest `time`: a typed or dragged time lands on a real frame. */
export function snapToFrame(time, fps) {
  const rate = fps > 0 ? fps : DEFAULT_FPS;
  return Math.max(0, Math.round(time * rate) / rate);
}

/**
 * What is wrong with a scene's time as typed, in a few words, or '' when it is
 * one. `start` and `end` are what the fields read (null when they read as no time);
 * `duration` is the clip's length, 0 while it is unknown.
 */
export function timeProblem({ start, end, passage, duration = 0, frame = 0 }) {
  if (start == null) return 'Type a time, like 1:05 or 65';
  if (passage && end == null) return 'Type an end, like 1:12';
  const latest = passage ? end : start;
  if (duration > 0 && latest > duration + frame) return `The video is ${shortClock(duration)} long`;
  if (passage && !(end > start)) return 'The end must come after the start';
  return '';
}

/**
 * Where a passage ends when an instant becomes one: with the frame on screen when
 * the clip has moved past the start, else a few seconds on, kept inside the clip.
 * `now` is the end of the frame on screen, so on the start itself it is one frame
 * on, which is no passage worth the name.
 */
export function defaultEnd(start, now, { frame, duration = 0 }) {
  if (now > start + frame * 1.5) return now;
  const end = start + DEFAULT_PASSAGE;
  const inside = duration > 0 ? Math.min(end, duration) : end;
  return inside > start ? inside : start + frame;
}

/** Whether two times are the same, to well under a frame. */
export const sameTime = (a, b) => (a == null ? b == null : b != null && Math.abs(a - b) < 1e-6);

/**
 * Where Another passage puts a scene's next passage, from the frame on screen `now`
 * (`{ start }`) and the passages it holds as their fields read: of the kind of its first
 * in clip order. An instant at that frame, unless the scene holds it already. A stretch
 * as long as its first stretch, starting there, or where the stretch that frame falls
 * in ends, shortened to the room before its next stretch and to the clip's end
 * (`duration`, 0 while unknown). Answers `{ start, end }`, or `{ refused }` in a few
 * words when no frame is free (`frame`, one frame's length).
 */
export function nextPassage(moments, now, { frame = 0, duration = 0 } = {}) {
  const held = sortMoments((moments ?? []).filter((m) => Number.isFinite(m?.start)));
  const at = Math.max(0, Number(now?.start) || 0);
  if (!held.length || !isStretch(held[0])) {
    if (held.some((m) => !isStretch(m) && sameTime(m.start, at))) return { refused: 'The scene holds this instant already' };
    return { start: at, end: null };
  }
  const length = held[0].end - held[0].start;
  const stretches = held.filter(isStretch);
  let start = at;
  // in clip order, so a frame in a stretch that touches the next leaves both behind
  for (const s of stretches) if (s.start <= start + 1e-6 && start < s.end - 1e-6) start = s.end;
  const next = stretches.find((s) => s.start > start + 1e-6)?.start ?? Infinity;
  const end = Math.min(start + length, next, duration > 0 ? duration : Infinity);
  if (!(end - start >= Math.max(frame, 1e-6) - 1e-6)) return { refused: 'No room here for another passage' };
  return { start, end };
}

/** Moments in the words of a toast: `at 0:03`, `0:03–0:08 · 1:12`, or `the whole video`. */
export function timeWords(moments) {
  if (!moments?.length) return 'the whole video';
  return moments.length === 1 && !isStretch(moments[0]) ? `at ${short(moments[0].start)}` : momentsTime(moments);
}

/** Whether two lists of moments say the same times. */
export const sameMoments = (a, b) =>
  (a ?? []).length === (b ?? []).length &&
  (a ?? []).every((m, i) => sameTime(m.start, b[i].start) && sameTime(m.end ?? null, b[i].end ?? null));

/** Moments in clip order: by start, an instant before a passage starting with it. */
export function sortMoments(moments) {
  return [...(moments ?? [])].sort((a, b) => a.start - b.start || (a.end ?? a.start) - (b.end ?? b.start));
}

/**
 * What is wrong between moments that are each right on their own: two passages
 * that overlap, or one instant said twice. The server refuses both.
 */
export function momentsClash(moments) {
  const sorted = sortMoments(moments);
  const passages = sorted.filter(isStretch);
  if (passages.some((m, i) => i > 0 && m.start < passages[i - 1].end - 1e-6)) return 'Two passages overlap';
  const instants = sorted.filter((m) => !isStretch(m)).map((m) => m.start);
  if (instants.some((t, i) => i > 0 && sameTime(t, instants[i - 1]))) return 'One instant is there twice';
  return '';
}
