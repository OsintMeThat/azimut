/**
 * The clock the case is read on, shared by every date field in the app.
 *
 * The Timeline's axis opens on where the case is (`lib/caseClock.js`) and the analyst
 * can move it. A date typed with no place of its own opens on that same clock, so it
 * lands on the axis where it was meant: a `10/09/2026` typed in a Los Angeles case is
 * Los Angeles's 10th, not UTC's. The Timeline says its clock here as it settles; a
 * field opened before the Timeline was ever drawn works it out once from the choice
 * kept for the case and the case's places. UTC until either is known.
 */
import { api } from './api.js';
import { buildCatalogQuery } from './catalog.js';
import { caseZone, rememberedClock } from './caseClock.js';
import { zoneAt } from './localZone.js';
import { UTC, knownZone, machineZone } from './timeline.js';

export const caseAxis = $state({ caseId: null, zone: null });

/** The case being worked out, so two fields asking at once ask once. */
let asking = null;

/** The zone a new date in this case opens on: the axis's clock, else UTC. */
export function axisZone(caseId) {
  return caseId && caseAxis.caseId === caseId && caseAxis.zone ? caseAxis.zone : UTC;
}

/** Said by the Timeline whenever its axis settles on a clock. */
export function noteAxisZone(caseId, zone) {
  if (!caseId || !zone || !knownZone(zone)) return;
  caseAxis.caseId = caseId;
  caseAxis.zone = zone;
}

/** The case's saved points with coordinates, as the Timeline's clock menu lists them. */
async function casePlaces(caseId, get) {
  const page = await get(buildCatalogQuery(caseId, { types: ['place'], limit: 50 }));
  return (page?.items ?? [])
    .filter((entity) => Number.isFinite(Number(entity.attrs?.lat)) && Number.isFinite(Number(entity.attrs?.lon)))
    .map((entity) => ({ id: entity.id, label: entity.label, lat: Number(entity.attrs.lat), lon: Number(entity.attrs.lon) }));
}

/**
 * Work out the axis's clock for a case the Timeline has not drawn in this session:
 * the clock kept for the case, and where the case is by default. Asked once per case;
 * the Timeline's own word replaces it whenever it is drawn.
 */
export async function learnAxisZone(caseId, { get = (url) => api.get(url), lookup = zoneAt, storage } = {}) {
  if (!caseId || caseAxis.caseId === caseId || asking === caseId) return;
  asking = caseId;
  const choice = rememberedClock(caseId, storage ?? globalThis.localStorage);
  let zone = UTC;
  try {
    if (choice === 'machine') zone = machineZone();
    else if (choice.startsWith('zone:')) zone = choice.slice(5);
    else if (choice !== 'utc') {
      const places = await casePlaces(caseId, get);
      if (choice.startsWith('place:')) {
        const place = places.find((entry) => entry.id === choice.slice(6));
        zone = place ? (await lookup(place)) || UTC : UTC;
      } else {
        zone = (await caseZone(places, { lookup }))?.zone ?? UTC;
      }
    }
  } catch {
    zone = UTC;
  }
  if (asking === caseId) asking = null;
  // The Timeline may have said it first, and its word is the one on screen.
  if (caseAxis.caseId !== caseId) noteAxisZone(caseId, knownZone(zone) ? zone : UTC);
}

/** Forget the clock learned. For tests. */
export function forgetAxisZone() {
  caseAxis.caseId = null;
  caseAxis.zone = null;
  asking = null;
}
