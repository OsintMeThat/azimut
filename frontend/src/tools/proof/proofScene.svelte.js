/**
 * The scene of the proof open in Geo Proof: what it states, the player that shows it,
 * and the one route that writes it.
 *
 * **Geo Proof never sends a scene with a save.** A tab open since before would write
 * an older time back over one changed meanwhile, so the save payload has no `scene`
 * (`lib/composer.toSpec`) and the server keeps the one on disk. The time and the ★
 * video are written through `PUT /cases/{id}/proofs/{name}/scene` alone, at once for
 * a saved proof, with an Undo in the toast like Inspect's. A proof never saved has
 * nowhere to write them yet: they are held here, and written by that same route right
 * after its first save lands.
 *
 * What the proof states is `stated`, `{ video, moments, draft }`, or null while the
 * scene is read off the panels (`lib/proofScene.js`). The whole video asked for is
 * stated, with no moments; only the Undo of a first time takes the proof back to its
 * frames (`traced`).
 *
 * A proof made by hand states nothing, yet its frames may all fall in one scene of
 * Inspect still to prove. A proof never saved takes it as its `match`: the time reads
 * the scene's, the tab names it, and the first save takes it up as Make the proof's
 * does. A saved proof is what is on disk, as Inspect shows it: the scene is its
 * `proposal`, named under the field, and nothing is written until **Take it up**.
 * **Not this scene** keeps the proof apart from it for the session, and writes nothing.
 *
 * **Inspect writes the same scene** from its Scenes tab. Geo Proof reads it again when it
 * comes back to the front and when the server says a scene moved (`reread`, `follow`),
 * the player left where it stands and nothing written. A time in hand with a change is
 * the analyst's and stays; `behind` says a read waits for it to be put away.
 */
import { SceneEdit } from '../../lib/sceneEdit.svelte.js';
import { sameMoments, sceneMoments, sortMoments, timeWords } from '../../lib/scenes.js';
import {
  outsideFrames, proofVideos, readStatedScene, sceneOfFrames, starVideo, statedMoments, videoName,
} from '../../lib/proofScene.js';

const plain = (moments) => (moments ?? []).map(({ start, end }) => ({ start, end: end ?? null }));

/** Whether two stated scenes say the same: their video, their moments and the scene they took up. */
const sameStated = (a, b) => (!a || !b
  ? !a === !b
  : a.video === b.video && (a.draft ?? null) === (b.draft ?? null) && sameMoments(sortMoments(a.moments), sortMoments(b.moments)));

export class ProofScene {
  /** What the proof states, or null while its panels say it all. */
  stated = $state(null);
  /** Whether `stated` waits for the proof's first save to be written. */
  held = $state(false);
  /** The player in the Scene tab, `{ video, at, play, n }`, or null before it opens. */
  view = $state(null);
  /** The clip in the player, `{ duration, fps }`, as its probe read it. */
  clip = $state({ duration: 0, fps: null });
  /** A frame being saved to the case, to come back as a panel. */
  adding = $state(false);
  /** The scenes refused with Not this scene for the proof open, by id. */
  refused = $state([]);
  /** Whether a read of the scene waits for the time in hand to be applied or dropped. */
  behind = $state(false);
  /** The name the open proof is listed under in its video's scenes, whose row is its own. */
  #listedAs = $state(null);
  /** What Not this scene refused, by case and proof, for the session only. */
  #refusals = new Map();
  /** Moved by every open, write and read, so an answer that crossed one is dropped. */
  #epoch = 0;
  /** The held scene's time as Inspect last listed it (`follow`), or null before a read. */
  #listedTime = null;
  edit;

  /**
   * The scene still to prove the proof's frames all fall in (`lib/proofScene.sceneOfFrames`),
   * or null. Only while the proof states no scene: none at all, or only the video a slide
   * started with + New scene holds.
   */
  #found = $derived.by(() => {
    const stated = this.stated;
    if (stated && !(this.held && !stated.draft && !stated.moments.length)) return null;
    const star = this.star;
    // the clip's own frame once the player read it, else a thirtieth, as in Inspect
    const frame = this.view?.video === star && this.clip.fps > 0 ? 1 / this.clip.fps : 0;
    const found = sceneOfFrames(this.frames(), star, this.listed(), { own: this.#listedAs, frame });
    return found && !this.refused.includes(found.id) ? found : null;
  });

  /** The scene found, for a proof never saved: its time is the proof's, and the first save takes it up. */
  match = $derived(this.#listedAs === null ? this.#found : null);

  /** The scene found, for a saved proof: named under the field, written only by Take it up. */
  proposal = $derived(this.#listedAs === null ? null : this.#found);

  /**
   * `where()` answers `{ caseId, name }`, the name null until the first save;
   * `frames()` the panels cut from a video (`lib/proofScene.panelFrames`);
   * `listed()` what `GET /scenes?video=` answered for the ★ video, or null.
   * `titleOf(path)` a video's title in Media, '' when it has none.
   * `onstated()` hears every change the analyst states, not the first save's.
   */
  constructor({ api, toast, where, frames, listed = () => null, titleOf = () => '', onstated = () => {} }) {
    this.api = api;
    this.toast = toast;
    this.where = where;
    this.frames = frames;
    this.listed = listed;
    this.titleOf = titleOf;
    this.onstated = onstated;
    this.edit = new SceneEdit(() => this.clip);
  }

  /** The video the proof is about. */
  get star() {
    return starVideo(this.frames(), this.stated);
  }

  /** When in it the place shows: none is the whole video, and a match reads its scene's. */
  get moments() {
    return this.match ? this.match.moments : statedMoments(this.stated, this.star);
  }

  /** The scene of Inspect the proof takes up: the one it states, else the one its frames found. */
  get draft() {
    return this.stated?.draft ?? this.match?.id ?? null;
  }

  /** Every video the proof rests on, the ★ first. The block shows itself when there is one. */
  get videos() {
    return proofVideos(this.frames(), this.stated, this.titleOf);
  }

  /** The ★ panels whose frame shows in none of the moments. */
  get outside() {
    return outsideFrames(this.frames(), this.star, this.moments);
  }

  /** A fresh proof, or one about to open. */
  reset() {
    this.stated = null;
    this.held = false;
    this.view = null;
    this.refused = [];
    this.behind = false;
    this.#listedAs = null;
    this.#listedTime = null;
    this.#epoch += 1;
    this.edit.close();
  }

  /** A saved proof opened: what its spec states, and the scene it refused this session. */
  load(scene) {
    this.reset();
    this.stated = readStatedScene(scene);
    this.#listedAs = this.where().name ?? null;
    this.refused = this.#refusals.get(this.#refusalKey()) ?? [];
  }

  /** Not this scene: the proof stays apart from the scene its frames found. Nothing is written. */
  refuse() {
    const found = this.#found;
    if (!found) return;
    const read = !!this.match;
    this.refused = [...this.refused, found.id];
    this.#keepRefusals();
    // a time printed on the picture now reads the whole video
    if (read) this.onstated();
  }

  /** Take it up: the scene proposed becomes the proof's, its time and the scene itself, written at once. */
  async takeUp() {
    const found = this.proposal;
    if (!found) return false;
    this.edit.close();
    return this.write({ video: this.star, moments: found.moments }, { draft: found.id });
  }

  #refusalKey() {
    const { caseId, name } = this.where();
    return name ? `${caseId ?? ''}\n${name}` : null;
  }

  #keepRefusals() {
    const key = this.#refusalKey();
    if (key && this.refused.length) this.#refusals.set(key, this.refused);
  }

  /** A new proof made from a scene: held until its first save. */
  hold(scene) {
    this.reset();
    this.stated = readStatedScene(scene);
    this.held = !!this.stated;
    // where Inspect stood when it was handed over, when the strip read its video already
    this.#listedTime = this.#draftListed();
  }

  // -- read again ---------------------------------------------------------------------

  /**
   * Read again what the saved proof states, as Inspect's Scenes tab or another window may
   * have changed it since it opened. The player and the tab stay where they are, and
   * nothing is written. A time open with no change starts again from the time read; one
   * with a change waits (`behind`). A proof whose first save is still to write its held
   * scene reads nothing: what it holds goes in with the next save.
   */
  async reread() {
    const { caseId, name } = this.where();
    if (!caseId || !name || this.held) return;
    const epoch = ++this.#epoch;
    let spec;
    try {
      spec = await this.api.get(`/api/cases/${caseId}/proofs/${encodeURIComponent(name)}`);
    } catch {
      return; // a proof gone meanwhile: the composer says so on its own
    }
    const now = this.where();
    if (epoch !== this.#epoch || now.caseId !== caseId || now.name !== name || this.held) return;
    if (this.#inHand()) return;
    const fresh = readStatedScene(spec?.scene);
    if (sameStated(this.stated, fresh)) return;
    const star = this.star;
    this.stated = fresh;
    this.#restart(star);
    this.onstated();
  }

  /**
   * A proof never saved, made from a scene still to prove, holds that scene's time for its
   * first save. While it holds the time Inspect listed, it follows a change made there
   * (`listed()`, read by the strip), so the save writes the scene's time as it now stands.
   * A time stated here is the analyst's and stays. The first reading only says where
   * Inspect stood, which may be behind the scene handed over a moment ago.
   */
  follow() {
    const stated = this.stated;
    if (!this.held || !stated?.draft) return;
    const listed = this.#draftListed();
    if (!listed) return;
    const before = this.#listedTime;
    if (before && sameMoments(before, listed)) return;
    if (this.#inHand()) return;
    this.#listedTime = listed;
    if (!before || !sameMoments(stated.moments, before)) return;
    const star = this.star;
    this.stated = { ...stated, moments: listed };
    this.#restart(star);
    this.onstated();
  }

  /** The held draft's moments as the strip last read them, or null when it lists none. */
  #draftListed() {
    const stated = this.stated;
    const answer = this.listed();
    if (!stated?.draft || answer?.video !== stated.video) return null;
    const row = (answer.scenes ?? []).find((s) => s?.kind === 'draft' && s.id === stated.draft);
    return row ? sortMoments(plain(sceneMoments(row))) : null;
  }

  /** Whether a time with a change is in hand: a read then waits for it (`behind`). */
  #inHand() {
    this.behind = !!this.edit.scene && this.edit.changed;
    return this.behind;
  }

  /** The time open with no change in it, started again on the time read, or closed with its video. */
  #restart(star) {
    if (!this.edit.scene) return;
    if (this.star === star) this.#beginTime();
    else this.edit.close();
  }

  /** Open the player on `video`: at a frame, paused, or running through the scene. */
  show(video, { at = null, play = false } = {}) {
    if (this.view?.video !== video) this.clip = { duration: 0, fps: null };
    this.view = { video, at, play, n: (this.view?.n ?? 0) + 1 };
  }

  // -- the time ---------------------------------------------------------------------

  /** Open the ★ video's time, with its player paused where the scene starts. */
  openTime() {
    const star = this.star;
    if (!star) return;
    const at = this.#beginTime();
    this.show(star, { at: this.moments[0]?.start ?? at[0] ?? 0 });
  }

  /** The time editor on the ★ video's moments as they stand, its frames pinned. Answers them. */
  #beginTime() {
    const star = this.star;
    // a collage that kept no instant pins nothing on the bar
    const at = this.frames().filter((f) => f.video === star && Number.isFinite(f.time)).map((f) => f.time).sort((a, b) => a - b);
    this.edit.begin({ kind: 'proof', key: 'proof', moments: this.moments, at });
    return at;
  }

  async applyTime() {
    const result = this.edit.result;
    if (!result) return;
    const changed = this.edit.changed;
    this.edit.close();
    if (changed) await this.write({ video: this.star, moments: result.moments });
  }

  /** Leave the time, as the tab is left: kept when it reads as one, as in Inspect. */
  leaveTime() {
    if (this.edit.result && this.edit.changed) this.applyTime();
    else this.edit.close();
  }

  /** An instant at each of these frames, beside the moments already stated. */
  async addInstants(times) {
    const fresh = [...new Set(times)];
    if (this.edit.scene) {
      for (const time of fresh) this.edit.add(time);
      return;
    }
    await this.write({ video: this.star, moments: [...this.moments, ...fresh.map((start) => ({ start, end: null }))] });
  }

  /**
   * Make another of the proof's videos the one it is about. Its time starts as the whole
   * video; back on the video its first panel was cut from, the proof is read off its
   * frames again, as it was before it stated anything.
   */
  async makeStar(video) {
    if (!video || video === this.star) return;
    this.edit.close();
    await this.write({ video, moments: [] }, { traced: video === this.frames()[0]?.video });
  }

  // -- writing --------------------------------------------------------------------------

  /**
   * State the proof's video and moments. A saved proof writes them at once and its toast
   * takes them back; a proof never saved holds them for its first save. `draft` is the
   * scene Take it up takes; `traced` takes a saved proof back to its frames, the Undo of
   * its first time.
   */
  async write({ video, moments }, { undoable = true, draft = null, traced = false } = {}) {
    // a time stated for the scene its frames found states that scene too, as Make the proof's does
    const taking = draft ?? (!this.stated?.draft && video === this.star ? this.match?.id ?? null : null);
    const next = { video, moments: sortMoments(plain(moments)), draft: this.stated?.draft ?? taking };
    const { caseId, name } = this.where();
    this.behind = false;
    if (!name) {
      this.stated = next;
      this.held = true;
      this.onstated();
      return true;
    }
    // what it stated, or that it stated nothing, which the Undo gives back
    const before = { video: this.star, moments: plain(this.moments), traced: !this.stated };
    this.#epoch += 1;
    let res;
    try {
      res = await this.api.put(`/api/cases/${caseId}/proofs/${encodeURIComponent(name)}/scene`, {
        moments: next.moments,
        video,
        ...(taking ? { draft: taking } : {}),
        ...(traced ? { traced: true } : {}),
      });
    } catch (e) {
      this.toast(e.message, 'danger');
      return false;
    }
    if (this.where().name !== name) return false;
    this.#take(res);
    this.onstated();
    const now = { video: this.star, moments: plain(this.moments) };
    const words = before.video !== now.video
      ? `The proof is now about ${videoName(now.video, this.titleOf)}`
      : `Scene now ${timeWords(now.moments)}`;
    this.toast(words, 'info', 6000, undoable ? {
      label: 'Undo',
      // only while nothing has moved it since, and on the proof it was said of
      onClick: () => {
        if (this.where().name === name && this.star === now.video && sameMoments(this.moments, now.moments)) {
          this.write(before, { undoable: false, traced: before.traced && !before.moments.length });
        }
      },
    } : null);
    return true;
  }

  /**
   * Write what a proof never saved was holding, right after its first save named it:
   * the video, the moments and the scene of Inspect it was made from. Run after every
   * save: the scene the frames of a proof made by hand found is taken up the same way.
   */
  async flush() {
    const { caseId, name } = this.where();
    if (!name) return;
    const found = this.match;
    if (found) {
      this.stated = { video: this.star, moments: plain(found.moments), draft: found.id };
      this.held = true;
    }
    this.#listedAs = name;
    this.#keepRefusals();
    if (!this.held || !this.stated) return;
    const { video, moments, draft } = this.stated;
    this.#epoch += 1;
    try {
      const res = await this.api.put(`/api/cases/${caseId}/proofs/${encodeURIComponent(name)}/scene`, {
        moments: plain(moments),
        video,
        ...(draft ? { draft } : {}),
      });
      if (this.where().name !== name) return;
      this.#take(res);
    } catch (e) {
      // still held, so the next save tries again
      this.toast(`The scene's time was not written: ${e.message}`, 'danger', 8000);
    }
  }

  /** The scene as the server now reads it. */
  #take(res) {
    this.#epoch += 1;
    this.held = false;
    this.stated = res?.stated
      ? { video: res.video, moments: sortMoments(plain(res.moments)), draft: res.draft ?? null }
      : null;
  }
}
