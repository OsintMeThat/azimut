/**
 * A Horizon view as the case keeps it (api/horizon_views.py `ViewSpec`), and
 * what of it counts as a change.
 *
 * The spec is the reading: where the eye stands and how high, which way it
 * looks through which lens, how the picture is drawn, the hour, the point
 * marked, and the photo laid over the view with what was done to match it.
 * Numbers are rounded to what the tab shows, so saving an untouched view
 * writes the same file.
 *
 * What counts as a change (`signature`) is everything saved but the look while
 * no photo is laid: looking round a place is reading it, as a pan is in
 * Compare, and the view reopens facing the way it was saved. Once a photo is
 * laid, the way the view faces is its alignment, which is the evidence. A video
 * with pins keeps its alignment in them, so there the look is reading too, and
 * so is the moment on show, always.
 */
import { cleanHints } from './hints.js';
import { headingOf } from './view.js';

const round = (value, digits) => {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
};
/** A heading as the case keeps it: 0 up to, never at, 360. */
const turn = (value) => {
  const heading = round(headingOf(Number(value) || 0), 2);
  return heading >= 360 ? 0 : heading;
};

/** What was known about the photo, as the case keeps it (lib/horizon/hints.js). */
function hintsSpec(hints) {
  const { zoom, facing, reach } = cleanHints(hints);
  return { zoom, facing: facing ? { heading: round(facing.heading, 1) } : null, reach };
}

/**
 * The photo laid over the view and the work on it, or null: none is laid, or it
 * is a file of this computer the case does not hold.
 */
export function photoSpec(overlay) {
  const source = overlay?.source;
  if (!source?.path || !source.caseId) return null;
  return {
    path: source.path,
    kind: source.kind,
    title: source.name ?? '',
    time: round(overlay.time ?? 0, 3),
    mix: round(overlay.mix ?? 1, 3),
    bend: round(overlay.bend ?? 0, 3),
    corners: overlay.warped ? overlay.corners.map(({ u, v }) => ({ u, v })) : null,
    strokes: overlay.strokes ?? [],
    trace_time: overlay.traceTime ?? null,
    // held to the terrain, it opens held again
    locked: Boolean(overlay.locked),
    // what was known about the photo, and the reach Fit found its skyline at
    hints: hintsSpec(overlay.hints),
    reach: Number.isFinite(overlay.reachFound) ? overlay.reachFound : null,
    pins: (overlay.pins ?? []).map((pin) => ({
      time: round(pin.time, 3),
      heading: turn(pin.heading),
      tilt: round(pin.tilt ?? 0, 2),
      roll: round(pin.roll ?? 0, 2),
      fov: round(pin.fov, 2),
    })),
  };
}

/** Whether a photo laid over the view is one the case holds, so the view can keep it. */
export function photoKept(overlay) {
  return !overlay?.source || Boolean(photoSpec(overlay));
}

/** The view as the case keeps it, or null while no eye stands anywhere. */
export function viewSpec(view, overlay = null) {
  const eye = view.observer;
  if (!eye) return null;
  const camera = view.camera;
  return {
    version: 1,
    eye: { lat: round(eye.lat, 6), lon: round(eye.lon, 6), mode: eye.mode, height: round(eye.height, 1) },
    look: {
      heading: turn(camera.heading),
      tilt: round(camera.tilt ?? 0, 2),
      roll: round(camera.roll ?? 0, 2),
      fov: round(camera.fov, 2),
      projection: camera.projection ?? 'camera',
    },
    picture: {
      ground: view.ground,
      lines: Boolean(view.lines),
      ridges: view.ridges,
      visibility: Number.isFinite(view.visibility) && view.visibility > 0 ? Math.round(view.visibility) : null,
      near: Math.round(view.near ?? 0),
      imagery: view.drapeSource,
      // kept only while it is laid, and never laid again by opening the view: it is billed
      sentinel: view.nearOn ? { reach: view.nearReach, date: view.nearDate ?? '' } : null,
      names: Boolean(view.peaksOn),
      shadows: round(view.shadowDepth ?? 0.5, 2),
    },
    sky: { on: Boolean(view.skyOn), date: view.skyDate ?? '', time: view.skyTime ?? '12:00' },
    target: view.target ? { lat: round(view.target.lat, 6), lon: round(view.target.lon, 6), height: round(view.target.height ?? 0, 1) } : null,
    photo: photoSpec(overlay),
  };
}

/**
 * What decides whether a saved view has changed, as text. The trace and the
 * pins are compared by the arrays themselves (`sameWork`), which change
 * whenever they are drawn on: a long trace is not written out at every frame.
 */
export function signature(spec) {
  if (!spec) return '';
  const { photo, look, ...rest } = spec;
  const pinned = photo?.kind === 'video' && photo.pins.length > 0;
  const kept = { ...rest };
  if (photo) {
    const settings = { ...photo };
    delete settings.strokes;
    delete settings.pins;
    delete settings.time;
    kept.photo = settings;
    if (!pinned) kept.look = look;
  }
  return JSON.stringify(kept);
}

/** Whether the trace and the pins on show are the ones a view was saved or opened with. */
export function sameWork(overlay, saved) {
  return (overlay?.strokes ?? null) === (saved?.strokes ?? null) && (overlay?.pins ?? null) === (saved?.pins ?? null);
}

/**
 * The view, as `state/horizon.svelte.js` `restore` takes it, from a saved spec:
 * the eye, the look and how the picture is drawn.
 */
export function restoredView(spec) {
  const picture = spec.picture ?? {};
  return {
    observer: { ...spec.eye },
    camera: { ...spec.look },
    visibility: picture.visibility ?? null,
    near: picture.near ?? 0,
    ground: picture.ground,
    lines: picture.lines,
    ridges: picture.ridges,
    imagery: picture.imagery,
    sentinel: picture.sentinel ?? null,
    names: picture.names,
    shadows: picture.shadows,
    sky: spec.sky ?? null,
  };
}

/** What the terrain was at the save, from the turn the app marched (`/api/horizon/panorama`). */
export function madeOf(panorama) {
  if (!panorama) return {};
  const credits = (panorama.credits ?? []).map(({ label = '', attribution = '' }) => ({ label, attribution }));
  const finite = (value, digits) => (Number.isFinite(value) ? round(value, digits) : null);
  return {
    terrain: credits,
    resolution_m: Number(panorama.resolution) > 0 ? round(panorama.resolution, 1) : null,
    refraction: finite(panorama.refraction, 3),
    ground_m: finite(panorama.observer?.ground, 1),
    altitude_m: finite(panorama.observer?.altitude, 1),
  };
}

/** The ground the view took in, as `[lon, lat]` pairs (geometry.js `footprint`), or null. */
export function footprintRing(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  return points.map(({ lat, lon }) => [round(lon, 6), round(lat, 6)]);
}

/** The name a new view is offered: the photo it is matched on, else where it stands. */
export function suggestedTitle(view, overlay) {
  const photo = overlay?.source?.name;
  if (photo) return String(photo).replace(/\.[a-z0-9]{2,5}$/i, '');
  const eye = view.observer;
  return eye ? `View from ${eye.lat.toFixed(4)}, ${eye.lon.toFixed(4)}` : 'View';
}
