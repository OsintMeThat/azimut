/**
 * What the scene being geolocated gathers, joining the proof open in Geo Proof that holds
 * it (`lib/geolocating.svelte.js`, `engine/geolocate.py`): a proof made from the scene and
 * never saved, by Make the proof or a map tab's Send to Geo Proof, as well as a saved one
 * that took it up. Two sources: the map captures the server attaches to the scene, and
 * the frames saved and collages exported inside a passage of it (`joins`, an instant
 * giving none). This says which ones the proof has not had yet.
 *
 * Each joins once. What the scene held before the proof took it up, the pictures a
 * handoff lays out itself, and everything laid since are passed over, so one the analyst
 * takes off stays off. The composer asks at each change and lays what it answers.
 */
import { isPicture } from '../../lib/sceneQueue.js';

/**
 * Whether the proof open holds the scene geolocated (`held`, the pill's row): a video's
 * scene it takes up, saved or not (`draft`, `ProofScene.draft`), or a picture it lays
 * out (`panels`, the case files of its panels).
 */
export function holdsScene(held, { draft = null, panels = [] } = {}) {
  if (!held?.id || !held.video) return false;
  if (isPicture(held)) return panels.includes(held.video);
  return draft === held.id;
}

/** What a toast says of what was laid: map captures, pictures of the video, or both; '' for none. */
export function addedWords(captures, pictures) {
  const count = (n, one, many) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
  const parts = [
    captures > 0 ? count(captures, 'map capture', 'map captures') : '',
    pictures > 0 ? count(pictures, 'picture of the video', 'pictures of the video') : '',
  ].filter(Boolean);
  return parts.length ? `${parts.join(' and ')} added` : '';
}

export class GatheredJoin {
  /** The scene the proof open holds, as last asked about; null to take it anew. */
  #key = null;
  /** What is passed over for it. */
  #passed = new Set();
  /** The sources already read for it, by kind. */
  #seen = new Set();
  /** The pictures the last handoff laid out itself. */
  #handed = new Set();

  /** Another proof opened or a new one started: what the scene holds then is passed over. */
  reset() {
    this.#key = null;
  }

  /** Pictures a handoff lays out itself: never laid again as gathered by the scene. */
  hand(paths) {
    this.#handed = new Set(paths);
    for (const path of paths) this.#passed.add(path);
  }

  /**
   * The case files to lay in the proof now, marked as laid. `key` names the scene the
   * proof holds, '' when it holds none. `sources` gives what the scene holds by kind, in
   * the order to lay it, a kind not read yet for this scene null: the first read of each
   * is taken as it stands, nothing laid. Nothing is laid while Geo Proof is behind
   * another tool (`front`).
   */
  take({ key, sources = {}, panels = [], front = false }) {
    if (key !== this.#key) {
      this.#key = key;
      this.#passed = new Set([...panels, ...this.#handed]);
      this.#seen = new Set();
    }
    const fresh = [];
    for (const [kind, paths] of Object.entries(sources)) {
      if (!paths) continue;
      if (!this.#seen.has(kind)) {
        this.#seen.add(kind);
        for (const path of paths) this.#passed.add(path);
        continue;
      }
      for (const path of paths) {
        // one already laid out, by hand or by a handoff, stays where the analyst leaves it
        if (panels.includes(path)) this.#passed.add(path);
        else if (path && !this.#passed.has(path) && !this.#handed.has(path) && !fresh.includes(path)) fresh.push(path);
      }
    }
    if (!key || !front) return [];
    for (const path of fresh) this.#passed.add(path);
    return fresh;
  }
}
