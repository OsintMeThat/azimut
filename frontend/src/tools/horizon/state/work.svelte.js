/**
 * Horizon's bench, kept in the case so a reload brings it back (api/horizon_work.py).
 *
 * The bench is what the tab holds and nothing has saved: the view as it stands,
 * the photo laid with its trace and what is known about it, Find's setup, and
 * which saved view is open. It is written a moment after it changes, and
 * cleared once nothing is on it; saving a view or running a search stays the
 * analyst's act.
 *
 * It is read back when the tab opens on a case and when another case opens.
 * Nothing is written for a case before its bench has been read, so an empty tab
 * opening never wipes the work it is about to bring back. On the tab's first
 * opening the address may already say where the eye stands (a link, a reload):
 * the bench's eye is laid only when the address held none or the same one.
 */
import { photoSpec, viewSpec } from '../../../lib/horizon/savedView.js';

/** The bench is written this long after it last changed, milliseconds. */
export const SAVE_MS = 1000;

const sameEye = (a, b) => Boolean(a && b) && Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6;

/**
 * @param {object} deps
 * @param {object} deps.api `get`/`put`/`del`
 * @param {() => string|null} deps.caseId the case open
 * @param {object} deps.view the tab's view (state/horizon.svelte.js)
 * @param {object} deps.overlay the photo and its trace (state/overlay.svelte.js)
 * @param {object} deps.finder Find's setup (state/find.svelte.js)
 * @param {object} deps.views the saved views (state/views.svelte.js)
 * @param {object|null} [deps.buildings] the buildings round the eye
 * @param {(fn: Function, ms: number) => any} [deps.later]
 * @param {(handle: any) => void} [deps.cancel]
 */
export function createWorkState({ api, caseId, view, overlay, finder, views, buildings = null, later = setTimeout, cancel = clearTimeout }) {
  /** The case whose bench has been read: the only one written to. */
  let readFor = null;
  let reading = 0;
  let timer = null;
  /** The bench waiting on the timer, and the case it is for. */
  let waiting = null;
  /** What was last written, as text, so the same bench is not written twice. */
  let written = '';
  let first = true;

  const base = (id) => `/api/cases/${encodeURIComponent(id)}/horizon/work`;

  /** The bench as it stands, or null when nothing is on it. */
  function bench() {
    const spec = viewSpec(view, null, buildings?.settings ?? null);
    const photo = photoSpec(overlay);
    const find = finder.snapshot;
    if (!spec && !photo && !find) return null;
    return { view: views.current?.name ?? null, spec, photo, find };
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

    /** Write the bench a moment after it last changed, once the case's own has been read. */
    keep(now) {
      const id = caseId();
      if (!id || readFor !== id) return;
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
      readFor = caseId();
    },

    /**
     * Read the case's bench and lay it: the saved view it came from first, then
     * the view as it stood, the photo and Find's setup over it. `address` is the
     * eye the address stood at when the tab first opened, which a bench never
     * moves the eye away from.
     */
    async restore({ address = null } = {}) {
      const id = caseId();
      const mine = ++reading;
      // what the case left behind waited on the timer: it is that case's, written now
      this.flush();
      readFor = null;
      if (!id) return null;
      const firstTime = first;
      first = false;
      let answer = null;
      try {
        answer = await api.get(base(id));
      } catch {
        answer = null;
      }
      if (mine !== reading || caseId() !== id) return null;
      const work = answer?.work ?? null;
      const still = () => mine === reading && caseId() === id;
      try {
        if (work) {
          if (work.view) await views.open(work.view);
          if (!still()) return null;
          const eye = !(firstTime && address && work.spec?.eye && !sameEye(address, work.spec.eye));
          await views.layWork({ spec: work.spec, photo: work.photo }, { photoHere: Boolean(answer.photo_here), eye });
          if (!still()) return null;
          await finder.restore(work.find, id);
        } else {
          await finder.restore(null, id);
        }
      } finally {
        if (still()) {
          readFor = id;
          written = work ? JSON.stringify(bench()) : '';
        }
      }
      // a photo the bench held that the case no longer does: said, and the rest laid without it
      return work ? { work, photoGone: Boolean(work.photo) && !answer.photo_here } : null;
    },

    destroy() {
      cancel(timer);
      reading += 1;
    },
  };
}
