/**
 * The clock a case is read on until the analyst picks one: the zone its places stand in.
 *
 * An investigation argues in the local time of where things happened. A video from Sanaa
 * stamped 17:07 UTC was filmed at 20:07, and reading it against UTC (or against the
 * analyst's own machine) is how an hour goes missing. The case already knows where it
 * is: its places have points, and each point has a civil zone (`lib/localZone.js`, read
 * offline). So the axis opens on the zone most of them stand in, and says so.
 *
 * Only the axis moves: the case stores UTC, and a value keeps the zone it was stated in.
 * A case with no placed point, or whose points could not be read, stays on UTC.
 */
import { zoneAt } from './localZone.js';
import { zoneWords, zonedFields } from './timeline.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (value) => String(value).padStart(2, '0');

/** Where the choice is kept, per case: the clock picked stays picked. */
const KEY = (caseId) => `azimut:timeline-clock:${caseId}`;
const CHOICE = /^(utc|case|machine|place:[^\s]{1,64}|zone:[A-Za-z0-9+\-_/]{1,64})$/;

/**
 * The zone most of these places stand in: `{ zone, count, of, places }`, or null.
 *
 * `count` places are in it out of the `of` whose zone was read, so the menu can say
 * "3 of 5 places" rather than pass a majority off as the whole case. Points closer
 * than about a kilometre are asked once: a town's dozen places are one question.
 */
export async function caseZone(places, { lookup = zoneAt } = {}) {
  const groups = new Map();
  for (const place of places ?? []) {
    const lat = Number(place?.lat);
    const lon = Number(place?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const group = groups.get(key) ?? { point: { lat, lon }, labels: [] };
    group.labels.push(place.label);
    groups.set(key, group);
  }
  const read = await Promise.all(
    [...groups.values()].map(async (group) => ({ ...group, zone: await lookup(group.point).catch(() => '') }))
  );
  const zones = new Map();
  let of = 0;
  for (const group of read) {
    if (!group.zone) continue;
    of += group.labels.length;
    const held = zones.get(group.zone) ?? { zone: group.zone, count: 0, places: [] };
    held.count += group.labels.length;
    held.places.push(...group.labels);
    zones.set(group.zone, held);
  }
  const [first] = [...zones.values()].sort((a, b) => b.count - a.count || a.zone.localeCompare(b.zone));
  return first ? { ...first, of } : null;
}

/** How the choice says where it came from: `the case's places` or `3 of 5 places`. */
export function caseZoneWords(found) {
  if (!found) return '';
  return found.count === found.of ? "the case's places" : `${found.count} of ${found.of} places`;
}

/** The clock picked for this case, or `case` when none was. */
export function rememberedClock(caseId, storage = globalThis.localStorage) {
  try {
    const held = caseId ? storage?.getItem(KEY(caseId)) : null;
    return held && CHOICE.test(held) ? held : 'case';
  } catch {
    return 'case';
  }
}

/** Keep the clock picked for this case. Going back to the default forgets it. */
export function rememberClock(caseId, choice, storage = globalThis.localStorage) {
  if (!caseId || !CHOICE.test(String(choice))) return;
  try {
    if (choice === 'case') storage?.removeItem(KEY(caseId));
    else storage?.setItem(KEY(caseId), choice);
  } catch {
    // A browser that keeps nothing still reads the case on its default clock.
  }
}

/**
 * An instant on the axis's clock, written the way the rest of the Timeline writes a
 * date: `22 Jun 2023, 20:07:16 Aden time`. Only for a value that names an instant: a
 * day has no hour, and printing 00:00 in another zone would invent one.
 */
export function clockReading(instant, zone, { named = true } = {}) {
  const millis = Date.parse(instant);
  if (!Number.isFinite(millis) || !zone) return '';
  const at = zonedFields(millis, zone);
  const day = `${at.day} ${MONTHS[at.month - 1]} ${at.year}`;
  const time = `${day}, ${pad(at.hour)}:${pad(at.minute)}:${pad(at.second)}`;
  return named ? `${time} ${zoneWords(zone).place} time` : time;
}
