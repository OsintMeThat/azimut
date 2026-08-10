/** The one Search+ question Board and Graph are reading. */
import { emptyFilter, loadFilter, normalizeFilter, saveFilter } from './entityFilter.js';

export const analysisSearch = $state({
  caseId: null,
  filter: emptyFilter(),
  activeView: null,
  snapshotId: null,
  modified: false,
  changeVersion: 0,
  saveState: 'idle',
});

const signature = (filter) => JSON.stringify(normalizeFilter(filter));

/** Move the shared question across a case boundary, never across cases by accident. */
export function openAnalysisCase(caseId) {
  const id = caseId || null;
  if (analysisSearch.caseId === id) return;
  analysisSearch.caseId = id;
  analysisSearch.filter = id ? loadFilter(id) : emptyFilter();
  analysisSearch.activeView = null;
  analysisSearch.snapshotId = null;
  analysisSearch.modified = false;
  analysisSearch.changeVersion = 0;
  analysisSearch.saveState = 'idle';
}

/** Replace the question from either surface and remember it for this case. */
export function setAnalysisFilter(caseId, filter) {
  openAnalysisCase(caseId);
  const next = normalizeFilter(filter);
  const changed = signature(analysisSearch.filter) !== signature(next);
  if (changed) analysisSearch.filter = next;
  if (caseId) saveFilter(caseId, next);
  const saved = analysisSearch.activeView?.spec?.query?.filter;
  analysisSearch.modified = Boolean(saved && signature(saved) !== signature(next));
  if (changed) analysisSearch.changeVersion += 1;
}

/** Open a named recipe on both surfaces at once. */
export function activateAnalysisView(caseId, view) {
  openAnalysisCase(caseId);
  analysisSearch.activeView = view;
  analysisSearch.snapshotId = view?.mode === 'snapshot' ? view.id : null;
  analysisSearch.filter = normalizeFilter(view?.spec?.query?.filter);
  analysisSearch.modified = false;
  analysisSearch.changeVersion = 0;
  analysisSearch.saveState = view?.mode === 'live' ? 'saved' : 'idle';
  if (caseId) saveFilter(caseId, analysisSearch.filter);
}

/** Accept an autosave response without replaying its presentation over newer edits. */
export function adoptSavedAnalysisView(caseId, view) {
  if (
    analysisSearch.caseId !== caseId ||
    !view ||
    analysisSearch.activeView?.id !== view.id
  ) return false;
  analysisSearch.activeView = view;
  return true;
}

/** Leave the named reading. The question can stay on screen or be dropped too. */
export function leaveAnalysisView(caseId, { clear = false } = {}) {
  openAnalysisCase(caseId);
  analysisSearch.activeView = null;
  analysisSearch.snapshotId = null;
  analysisSearch.modified = false;
  analysisSearch.changeVersion = 0;
  analysisSearch.saveState = 'idle';
  if (clear) setAnalysisFilter(caseId, emptyFilter());
}
