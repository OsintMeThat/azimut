/**
 * The clip cut for a proof's post, as the Scene tab shows it: the one the proof's scene
 * keeps, the cut running, or what stopped it (`lib/postClip.js`).
 *
 * It is read from the server when the tab is shown for a saved proof, and again when
 * the case says something changed (a delete taken back from the Trash). It never comes
 * from the proof's save, which carries no scene.
 *
 * A proof never saved has nowhere to keep a clip yet: its cut saves it first, through
 * Geo Proof's own save, and cuts once that landed. A save that stopped cuts nothing.
 */
import { cutClip, readClip } from '../../lib/postClip.js';

/** What the line says when the save a cut waited for did not land. */
export const NOT_SAVED = 'The proof was not saved, so nothing was cut.';

export class SceneClip {
  /** The clip the scene keeps, `{ path, start, end, size, title }`, or null. */
  clip = $state(null);
  /** The cut running: `{ start, end, percent }`, or null. */
  cutting = $state(null);
  /** Why the last cut stopped, in one sentence, or ''. */
  error = $state('');
  /** A proof never saved being saved, before its cut. */
  saving = $state(false);
  /** The proof this was read for, `case\nname`, so a late answer for another is dropped. */
  #for = '';
  /** Moved as each cut starts and ends, so a read asked before then never answers over it. */
  #cuts = 0;

  constructor({ api }) {
    this.api = api;
  }

  /** Read the clip of a saved proof. A proof never saved, or none, holds none. */
  async read(caseId, name) {
    const key = caseId && name ? `${caseId}\n${name}` : '';
    if (key !== this.#for) {
      this.#for = key;
      this.clip = null;
      this.cutting = null;
      this.error = '';
    }
    if (!key) return;
    const cuts = this.#cuts;
    try {
      const { clip } = await readClip(caseId, name, { get: this.api.get });
      if (this.#for === key && this.#cuts === cuts) this.clip = clip;
    } catch {
      // the line stays as it was: nothing here is worth a toast
    }
  }

  /**
   * Cut `passage` for the proof's post, the percent shown while it runs. A proof never
   * saved (no `name`) is saved first by `save()`, which answers `{ caseId, name }` once
   * the save landed, or null when it stopped or was cancelled; then nothing is cut, and
   * `error` says why.
   */
  async cut(caseId, name, passage, save = null) {
    if (this.cutting || this.saving) return;
    if (!name) {
      if (!save) return;
      this.error = '';
      this.saving = true;
      let saved = null;
      try {
        saved = await save();
      } catch {
        // the save says what went wrong in its own toast
      } finally {
        this.saving = false;
      }
      if (!saved?.caseId || !saved?.name) {
        this.error = NOT_SAVED;
        return;
      }
      ({ caseId, name } = saved);
    }
    if (!caseId || !name) return;
    const key = `${caseId}\n${name}`;
    this.#for = key;
    this.error = '';
    this.#cuts += 1;
    this.cutting = { start: passage.start, end: passage.end, percent: 0 };
    try {
      const clip = await cutClip(caseId, name, passage, {
        post: this.api.post,
        get: this.api.get,
        isStale: () => this.#for !== key,
        onprogress: (percent) => {
          if (this.#for === key && this.cutting) this.cutting = { ...this.cutting, percent };
        },
      });
      if (this.#for === key && clip) this.clip = clip;
    } catch (e) {
      if (this.#for === key) this.error = e.message;
    } finally {
      this.#cuts += 1;
      if (this.#for === key) this.cutting = null;
    }
  }

  /** The clip's file went to the Trash. */
  removed() {
    this.clip = null;
  }
}
