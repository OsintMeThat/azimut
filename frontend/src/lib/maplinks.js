// Quick-jump links to external maps we can't embed in-tool, for a coordinate.
// Used by the Satellite "Open in…" panel: the point is to reach the maps that
// aren't reachable from inside Azimut (Esri/OSM are already in-tool tile
// providers, so they're deliberately left out). Pure URL construction.
//
// Every form here was opened in a real browser at a known zoom and read back
// out of the address bar, and `docs/MAP_SITES.md` records what came back. Two
// rules came out of that and are worth stating where the URLs are written:
//
// * **The zoom is the same number on all of them.** Google's `z`, Bing's `lvl`,
//   Yandex's `z`, Copernicus's `zoom`, Zoom Earth's `z`, Satellites.pro's third
//   field and Apple's `z` are all the tile level of a 256-pixel Web Mercator —
//   measured, not assumed, including Apple's, whose documentation declines to
//   say so.
// * **Order and layer are not.** Yandex writes longitude first. Zoom Earth
//   opens its weather layer unless the path says otherwise. Google needs a
//   `data=` code for satellite, and passing it a distance in metres instead of
//   a zoom lands somewhere else entirely.
export function mapLinks(lat, lon, zoom = 17) {
  const z = Math.round(zoom);
  return [
    { id: 'google', label: 'Google Maps', url: `https://www.google.com/maps/@${lat},${lon},${z}z` },
    {
      id: 'google_sat',
      label: 'Google Satellite',
      // the zoom is kept and `!3m1!1e3` picks the imagery: Google rewrites it
      // into its own `,3231m` viewport height on arrival, at this same level
      url: `https://www.google.com/maps/@${lat},${lon},${z}z/data=!3m1!1e3`,
    },
    {
      id: 'google_earth',
      label: 'Google Earth',
      // Earth takes a camera distance and a field of view, not a zoom, and it
      // honours both: `1y` here once opened every link 35 times too close.
      url: `https://earth.google.com/web/@${lat},${lon},0a,${earthDistance(z, lat)}d,${EARTH_FOV}y,0h,0t,0r`,
    },
    {
      id: 'apple',
      label: 'Apple Maps',
      // map=satellite selects the satellite basemap in Apple's current web URL
      url: `https://maps.apple.com/?ll=${lat},${lon}&z=${z}&map=satellite`,
    },
    { id: 'bing', label: 'Bing Maps', url: `https://www.bing.com/maps?cp=${lat}~${lon}&lvl=${z}&style=h` },
    {
      id: 'yandex',
      label: 'Yandex Satellite',
      url: `https://yandex.com/maps/?ll=${lon},${lat}&z=${z}&l=sat`,
    },
    {
      id: 'sentinel',
      label: 'Copernicus Browser',
      url: `https://browser.dataspace.copernicus.eu/?zoom=${z}&lat=${lat}&lng=${lon}`,
    },
    {
      id: 'zoom_earth',
      label: 'Zoom Earth',
      // /maps/satellite/ or it opens on the live weather layer instead
      url: `https://zoom.earth/maps/satellite/#view=${lat},${lon},${z}z`,
    },
    {
      id: 'satellites_pro',
      label: 'Satellites.pro',
      url: `https://satellites.pro/#${lat},${lon},${z}`,
    },
  ];
}

/** Metres of ground per pixel at the equator, zoom 0, on 256-pixel tiles. */
const EQUATOR_M_PER_PX = (2 * Math.PI * 6378137) / 256;

/** The field of view Earth writes for itself, in degrees. */
const EARTH_FOV = 35;

/** The window height a link is sized for, in CSS pixels. Earth's view covers
 *  the same ground in any window, so a shorter one lands a little further out. */
const EARTH_WINDOW_PX = 1000;

/**
 * How far Google Earth's camera sits from the ground for a tile zoom, in metres.
 *
 * Earth's 2D map covers `2·d·tan(y/2)` metres of ground across the window's
 * height, measured in a browser (`engine/mapsites.py`, `_earth_height_m`), so a
 * level `z` of Web Mercator in a 1000 px window is the `d` below. The ground's
 * height is not in a link, so Earth draws it that much closer until the map is
 * first moved.
 */
function earthDistance(zoom, lat) {
  const metresPerPx = (EQUATOR_M_PER_PX * Math.cos((lat * Math.PI) / 180)) / 2 ** Math.max(0, zoom);
  const halfFov = (EARTH_FOV * Math.PI) / 360;
  return Math.max(25, Math.round((metresPerPx * EARTH_WINDOW_PX) / (2 * Math.tan(halfFov))));
}

/**
 * Google Earth standing where a Horizon eye stands and looking where it looks.
 *
 * A link is a camera (`docs/MAP_SITES.md`): `a` its height above the sea,
 * `d` how far it stands back from that point, here none, `y` its field of view
 * top to bottom, `h` the heading, `t` the tilt from straight down (90 is
 * level, so the view's own tilt is added to it) and `r` the roll. Earth sizes
 * its window as it likes, so the lens is said by its height, which is the
 * view's vertical field (camera.js `verticalFov`).
 */
export function earthCameraLink({ lat, lon, altitude, heading, tilt = 0, roll = 0, vfov }) {
  const fixed = (value, digits) => Number(Number(value).toFixed(digits));
  const up = Math.min(180, Math.max(0, 90 + Number(tilt || 0)));
  const across = Math.min(150, Math.max(1, Number(vfov) || 35));
  const turn = ((Number(heading) % 360) + 360) % 360;
  return (
    `https://earth.google.com/web/@${fixed(lat, 6)},${fixed(lon, 6)},${fixed(altitude, 1)}a,0d,` +
    `${fixed(across, 2)}y,${fixed(turn, 2)}h,${fixed(up, 2)}t,${fixed(roll, 2)}r`
  );
}

/** Esri's own Wayback app, as its share links write it: `mapCenter` is longitude first. */
const WAYBACK_APP = 'https://livingatlas.arcgis.com/wayback/';
const COPERNICUS_APP = 'https://browser.dataspace.copernicus.eu/';
/** The deepest level the Copernicus Browser honours from a link (`docs/MAP_SITES.md`). */
const COPERNICUS_MAX_ZOOM = 18;
/** The level a verify link opens at when the picture recorded none. */
const VERIFY_ZOOM = 17;
/** The Copernicus Browser's collection for each Sentinel basemap the app captures from. */
const DATASETS = { sentinel2: 'S2_L2A_CDAS', sentinel1: 'S1_CDAS_IW_VVVH' };
/** A Wayback release rides on the provider id (`lib/wayback.js`). */
const RELEASE = /^esri-wayback~([1-9]\d{0,8})$/;
/** A day as the case reads it, or the moment of a radar pass on it; never one ending `~`. */
const DAY = /^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z)?$/;

/** A coordinate as a verify link writes it: five places, about a metre, no trailing zero. */
export function linkCoord(value) {
  const text = Number(value).toFixed(5).replace(/\.?0+$/, '');
  return text === '-0' ? '0' : text;
}

/** The map level a verify link opens at: the picture's own, rounded half up, else the default. */
function linkLevel(zoom, ceiling = Infinity) {
  const value = zoom == null || zoom === '' ? NaN : Number(zoom);
  const whole = Math.max(0, Number.isFinite(value) ? Math.floor(value + 0.5) : VERIFY_ZOOM);
  return Math.min(whole, ceiling);
}

/** Esri's Wayback app over the point, showing one release. */
export function waybackLink(lat, lon, zoom, release) {
  return `${WAYBACK_APP}#mapCenter=${linkCoord(lon)}%2C${linkCoord(lat)}%2C${linkLevel(zoom)}&mode=explore&active=${release}`;
}

/** The Copernicus Browser over the point, on one day of one collection. */
export function copernicusLink(lat, lon, zoom, day, dataset) {
  return (
    `${COPERNICUS_APP}?zoom=${linkLevel(zoom, COPERNICUS_MAX_ZOOM)}&lat=${linkCoord(lat)}&lng=${linkCoord(lon)}` +
    `&datasetId=${dataset}&fromTime=${day}T00%3A00%3A00.000Z&toTime=${day}T23%3A59%3A59.999Z`
  );
}

/**
 * Where a picture from `provider` at the point can be checked without Azimut, as
 * `{ label, url }`: Esri's Wayback app at its release, the Copernicus Browser on the
 * day of its pass. `day` is its imagery day as the case reads it (`2024-03-12~` for an
 * estimate, which is no day). Nothing for a point, a release or a day it did not
 * record. `engine/verifylinks.py` writes the same links in a printed note's sources,
 * and `tests/fixtures/verify-links.json` holds the two to one set of answers.
 */
export function verifyLinks({ provider, lat, lon, zoom = null, day = '' } = {}) {
  const y = lat == null || lat === '' ? NaN : Number(lat);
  const x = lon == null || lon === '' ? NaN : Number(lon);
  if (!Number.isFinite(y) || !Number.isFinite(x) || Math.abs(y) > 90 || Math.abs(x) > 180) return [];
  const ident = String(provider ?? '').trim();
  const release = RELEASE.exec(ident);
  if (release) return [{ label: 'Esri Wayback', url: waybackLink(y, x, zoom, Number(release[1])) }];
  const base = ident.split('~')[0];
  const dataset = Object.hasOwn(DATASETS, base) ? DATASETS[base] : '';
  const found = DAY.exec(String(day ?? '').trim());
  if (dataset && found) return [{ label: 'Copernicus Browser', url: copernicusLink(y, x, zoom, found[1], dataset) }];
  return [];
}
