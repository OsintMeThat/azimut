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

/** Is this a real number, inside the bounds the app states everywhere else? */
function within(value, low, high) {
  return Number.isFinite(value) && value >= low && value <= high;
}

/** The view as query parameters, for `buildHash`. */
export function viewParams({ lat, lon, zoom, bearing = 0, provider = '' } = {}) {
  const params = {};
  if (within(lat, -90, 90) && within(lon, -180, 180)) {
    params.ll = `${Number(lat.toFixed(PLACES))},${Number(lon.toFixed(PLACES))}`;
  }
  if (within(zoom, 0, 24)) params.z = String(Math.round(zoom));
  // north-up is the default everywhere, so it is not worth an address
  if (within(bearing, 0, 360) && Math.round(bearing) % 360 !== 0) {
    params.b = String(Math.round(bearing) % 360);
  }
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

  const zoom = Number(get('z'));
  if (get('z') !== null && get('z') !== undefined && within(zoom, 0, 24)) {
    view.zoom = Math.round(zoom);
  }

  const bearing = Number(get('b'));
  if (get('b') !== null && get('b') !== undefined && within(bearing, 0, 360)) {
    view.bearing = Math.round(bearing) % 360;
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
