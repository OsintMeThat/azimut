/**
 * A Timeline or Graph picture in a note opens the snapshot that froze it, in the tool it
 * was drawn by. Loaded with the note (`lib/notes/openersLoaded.js`), so it stays light.
 */
import { api } from '../lib/api.js';
import { activateAnalysisView } from '../lib/analysisSearch.svelte.js';
import { registerOpener } from '../lib/notes/openers.js';
import { caseState, toast, uiState } from '../lib/state.svelte.js';

/** The snapshot a picture froze, for a tool: its id when the picture is of that tool's. */
export const snapshotOf = (entity, surface) => (entity?.type === 'media' && entity.attrs?.analysis_surface === surface
  ? String(entity.attrs.analysis_view ?? '') : '');

/** Open the snapshot in its tool. A snapshot sent to the Trash since says so. */
export async function openSnapshot(id, { get = api.get } = {}) {
  const caseId = caseState.current?.id;
  if (!caseId || !id) return;
  try {
    const view = await get(`/api/cases/${caseId}/analysis-views/${encodeURIComponent(id)}`);
    activateAnalysisView(caseId, view);
    uiState.tool = view.surface;
  } catch (error) {
    toast(error?.status === 404 ? 'That snapshot is no longer in the case' : error?.message || 'The snapshot could not be opened', 'warn');
  }
}

/** What reopens a picture of `surface`'s reading. */
export const readingOpener = (surface) => ({
  accepts: (entity) => Boolean(snapshotOf(entity, surface)),
  open: (entity) => openSnapshot(snapshotOf(entity, surface)),
});

registerOpener('timeline', readingOpener('timeline'));
registerOpener('graph', readingOpener('graph'));
