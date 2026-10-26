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
 * - **A window is free, docked or pinned** (`PLACES` in `lib/refViewers.js`).
 *   Docked, it leaves the map for a column on that side (`RefDock.svelte`), so
 *   the map narrows rather than being covered; each side has its own column,
 *   its windows stacked at their picture's height. Pinned, it stays over the
 *   map in that corner, clear of the map's own controls, as the map changes
 *   size. The columns' widths are the session's, like everything else here.
 * - **A clip's frame rate is read when it opens**, so a frame step is one frame.
 *   Without it the window steps at the Inspect player's default rate.
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
import { clampDock, createViewer, DOCK_W, nextZ, PLACES, restack } from '../../../lib/refViewers.js';
import { preciseClock } from '../../../lib/inspectPlayer.js';

/** New windows step down-right so the one underneath stays grabbable, and wrap
 *  before they walk off the map. */
const STAGGER = 26;
const STAGGER_WRAP = 6;

export function createRefsState({ api, notify, caseId, viewers, setViewers }) {
  let picking = $state(false); // the "pick an image" modal
  let media = $state([]); // what the case has to offer
  let loading = $state(false);
  let spawned = 0; // id source, so two windows on the same media stay distinct
  // The picker's chip and working-files switch, kept for the session so the
  // next reference opens on the same narrowing as the last one.
  let category = $state(null);
  let showWorking = $state(false);
  const dockWidths = $state({ left: DOCK_W, right: DOCK_W });

  /** One more window, on top of the others, handed back as the session holds it. */
  function spawn(item, at = {}) {
    const open = viewers();
    const step = (open.length % STAGGER_WRAP) * STAGGER;
    open.push(
      createViewer(`ref-${++spawned}`, item, {
        x: at.x ?? 60 + step,
        y: at.y ?? 60 + step,
        z: nextZ(open),
        docked: at.docked,
      })
    );
    return open[open.length - 1];
  }

  /** The clip's own frame rate, from the same probe Inspect reads. A probe that
   *  fails leaves the default rate, as Inspect does. */
  async function readRate(pane) {
    const id = caseId();
    if (!id) return;
    try {
      const probe = await api.get(`/api/cases/${id}/inspect/probe?path=${encodeURIComponent(pane.path)}`);
      if (probe?.fps > 0) pane.fps = probe.fps;
    } catch {
      // stepped at the default rate
    }
  }

  return {
    get picking() {
      return picking;
    },
    set picking(value) {
      picking = value;
    },
    get category() {
      return category;
    },
    set category(value) {
      category = value;
    },
    get showWorking() {
      return showWorking;
    },
    set showWorking(value) {
      showWorking = value;
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
    /** The ones over the map, and the ones in a column beside it. */
    get floating() {
      return viewers().filter((window) => !window.docked);
    },
    dockedOn(side) {
      return viewers().filter((window) => window.docked === side);
    },
    dockWidth(side) {
      return dockWidths[side];
    },
    /** Widen or narrow one column, kept to what leaves the map at least half
     *  of the row it shares once the other column has its own. */
    setDockWidth(side, width, total) {
      const other = side === 'left' ? 'right' : 'left';
      const taken = viewers().some((window) => window.docked === other) ? dockWidths[other] : 0;
      dockWidths[side] = clampDock(width, total - taken);
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
      const pane = spawn(item);
      picking = false;
      if (pane.kind === 'video') readRate(pane);
    },

    /**
     * A frame of a clip, kept as a picture in a window of its own: beside the
     * clip in the dock when the clip is docked, a step down from it otherwise.
     * It is the session's like the window, so nothing is filed.
     */
    keepFrame(id, still, at) {
      const clip = viewers().find((window) => window.id === id);
      if (!clip || !still) return;
      const pane = spawn(
        { path: clip.path, kind: 'image', title: `${clip.title || 'Reference'} · ${preciseClock(at)}`, still },
        { x: clip.x + STAGGER, y: clip.y + STAGGER, docked: clip.docked }
      );
      pane.facts = clip.facts;
    },

    /** Put a window in one of `PLACES` by its id; asked for the place it is
     *  already in, or for none, it floats free again. */
    place(id, where) {
      const pane = viewers().find((window) => window.id === id);
      if (!pane) return;
      const target = PLACES.find((place) => place.id === where);
      const free = !target || (pane.docked || pane.corner) === where;
      pane.docked = free ? false : (target.docked ?? false);
      pane.corner = free ? false : (target.corner ?? false);
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
