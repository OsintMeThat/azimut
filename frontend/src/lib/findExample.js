/**
 * The guide's Search with Find, ready to run: the 1901 photo of Half Dome and the setup its
 * pictures were made with, every line of the trace and every mark, as that search asked
 * them (`guide/stages.mjs` writes `findExample.json`).
 *
 * It goes in a case of its own, so no real case is handed a demo file, and stays a search
 * not run: the analyst reads the setup, then presses Search. Pressed again, the case opens
 * on its newest search, so a search that ran comes back with its places.
 */
import { api } from './api.js';
import { caseState, createCase, openCase, reloadCase, sessionStarted, toast, uiState } from './state.svelte.js';

export const EXAMPLE_CASE = 'Find example';
const PHOTO_NAME = 'half_dome_1901.jpg';
/** Where the photo comes from, filed with it as any source is (guide/photos/CREDITS.md). */
const PHOTO_SOURCE =
  'https://commons.wikimedia.org/wiki/File:Vernal_Falls,_Nevada_Falls_and_Half_Dome_from_Glacier_Point_in_Yosemite_National_Park,_California,_1901_(CHS-1175).jpg';

/** The photo and the search filed in the case, answering the search's name. */
async function file(caseId, ask) {
  // asked for only now: nothing of the example may stand in the way of the app starting
  const { default: photo } = await import('../../guide/photos/half_dome_1901.jpg?url');
  const answer = await fetch(photo);
  // the upload takes any bytes, and an error page filed as the photo would stay there
  if (!answer.ok) throw new Error('The example photo could not be read');
  const form = new FormData();
  form.append('file', await answer.blob(), PHOTO_NAME);
  form.append('source_url', PHOTO_SOURCE);
  const { item } = await api.post(`/api/cases/${caseId}/media/upload`, form);
  const row = await api.post(`/api/cases/${caseId}/horizon/finds`, { ...ask, photo: { ...ask.photo, path: item.path }, run: false });
  // the case was read before these two were filed
  await reloadCase();
  return row.name;
}

let opening = false;

/** Open the example in Find: its case and its search filed first if they are not there yet. */
export async function openFindExample() {
  if (opening) return;
  opening = true;
  try {
    // asked of a tab just opened: the last case it reopens would land over the example
    await sessionStarted();
    const { default: ask } = await import('./findExample.json');
    const cases = await api.get('/api/cases');
    const known = cases.find((one) => one.name === EXAMPLE_CASE);
    // the guards of the case being left may keep it open, and that is the analyst's answer
    if (!(known ? await openCase(known.id) : await createCase(EXAMPLE_CASE))) return;
    const caseId = caseState.current.id;
    const [newest] = await api.get(`/api/cases/${caseId}/horizon/finds`);
    const name = newest?.name ?? (await file(caseId, ask));
    uiState.tool = 'horizon';
    uiState.openHorizonFind = name;
  } catch (failure) {
    toast(failure.message || 'The example could not be opened', 'danger');
  } finally {
    opening = false;
  }
}
