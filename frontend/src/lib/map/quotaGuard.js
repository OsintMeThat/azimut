/**
 * Billed imagery stops where a flat view would: the far ground of a tilted map
 * comes from Esri instead.
 *
 * A map tilted toward the horizon asks for tiles all the way to it, many times
 * what the same view looking straight down needs. On a provider that counts
 * every tile against a quota (Google, Mapbox, Sentinel Hub) that is a month's
 * allowance spent on blur nobody reads. So billed tiles are fetched through a
 * protocol of our own, which decides per tile: one inside the reach of the
 * flat view at this zoom comes from the chosen provider, one past it comes from
 * Esri World Imagery, which is free. A tilted view then costs about what a
 * flat one does, and the ground near the eye keeps the imagery that was chosen.
 *
 * The map says so on screen whenever it is happening, and a tilted capture
 * records Esri as the far imagery: a picture made of two providers names both.
 *
 * `farTile` is pure, so the rule is read off a test; the protocol handler is
 * the only part that touches the engine.
 */

export const GUARD_PROTOCOL = 'azimut-billed';
export const FREE_FAR_PROVIDER = 'esri-world-imagery';
/** How far billed tiles reach, as a share of the flat view's own half-diagonal. */
export const REACH = 1.25;
const EARTH_CIRCUMFERENCE = 40075016.686;

/** The centre of an XYZ tile, in degrees. */
export function tileCentre(z, x, y) {
  const n = 2 ** z;
  const lon = ((x + 0.5) / n) * 360 - 180;
  const merc = Math.PI * (1 - (2 * (y + 0.5)) / n);
  return { lat: (Math.atan(Math.sinh(merc)) * 180) / Math.PI, lon };
}

function metres(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * How far a flat view at this engine zoom reaches from its centre, in metres:
 * half its diagonal on the ground. MapLibre counts zoom on 512 px tiles.
 */
export function flatReach({ lat, zoom, width, height }) {
  const perPixel = (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
  return (perPixel * Math.hypot(width, height)) / 2;
}

/**
 * Whether a tile lies past what billed imagery should reach. Never on a map
 * looking straight down: there is no far ground to spare.
 *
 * @param {{z: number, x: number, y: number}} tile
 * @param {{lat: number, lon: number, zoom: number, width: number, height: number, pitch: number}} view
 */
export function farTile({ z, x, y }, view) {
  if (!(view.pitch > 0)) return false;
  const reach = flatReach(view) * REACH;
  // a tile is near if any of it is: measure to its centre, less half its size
  const centre = tileCentre(z, x, y);
  const half = (EARTH_CIRCUMFERENCE * Math.cos((centre.lat * Math.PI) / 180)) / 2 ** z / Math.SQRT2;
  return metres(view, centre) - half > reach;
}

/** The address billed tiles are asked for on one map, through the guard. */
export function guardedTemplate(mapId, providerId) {
  return `${GUARD_PROTOCOL}://${mapId}/${providerId}/{z}/{x}/{y}`;
}

/** …and that address read back. Null for anything that is not one. */
export function readGuarded(url) {
  const found = new RegExp(`^${GUARD_PROTOCOL}://([^/]+)/([^/]+)/(\\d+)/(\\d+)/(\\d+)$`).exec(url);
  if (!found) return null;
  const [, mapId, providerId, z, x, y] = found;
  return { mapId, providerId, z: Number(z), x: Number(x), y: Number(y) };
}

/** Where a guarded tile is really fetched from. */
export function tileSource(asked, view) {
  const far = farTile(asked, view);
  const provider = far ? FREE_FAR_PROVIDER : asked.providerId;
  return { far, url: `/api/tiles/${provider}/${asked.z}/${asked.x}/${asked.y}` };
}
