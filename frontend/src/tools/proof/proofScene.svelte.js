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
 * scene is read off the panels (`lib/proofScene.js`).
 */
import { SceneEdit } from '../../lib/sceneEdit.svelte.js';
import { sameMoments, sortMoments, timeWords } from '../../lib/scenes.js';
import {
  outsideFrames, proofVideos, readStatedScene, starVideo, statedMoments, videoName,
} from '../../lib/proofScene.js';

const plain = (moments) => (moments ?? []).map(({ start, end }) => ({ start, end: end ?? null }));

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
  edit;

  /**
   * `where()` answers `{ caseId, name }`, the name null until the first save;
   * `frames()` the panels cut from a video (`lib/proofScene.panelFrames`).
   * `onstated()` hears every change the analyst states, not the first save's.
   */
  constructor({ api, toast, where, frames, onstated = () => {} }) {
    this.api = api;
    this.toast = toast;
    this.where = where;
    this.frames = frames;
    this.onstated = onstated;
    this.edit = new SceneEdit(() => this.clip);
  }

  /** The video the proof is about. */
  get star() {
    return starVideo(this.frames(), this.stated);
  }

  /** When in it the place shows: none is the whole video. */
  get moments() {
    return statedMoments(this.stated, this.star);
  }

  /** Every video the proof rests on, the ★ first. The block shows itself when there is one. */
  get videos() {
    return proofVideos(this.frames(), this.stated);
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
    this.edit.close();
  }

  /** A saved proof opened: what its spec states. */
  load(scene) {
    this.reset();
    this.stated = readStatedScene(scene);
  }

  /** A new proof made from a scene: held until its first save. */
  hold(scene) {
    this.reset();
    this.stated = readStatedScene(scene);
    this.held = !!this.stated;
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
    const at = this.frames().filter((f) => f.video === star).map((f) => f.time).sort((a, b) => a - b);
    this.edit.begin({ kind: 'proof', key: 'proof', moments: this.moments, at });
    this.show(star, { at: this.moments[0]?.start ?? at[0] ?? 0 });
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

  /** Make another of the proof's videos the one it is about. Its time starts as the whole video. */
  async makeStar(video) {
    if (!video || video === this.star) return;
    this.edit.close();
    await this.write({ video, moments: [] });
  }

  // -- writing --------------------------------------------------------------------------

  /**
   * State the proof's video and moments. A saved proof writes them at once and its toast
   * takes them back; a proof never saved holds them for its first save.
   */
  async write({ video, moments }, { undoable = true } = {}) {
    const next = { video, moments: sortMoments(plain(moments)), draft: this.stated?.draft ?? null };
    const { caseId, name } = this.where();
    if (!name) {
      this.stated = next;
      this.held = true;
      this.onstated();
      return true;
    }
    const before = { video: this.star, moments: plain(this.moments) };
    let res;
    try {
      res = await this.api.put(`/api/cases/${caseId}/proofs/${encodeURIComponent(name)}/scene`, {
        moments: next.moments,
        video,
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
      ? `The proof is now about ${videoName(now.video)}`
      : `Scene now ${timeWords(now.moments)}`;
    this.toast(words, 'info', 6000, undoable ? {
      label: 'Undo',
      // only while nothing has moved it since, and on the proof it was said of
      onClick: () => {
        if (this.where().name === name && this.star === now.video && sameMoments(this.moments, now.moments)) {
          this.write(before, { undoable: false });
        }
      },
    } : null);
    return true;
  }

  /**
   * Write what a proof never saved was holding, right after its first save named it:
   * the video, the moments and the scene of Inspect it was made from.
   */
  async flush() {
    const { caseId, name } = this.where();
    if (!this.held || !this.stated || !name) return;
    const { video, moments, draft } = this.stated;
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
    this.held = false;
    this.stated = res?.stated
      ? { video: res.video, moments: sortMoments(plain(res.moments)), draft: res.draft ?? null }
      : null;
  }
}
