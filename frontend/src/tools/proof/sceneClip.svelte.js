/**
 * The clip cut for a proof's post, as the Scene tab shows it: the one the proof's scene
 * keeps, the cut running, or what stopped it (`lib/postClip.js`).
 *
 * It is read from the server when the tab is shown for a saved proof, and again when
 * the case says something changed (a delete taken back from the Trash). It never comes
 * from the proof's save, which carries no scene.
 */
import { cutClip, readClip } from '../../lib/postClip.js';

export class SceneClip {
  /** The clip the scene keeps, `{ path, start, end, size, title }`, or null. */
  clip = $state(null);
  /** The cut running: `{ start, end, percent }`, or null. */
  cutting = $state(null);
  /** Why the last cut stopped, in one sentence, or ''. */
  error = $state('');
  /** The proof this was read for, `case\nname`, so a late answer for another is dropped. */
  #for = '';

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
    try {
      const { clip } = await readClip(caseId, name, { get: this.api.get });
      if (this.#for === key) this.clip = clip;
    } catch {
      // the line stays as it was: nothing here is worth a toast
    }
  }

  /** Cut `passage` for the proof's post, the percent shown while it runs. */
  async cut(caseId, name, passage) {
    if (!caseId || !name || this.cutting) return;
    const key = `${caseId}\n${name}`;
    this.#for = key;
    this.error = '';
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
      if (this.#for === key) this.cutting = null;
    }
  }

  /** The clip's file went to the Trash. */
  removed() {
    this.clip = null;
  }
}
