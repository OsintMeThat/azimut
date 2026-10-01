/**
 * A time typed as the local time at a place (D33 of the Case transition).
 *
 * A Claim tied to a point was seen somewhere, and the hour a witness or a caption
 * gives is that place's clock. The zone comes from the server's bundled boundaries
 * (`GET /api/geo/zone`, nothing reaches the network) and the offset from this
 * browser's own zone database, for the instant itself: an August hour in Kyiv is
 * `+03:00` and a January one `+02:00`. How a value is put on a clock and stored is
 * `lib/clock.js`; this module finds the zones and their offsets.
 */
import { api } from './api.js';
import { instantOf, zoneOffset } from './timeline.js';

const UNZONED = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?$/;

const pad = (value) => String(value).padStart(2, '0');

/** The offset in force at that wall-clock time in the zone, as `+03:00`. */
export function offsetAt(raw, zone) {
  const match = UNZONED.exec(String(raw ?? ''));
  if (!match || !zone) return '';
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const instant = instantOf({ year, month, day, hour, minute, second }, zone);
  const minutes = Math.round(zoneOffset(instant, zone) / 60_000);
  const size = Math.abs(minutes);
  return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(size / 60))}:${pad(size % 60)}`;
}

const DAYS = /^\d{4}(-\d{2}(-\d{2})?)?[~?%]?(\/\d{4}(-\d{2}(-\d{2})?)?[~?%]?)?$/;

/** Whether a stored value is a date or a span of dates, with no hour. A day has no
 *  offset to carry, so the zone it is a day of travels beside it (`when_zone`). */
export function isDateOnly(raw) {
  return DAYS.test(String(raw ?? ''));
}

/** Where an entity stands, when it is a point: a place, or a proof with its own. */
export function pointOf(entity) {
  if (!entity || !['place', 'proof'].includes(entity.type)) return null;
  const lat = Number(entity.attrs?.lat);
  const lon = Number(entity.attrs?.lon);
  if (entity.attrs?.lat == null || entity.attrs?.lon == null) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/** Zones already asked for, by point. A handful of places per case, capped anyway. */
const ZONES = new Map();
const MAX_ZONES = 200;

/** The civil zone at a point, asked once per point per session. */
export function zoneAt({ lat, lon }) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  let held = ZONES.get(key);
  if (!held) {
    held = api
      .get(`/api/geo/zone?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`)
      .then((body) => body?.name || '')
      .catch(() => {
        ZONES.delete(key);
        return '';
      });
    if (ZONES.size >= MAX_ZONES) ZONES.delete(ZONES.keys().next().value);
    ZONES.set(key, held);
  }
  return held;
}

/**
 * The zones a draft's points stand in, one entry per zone.
 *
 * Two places in one zone are one choice. Two zones are two, and neither is taken on
 * the analyst's behalf: `only` is set only when every point agrees.
 */
export async function zonesOf(entities) {
  const placed = entities
    .map((entity) => ({ entity, point: pointOf(entity) }))
    .filter((entry) => entry.point);
  const named = await Promise.all(placed.map(async (entry) => ({
    zone: await zoneAt(entry.point),
    place: entry.entity.label,
  })));
  const zones = [];
  for (const entry of named) {
    if (entry.zone && !zones.some((held) => held.zone === entry.zone)) zones.push(entry);
  }
  return { zones, only: zones.length === 1 ? zones[0] : null };
}

/** Forget every zone asked for. For tests. */
export function forgetZones() {
  ZONES.clear();
}
