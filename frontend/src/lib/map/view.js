/**
 * A map view, written into the address and read back out of it.
 *
 * This is what makes a second map window possible at all. The window the
 * analyst detaches is the same app on the same case, and the only thing that
 * distinguishes it is where its camera is pointed — so the camera goes in the
 * hash. Four things follow for free: a reload comes back to the same ground, a
 * view is a link worth keeping, a window can be duplicated, and two windows can
 * later be told to follow each other without inventing a second channel.
 *
 * Everything here is a number a person could have typed into the address bar,
 * which is why `readView` validates rather than parses: a hand-edited `z=900`
 * or `ll=nowhere` must leave the map where it was, not fly it to NaN.
 *
 * Precision is six decimals, about 0.1 m — past what any imagery resolves and
 * short enough to keep the address readable.
 */

const PLACES = 6;
/** Places a zoom keeps over relief, a few metres of the camera's height. */
const RELIEF_ZOOM_PLACES = 2;
/** The heights a camera's centre may be held at, in metres: the Dead Sea shore to Everest's top. */
const MIN_ELEVATION = -500;
const MAX_ELEVATION = 9000;

/** Is this a real number, inside the bounds the app states everywhere else? */
function within(value, low, high) {
  return Number.isFinite(value) && value >= low && value <= high;
}

/**
 * The zoom a view is written down at. A flat map comes to rest on whole levels,
 * so a whole level is the view. Over relief it does not (`engine.js`), and the
 * fraction is part of where the camera stands: rounded away, a link or a
 * capture would set the view up again from another height, and at a steep tilt
 * on other ground.
 */
export function writtenZoom(zoom, tilted) {
  return tilted ? Number(zoom.toFixed(RELIEF_ZOOM_PLACES)) : Math.round(zoom);
}

/** The view as query parameters, for `buildHash`. */
export function viewParams({ lat, lon, zoom, bearing = 0, pitch = null, elevation = null, provider = '' } = {}) {
  const params = {};
  if (within(lat, -90, 90) && within(lon, -180, 180)) {
    params.ll = `${Number(lat.toFixed(PLACES))},${Number(lon.toFixed(PLACES))}`;
  }
  const tilted = within(pitch, 0, 90);
  if (within(zoom, 0, 24)) params.z = String(writtenZoom(zoom, tilted));
  // north-up is the default everywhere, so it is not worth an address
  if (within(bearing, 0, 360) && Math.round(bearing) % 360 !== 0) {
    params.b = String(Math.round(bearing) % 360);
  }
  // A tilt is only ever there with the relief on, so its presence, even at 0,
  // is what brings the relief back on a reload.
  if (tilted) params.t = String(Math.round(pitch));
  // …and over relief, the height the camera holds its centre at, to the metre:
  // with the zoom it says where the eye stands (`facade.js` setCamera)
  if (tilted && within(elevation, MIN_ELEVATION, MAX_ELEVATION)) params.e = String(Math.round(elevation));
  if (provider) params.p = provider;
  return params;
}

/**
 * …and back, or null when there is no usable view in there.
 *
 * A partial address is honoured as far as it goes: `#satellite?p=sentinel2`
 * names a basemap and no place, and the map opens where it would have anyway.
 */
export function readView(params) {
  const get = (key) => (params instanceof URLSearchParams ? params.get(key) : params?.[key]);
  const view = {};

  const pair = String(get('ll') ?? '').split(',');
  if (pair.length === 2) {
    const lat = Number(pair[0]);
    const lon = Number(pair[1]);
    if (within(lat, -90, 90) && within(lon, -180, 180)) {
      view.lat = lat;
      view.lon = lon;
    }
  }

  const tilt = Number(get('t'));
  // the globe leans to 88°, the map engine's own 3D to 85° and it holds anything past it there
  const tilted = get('t') !== null && get('t') !== undefined && within(tilt, 0, 90);
  const zoom = Number(get('z'));
  if (get('z') !== null && get('z') !== undefined && within(zoom, 0, 24)) {
    view.zoom = writtenZoom(zoom, tilted);
  }

  const bearing = Number(get('b'));
  if (get('b') !== null && get('b') !== undefined && within(bearing, 0, 360)) {
    view.bearing = Math.round(bearing) % 360;
  }

  if (tilted) view.pitch = Math.round(tilt);
  const elevation = Number(get('e'));
  if (tilted && get('e') !== null && get('e') !== undefined && within(elevation, MIN_ELEVATION, MAX_ELEVATION)) {
    view.elevation = Math.round(elevation);
  }

  const provider = get('p');
  if (provider) view.provider = String(provider);

  return Object.keys(view).length ? view : null;
}

/**
 * Which window this is, for the ones opened beside the first.
 *
 * The first window carries no number and says nothing; a detached one is told
 * which it is, because two identical windows on a second screen are otherwise
 * impossible to tell apart. Bounded, because it reaches a title and a badge.
 */
export function readWindowLabel(params) {
  const raw = params instanceof URLSearchParams ? params.get('w') : params?.w;
  const n = Number(raw);
  return Number.isInteger(n) && n > 1 && n < 100 ? n : null;
}
