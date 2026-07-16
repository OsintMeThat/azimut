// Latitude/longitude presentation. The app stores decimal degrees everywhere
// (case.json, proof specs, exports) — this module only decides how a pair is
// *shown*, per the user's Settings → Preferences choice. Nothing here ever
// changes what lands on disk, so a case reads the same for every reader.
//
// Kept pure and Leaflet-free so it can be unit-tested.

export const COORD_FORMATS = ['dd', 'dms', 'mgrs'];

// WGS84 / UTM constants (mirror of the ellipsoid Web Mercator tiles use).
const A = 6378137; // semi-major axis (m)
const F = 1 / 298.257223563; // flattening
const K0 = 0.9996; // UTM scale factor on the central meridian
const E2 = F * (2 - F); // first eccentricity squared
const EP2 = E2 / (1 - E2); // second eccentricity squared

const rad = (deg) => (deg * Math.PI) / 180;

/** Decimal degrees, 6 dp (~0.11 m) — the app's native precision. */
export function formatDD(lat, lon) {
  return `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`;
}

function dmsPart(value, positive, negative) {
  const hemi = value < 0 ? negative : positive;
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  let min = Math.floor((abs - deg) * 60);
  let sec = (abs - deg - min / 60) * 3600;
  // rounding the seconds for display can carry into the minute (and the degree)
  if (Number(sec.toFixed(2)) >= 60) {
    sec = 0;
    min += 1;
  }
  if (min >= 60) {
    min = 0;
    deg += 1;
  }
  return `${deg}°${String(min).padStart(2, '0')}'${sec.toFixed(2).padStart(5, '0')}"${hemi}`;
}

/** Degrees/minutes/seconds, 2 dp on the seconds (~0.3 m). */
export function formatDMS(lat, lon) {
  return `${dmsPart(Number(lat), 'N', 'S')} ${dmsPart(Number(lon), 'E', 'W')}`;
}

/**
 * The UTM zone for a point, including the two irregularities every MGRS
 * implementation has to carry: zone 32 is widened over south-west Norway, and
 * band X over Svalbard uses only the odd zones 31/33/35/37.
 */
export function utmZone(lat, lon) {
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) return 32;
  if (lat >= 72 && lat < 84 && lon >= 0 && lon < 42) {
    if (lon < 9) return 31;
    if (lon < 21) return 33;
    if (lon < 33) return 35;
    return 37;
  }
  return Math.floor((lon + 180) / 6) + 1;
}

// Latitude bands, 8° each from 80°S; I and O are skipped to avoid reading as
// 1 and 0. The last band (X) is 12° tall and runs to the 84°N UTM limit.
const BANDS = 'CDEFGHJKLMNPQRSTUVWX';

export function latBand(lat) {
  if (lat < -80 || lat > 84) return null; // outside the UTM/MGRS domain
  if (lat >= 72) return 'X';
  return BANDS[Math.floor((lat + 80) / 8)];
}

/** Project to UTM: { zone, easting, northing } in metres. */
export function toUTM(lat, lon) {
  const zone = utmZone(lat, lon);
  const lon0 = rad((zone - 1) * 6 - 180 + 3); // central meridian of the zone
  const phi = rad(lat);
  const lam = rad(lon);

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);

  const N = A / Math.sqrt(1 - E2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = EP2 * cosPhi * cosPhi;
  // keep the longitude difference in (-180, 180] so a zone straddling the
  // antimeridian doesn't blow the series up
  let dLon = lam - lon0;
  if (dLon > Math.PI) dLon -= 2 * Math.PI;
  if (dLon < -Math.PI) dLon += 2 * Math.PI;
  const Aa = dLon * cosPhi;

  // meridional arc
  const M =
    A *
    ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 * E2 * E2) / 256) * phi -
      ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 * E2 * E2) / 1024) * Math.sin(2 * phi) +
      ((15 * E2 * E2) / 256 + (45 * E2 * E2 * E2) / 1024) * Math.sin(4 * phi) -
      ((35 * E2 * E2 * E2) / 3072) * Math.sin(6 * phi));

  const easting =
    K0 *
      N *
      (Aa +
        ((1 - T + C) * Aa ** 3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * Aa ** 5) / 120) +
    500000;

  let northing =
    K0 *
    (M +
      N *
        tanPhi *
        ((Aa * Aa) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * Aa ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * Aa ** 6) / 720));
  if (lat < 0) northing += 10000000; // southern hemisphere false northing

  return { zone, easting, northing };
}

// 100 km square identifiers. The column letter cycles through three alphabet
// sets by zone; the row letter cycles through 20 letters, offset by half the
// alphabet on even zones (the standard AA lettering scheme).
const COL_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROW_LETTERS = 'ABCDEFGHJKLMNPQRSTUV';

/**
 * Military Grid Reference System, 1 m precision — e.g. "31U DQ 48250 11951".
 * Returns null outside the UTM domain (the poles use UPS, which the tools
 * never need).
 */
export function formatMGRS(lat, lon) {
  const band = latBand(lat);
  if (band === null) return null;

  const { zone, easting, northing } = toUTM(lat, lon);
  const col = COL_SETS[(zone - 1) % 3][Math.floor(easting / 100000) - 1];
  let rowIndex = Math.floor(northing / 100000) % 20;
  if (zone % 2 === 0) rowIndex = (rowIndex + 5) % 20;
  const row = ROW_LETTERS[rowIndex];

  const e = String(Math.floor(easting % 100000)).padStart(5, '0');
  const n = String(Math.floor(northing % 100000)).padStart(5, '0');
  return `${zone}${band} ${col}${row} ${e} ${n}`;
}

/**
 * Read the Settings home-view fields into a view the API accepts, or null when
 * one is blank or unreadable. The fields arrive mixed: lat/lon bind as text, so
 * a half-typed "-" isn't fought mid-keystroke, while the zoom input binds as a
 * number (and as null once emptied) — hence the string normalisation.
 */
export function parseHomeView({ lat, lon, zoom }) {
  const text = (value) => String(value ?? '').trim();
  if (!text(lat) || !text(lon) || !text(zoom)) return null;
  // zoom is a discrete tile level; the server refuses a fractional one
  const view = { lat: Number(lat), lon: Number(lon), zoom: Math.round(Number(zoom)) };
  return Object.values(view).every(Number.isFinite) ? view : null;
}

/**
 * Render a pair in the user's chosen format. Unknown formats — and points MGRS
 * can't express — fall back to decimal degrees, so a coordinate is always
 * readable rather than blank.
 */
export function formatCoords(lat, lon, format = 'dd') {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return '';
  if (format === 'dms') return formatDMS(lat, lon);
  if (format === 'mgrs') return formatMGRS(lat, lon) ?? formatDD(lat, lon);
  return formatDD(lat, lon);
}
