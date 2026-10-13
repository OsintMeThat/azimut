/**
 * Find where a photo was taken: what the analyst sets up before the search.
 *
 * The photo and its trace are the overlay's (state/overlay.svelte.js), so a
 * skyline traced in the view is the one searched, and the other way round.
 * What is Find's own: the area, a polygon drawn on the map; the alignments, two
 * things one behind the other clicked on the photo then on the map
 * (lib/horizon/find.js), each with its tops touching or not; who took the
 * photo, a person, a drone or an aircraft, with a range of heights; and the
 * settings a search runs with.
 *
 * An alignment is made by four guided clicks: two on the photo, the same two
 * on the map. One whose tops touch asks the app where along its line the eye
 * lays the near top on the far one (`/api/horizon/alignment`), which gives a
 * place on its own.
 *
 * The search runs in the app, on the case's background queue
 * (api/horizon_finds.py): started by the analyst's press, followed while it
 * runs, stopped by theirs, and kept in the case once done with every point it
 * scored, so a search reopened shows its map without running again.
 */
import {
  ALIGN_COLOURS,
  ALIGN_STEPS,
  ALIGN_TOLERANCE,
  alignmentBearing,
  areaProblem,
  meeting,
  photoOffset,
} from '../../../lib/horizon/find.js';
import { searchHints } from '../../../lib/horizon/hints.js';
import { GAP_MIN_POINTS, tracePlane, traceSamples } from '../../../lib/horizon/overlay.js';
import { pollWhile } from '../../../lib/poll.js';

/** Who took the photo, and the heights each may stand at by default (over the ground, an aircraft's above the sea). */
export const WHO = {
  ground: { label: 'On foot', low: 1.7, high: 1.7 },
  drone: { label: 'Drone', low: 10, high: 120 },
  aircraft: { label: 'Aircraft', low: 300, high: 3000 },
};

/** The grid a search is laid on, metres between points; auto picks it from the area. */
export const SPACINGS = ['auto', 100, 250, 500, 1000];

/** Nothing set yet: on foot, auto spacing, the usual tolerance. */
export const NO_SETTINGS = Object.freeze({ spacing: 'auto', tolerance: ALIGN_TOLERANCE });

/** The frame a trace is measured in for the search: as wide as Fit's bench reads it. */
const PLANE_W = 1200;
/** A running search is read again this often, milliseconds. */
export const POLL_MS = 2000;
/**
 * Seconds a point of the grid takes, about, for the estimate before a search runs (measured on a
 * recent laptop; turns read finer cost more). Once it runs, the time left is the machine's own pace.
 */
const SECONDS_PER_POINT = { fine: 1, coarse: 0.3 };
/** A search's statuses while it runs. */
export const ACTIVE = ['queued', 'running'];

/** The time a search should take, in words: "about 6 min". */
export function durationText(points, step) {
  const seconds = points * (step <= 0.2 ? SECONDS_PER_POINT.fine : SECONDS_PER_POINT.coarse);
  if (seconds < 90) return 'about a minute';
  if (seconds < 3600) return `about ${Math.round(seconds / 60)} min`;
  return `about ${(seconds / 3600).toFixed(1)} h`;
}

let made = 0;

/**
 * @param {object} deps
 * @param {object} deps.api `get`/`post`
 * @param {object} deps.overlay the photo and its trace
 * @param {object} deps.view the tab's view state, for the lens the photo is seen through
 */
export function createFindState({ api, overlay, view }) {
  let open = $state(false);
  /** The area's corners, `{ lat, lon }`, in the order drawn. */
  let area = $state.raw([]);
  /** What a click on the map does: `area` adds a corner, `align` answers the alignment's step; null reads nothing. */
  let drawing = $state(null);
  /** The alignments made, each `{ id, colour, photo: { near, far }, map: { near, far }, offset, tops, heights, touch }`. */
  let alignments = $state.raw([]);
  /** The alignment being made: `{ step, photo, map }`, or null. */
  let pending = $state.raw(null);
  let who = $state.raw({ mode: 'ground', ...pick(WHO.ground) });
  let settings = $state.raw(NO_SETTINGS);
  /** The search on show: `{ name, status, progress, error, result, ask }` as the app keeps it, or null. */
  let search = $state.raw(null);
  /** The case's searches, newest first, as the list shows them. */
  let list = $state.raw([]);
  /** How large the search would be: `{ points, coarse, spacing, step }`, or null. */
  let estimated = $state.raw(null);
  let stopPoll = null;
  let caseOf = null;

  function pick({ low, high }) {
    return { low, high };
  }

  /** The lens the photo is seen through now, to read how far apart two points stand across it; null when unknown. */
  function lensNow() {
    const lens = overlay.lens;
    if (lens?.fov) return { fov: lens.fov, projection: overlay.isPanorama ? 'panorama' : 'camera' };
    return null;
  }

  function nextColour() {
    const used = new Set(alignments.map((a) => a.colour));
    return ALIGN_COLOURS.find((c) => !used.has(c)) ?? ALIGN_COLOURS[alignments.length % ALIGN_COLOURS.length];
  }

  function finishAlignment() {
    const { photo, map } = pending;
    const lens = lensNow();
    const offset = photoOffset(photo.near, photo.far, lens ?? {});
    alignments = [
      ...alignments,
      {
        id: `al_${Date.now().toString(36)}_${(made += 1)}`,
        colour: nextColour(),
        photo,
        map,
        // apart across a photo of unknown lens: taken as one behind the other
        offset: offset ?? 0,
        offsetKnown: offset !== null,
        tops: false,
        heights: { near: 0, far: 0 },
        touch: null,
      },
    ];
    pending = null;
    drawing = null;
  }

  // the question last asked about each alignment: an answer to an older one is dropped
  const asked = new Map();
  let asking = 0;

  async function askTouch(id) {
    const one = alignments.find((a) => a.id === id);
    if (!one?.tops) return;
    const mine = (asking += 1);
    asked.set(id, mine);
    setOne(id, { touch: { busy: true } });
    try {
      const answer = await api.post('/api/horizon/alignment', {
        near: { ...one.map.near, height: one.heights.near },
        far: { ...one.map.far, height: one.heights.far },
        bearing: alignmentBearing(one),
        mode: who.mode,
        low: who.low,
        high: who.high,
      });
      if (asked.get(id) !== mine) return;
      setOne(id, { touch: answer });
    } catch (failure) {
      if (asked.get(id) !== mine) return;
      setOne(id, { touch: { error: failure.message || 'The terrain could not be read' } });
    }
  }

  function setOne(id, change) {
    alignments = alignments.map((a) => (a.id === id ? { ...a, ...change } : a));
  }

  /** The trace on the picture plane, as the search reads it, or null while it is too short. */
  function planeOfTrace() {
    const aspect = overlay.aspect;
    if (!(aspect > 0)) return null;
    const size = { width: PLANE_W, height: PLANE_W / aspect };
    const samples = traceSamples(overlay.strokesSeen ?? [], size);
    if (samples.length < GAP_MIN_POINTS) return null;
    const lens = overlay.lens;
    const projection = overlay.isPanorama ? 'panorama' : 'camera';
    const told = searchHints(overlay.hints, { lensKnown: Boolean(lens) });
    const fov = lens?.fov ?? Math.sqrt(told.within[0] * told.within[1]);
    const plane = tracePlane(samples, { fov, ...size, projection, heading: 0, tilt: 0, roll: 0 });
    return { ...plane, fov, known: Boolean(lens), ...(told.within ? { within: told.within } : {}), projection };
  }

  /** What a search asks the app, from the photo, its trace and what Find holds; null while it cannot be asked. */
  function askNow() {
    const trace = planeOfTrace();
    if (!trace || areaProblem(area)) return null;
    const reach = overlay.hints?.reach;
    const source = overlay.source;
    return {
      ...(source?.path ? { title: `${source.name ?? 'Photo'} search` } : {}),
      photo: source?.path
        ? { path: source.path, kind: source.kind, title: source.name ?? '', time: overlay.time ?? 0, strokes: overlay.strokes }
        : null,
      trace,
      area: area.map((p) => ({ lat: p.lat, lon: p.lon })),
      who: { mode: who.mode, low: who.low, high: who.high },
      reach: Number.isFinite(reach) ? reach : reach === 'all' ? 100_000 : null,
      spacing: settings.spacing === 'auto' ? null : settings.spacing,
      alignments: alignments.map((one) => ({
        near: one.map.near,
        far: one.map.far,
        bearing: alignmentBearing(one),
        tolerance: settings.tolerance,
        offset: one.offset,
        photo_x: (overlay.seenOf(one.photo.near).u - 0.5) * 2,
        photo: one.photo,
        tops: one.tops,
        heights: one.heights,
        colour: one.colour,
      })),
      hints: overlay.hints,
    };
  }

  function follow(caseId, name) {
    stopPoll?.();
    stopPoll = pollWhile(
      () => Boolean(search && search.name === name && ACTIVE.includes(search.status)),
      async () => {
        try {
          const now = await api.get(`/api/cases/${encodeURIComponent(caseId)}/horizon/finds/${encodeURIComponent(name)}`);
          if (search?.name === name) search = { ...now, name };
          if (!ACTIVE.includes(now.status)) refreshList(caseId);
        } catch {
          // read again at the next tick; a search deleted meanwhile stops being followed
        }
      },
      POLL_MS
    );
  }

  async function refreshList(caseId = caseOf) {
    if (!caseId) {
      list = [];
      return;
    }
    caseOf = caseId;
    try {
      list = await api.get(`/api/cases/${encodeURIComponent(caseId)}/horizon/finds`);
    } catch {
      list = [];
    }
  }

  return {
    get open() {
      return open;
    },
    /** Open the finder; the photo and its trace are the overlay's. */
    show() {
      open = true;
    },
    hide() {
      open = false;
      drawing = null;
      pending = null;
    },

    // -- the area ------------------------------------------------------------

    get area() {
      return area;
    },
    /** Why the area cannot be searched yet, '' when it can. */
    get areaProblem() {
      return areaProblem(area);
    },
    get drawing() {
      return drawing;
    },
    /** Start the area again, corner by corner. */
    drawArea() {
      pending = null;
      area = [];
      drawing = 'area';
    },
    addCorner(point) {
      if (drawing !== 'area' || !point) return;
      area = [...area, { lat: point.lat, lon: point.lon }];
    },
    moveCorner(index, point) {
      if (!(index >= 0 && index < area.length) || !point) return;
      area = area.map((p, i) => (i === index ? { lat: point.lat, lon: point.lon } : p));
    },
    removeCorner(index) {
      area = area.filter((_, i) => i !== index);
    },
    /** The last corner placed: the area is closed and the map reads clicks no more. */
    closeArea() {
      if (drawing === 'area') drawing = null;
    },
    clearArea() {
      area = [];
      if (drawing === 'area') drawing = null;
    },
    /** A whole area at once (a saved search, a test). */
    setArea(points) {
      area = (points ?? []).map((p) => ({ lat: p.lat, lon: p.lon }));
    },

    // -- the alignments ---------------------------------------------------------

    get alignments() {
      return alignments;
    },
    get pending() {
      return pending;
    },
    /** What the alignment being made asks for next, `{ on, end, text }`, or null. */
    get step() {
      return pending ? ALIGN_STEPS[pending.step] : null;
    },
    startAlignment() {
      pending = { step: 0, photo: {}, map: {} };
      drawing = 'align';
    },
    cancelAlignment() {
      pending = null;
      if (drawing === 'align') drawing = null;
    },
    /** A click on the photo, `{ u, v }`: taken when the alignment asks for the photo. */
    photoClick(point) {
      const step = pending ? ALIGN_STEPS[pending.step] : null;
      if (step?.on !== 'photo' || !point) return false;
      pending = { ...pending, step: pending.step + 1, photo: { ...pending.photo, [step.end]: { u: point.u, v: point.v } } };
      return true;
    },
    /** A click on the map, `{ lat, lon }`: taken when the alignment asks for the map. */
    mapClick(point) {
      const step = pending ? ALIGN_STEPS[pending.step] : null;
      if (step?.on !== 'map' || !point) return false;
      pending = { ...pending, step: pending.step + 1, map: { ...pending.map, [step.end]: { lat: point.lat, lon: point.lon } } };
      if (pending.step >= ALIGN_STEPS.length) finishAlignment();
      return true;
    },
    removeAlignment(id) {
      alignments = alignments.filter((a) => a.id !== id);
    },
    /** Move one end of an alignment on the map. */
    moveEnd(id, end, point) {
      const one = alignments.find((a) => a.id === id);
      if (!one || !point) return;
      setOne(id, { map: { ...one.map, [end]: { lat: point.lat, lon: point.lon } }, touch: null });
      if (one.tops) askTouch(id);
    },
    /** Say the near top touches the far one in the photo, or not; with the tops' heights over the ground (0: summits). */
    setTops(id, on, heights = null) {
      const one = alignments.find((a) => a.id === id);
      if (!one) return;
      if (!on) asked.delete(id);
      setOne(id, {
        tops: Boolean(on),
        heights: heights ? { near: Math.max(0, Number(heights.near) || 0), far: Math.max(0, Number(heights.far) || 0) } : one.heights,
        touch: null,
      });
      if (on) askTouch(id);
    },
    /** Where the alignments meet, `{ at, spread, crossings }`, or null. */
    get meeting() {
      return meeting(alignments);
    },

    // -- the search ------------------------------------------------------------------

    /** What keeps a search from being run now, '' when nothing does. */
    get searchProblem() {
      if (!overlay.source) return 'Add the photo first';
      if (!planeOfTrace()) return 'Trace the skyline on the photo first';
      if (area.length < 3) return 'Draw the area on the map';
      return areaProblem(area);
    },
    get search() {
      return search;
    },
    get searching() {
      return Boolean(search && ACTIVE.includes(search.status));
    },
    get list() {
      return list;
    },
    refreshList,
    get estimated() {
      return estimated;
    },
    /** Ask the app how large the search would be, for the line under the button. */
    async estimate() {
      const ask = askNow();
      if (!ask) {
        estimated = null;
        return;
      }
      try {
        estimated = await api.post('/api/horizon/finds/estimate', ask);
      } catch {
        estimated = null;
      }
    },
    /** Start the search in the case. */
    async start(caseId) {
      const ask = askNow();
      if (!ask || !caseId) return null;
      caseOf = caseId;
      const row = await api.post(`/api/cases/${encodeURIComponent(caseId)}/horizon/finds`, ask);
      search = { ...row, ask, result: null };
      follow(caseId, row.name);
      refreshList(caseId);
      return row;
    },
    /** Stop the search on show. */
    async stop() {
      if (!search || !caseOf) return;
      const row = await api.post(`/api/cases/${encodeURIComponent(caseOf)}/horizon/finds/${encodeURIComponent(search.name)}/cancel`);
      search = { ...search, ...row };
    },
    /** Put the search away, its map and its places with it (it stays in the case). */
    closeSearch() {
      stopPoll?.();
      search = null;
    },
    /** Open a search the case keeps: its area, alignments and settings come back with its map. */
    async openSearch(caseId, name) {
      caseOf = caseId;
      const record = await api.get(`/api/cases/${encodeURIComponent(caseId)}/horizon/finds/${encodeURIComponent(name)}`);
      const ask = record.ask ?? {};
      area = (ask.area ?? []).map(([lat, lon]) => ({ lat, lon }));
      drawing = null;
      pending = null;
      who = ask.who ? { mode: ask.who.mode, low: ask.who.low, high: ask.who.high } : who;
      const kept = (ask.alignments ?? [])[0];
      settings = { spacing: ask.spacing ?? 'auto', tolerance: kept?.tolerance ?? settings.tolerance };
      alignments = (ask.alignments ?? []).map((one, index) => ({
        id: `al_${name}_${index}`,
        colour: one.colour ?? ALIGN_COLOURS[index % ALIGN_COLOURS.length],
        photo: one.photo ?? { near: { u: 0.5, v: 0.5 }, far: { u: 0.5, v: 0.4 } },
        map: { near: one.near, far: one.far },
        offset: one.offset ?? 0,
        offsetKnown: true,
        tops: Boolean(one.tops),
        heights: one.heights ?? { near: 0, far: 0 },
        touch: null,
      }));
      search = { ...record, name };
      if (ACTIVE.includes(record.status)) follow(caseId, name);
      return record;
    },
    /** Delete a search the case keeps, to the Trash. */
    async remove(caseId, name) {
      await api.del(`/api/cases/${encodeURIComponent(caseId)}/horizon/finds/${encodeURIComponent(name)}`);
      if (search?.name === name) this.closeSearch();
      await refreshList(caseId);
    },

    // -- who took it, and how the search runs --------------------------------------

    get who() {
      return who;
    },
    setWho(change) {
      const mode = change?.mode && WHO[change.mode] ? change.mode : who.mode;
      const base = mode !== who.mode ? pick(WHO[mode]) : who;
      const low = Number.isFinite(change?.low) ? change.low : base.low;
      const high = Number.isFinite(change?.high) ? change.high : base.high;
      who = mode === 'ground' ? { mode, low: Math.min(low, 100), high: Math.min(low, 100) } : { mode, low: Math.min(low, high), high: Math.max(low, high) };
      for (const one of alignments) if (one.tops) askTouch(one.id);
    },
    get settings() {
      return settings;
    },
    setSettings(change) {
      const spacing = SPACINGS.includes(change?.spacing) ? change.spacing : settings.spacing;
      const tolerance = Number(change?.tolerance) > 0 ? Number(change.tolerance) : settings.tolerance;
      settings = { spacing, tolerance };
    },

    /** The lens Find reads the photo through, for a line on the panel. */
    get lens() {
      return lensNow();
    },
    /** The view's camera, which a place found is opened with. */
    get camera() {
      return view.camera;
    },
  };
}
