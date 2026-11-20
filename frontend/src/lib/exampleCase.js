/**
 * The example case, opened in one press: a fictional storm on an invented island, told in
 * real public-domain photographs and filled from the showcase templates, so every note
 * shows what a report can hold. The server imports the bundle the app ships
 * (`engine/examplecase.py`, `POST /api/cases/example`) as Import case does, or answers the
 * one already made; nothing is fetched and no key is asked.
 */
import { api } from './api.js';
import { waitForBundle } from './bundles.js';
import { openCase, refreshCaseList, sessionStarted, toast, uiState } from './state.svelte.js';

/** What the case is called, as the server names it. */
export const EXAMPLE_NAME = 'Example case (fictional)';
/** What the press says it does, wherever it stands. */
export const EXAMPLE_HINT = 'A fictional case with every kind of note filled in, made on this computer';

let opening = false;

/** Make the example case if it is not there yet, then open it on its notes. Answers whether it opened. */
export async function openExampleCase() {
  if (opening) return false;
  opening = true;
  try {
    // asked of a tab just opened: the last case it reopens would land over the example
    await sessionStarted();
    const started = await api.post('/api/cases/example', {});
    if (started.job_id) {
      toast('Making the example case…', 'info', 2500);
      const job = await waitForBundle(started.case_id, started.job_id);
      if (job.state !== 'ready') throw new Error(job.error ? `The example case could not be made: ${job.error}` : 'The example case could not be made');
      await refreshCaseList();
    }
    // the guards of the case being left may keep it open, and that is the analyst's answer
    if (!(await openCase(started.case_id))) return false;
    uiState.tool = 'notebook';
    return true;
  } catch (failure) {
    toast(failure.message || 'The example case could not be opened', 'danger', 7000);
    return false;
  } finally {
    opening = false;
  }
}
