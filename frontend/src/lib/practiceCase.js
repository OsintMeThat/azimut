/**
 * The guide's practice case: a public-domain photo whose place is known, filed in a case of
 * its own for the reader to geolocate, the answer kept here until they check it.
 *
 * Made the way findExample.js makes its case: lazily, the first time it is asked for, and
 * reopened as it was left every time after, so a reader's work in it is never undone.
 */
import { api } from './api.js';
import { haversine } from './measure.js';
import { buildMediaQuery } from './mediaQuery.js';
import { caseState, createCase, openCase, reloadCase, sessionStarted, toast, uiState } from './state.svelte.js';

export const PRACTICE_CASE = 'Practice: Port of Los Angeles';
const PHOTO_NAME = 'bridge_channel.jpg';
/** Where the photo comes from, filed with it as any source is (guide/photos/CREDITS.md). */
const PHOTO_SOURCE =
  'https://commons.wikimedia.org/wiki/File:FDA%E2%80%99s_China_Offices_Focus_on_Product_Safety_(6549753597).jpg';

/**
 * Where the camera stood: `CAMERA` of the guide's demo case (guide/demo.mjs), high on the
 * west bank of the Main Channel at the edge of town, looking down on the cruise terminal's
 * car park.
 *
 * `within` is what a position read off imagery can be held to. The frame fixes the bearing
 * (the Evergreen cranes stand in front of the bridge's east tower), not the range: the bridge
 * is 1.3 km off and the lens is long, so a couple of hundred metres along that line barely
 * changes the view. 300 m takes the car park and the waterfront below and still refuses the
 * Evergreen yard across the water.
 */
export const PRACTICE_ANSWER = { lat: 33.74168, lon: -118.27946, within: 300 };

/** Whether a case, or a case name, is the practice case. Matched as the server matches a
 *  name it refuses twice: trimmed and whatever its case. */
export function isPractice(open) {
  const name = typeof open === 'string' ? open : open?.name;
  return typeof name === 'string' && name.trim().toLowerCase() === PRACTICE_CASE.toLowerCase();
}

/** How far a guess stands from where the camera was, in whole metres, and whether it is close enough. */
export function checkAnswer({ lat, lon }) {
  const metres = haversine(PRACTICE_ANSWER, { lat, lon });
  return { metres: Math.round(metres), right: metres <= PRACTICE_ANSWER.within };
}

/** Whether the case holds the photo already, found by its source, which a rename leaves alone. */
async function holdsPhoto(caseId) {
  const { items } = await api.get(buildMediaQuery(caseId, { q: PHOTO_SOURCE, limit: 20 }));
  return items.some((item) => item.source?.url === PHOTO_SOURCE);
}

async function filePhoto(caseId) {
  // asked for only now: nothing of the practice may stand in the way of the app starting
  const { default: photo } = await import('../../guide/photos/bridge_channel.jpg?url');
  const answer = await fetch(photo);
  // the upload takes any bytes, and an error page filed as the photo would stay there
  if (!answer.ok) throw new Error('The practice photo could not be read');
  const form = new FormData();
  form.append('file', await answer.blob(), PHOTO_NAME);
  form.append('source_url', PHOTO_SOURCE);
  await api.post(`/api/cases/${caseId}/media/upload`, form);
  // the case was read before the photo was filed
  await reloadCase();
}

let opening = false;

/** Open the practice case on Media, its photo filed first if it is not there yet. */
export async function openPractice() {
  if (opening) return;
  opening = true;
  try {
    // asked of a tab just opened: the last case it reopens would land over the practice
    await sessionStarted();
    const cases = await api.get('/api/cases');
    const known = cases.find(isPractice);
    // the guards of the case being left may keep it open, and that is the analyst's answer
    if (!(known ? await openCase(known.id) : await createCase(PRACTICE_CASE))) return;
    const caseId = caseState.current.id;
    if (!(await holdsPhoto(caseId))) await filePhoto(caseId);
    uiState.tool = 'media';
  } catch (failure) {
    toast(failure.message || 'The practice case could not be opened', 'danger');
  } finally {
    opening = false;
  }
}
