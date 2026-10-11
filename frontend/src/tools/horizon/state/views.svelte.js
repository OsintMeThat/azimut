/**
 * The case's saved Horizon views, and the one the tab shows (api/horizon_views.py).
 *
 * A view is saved by hand, under a name, and opened again with everything it
 * was read with (lib/horizon/savedView.js). The one open is `current`;
 * `dirty` says the tab shows something it does not hold yet, which is always
 * true of a view never saved. Saving again keeps the same view; saving under
 * another name renames it. `fresh` lets the next save start another view from
 * where the tab stands.
 *
 * Opening a view stands the eye where it stood, draws the picture as it was
 * drawn, marks its point, and lays its photo again with the work on it, held
 * to the terrain when it was. Billed
 * imagery is never switched back on by opening a view: its reach and its pass
 * wait on the switch. A photo the case no longer holds is said, and the view
 * opens without it.
 *
 * The preview the saved work lists show is drawn from the view on screen at
 * each save (`snapshot`), and a preview that cannot be drawn costs the save
 * nothing.
 */
import {
  footprintRing,
  madeOf,
  restoredView,
  sameWork,
  signature,
  suggestedTitle,
  viewSpec,
} from '../../../lib/horizon/savedView.js';

/**
 * @param {object} deps
 * @param {object} deps.api the app's fetch wrapper
 * @param {object} deps.view the Horizon view (state/horizon.svelte.js)
 * @param {object} deps.overlay the photo laid over it (state/overlay.svelte.js)
 * @param {() => string|null} deps.caseId the open case
 * @param {() => Promise<Blob|null>} [deps.snapshot] the view on screen, small, for the lists
 * @param {() => Array<{lat:number, lon:number}>} [deps.footprint] the ground the lens takes in
 */
export function createViewsState({ api, view, overlay, caseId, snapshot = async () => null, footprint = () => [] }) {
  let list = $state.raw([]);
  let current = $state.raw(null);
  // what the open view was saved or opened as: its signature, its trace and its pins
  let saved = $state.raw(null);
  let busy = $state(false);
  let error = $state('');
  let listed = 0;
  let opened = 0;

  const spec = $derived(viewSpec(view, overlay));
  const now = $derived(signature(spec));

  const base = (id) => `/api/cases/${encodeURIComponent(id)}/horizon/views`;

  function hold() {
    saved = { signature: signature(viewSpec(view, overlay)), strokes: overlay.strokes, pins: overlay.pins };
  }

  async function load(id = caseId()) {
    const mine = ++listed;
    if (!id) {
      list = [];
      return list;
    }
    try {
      const answer = await api.get(base(id));
      if (mine === listed) list = Array.isArray(answer) ? answer : [];
    } catch {
      // the list says nothing new; the views are still on disk
    }
    return list;
  }

  async function open(name) {
    const id = caseId();
    if (!id || !name) return false;
    const mine = ++opened;
    busy = true;
    error = '';
    try {
      const answer = await api.get(`${base(id)}/${encodeURIComponent(name)}`);
      if (mine !== opened || caseId() !== id) return false;
      const kept = answer.spec;
      if (overlay.source) overlay.remove();
      view.restore(restoredView(kept));
      if (kept.target) view.mark(kept.target, { height: kept.target.height ?? 0 });
      else view.clearTarget();
      const photo = kept.photo;
      if (photo && answer.photo_here) {
        await overlay.openCase(id, { path: photo.path, kind: photo.kind, title: photo.title }, { time: photo.time ?? 0 });
        if (mine !== opened || caseId() !== id) return false;
        overlay.restoreWork({
          mix: photo.mix,
          bend: photo.bend,
          corners: photo.corners,
          strokes: photo.strokes,
          traceTime: photo.trace_time,
          pins: photo.pins,
          hints: photo.hints,
          reach: photo.reach,
        });
        // opening the photo set its lens and its lines: the view's own come back over them
        view.look(kept.look);
        view.setLines(kept.picture?.lines);
        // a photo held to the terrain when it was saved is held again
        if (photo.locked) overlay.setLocked(true);
      } else if (photo) {
        error = `The photo this view was matched on is no longer in the case (${photo.title || photo.path}).`;
      }
      current = { name: answer.name ?? name, title: answer.title ?? name };
      hold();
      return true;
    } catch (failure) {
      if (mine === opened) error = failure.message;
      return false;
    } finally {
      if (mine === opened) busy = false;
    }
  }

  return {
    /** The case's views, newest first: `{ name, title, updated_at, lat, lon, heading, fov, photo, thumb }`. */
    get list() {
      return list;
    },
    /** The view the tab shows, once saved or opened: `{ name, title }`. */
    get current() {
      return current;
    },
    /** Whether the tab shows something its view does not hold: always, for a view never saved. */
    get dirty() {
      if (!spec) return false;
      return !current || !saved || now !== saved.signature || !sameWork(overlay, saved);
    },
    get busy() {
      return busy;
    },
    /** What went wrong opening or saving, or what a view opened without. */
    get error() {
      return error;
    },
    clearError() {
      error = '';
    },
    /** The name a view never saved is offered. */
    get suggested() {
      return suggestedTitle(view, overlay);
    },

    load,
    open,

    /** Keep the view in the case under `title`; a new title renames the view open. */
    async save(title) {
      const id = caseId();
      const kept = viewSpec(view, overlay);
      if (!id || !kept || busy) return null;
      const name = String(title ?? '').trim() || suggestedTitle(view, overlay);
      const body = { title: name, spec: kept, made: madeOf(view.panorama), footprint: footprintRing(footprint()) };
      if (current) {
        if (name === current.title) body.overwrite = true;
        else body.rename_from = current.name;
      }
      busy = true;
      error = '';
      try {
        const answer = await api.post(base(id), body);
        if (caseId() !== id) return null;
        current = { name: answer.name, title: answer.title };
        saved = { signature: signature(kept), strokes: kept.photo?.strokes ?? overlay.strokes, pins: overlay.pins };
        try {
          const picture = await snapshot();
          if (picture) {
            const form = new FormData();
            form.append('file', picture, 'preview.png');
            await api.put(`${base(id)}/${encodeURIComponent(answer.name)}/thumb`, form);
          }
        } catch {
          // a view without its preview is still kept: the list shows its glyph
        }
        await load(id);
        return answer;
      } catch (failure) {
        error = failure.message;
        return null;
      } finally {
        busy = false;
      }
    },

    /** Back to the view as it was saved. */
    revert() {
      return current ? open(current.name) : Promise.resolve(false);
    },

    /** Delete a view; the images kept from it stay in the case. */
    async remove(name) {
      const id = caseId();
      if (!id || !name) return false;
      try {
        await api.delete(`${base(id)}/${encodeURIComponent(name)}`);
      } catch (failure) {
        error = failure.message;
        return false;
      }
      if (current?.name === name) {
        current = null;
        saved = null;
      }
      await load(id);
      return true;
    },

    /** The next save starts another view from where the tab stands. */
    fresh() {
      opened += 1;
      current = null;
      saved = null;
      error = '';
    },
  };
}
