/**
 * Horizon's bench, kept in the case (api/horizon_work.py).
 *
 * The bench is what the tab holds and nothing has saved: the view as it stands,
 * the photo laid with its trace and what is known about it, Find's setup, the
 * mode, and which saved view is open. It is written a moment after it changes,
 * and cleared once nothing is on it; saving a view or running a search stays
 * the analyst's act.
 *
 * The tab opens on the map, never on the bench. When the tab opens on a case,
 * or another case opens, the bench is read and, if it holds work no save
 * keeps, offered: Resume lays it, Discard clears it, and anything started
 * instead replaces it. Nothing is written for a case before its bench has been
 * read, so an empty tab opening never wipes the work it is about to offer.
 */
import { photoSpec, viewSpec } from '../../../lib/horizon/savedView.js';
import { MODES } from '../../../lib/horizon/modes.js';

/** The bench is written this long after it last changed, milliseconds. */
export const SAVE_MS = 1000;

/**
 * @param {object} deps
 * @param {object} deps.api `get`/`put`/`del`
 * @param {() => string|null} deps.caseId the case open
 * @param {object} deps.view the tab's view (state/horizon.svelte.js)
 * @param {object} deps.overlay the photo and its trace (state/overlay.svelte.js)
 * @param {object} deps.finder Find's setup (state/find.svelte.js)
 * @param {object} deps.views the saved views (state/views.svelte.js)
 * @param {object|null} [deps.buildings] the buildings round the eye
 * @param {() => string} [deps.mode] the mode the tab is in (lib/horizon/modes.js)
 * @param {(fn: Function, ms: number) => any} [deps.later]
 * @param {(handle: any) => void} [deps.cancel]
 */
export function createWorkState({ api, caseId, view, overlay, finder, views, buildings = null, mode = () => 'view', later = setTimeout, cancel = clearTimeout }) {
  /** The case whose bench has been read: the only one written to. */
  let readFor = null;
  let reading = 0;
  let timer = null;
  /** The bench waiting on the timer, and the case it is for. */
  let waiting = null;
  /** What was last written, as text, so the same bench is not written twice. */
  let written = '';
  /** The bench read back with work no save keeps, waiting on Resume: `{ caseId, work, photoHere }`, or null. */
  let offer = $state.raw(null);

  const base = (id) => `/api/cases/${encodeURIComponent(id)}/horizon/work`;

  /**
   * The bench as it stands, or null when nothing is on it. `saved` says a save
   * keeps all of it: the saved view open and unchanged, and Find's setup the
   * search on show was asked with.
   */
  function bench() {
    const spec = viewSpec(view, null, buildings?.settings ?? null);
    const photo = photoSpec(overlay);
    const find = finder.snapshot;
    if (!spec && !photo && !find) return null;
    const viewKept = Boolean(views.current && !views.dirty);
    const findKept = Boolean(find?.search && !finder.edited);
    const saved = (!spec || viewKept) && (!find || findKept) && (!photo || viewKept || findKept);
    return { view: views.current?.name ?? null, spec, photo, find, mode: mode(), saved };
  }

  async function write(id, now) {
    const text = now ? JSON.stringify(now) : '';
    if (text === written) return;
    written = text;
    try {
      if (now) await api.put(base(id), now);
      else await api.del(base(id));
    } catch {
      // the bench is a convenience: the next change writes it again
      written = '';
    }
  }

  return {
    /** The bench as it stands, for the tab to follow. */
    get current() {
      return bench();
    },

    /** The bench offered back, `{ caseId, work, photoHere }`, or null. */
    get offer() {
      return offer;
    },

    /** Write the bench a moment after it last changed, once the case's own has been read. */
    keep(now) {
      const id = caseId();
      if (!id || readFor !== id) return;
      // something started instead of the work offered: it replaces it
      if (now && offer) offer = null;
      cancel(timer);
      waiting = { id, now };
      timer = later(() => {
        waiting = null;
        write(id, now);
      }, SAVE_MS);
    },

    /** Write what waits now: the tab is going, or another case is opening. */
    flush() {
      cancel(timer);
      if (waiting) write(waiting.id, waiting.now);
      waiting = null;
    },

    /**
     * The analyst acted before the bench was read, a photo or an eye handed over
     * from another tool: what they did wins over the bench, and is kept from now on.
     */
    interrupt() {
      reading += 1;
      offer = null;
      readFor = caseId();
    },

    /**
     * Read the case's bench, laying nothing: work no save keeps is offered
     * (`offer`), unless `quiet` because the tab already holds work of its own,
     * which is then kept in its place.
     */
    async restore({ quiet = false } = {}) {
      const id = caseId();
      const mine = ++reading;
      // what the case left behind waited on the timer: it is that case's, written now
      this.flush();
      readFor = null;
      offer = null;
      if (!id) return null;
      let answer = null;
      try {
        answer = await api.get(base(id));
      } catch {
        answer = null;
      }
      if (mine !== reading || caseId() !== id) return null;
      const work = answer?.work ?? null;
      readFor = id;
      // an empty tab writes nothing: the bench stays as it was left until something is started
      written = '';
      if (work && !work.saved && !quiet) offer = { caseId: id, work, photoHere: Boolean(answer.photo_here) };
      return offer;
    },

    /**
     * Lay the work offered: the saved view it came from first, then the view as
     * it stood, the photo and Find's setup over it. Says the mode it was left in,
     * and whether its photo has left the case.
     */
    async resume() {
      const held = offer;
      const id = caseId();
      if (!held || held.caseId !== id) return null;
      offer = null;
      const mine = ++reading;
      readFor = null;
      const { work, photoHere } = held;
      const still = () => mine === reading && caseId() === id;
      try {
        if (work.view) await views.open(work.view);
        if (!still()) return null;
        await views.layWork({ spec: work.spec, photo: work.photo }, { photoHere });
        if (!still()) return null;
        await finder.restore(work.find, id);
      } finally {
        if (still()) {
          readFor = id;
          written = JSON.stringify(bench());
        }
      }
      if (!still()) return null;
      return {
        mode: MODES.some((one) => one.id === work.mode) ? work.mode : 'view',
        photoGone: Boolean(work.photo) && !photoHere,
      };
    },

    /** Let the work offered go, and the case's bench with it. */
    discard() {
      const held = offer;
      offer = null;
      if (!held || held.caseId !== caseId()) return;
      api.del(base(held.caseId)).catch(() => {});
    },

    destroy() {
      cancel(timer);
      reading += 1;
    },
  };
}

/**
 * The work offered back, in a line: what the view was, the photo and its
 * trace, and Find's search or area. `views` and `searches` are the case's
 * rows, for their titles.
 */
export function benchSummary(work, { views = [], searches = [] } = {}) {
  if (!work) return '';
  const titleOf = (rows, name) => rows.find((row) => row.name === name)?.title ?? name;
  const parts = [];
  if (work.view) parts.push(`changes to “${titleOf(views, work.view)}”`);
  else if (work.spec?.eye) parts.push(`a viewpoint at ${work.spec.eye.lat.toFixed(4)}, ${work.spec.eye.lon.toFixed(4)}`);
  if (work.photo) {
    const lines = work.photo.strokes?.length ?? 0;
    const what = work.photo.kind === 'video' ? 'video' : 'photo';
    parts.push(`${what} “${work.photo.title || work.photo.path.split('/').pop()}”${lines ? `, ${lines} ${lines === 1 ? 'line' : 'lines'} traced` : ''}`);
  }
  if (work.find?.search) parts.push(`search “${titleOf(searches, work.find.search)}”`);
  else if (work.find?.area?.length) parts.push('an area drawn in Find');
  const line = parts.join(' · ');
  return line ? line[0].toUpperCase() + line.slice(1) : 'Find’s settings';
}
