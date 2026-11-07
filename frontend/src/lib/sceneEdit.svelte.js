/**
 * The scene whose time is being changed, one at a time: what its fields read, and
 * what pressing Apply would make of it.
 *
 * Three hands move it and all three land here: the fields of the open scene, the
 * handles on the player's bar, and Here at the frame on screen. Nothing is kept
 * until Apply, so a drag or a typo costs nothing, and the list does not reorder
 * under the pointer while a start moves.
 *
 * A scene is about the whole video, or holds moments, each an instant or a passage.
 * A draft holds one at most; a proof as many as the place shows in. The fields and
 * the keys work on the moment in hand (`active`), and so do the bar's handles.
 *
 * A field's text is what the analyst sees and types; the time beside it is what a
 * handle or a key set to the very frame, and what typing set rounded to the
 * nearest frame. A typo leaves the text as typed and the time empty, which is what
 * the problem line reads.
 */
import {
  MAX_MOMENTS, defaultEnd, editClock, isStretch, momentKey, momentsClash, parseClock, sameMoments, sceneMoments,
  snapToFrame, sortMoments, timeProblem,
} from './scenes.js';
import { frameDuration } from './inspectPlayer.js';

/** One moment's line, from a stored moment. */
const line = ({ start, end = null }) => ({
  startText: editClock(start),
  endText: isStretch({ start, end }) ? editClock(end) : '',
  passage: isStretch({ start, end }),
  start,
  end: isStretch({ start, end }) ? end : null,
  lastEnd: null,
});

/** A line as the moment it says, read whether or not it is right. */
const said = (l) => ({ start: l.start, end: l.passage ? l.end : null });

export class SceneEdit {
  /** The scene in hand, as the list showed it when it was opened; null when none is. */
  scene = $state(null);
  /** Its moments as the fields read them, in the order they were added: none is the whole video. */
  moments = $state([]);
  /** The moment in hand, which the handles and S move. */
  active = $state(0);
  // The moments put aside by Whole video, given back if Instant or Passage is chosen again.
  #kept = [];

  /** `clip()` answers the open clip's `{ duration, fps }`, read when it is needed. */
  constructor(clip = () => ({ duration: 0, fps: null })) {
    this.clip = clip;
  }

  get key() {
    return this.scene?.key ?? null;
  }

  /** Whether the scene may hold several moments: a proof's place can come back. */
  get many() {
    return this.scene?.kind === 'proof';
  }

  get whole() {
    return this.moments.length === 0;
  }

  /** 'whole', or what the moment in hand is: 'instant' or 'passage'. */
  get kind() {
    if (this.whole) return 'whole';
    return this.moments[this.active]?.passage ? 'passage' : 'instant';
  }

  /** The moment in hand, as the bar draws its handles. */
  get start() {
    return this.moments[this.active]?.start ?? null;
  }

  get end() {
    const held = this.moments[this.active];
    return held?.passage ? held.end : null;
  }

  /** What the bar calls the moment in hand. */
  get activeKey() {
    return this.scene ? momentKey(this.scene, this.active) : null;
  }

  get problem() {
    const { duration, fps } = this.clip();
    const frame = frameDuration(fps);
    const several = this.moments.length > 1;
    for (const [i, l] of this.moments.entries()) {
      const wrong = timeProblem({ start: l.start, end: l.end, passage: l.passage, duration, frame });
      if (wrong) return several ? `Moment ${i + 1}: ${wrong[0].toLowerCase()}${wrong.slice(1)}` : wrong;
    }
    return momentsClash(this.moments.map(said));
  }

  /**
   * What Apply would keep, or null while the fields do not read as a time: a
   * draft's `{ start, end }`, both null for the whole video, or a proof's
   * `{ moments }` in clip order, none for the whole video.
   */
  get result() {
    if (!this.scene || this.problem) return null;
    const moments = sortMoments(this.moments.map(said));
    if (this.many) return { moments };
    return moments[0] ?? { start: null, end: null };
  }

  /** Whether Apply would change anything. */
  get changed() {
    if (!this.scene) return false;
    return !sameMoments(sortMoments(this.moments.map(said)), sortMoments(sceneMoments(this.scene)));
  }

  /** Open a scene on what it says now: its moments, or the whole video. */
  begin(scene) {
    this.scene = scene;
    this.moments = sceneMoments(scene).map(line);
    this.active = 0;
    this.#kept = [];
  }

  close() {
    this.scene = null;
    this.moments = [];
  }

  activate(index) {
    if (index >= 0 && index < this.moments.length) this.active = index;
  }

  /** The start at this very time: the frame on screen, or where a handle was dropped. */
  setStart(time, index = this.active) {
    const l = this.moments[index];
    if (!l) return;
    l.start = time;
    l.startText = editClock(time);
  }

  /** The end at this very time, which makes the moment a passage. */
  setEnd(time, index = this.active) {
    const l = this.moments[index];
    if (!l) return;
    l.passage = true;
    l.end = time;
    l.endText = editClock(time);
  }

  typeStart(text, index = this.active) {
    const l = this.moments[index];
    if (!l) return;
    l.startText = text;
    l.start = this.#typed(text);
  }

  typeEnd(text, index = this.active) {
    const l = this.moments[index];
    if (!l) return;
    l.endText = text;
    l.end = this.#typed(text);
  }

  /**
   * Whole video, Instant or Passage. From the whole video, the moments it put aside
   * come back, else one starts at the frame on screen. `now` is that frame:
   * `{ start, end }`, where its end is where a passage ends by default once the clip
   * has moved past its start, else a few seconds on.
   */
  setKind(kind, now = { start: 0, end: 0 }) {
    if (kind === 'whole') {
      if (!this.whole) this.#kept = this.moments.map((l) => ({ ...l }));
      this.moments = [];
      this.active = 0;
      return;
    }
    if (this.whole) {
      this.moments = this.#kept.length ? this.#kept : [line({ start: now.start })];
      this.#kept = [];
      this.active = 0;
    }
    const l = this.moments[this.active];
    if (kind === 'instant') {
      if (l.passage) l.lastEnd = l.end;
      l.passage = false;
      return;
    }
    if (l.passage) return;
    const start = l.start ?? now.start;
    const { duration, fps } = this.clip();
    const kept = l.lastEnd != null && l.lastEnd > start ? l.lastEnd : null;
    this.setEnd(kept ?? defaultEnd(start, now.end, { frame: frameDuration(fps), duration }));
  }

  /** Another moment of a proof, an instant at `time`, taken in hand. */
  add(time) {
    if (!this.many || this.moments.length >= MAX_MOMENTS) return;
    this.moments.push(line({ start: time }));
    this.active = this.moments.length - 1;
  }

  /** Take one moment off; the last one goes by choosing Whole video. */
  remove(index) {
    if (this.moments.length < 2 || !this.moments[index]) return;
    this.moments.splice(index, 1);
    this.active = Math.min(this.active > index ? this.active - 1 : this.active, this.moments.length - 1);
  }

  /**
   * The frame on screen as the start of a moment, or the end of that frame as its
   * end. `now` is that frame, `{ start, end }`. The whole video gets a moment there.
   */
  here(which, now, index = this.active) {
    if (this.whole) this.setKind('instant', now);
    this.activate(index);
    if (which === 'end') this.setEnd(now.end);
    else this.setStart(now.start);
  }

  /**
   * Move one end of a moment a frame, or a second, and answer the frame that now
   * shows it, or null when it cannot move there.
   */
  nudge(which, direction, wholeSecond = false, index = this.active) {
    this.activate(index);
    const from = which === 'end' ? this.end : this.start;
    if (from == null) return null;
    const { fps } = this.clip();
    const frame = frameDuration(fps);
    const time = Math.max(0, snapToFrame(from + direction * (wholeSecond ? 1 : frame), fps));
    if (which === 'start') {
      this.setStart(time);
      return time;
    }
    if (!(time > (this.start ?? 0))) return null;
    this.setEnd(time);
    return time - frame;
  }

  #typed(text) {
    const time = parseClock(text);
    return time == null ? null : snapToFrame(time, this.clip().fps);
  }
}
