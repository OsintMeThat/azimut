/**
 * Find where a photo was taken: what the analyst sets up before the search.
 *
 * The photo and its trace are the overlay's (state/overlay.svelte.js), so a
 * skyline traced in the view is the one searched, and the other way round.
 * What is Find's own: the area, a polygon drawn on the map, more areas searched
 * with it on the same grid, and zones beside it (each searched on a finer grid
 * of its own, or left out); the brush's strokes, painted over the grid to leave
 * points out or take them back, each over the ones before; the alignments, two
 * things one behind the other clicked on the photo then on the map
 * (lib/horizon/find.js), each with its tops touching or not; who took the
 * photo, a person, a drone or an aircraft, with a range of heights; which way
 * it may face, compass directions ticked (none: any); the ground the eye may
 * stand on (none: any), with the grid read before the search to show what it
 * keeps; whether the camera looks down from a height or up at a summit (none:
 * about level); whether it is a selfie, searched mirrored too; where the sun
 * stood against it on a day (the app turns it into headings, with the
 * compass's); and the settings a search runs with.
 *
 * An alignment is made by four guided clicks: two on the photo, the same two
 * on the map. One whose tops touch asks the app where along its line the eye
 * lays the near top on the far one (`/api/horizon/alignment`), which gives a
 * place on its own.
 *
 * The search runs in the app, on the case's background queue
 * (api/horizon_finds.py): started by the analyst's press, followed while it
 * runs with the points it has scored so far (`live`), for the map to fill in,
 * stopped by theirs, and kept in the case with every point it scored, so a
 * search reopened shows its map without running again. A place the analyst
 * looked from and confirmed is kept on the search (`confirm`), which stops it.
 *
 * The setup is part of Horizon's bench (state/work.svelte.js): `snapshot` is
 * what the case keeps of it, `restore` puts it back after a reload.
 */
import {
  ALIGN_COLOURS,
  ALIGN_STEPS,
  ALIGN_TOLERANCE,
  alignmentBearing,
  areaMiddle,
  areaProblem,
  cleanFacing,
  cleanStands,
  cleanSun,
  lookingOf,
  NO_SUN,
  sunAsked,
  meeting,
  photoOffset,
  sameAsk,
  searchedReach,
  toggleFacing,
  toggleStand,
  traceSpan,
} from '../../../lib/horizon/find.js';
import { AUTO_REACH, MEASURED_GIVE, PANORAMA_TALL, PANORAMA_WITHIN, searchHints } from '../../../lib/horizon/hints.js';
import { farRange } from '../../../lib/horizon/traceMarks.js';
import { marksSaid } from '../../../lib/horizon/traceMarks.js';
import { COARSE_RELIEF_M, GAP_MIN_POINTS, markedPlane, traceSamples } from '../../../lib/horizon/overlay.js';
import { pollWhile } from '../../../lib/poll.js';
import { formatDistance } from '../../../lib/measure.js';

/** Who took the photo, and the heights each may stand at by default (over the ground, an aircraft's above the sea). */
export const WHO = {
  ground: { label: 'On foot', low: 1.7, high: 1.7 },
  drone: { label: 'Drone', low: 10, high: 120 },
  aircraft: { label: 'Aircraft', low: 300, high: 3000 },
};

/** The grid a search is laid on, metres between points; auto picks it from the area. */
export const SPACINGS = ['auto', 20, 50, 100, 250, 500, 1000];

/** Nothing set yet: on foot, auto spacing at its usual effort, the usual tolerance. */
export const NO_SETTINGS = Object.freeze({ spacing: 'auto', tolerance: ALIGN_TOLERANCE, speed: 'fast', effort: 'normal' });

/** How thorough Auto's grid is against the time it takes (engine/finder.py EFFORTS). */
export const EFFORTS = [
  { id: 'quick', label: 'Quick', title: 'A grid twice as wide: a quarter of the points' },
  { id: 'normal', label: 'Normal', title: 'The grid Auto lays' },
  { id: 'thorough', label: 'Thorough', title: 'A grid about three times as dense' },
];

/** Water the photo shows: the sea alone (seen as far as the sea's horizon), or any of the sea, a lake or a river
 * the map draws as water. */
export const WATERS = [
  { id: 'sea', label: 'The sea', title: 'The sea shows: points it could not be seen from are left out. An island is traced as any skyline' },
  { id: 'lake', label: 'Sea, lake or river', title: 'Water shows: points where none is within reach are left out' },
];

/** Water said of the photo as Find keeps it: 'sea', 'lake' (any water, as an older search said `true`), or false. */
export function cleanWater(value) {
  if (value === true) return 'lake';
  return WATERS.some((one) => one.id === value) ? value : false;
}

/** How hard a search works the computer: on each of its own cores, on up to four, or on one. */
export const SPEEDS = [
  { id: 'fastest', label: 'Fastest', title: 'A large grid is searched on every core this computer has, as the free memory allows' },
  { id: 'fast', label: 'Fast', title: 'A large grid is searched on several cores, up to four, as the free memory allows' },
  { id: 'gentle', label: 'Gentle', title: 'One core: slower, and the computer stays free for the rest' },
];

/** The frame a trace is measured in for the search: as wide as Fit's bench reads it. */
const PLANE_W = 1200;
/** A running search is read again this often, milliseconds. */
export const POLL_MS = 2000;
/** How often the Mesh step's check of water in sight is read while it runs, milliseconds. */
export const SIGHT_POLL_MS = 400;
/**
 * Seconds a point of the grid takes, about, for the estimate until this machine's pace is timed
 * (`/horizon/finds/pace`; measured on a recent laptop, turns read finer cost more). Once it runs, the
 * time left is the machine's own pace.
 */
const SECONDS_PER_POINT = { fine: 1, coarse: 0.3 };
/** Find's pace is timed this long after the setup last changed, milliseconds. */
export const PACE_WAIT_MS = 2000;
/** A search's statuses while it runs, asked to stop included: it keeps what it found once it has. */
export const ACTIVE = ['queued', 'running', 'stopping'];

/**
 * The seconds a search of `points` takes on this machine, from its pace (`/horizon/finds/pace`): each point
 * as long as the ones timed, the best places searched in full `full` times as long, in `lanes` processes
 * `lanes` to the `lane_power` times as fast once the grid holds `lane_min` points.
 */
export function pacedSeconds(points, { seconds, lanes = 1, lane_min: laneMin = 200, full = 8, lane_power: power = 0.46, top = 15 }) {
  const speedup = points >= laneMin ? Math.max(1, lanes) ** power : 1;
  return (seconds * (Math.max(0, points - top) + top * full)) / speedup;
}

/**
 * The time a search should take, in words: "about 6 min". From this machine's pace once timed (`paced`),
 * else guessed: `turn` is the share of the turn each point reads.
 */
export function durationText(points, step, turn = 1, paced = null) {
  const seconds = Number.isFinite(paced?.seconds)
    ? pacedSeconds(points, paced)
    : points * (step <= 0.2 ? SECONDS_PER_POINT.fine : SECONDS_PER_POINT.coarse) * Math.min(1, Math.max(0.05, turn));
  if (seconds < 90) return 'about a minute';
  if (seconds < 3600) return `about ${Math.round(seconds / 60)} min`;
  return `about ${(seconds / 3600).toFixed(1)} h`;
}

/**
 * How large a search is, before it runs (`/api/horizon/finds/estimate`): its
 * points and time, and how far both may grow where relief stands near and the
 * grid is filled in (`most`).
 */
export function estimateText({ points, most = points, step, turn = 1 }, paced = null) {
  const where = Number.isFinite(paced?.seconds) ? ' on this computer' : '';
  const size = `${points.toLocaleString('en-US')} points, ${durationText(points, step, turn, paced)}${where}`;
  if (!(most > points)) return `${size}.`;
  return `${size}; up to ${durationText(most, step, turn, paced).replace('about ', '')} where relief stands near.`;
}

/**
 * The grids the estimate lays wider than the analyst picked, the area or its zones holding more points than hours
 * of search: a line each. `picked` is false while the area's grid is Auto, which widens as it must.
 */
export function widenedText({ asked, spacing, zones_wider: wider } = {}, units = 'metric', picked = true) {
  const lines = [];
  if (picked && asked && spacing) {
    lines.push(`Too large for a ${formatDistance(asked, units)} grid, even in hours: a point every ${formatDistance(spacing, units)}. A zone searches finer.`);
  }
  if (wider) lines.push(`Zones too large for their grid: points ${wider.toFixed(1)}× farther apart.`);
  return lines;
}

/** The most zones a search keeps beside its area, and the most areas searched with it. */
export const ZONES_MAX = 12;
export const AREAS_MAX = 12;

/** How wide the brush paints, metres either side of the hand's path; the strokes a search keeps, each this long at most. */
export const BRUSH_SIZES = [50, 100, 250, 500, 1000, 2500];
export const STROKES_MAX = 200;
export const STROKE_POINTS_MAX = 500;

/** The brush's size nearest a grid `spacing` apart: about a cell either side. */
export function brushFor(spacing) {
  const want = Number.isFinite(spacing) && spacing > 0 ? spacing : 250;
  return BRUSH_SIZES.reduce((best, size) => (Math.abs(Math.log(size / want)) < Math.abs(Math.log(best / want)) ? size : best));
}

const effortOf = (word) => (EFFORTS.some((one) => one.id === word) ? word : 'normal');
const latLon = (p) => (Array.isArray(p) ? { lat: p[0], lon: p[1] } : { lat: p.lat, lon: p.lon });

/** Zones as a search kept them (`[lat, lon]` corners, a spacing in metres or null) made Find's again. */
function zonesOf(kept, name) {
  return (kept ?? []).map((zone, index) => ({
    id: `zn_${name}_${index}`,
    points: (zone.area ?? []).map((p) => (Array.isArray(p) ? { lat: p[0], lon: p[1] } : { lat: p.lat, lon: p.lon })),
    spacing: SPACINGS.includes(zone.spacing) ? zone.spacing : 'auto',
    out: Boolean(zone.out),
  }));
}

/** Which way the camera may look when not about level, as Find offers it. */
export const VIEWS = [
  { id: 'down', label: 'Looking down', title: 'From a height down onto the land: the camera may tilt far down' },
  { id: 'up', label: 'Looking up', title: 'From below up at a summit: the camera may tilt far up' },
];

/** Where the eye stands against the land 1 to 3 km round it, when the analyst says (engine/ruleout.py). */
export const OVERS = [
  { id: 'above', label: 'Above the land round', title: 'Higher than most of the land within 3 km: a hilltop, a slope over a plain. Lower points are left out' },
  { id: 'below', label: 'Below it', title: 'Lower than most of the land within 3 km: a valley, the foot of a range. Higher points are left out' },
];

/** The views ticked, in the menu's order, once each. */
export function cleanView(words) {
  const said = new Set(Array.isArray(words) ? words : []);
  return VIEWS.filter((v) => said.has(v.id)).map((v) => v.id);
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
  /**
   * What a click on the map does: `area` adds a corner to the area, `zone` to
   * the zone being drawn, `align` answers the alignment's step, `try` tries the
   * trace there; null reads nothing.
   */
  let drawing = $state(null);
  /** Zones beside the area, each `{ id, points, spacing, out }`: searched on its own grid (`spacing`, 'auto' a third of the area's), or left out. */
  let zones = $state.raw([]);
  /** The zone being drawn, by its id, or null. */
  let zoneDrawn = null;
  /** More areas searched with the first on the same grid, each `{ id, points }`; the one being drawn by its id. */
  let areas = $state.raw([]);
  let moreDrawn = null;
  /** The brush's strokes, in the order painted, each `{ path, radius, out }`, and how it paints next. */
  let strokes = $state.raw([]);
  let brush = $state.raw({ out: true, radius: null });
  /** The alignments made, each `{ id, colour, photo: { near, far }, map: { near, far }, offset, tops, heights, touch }`. */
  let alignments = $state.raw([]);
  /** The alignment being made: `{ step, photo, map }`, or null. */
  let pending = $state.raw(null);
  let who = $state.raw({ mode: 'ground', ...pick(WHO.ground) });
  /** The compass directions the photo may face (lib/horizon/find.js DIRECTIONS); none for any. */
  let facing = $state.raw([]);
  /** The ground the eye may stand on (lib/horizon/find.js GROUNDS); none for any. */
  let stands = $state.raw([]);
  /** Which way the camera looks when not about level: `down` from a height, `up` at a summit. */
  let looking = $state.raw([]);
  /** The trace tried from one point: `{ at, place, busy, error }`, or null. */
  let tried = $state.raw(null);
  let trying = 0;
  /** A selfie: searched mirrored too. */
  let mirror = $state(false);
  /** Water shows in the photo; where the eye stands against the land round it ('above', 'below' or null). */
  let water = $state(false);
  let over = $state(null);
  /** Near lines judged rounded where the relief is coarse. */
  let rounding = $state(false);
  /** Where the sun stood against the camera, on a day between two local hours (lib/horizon/find.js NO_SUN). */
  let sun = $state.raw(NO_SUN);
  /** The headings the compass and the sun leave, as the app read them: `{ sectors, sun }`, or null. */
  let sectors = $state.raw(null);
  let sectorsAsked = '';
  /** The grid read before the search: `{ total, kept, kinds, points, spacing, ruled, sight }`, or null. */
  let previewed = $state.raw(null);
  let previewAsked = '';
  /** The Mesh step's check of water in sight under way, `{ id, done, total }`, or null; why the last one failed. */
  let sighting = $state.raw(null);
  let sightFailed = $state('');
  let settings = $state.raw(NO_SETTINGS);
  /** The search on show: `{ name, status, progress, error, result, ask, found }` as the app keeps it, or null. */
  let search = $state.raw(null);
  /** The points the search on show has scored so far while it runs: `{ name, started, points }`, or null. */
  let soFar = $state.raw(null);
  /** Checking the search on show against decoys of its trace. */
  let checking = $state(false);
  /** The case's searches, newest first, as the list shows them. */
  let list = $state.raw([]);
  /** How many searches were opened from the list: the map comes over what one searched each time. */
  let opened = $state(0);
  /** How large the search would be: `{ points, coarse, spacing, step }`, or null. */
  let estimated = $state.raw(null);
  /** This machine's pace for the search as set up, as `/finds/pace` timed it, or null; whether it is being timed. */
  let paced = $state.raw(null);
  let pacing = $state(false);
  let pacedFor = '';
  let paceAgain = false;
  /** How fine the heights over the area are, metres, once read; and where they were read. */
  let detail = $state(null);
  let detailAt = '';
  let stopPoll = null;
  let caseOf = $state(null);

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

  /**
   * An alignment with how far apart its two points stand across the photo,
   * read on the photo as the search reads it (straightened from its lens's
   * curve, between its pulled corners): a curve set after the points were
   * placed moves it, as the points stay on the photo's own pixels. Kept as it
   * was while the lens is not known.
   */
  function offsetNow(one) {
    if (!one.offsetKnown) return one;
    const offset = photoOffset(overlay.seenOf(one.photo.near), overlay.seenOf(one.photo.far), lensNow() ?? {});
    return offset === null || offset === one.offset ? one : { ...one, offset };
  }
  /** The alignments as the photo now reads them. */
  const live = $derived(alignments.map(offsetNow));

  function finishAlignment() {
    const { photo, map } = pending;
    const lens = lensNow();
    const offset = photoOffset(overlay.seenOf(photo.near), overlay.seenOf(photo.far), lens ?? {});
    alignments = [
      ...alignments,
      {
        id: `al_${Date.now().toString(36)}_${(made += 1)}`,
        colour: pending.colour ?? nextColour(),
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
    const one = live.find((a) => a.id === id);
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
    const marks = overlay.marks ?? null;
    const inner = new Set(marks?.inner ?? []);
    // the skyline alone must say enough: inner edges are judged on the places it finds
    if (samples.filter((s) => !inner.has(marks?.lines?.[s.stroke] ?? s.stroke)).length < GAP_MIN_POINTS) return null;
    const lens = overlay.lens;
    const projection = overlay.isPanorama ? 'panorama' : 'camera';
    const told = searchHints(overlay.hints, { lensKnown: Boolean(lens), aspect });
    const fov = lens?.fov ?? Math.sqrt(told.within[0] * told.within[1]);
    const pieceAt = (s) => overlay.pieceAt?.({ u: s.x / size.width, v: s.y / size.height }) ?? 0;
    const plane = markedPlane(samples, { fov, ...size, projection, heading: 0, tilt: 0, roll: 0 }, marks, pieceAt);
    // a lens read off the video's pan is searched a little either way, one the file or the stitch says held exact
    const within = lens?.measured ? [fov / MEASURED_GIVE, fov * MEASURED_GIVE] : told.within;
    // a panorama of unknown width spans no more than a phone's frame up and down: wider lenses are never tried
    const lensMax = projection === 'panorama' && !lens ? PANORAMA_TALL * aspect : Infinity;
    return {
      ...plane, fov, known: Boolean(lens) && !lens.measured, ...(within ? { within } : {}), projection,
      ...(lensMax < PANORAMA_WITHIN[1] ? { lens_max: Math.round(lensMax * 10) / 10 } : {}),
    };
  }

  /** The alignments as a search asks with them. */
  function alignmentsAsked() {
    return live.map((one) => ({
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
    }));
  }

  /** The zones a search is asked with: those drawn whole, as the app reads them. */
  function zonesAsked() {
    return zones
      .filter((zone) => zone.points.length >= 3 && !areaProblem(zone.points))
      .map((zone) => ({
        area: zone.points.map((p) => ({ lat: p.lat, lon: p.lon })),
        spacing: zone.out || zone.spacing === 'auto' ? null : zone.spacing,
        out: zone.out,
      }));
  }

  /** The more areas a search is asked with: those drawn whole. */
  function areasAsked() {
    return areas.filter((one) => one.points.length >= 3 && !areaProblem(one.points)).map((one) => one.points.map(latLon));
  }

  /** The brush's strokes as a search is asked with them. */
  function strokesAsked() {
    return strokes.map((one) => ({ path: one.path.map(latLon), radius: one.radius, out: one.out }));
  }

  /** Where the search would look, by whom and on what ground: what its grid is laid from; null while the area is not ready. */
  function groundNow() {
    if (area.length < 3 || areaProblem(area) || ['area', 'zone', 'more'].includes(drawing)) return null;
    return {
      area: area.map((p) => ({ lat: p.lat, lon: p.lon })),
      areas: areasAsked(),
      strokes: strokesAsked(),
      zones: zonesAsked(),
      who: { mode: who.mode, low: who.low, high: who.high },
      spacing: settings.spacing === 'auto' ? null : settings.spacing,
      effort: settings.effort,
      alignments: alignmentsAsked(),
      stands,
      ...(nearSaid() ? { near: nearSaid() } : {}),
      ...seenSaid(),
    };
  }

  /** What the photo shows that rules points out before the search (engine/ruleout.py), as a search asks it. */
  function seenSaid() {
    return { sea: Boolean(overlay.marks?.sea?.length) || water === 'sea', water: water === 'lake', over };
  }

  /**
   * Read the grid the search would lay, and the ground under each point
   * (`/api/horizon/finds/preview`): once the area is drawn, never before. An
   * answer to an older question is dropped.
   */
  async function readPreview() {
    const ground = groundNow();
    const key = ground ? JSON.stringify(ground) : '';
    if (key === previewAsked) return;
    previewAsked = key;
    if (!ground) {
      previewed = null;
      return;
    }
    // the strokes the answer reads: the map lays those painted since over it until the next one comes
    const read = strokes;
    try {
      const answer = await api.post('/api/horizon/finds/preview', ground);
      if (previewAsked === key) previewed = { ...answer, strokesRead: read };
    } catch {
      if (previewAsked === key) previewed = null;
    }
  }

  /** The nearest a traced line is said to stand, metres, or null when no line's distance is said. */
  function nearSaid() {
    const lows = (overlay.marks?.far ?? []).map((one) => farRange(one.bands)?.[0]).filter((v) => Number.isFinite(v));
    return lows.length ? Math.min(...lows) : null;
  }

  /** What trying the trace from one point asks the app (`/horizon/finds/try`): a search's question, the area aside. */
  function tryAsk(at) {
    const ask = askNow({ anyArea: true });
    if (!ask) return null;
    const { area: _area, areas: _areas, strokes: _strokes, zones: _zones, spacing: _spacing, stands: _stands, title: _title, ...rest } = ask;
    return { ...rest, at: { lat: at.lat, lon: at.lon } };
  }

  /**
   * What a search's pace depends on: the trace and what is known of it, who took it, about where (the
   * area's middle, to a few kilometres); not the grid, its areas, what rules its points out nor how many lanes run it.
   */
  function paceKeyOf(ask) {
    const { area: corners, areas: _areas, strokes: _strokes, zones: _zones, spacing: _spacing, effort: _effort, speed: _speed, title: _title, sea: _sea, water: _water, over: _over, photo, ...rest } =
      ask;
    const middle = areaMiddle(corners);
    return JSON.stringify({ ...rest, photo: photo?.path ?? null, at: [middle.lat.toFixed(2), middle.lon.toFixed(2)] });
  }

  /** Time this machine's pace for the search as set up, once a case holds it and none runs; a change meanwhile is timed next. */
  async function timePace() {
    if (!caseOf || (search && ACTIVE.includes(search.status))) return;
    const ask = askNow();
    if (!ask) return;
    const key = paceKeyOf(ask);
    if (key === pacedFor) return;
    if (pacing) {
      paceAgain = true;
      return;
    }
    pacedFor = key;
    pacing = true;
    try {
      const answer = await api.post(`/api/cases/${encodeURIComponent(caseOf)}/horizon/finds/pace`, ask);
      if (pacedFor === key) paced = Number.isFinite(answer?.seconds) ? answer : null;
    } catch {
      // the time stays guessed, and is timed again once the setup changes
      if (pacedFor === key) pacedFor = '';
    } finally {
      pacing = false;
      if (paceAgain) {
        paceAgain = false;
        timePace();
      }
    }
  }

  /** What a search asks the app, from the photo, its trace and what Find holds; null while it cannot be asked. */
  function askNow({ anyArea = false } = {}) {
    const trace = planeOfTrace();
    if (!trace || (!anyArea && areaProblem(area))) return null;
    const reach = overlay.hints?.reach;
    const source = overlay.source;
    return {
      ...(source?.path ? { title: `${source.name ?? 'Photo'} search` } : {}),
      photo: source?.path
        ? {
            path: source.path,
            kind: source.kind,
            title: source.name ?? '',
            time: overlay.time ?? 0,
            strokes: overlay.strokes,
            ...(marksSaid(overlay.marks) ? { marks: overlay.marks } : {}),
            // what the trace is straightened and pulled by, so the search opens again on the same plane
            ...(overlay.bend ? { bend: overlay.bend } : {}),
            ...(overlay.warped ? { corners: overlay.corners.map(({ u, v }) => ({ u, v })) } : {}),
          }
        : null,
      trace,
      area: area.map((p) => ({ lat: p.lat, lon: p.lon })),
      areas: areasAsked(),
      strokes: strokesAsked(),
      zones: zonesAsked(),
      who: { mode: who.mode, low: who.low, high: who.high },
      facing,
      stands,
      view: looking,
      mirror,
      round: rounding && detail >= COARSE_RELIEF_M,
      sun: sunAsked(sun),
      ...seenSaid(),
      speed: settings.speed,
      reach: Number.isFinite(reach) ? reach : reach === 'all' ? 100_000 : null,
      spacing: settings.spacing === 'auto' ? null : settings.spacing,
      effort: settings.effort,
      alignments: alignmentsAsked(),
      hints: overlay.hints,
    };
  }

  const findPath = (caseId, name) => `/api/cases/${encodeURIComponent(caseId)}/horizon/finds/${encodeURIComponent(name)}`;

  function follow(caseId, name) {
    stopPoll?.();
    stopPoll = pollWhile(
      () => Boolean(search && search.name === name && ACTIVE.includes(search.status)),
      async () => {
        try {
          const now = await api.get(findPath(caseId, name));
          if (search?.name === name) search = { ...now, name };
          if (ACTIVE.includes(now.status)) await readLive(caseId, name);
          else refreshList(caseId);
        } catch {
          // read again at the next tick; a search deleted meanwhile stops being followed
        }
      },
      POLL_MS
    );
  }

  /** The points scored since the last read, added to the ones held; all of them again for another run. */
  async function readLive(caseId, name) {
    const held = soFar?.name === name ? soFar : null;
    const since = held?.points.length ?? 0;
    const query = held?.started != null ? `?since=${since}&started=${held.started}` : '?since=0';
    const answer = await api.get(`${findPath(caseId, name)}/points${query}`);
    // nothing held there: the run just ended, and its record says what it found
    if (search?.name !== name || answer.started == null) return;
    const kept = answer.started === held?.started && answer.since === since ? held.points : [];
    soFar = { name, started: answer.started, points: answer.points.length ? [...kept, ...answer.points] : kept };
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
      if (!point) return;
      if (drawing === 'more') {
        areas = areas.map((one) => (one.id === moreDrawn ? { ...one, points: [...one.points, { lat: point.lat, lon: point.lon }] } : one));
        return;
      }
      if (drawing === 'zone') {
        zones = zones.map((zone) => (zone.id === zoneDrawn ? { ...zone, points: [...zone.points, { lat: point.lat, lon: point.lon }] } : zone));
        return;
      }
      if (drawing !== 'area') return;
      area = [...area, { lat: point.lat, lon: point.lon }];
    },
    moveCorner(index, point) {
      if (!(index >= 0 && index < area.length) || !point) return;
      area = area.map((p, i) => (i === index ? { lat: point.lat, lon: point.lon } : p));
    },
    removeCorner(index) {
      area = area.filter((_, i) => i !== index);
    },
    /** The last corner placed: the area (or the zone being drawn) is closed and the map reads clicks no more. */
    closeArea() {
      if (drawing === 'more') {
        // an area given fewer than three corners is no area
        areas = areas.filter((one) => one.id !== moreDrawn || one.points.length >= 3);
        moreDrawn = null;
        drawing = null;
        return;
      }
      if (drawing === 'zone') {
        // a zone given fewer than three corners is no zone
        zones = zones.filter((zone) => zone.id !== zoneDrawn || zone.points.length >= 3);
        zoneDrawn = null;
        drawing = null;
        return;
      }
      if (drawing === 'area') drawing = null;
    },

    // -- the zones ---------------------------------------------------------------

    get zones() {
      return zones;
    },
    /** The zone being drawn, or null. */
    get zoneDrawn() {
      return zones.find((zone) => zone.id === zoneDrawn) ?? null;
    },
    /** Start a zone: searched on a finer grid (`out` false), or left out. Its corners are clicked on the map. */
    drawZone({ out = false } = {}) {
      pending = null;
      if (drawing === 'zone') this.closeArea();
      const id = `zn_${Date.now().toString(36)}_${(made += 1)}`;
      zones = [...zones, { id, points: [], spacing: 'auto', out: Boolean(out) }].slice(-ZONES_MAX);
      zoneDrawn = id;
      drawing = 'zone';
    },
    removeZone(id) {
      zones = zones.filter((zone) => zone.id !== id);
      if (zoneDrawn === id) {
        zoneDrawn = null;
        if (drawing === 'zone') drawing = null;
      }
    },
    setZoneSpacing(id, spacing) {
      if (!SPACINGS.includes(spacing)) return;
      zones = zones.map((zone) => (zone.id === id ? { ...zone, spacing } : zone));
    },
    /** Why a zone cannot be searched, '' when it can. */
    zoneProblem(zone) {
      if (!zone || zone.points.length < 3) return 'Draw at least three corners';
      return areaProblem(zone.points).replace('area', 'zone');
    },
    clearArea() {
      area = [];
      areas = [];
      moreDrawn = null;
      if (drawing === 'area' || drawing === 'more') drawing = null;
    },

    // -- more areas, searched with the first ---------------------------------------

    get areas() {
      return areas;
    },
    /** The area being drawn beside the first, or null. */
    get moreDrawn() {
      return areas.find((one) => one.id === moreDrawn) ?? null;
    },
    /** Start another area, searched with the first on the same grid: its corners are clicked on the map. */
    drawMore() {
      pending = null;
      if (drawing === 'more' || drawing === 'zone') this.closeArea();
      if (areas.length >= AREAS_MAX) return;
      const id = `ar_${Date.now().toString(36)}_${(made += 1)}`;
      areas = [...areas, { id, points: [] }];
      moreDrawn = id;
      drawing = 'more';
    },
    removeMore(id) {
      areas = areas.filter((one) => one.id !== id);
      if (moreDrawn === id) {
        moreDrawn = null;
        if (drawing === 'more') drawing = null;
      }
    },

    // -- the brush -------------------------------------------------------------------

    get strokes() {
      return strokes;
    },
    /** How the brush paints next: `out` leaves points out, else takes them back; `radius` metres either side. */
    get brush() {
      return { out: brush.out, radius: brush.radius ?? brushFor(previewed?.spacing) };
    },
    setBrush(change) {
      brush = {
        out: typeof change?.out === 'boolean' ? change.out : brush.out,
        radius: BRUSH_SIZES.includes(change?.radius) ? change.radius : brush.radius,
      };
    },
    /** The map paints instead of panning; Escape or a second press stops it. */
    startBrush() {
      pending = null;
      if (drawing === 'more' || drawing === 'zone') this.closeArea();
      drawing = 'brush';
    },
    stopBrush() {
      if (drawing === 'brush') drawing = null;
    },
    /** A stroke painted, `{ path, radius, out }` its path `{ lat, lon }` points: kept over the ones before. */
    addStroke(stroke) {
      const path = (stroke?.path ?? []).slice(0, STROKE_POINTS_MAX).map(latLon);
      if (!path.length || strokes.length >= STROKES_MAX) return;
      strokes = [...strokes, { path, radius: Number(stroke.radius) || this.brush.radius, out: stroke.out ?? brush.out }];
    },
    /** The last stroke taken back. */
    undoStroke() {
      strokes = strokes.slice(0, -1);
    },
    clearStrokes() {
      strokes = [];
    },
    /** A whole area at once (a saved search, a test). */
    setArea(points) {
      area = (points ?? []).map((p) => ({ lat: p.lat, lon: p.lon }));
    },

    // -- the alignments ---------------------------------------------------------

    get alignments() {
      return live;
    },
    get pending() {
      return pending;
    },
    /** What the alignment being made asks for next, `{ on, end, text }`, or null. */
    get step() {
      return pending ? ALIGN_STEPS[pending.step] : null;
    },
    /** Start an alignment: its colour is its own from the first click, on the photo and the map. */
    startAlignment() {
      pending = { step: 0, photo: {}, map: {}, colour: nextColour() };
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
      return meeting(live);
    },

    // -- the search ------------------------------------------------------------------

    /** What keeps a search from being run now, '' when nothing does. */
    get searchProblem() {
      if (!overlay.source) return 'Add the photo first';
      if (!planeOfTrace()) return 'Trace the skyline on the photo first';
      if (area.length < 3) return 'Draw the area on the map';
      if (previewed && previewed.total > 0 && previewed.kept === 0) return 'No point of the area stands on the ground ticked';
      if (sectors && Array.isArray(sectors.sectors) && !sectors.sectors.length) return 'The sun and the directions ticked leave no heading';
      return areaProblem(area);
    },
    get search() {
      return search;
    },
    get searching() {
      return Boolean(search && ACTIVE.includes(search.status));
    },
    /** The points the search on show has scored so far while it runs (as its result's), or [] when none runs. */
    get live() {
      return search && soFar?.name === search.name && ACTIVE.includes(search.status) ? soFar.points : [];
    },
    /**
     * Keep a place on the search on show as the one the analyst confirmed, `{ lat, lon, height, heading, tilt,
     * roll, fov, explained, view }` with `search` the search it came from (the one on show when not said): one
     * still running stops, keeping what it found.
     */
    async confirm({ search: name = search?.name, ...place }) {
      if (!name || !caseOf) return null;
      const record = await api.post(`${findPath(caseOf, name)}/found`, place);
      if (search?.name === name) {
        search = { ...record, name };
        if (ACTIVE.includes(record.status)) follow(caseOf, name);
      }
      refreshList(caseOf);
      return record;
    },
    /** The place confirmed taken back: the search is as it ended. */
    async unconfirm() {
      if (!search?.found || !caseOf) return;
      const name = search.name;
      const record = await api.del(`${findPath(caseOf, name)}/found`);
      if (search?.name === name) search = { ...record, name };
      refreshList(caseOf);
    },
    /**
     * Whether the setup changed since the search on show was asked; true while
     * none is on show. Read off what the analyst set, never the trace worked
     * out from it, so it costs nothing as the view turns.
     */
    get edited() {
      if (!search?.ask) return true;
      const source = overlay.source;
      return !sameAsk(search.ask, {
        area,
        who,
        spacing: settings.spacing === 'auto' ? null : settings.spacing,
        effort: settings.effort,
        alignments: live.map((one) => ({ near: one.map.near, far: one.map.far, tops: one.tops, heights: one.heights })),
        zones: zonesAsked(),
        areas: areasAsked(),
        strokes: strokesAsked(),
        photo: source?.path ? { path: source.path, strokes: overlay.strokes, marks: overlay.marks } : null,
        hints: overlay.hints,
        facing,
        stands,
        view: looking,
        mirror,
        round: rounding && detail >= COARSE_RELIEF_M,
        sun: sunAsked(sun),
        ...seenSaid(),
      });
    },
    get list() {
      return list;
    },
    get opened() {
      return opened;
    },
    refreshList,
    get estimated() {
      return estimated;
    },
    /** This machine's pace for the search as set up, with the lanes the speed picked runs, once timed; else null. */
    get pace() {
      return this.paceFor(settings.speed);
    },
    /** This machine's pace at a speed (`SPEEDS`): its lanes on this computer, or null until timed. */
    paceFor(speed) {
      return paced ? { ...paced, lanes: paced.lanes?.[speed] ?? 1 } : null;
    },
    /** Whether the pace is being timed. */
    get pacing() {
      return pacing;
    },
    timePace,
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
      soFar = null;
      follow(caseId, row.name);
      refreshList(caseId);
      return row;
    },
    /** Whether the search on show is being checked against decoys of its trace. */
    get checking() {
      return checking;
    },
    /** Try the search's places again with decoys of its trace (mirrored, upside down): each keeps what they explain. */
    async check() {
      if (!search || search.status !== 'done' || !caseOf) return;
      const name = search.name;
      checking = true;
      try {
        const record = await api.post(`/api/cases/${encodeURIComponent(caseOf)}/horizon/finds/${encodeURIComponent(name)}/check`);
        if (search?.name === name) search = { ...record, name };
      } finally {
        checking = false;
      }
    },
    /** Stop the search on show: followed on until it has kept what it found. */
    async stop() {
      if (!search || !caseOf) return;
      const name = search.name;
      const row = await api.post(`${findPath(caseOf, name)}/cancel`);
      if (search?.name !== name) return;
      search = { ...search, ...row };
      if (ACTIVE.includes(row.status)) follow(caseOf, name);
    },
    /** Put the search away, its map and its places with it (it stays in the case). */
    closeSearch() {
      stopPoll?.();
      search = null;
      soFar = null;
    },
    /**
     * Open a search the case keeps: its area, alignments and settings come back with its map, which is
     * framed over them unless the search is only put back as the bench left it (`framed: false`).
     */
    async openSearch(caseId, name, { framed = true } = {}) {
      caseOf = caseId;
      const record = await api.get(`/api/cases/${encodeURIComponent(caseId)}/horizon/finds/${encodeURIComponent(name)}`);
      const ask = record.ask ?? {};
      area = (ask.area ?? []).map(([lat, lon]) => ({ lat, lon }));
      zones = zonesOf(ask.zones, name);
      zoneDrawn = null;
      areas = (ask.areas ?? []).map((points, index) => ({ id: `ar_${name}_${index}`, points: points.map(latLon) }));
      moreDrawn = null;
      strokes = (ask.strokes ?? []).map((one) => ({ path: one.path.map(latLon), radius: one.radius, out: one.out !== false }));
      drawing = null;
      pending = null;
      who = ask.who ? { mode: ask.who.mode, low: ask.who.low, high: ask.who.high } : who;
      facing = cleanFacing(ask.facing);
      stands = cleanStands(ask.stands);
      looking = cleanView(ask.view);
      mirror = Boolean(ask.mirror);
      water = ask.water ? 'lake' : ask.sea && !ask.photo?.marks?.sea?.length ? 'sea' : false;
      over = OVERS.some((one) => one.id === ask.over) ? ask.over : null;
      rounding = Boolean(ask.round);
      sun = cleanSun(ask.sun ?? NO_SUN);
      const kept = (ask.alignments ?? [])[0];
      settings = {
        spacing: ask.spacing ?? 'auto',
        tolerance: kept?.tolerance ?? settings.tolerance,
        speed: SPEEDS.some((one) => one.id === ask.speed) ? ask.speed : 'fast',
        effort: effortOf(ask.effort),
      };
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
      soFar = null;
      if (framed) opened += 1;
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
    /** The compass directions the photo may face, none for any. */
    get facing() {
      return facing;
    },
    /** Tick a direction, or untick it. */
    toggleFacing(id) {
      facing = toggleFacing(facing, id);
    },
    /** Any way again. */
    clearFacing() {
      facing = [];
    },
    /** The ground the eye may stand on, none for any. */
    get stands() {
      return stands;
    },
    /** Tick a ground, or untick it. */
    toggleStand(id) {
      stands = toggleStand(stands, id);
    },
    /** The trace tried from one point, `{ at, place, busy, error }`, or null. */
    get tried() {
      return tried;
    },
    /** A click on the map tries the trace there; Escape or a second press stops it. */
    startTrying() {
      pending = null;
      drawing = 'try';
    },
    stopTrying() {
      if (drawing === 'try') drawing = null;
    },
    /** Why the trace cannot be tried yet, '' when it can. */
    get tryProblem() {
      if (!overlay.source) return 'Add the photo first';
      if (!planeOfTrace()) return 'Trace the skyline on the photo first';
      if (!caseOf) return 'Open a case first';
      return '';
    },
    /** Try the trace from a point of the map, as a search would score it there; an older answer is dropped. */
    async tryAt(point) {
      if (!point) return;
      const at = { lat: point.lat, lon: point.lon };
      const body = tryAsk(at);
      if (!body || !caseOf) {
        tried = { at, place: null, busy: false, error: this.tryProblem || 'The trace cannot be tried yet' };
        return;
      }
      const mine = (trying += 1);
      tried = { at, place: null, busy: true, error: '' };
      try {
        const answer = await api.post(`/api/cases/${encodeURIComponent(caseOf)}/horizon/finds/try`, body);
        if (mine === trying) tried = { at, place: answer.place, frames: answer.frames ?? null, busy: false, error: '' };
      } catch (failure) {
        if (mine === trying) tried = { at, place: null, busy: false, error: failure.message || 'The terrain could not be read' };
      }
    },
    /** The point tried put away. */
    clearTried() {
      trying += 1;
      tried = null;
      if (drawing === 'try') drawing = null;
    },
    /** Any ground again. */
    clearStands() {
      stands = [];
    },
    /** Which way the camera looks when not about level: `down`, `up`, both, or none. */
    get view() {
      return looking;
    },
    toggleView(id) {
      looking = cleanView(looking.includes(id) ? looking.filter((one) => one !== id) : [...looking, id]);
    },
    /**
     * What the trace itself says before a search: which way the camera must look past what is searched for
     * who took the photo (`down`, `up` or null), and how many degrees the picture read as one spans.
     */
    get traceSays() {
      const trace = planeOfTrace();
      return trace ? { looking: lookingOf(trace, who.mode), span: traceSpan(trace) } : null;
    },
    /** Where the sun stood against the camera: `{ date, start, end, sides }`. */
    get sun() {
      return sun;
    },
    setSun(change) {
      sun = cleanSun({ ...sun, ...change });
    },
    /** A side the sun stood on, ticked or unticked. */
    toggleSunSide(id) {
      const sides = sun.sides.includes(id) ? sun.sides.filter((one) => one !== id) : [...sun.sides, id];
      sun = cleanSun({ ...sun, sides });
    },
    /** The headings the compass and the sun leave, as the app read them, or null. */
    get sectors() {
      return sectors;
    },
    /** Ask the app which headings the compass and the sun leave over the area (`/horizon/finds/sectors`). */
    async readSectors() {
      const asked = sunAsked(sun);
      const body = area.length >= 3 && !areaProblem(area) && asked ? { area: area.map(({ lat, lon }) => ({ lat, lon })), facing, sun: asked } : null;
      const key = body ? JSON.stringify(body) : '';
      if (key === sectorsAsked) return;
      sectorsAsked = key;
      if (!body) {
        sectors = null;
        return;
      }
      try {
        const answer = await api.post('/api/horizon/finds/sectors', body);
        if (sectorsAsked === key) sectors = answer;
      } catch {
        if (sectorsAsked === key) sectors = null;
      }
    },
    /** Whether near lines are judged rounded, where the relief is coarse (`detail`). */
    get round() {
      return rounding;
    },
    setRound(on) {
      rounding = Boolean(on);
    },
    /** Whether the photo is a selfie, searched mirrored too. */
    get mirror() {
      return mirror;
    },
    setMirror(on) {
      mirror = Boolean(on);
    },
    /** Water the photo shows (`WATERS`): 'sea', 'lake' for any water, or false. */
    get water() {
      return water;
    },
    setWater(value) {
      water = cleanWater(value);
    },
    /** Where the eye stands against the land round it: 'above', 'below', or null for either. */
    get over() {
      return over;
    },
    /** Say where the eye stands, or, said again, either. */
    toggleOver(id) {
      over = OVERS.some((one) => one.id === id) && over !== id ? id : null;
    },
    /** The grid read before the search, each point with its ground, or null. */
    get previewed() {
      return previewed;
    },
    /** Read the grid the search would lay, once the area is drawn (`readPreview`). */
    async preview() {
      await readPreview();
    },
    /** The Mesh step's check of water in sight under way, `{ id, done, total }`, or null. */
    get sighting() {
      return sighting;
    },
    /** Why the last check of water in sight failed, or ''. */
    get sightFailed() {
      return sightFailed;
    },
    /**
     * Check which points of the grid see the water the photo shows (`/api/horizon/finds/sight`), in the
     * background; once it ends the grid is read again, greying the points it hid. The search reuses it.
     */
    async checkSight() {
      const ground = groundNow();
      if (!ground || sighting) return;
      sightFailed = '';
      try {
        const started = await api.post('/api/horizon/finds/sight', ground);
        sighting = { id: started.id, done: started.done, total: started.total };
      } catch (failure) {
        sightFailed = failure.message;
        return;
      }
      const id = sighting.id;
      while (sighting?.id === id) {
        await new Promise((resolve) => setTimeout(resolve, SIGHT_POLL_MS));
        let state;
        try {
          state = await api.get(`/api/horizon/finds/sight/${id}`);
        } catch {
          continue;
        }
        if (sighting?.id !== id) return;
        if (state.status === 'running') {
          sighting = { id, done: state.done, total: state.total };
          continue;
        }
        sighting = null;
        if (state.status === 'failed') sightFailed = state.error || 'The check failed';
        // what it checked, the whole grid or as far as it went, shows on the map
        previewAsked = '';
        await readPreview();
      }
    },
    /** Stop the check of water in sight: what it checked by then shows on the map. */
    async stopSight() {
      if (!sighting) return;
      try {
        await api.post(`/api/horizon/finds/sight/${sighting.id}/cancel`, {});
      } catch {
        // the next read says how it ended
      }
    },
    /** How far the search reads the turn, metres, as far as the map draws the directions ticked. */
    get reach() {
      const reach = overlay.hints?.reach;
      if (Number.isFinite(reach)) return searchedReach(reach, AUTO_REACH);
      return reach === 'all' ? 100_000 : AUTO_REACH;
    },
    get settings() {
      return settings;
    },
    setSettings(change) {
      const spacing = SPACINGS.includes(change?.spacing) ? change.spacing : settings.spacing;
      const tolerance = Number(change?.tolerance) > 0 ? Number(change.tolerance) : settings.tolerance;
      const speed = SPEEDS.some((one) => one.id === change?.speed) ? change.speed : settings.speed;
      const effort = EFFORTS.some((one) => one.id === change?.effort) ? change.effort : settings.effort;
      settings = { spacing, tolerance, speed, effort };
    },

    // -- the bench ----------------------------------------------------------------------

    /** The setup as the bench keeps it (api/horizon_work.py), or null while nothing is set. */
    get snapshot() {
      const plain =
        who.mode === 'ground' && settings.spacing === 'auto' && settings.tolerance === ALIGN_TOLERANCE && settings.speed === 'fast' && settings.effort === 'normal';
      if (!area.length && !areas.length && !strokes.length && !zones.length && !alignments.length && !search && !facing.length && !stands.length && !looking.length && !mirror && !water && !over && !rounding && !sunAsked(sun) && !sun.sides.length && !sun.date && plain) return null;
      return {
        area: area.map(({ lat, lon }) => ({ lat, lon })),
        alignments: live.map((one) => ({
          colour: one.colour,
          photo: one.photo,
          map: one.map,
          offset: one.offset,
          offset_known: one.offsetKnown,
          tops: one.tops,
          heights: one.heights,
        })),
        who: { mode: who.mode, low: who.low, high: who.high },
        spacing: settings.spacing,
        tolerance: settings.tolerance,
        speed: settings.speed,
        effort: settings.effort,
        facing,
        stands,
        view: looking,
        mirror,
        water,
        over,
        round: rounding,
        sun,
        zones: zones
          .filter((zone) => zone.points.length >= 3)
          .map((zone) => ({ points: zone.points.map(({ lat, lon }) => ({ lat, lon })), spacing: zone.spacing, out: zone.out })),
        areas: areas.filter((one) => one.points.length >= 3).map((one) => ({ points: one.points.map(latLon) })),
        strokes: strokesAsked(),
        search: search?.name ?? null,
      };
    },
    /** The setup the bench kept put back: the search on show reopened, then what was set since over it. */
    async restore(setup, caseId) {
      drawing = null;
      pending = null;
      if (setup?.search && caseId) {
        try {
          await this.openSearch(caseId, setup.search, { framed: false });
        } catch {
          stopPoll?.();
          search = null;
          soFar = null;
        }
      } else {
        stopPoll?.();
        search = null;
        soFar = null;
      }
      area = (setup?.area ?? []).map(({ lat, lon }) => ({ lat, lon }));
      zones = (setup?.zones ?? []).map((zone, index) => ({
        id: `zn_kept_${index}_${(made += 1)}`,
        points: (zone.points ?? []).map(({ lat, lon }) => ({ lat, lon })),
        spacing: SPACINGS.includes(zone.spacing) ? zone.spacing : 'auto',
        out: Boolean(zone.out),
      }));
      zoneDrawn = null;
      areas = (setup?.areas ?? []).map((one, index) => ({ id: `ar_kept_${index}_${(made += 1)}`, points: (one.points ?? []).map(latLon) }));
      moreDrawn = null;
      strokes = (setup?.strokes ?? []).map((one) => ({ path: (one.path ?? []).map(latLon), radius: one.radius, out: one.out !== false }));
      alignments = (setup?.alignments ?? []).map((one, index) => ({
        id: `al_${Date.now().toString(36)}_${(made += 1)}`,
        colour: one.colour ?? ALIGN_COLOURS[index % ALIGN_COLOURS.length],
        photo: one.photo,
        map: one.map,
        offset: one.offset ?? 0,
        offsetKnown: one.offset_known ?? true,
        tops: Boolean(one.tops),
        heights: one.heights ?? { near: 0, far: 0 },
        touch: null,
      }));
      who = setup?.who && WHO[setup.who.mode] ? { mode: setup.who.mode, low: setup.who.low, high: setup.who.high } : { mode: 'ground', ...pick(WHO.ground) };
      facing = cleanFacing(setup?.facing);
      stands = cleanStands(setup?.stands);
      looking = cleanView(setup?.view);
      mirror = Boolean(setup?.mirror);
      water = cleanWater(setup?.water);
      over = OVERS.some((one) => one.id === setup?.over) ? setup.over : null;
      rounding = Boolean(setup?.round);
      sun = cleanSun(setup?.sun ?? NO_SUN);
      settings = {
        spacing: SPACINGS.includes(setup?.spacing) ? setup.spacing : 'auto',
        tolerance: Number(setup?.tolerance) > 0 ? Number(setup.tolerance) : ALIGN_TOLERANCE,
        speed: SPEEDS.some((one) => one.id === setup?.speed) ? setup.speed : 'fast',
        effort: effortOf(setup?.effort),
      };
      // where the tops touch was read off the terrain the analyst already looked at: read again
      for (const one of alignments) if (one.tops) askTouch(one.id);
    },

    /** How fine the heights over the area are, metres (30 over most of the world), or null until read. */
    get detail() {
      return detail;
    },
    /** Read how fine the heights are at the area's middle, once it is closed: the one tile the search reads first anyway. */
    async readDetail() {
      if (area.length < 3 || drawing === 'area') return;
      const lat = area.reduce((sum, p) => sum + p.lat, 0) / area.length;
      const lon = area.reduce((sum, p) => sum + p.lon, 0) / area.length;
      const at = `${lat.toFixed(3)},${lon.toFixed(3)}`;
      if (at === detailAt) return;
      detailAt = at;
      try {
        const answer = await api.get(`/api/terrain/elevation?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`);
        if (detailAt === at) detail = Number(answer?.resolution_m) > 0 ? Number(answer.resolution_m) : null;
      } catch {
        if (detailAt === at) detail = null;
      }
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
