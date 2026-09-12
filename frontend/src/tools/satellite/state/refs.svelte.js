/**
 * The reference windows: floating scratch panes over the map, each holding one
 * of the case's images, so the shot being geolocated can be eyeballed against
 * the imagery while the map pans under it.
 *
 * They are scratch, and everything here follows from that:
 *
 * - **They live in the session, not in the case.** Nothing about which windows
 *   were open is worth restoring, and a capture must never show them — the
 *   crop hides them by class (`MapSurface.svelte`), which only works because
 *   they are chrome painted over the map rather than anything on it.
 * - **The picker reads the case's media when it opens**, never on mount. A tab
 *   that indexed the case just by being selected would be a request nobody
 *   asked for.
 * - **Focus renumbers the whole stack** instead of handing the newest window an
 *   ever-larger z. Small, gap-free values are what keep a window from
 *   eventually climbing over a dialog.
 *
 * The window's own geometry — placement, clamping, cursor-anchored zoom — is
 * `lib/refViewers.js`, and the pointer handling is `RefViewer.svelte`. This
 * holds which windows are open and what the picker is showing.
 *
 * @param {object} deps
 * @param {object} deps.api the app's fetch wrapper
 * @param {(message: string, kind?: string, ms?: number) => void} deps.notify
 * @param {() => string|undefined} deps.caseId the case whose media can be referenced
 * @param {() => object[]} deps.viewers the session's open windows
 * @param {(windows: object[]) => void} deps.setViewers replace them
 */
import { createViewer, nextZ, restack } from '../../../lib/refViewers.js';

/** New windows step down-right so the one underneath stays grabbable, and wrap
 *  before they walk off the map. */
const STAGGER = 26;
const STAGGER_WRAP = 6;

export function createRefsState({ api, notify, caseId, viewers, setViewers }) {
  let picking = $state(false); // the "pick an image" modal
  let media = $state([]); // what the case has to offer
  let loading = $state(false);
  let spawned = 0; // id source, so two windows on the same media stay distinct

  return {
    get picking() {
      return picking;
    },
    set picking(value) {
      picking = value;
    },
    get media() {
      return media;
    },
    get loading() {
      return loading;
    },
    /** The open windows, in the order they were spawned. */
    get open() {
      return viewers();
    },

    /** Read what this case can reference. A video counts: the frame to place is
     *  often in one, and the window plays it. */
    async openPicker() {
      picking = true;
      loading = true;
      try {
        const id = caseId();
        const all = id ? await api.get(`/api/cases/${id}/media`) : [];
        media = all.filter((item) => item.kind === 'image' || item.kind === 'video');
      } catch (e) {
        notify(`Could not load media: ${e.message}`, 'danger');
        media = [];
      } finally {
        loading = false;
      }
    },

    /** Spawn a window on one picked item, on top of the others. */
    add(item) {
      const open = viewers();
      const step = (open.length % STAGGER_WRAP) * STAGGER;
      open.push(
        createViewer(`ref-${++spawned}`, item, {
          x: 60 + step,
          y: 60 + step,
          z: nextZ(open),
        })
      );
      picking = false;
    },

    /** Bring one to the front, renumbering the rest so the values stay small. */
    focus(id) {
      const open = viewers();
      const z = restack(open, id);
      for (const window of open) window.z = z.get(window.id);
    },

    close(id) {
      setViewers(viewers().filter((window) => window.id !== id));
    },
  };
}
