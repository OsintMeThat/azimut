/** The named readings each family of tools is holding.
 *
 * Board and Graph ask one question of the catalog — the same entities, drawn as rows
 * or as a network — so they share a question and a saved view. The Timeline asks about
 * time: its recipe is tracks, a window and a clock, and none of that means anything on
 * a Board. Keeping one slot for both made a Timeline view unseat the Board's live view
 * and, worse, replace the catalog question with the empty one a timeline spec carries.
 * Two slots, one per family, and a view only ever lands in its own.
 */
import { emptyFilter, loadFilter, normalizeFilter, saveFilter } from './entityFilter.js';
import {
  emptyAnalysisPeriod,
  normalizeAnalysisPeriod,
} from './analysisPeriod.js';

const idle = () => ({
  activeView: null,
  snapshotId: null,
  modified: false,
  changeVersion: 0,
  saveState: 'idle',
});

export const analysisSearch = $state({
  caseId: null,
  /** The catalog question, shared by Board and Graph. */
  filter: emptyFilter(),
  /** The fact-time half of that question, separate from the filing-date filter. */
  period: emptyAnalysisPeriod(),
  catalog: idle(),
  timeline: idle(),
});

/** Which family a surface belongs to. */
export function viewFamily(surface) {
  return surface === 'timeline' ? 'timeline' : 'catalog';
}

/** The slot a surface reads and writes. Mutated in place, never replaced, so a
 *  component may hold on to it. */
export function viewSlot(surface) {
  return analysisSearch[viewFamily(surface)];
}

export const catalogViews = analysisSearch.catalog;
export const timelineViews = analysisSearch.timeline;

const signature = (filter) => JSON.stringify(normalizeFilter(filter));

function reset(slot) {
  Object.assign(slot, idle());
}

function catalogQuestionModified(slot) {
  if (!slot.activeView) return false;
  const savedFilter = normalizeFilter(slot.activeView.spec?.query?.filter);
  const savedPeriod = normalizeAnalysisPeriod(slot.activeView.spec?.timeline);
  return (
    signature(savedFilter) !== signature(analysisSearch.filter) ||
    JSON.stringify(savedPeriod) !== JSON.stringify(analysisSearch.period)
  );
}

/** Move the shared question across a case boundary, never across cases by accident. */
export function openAnalysisCase(caseId) {
  const id = caseId || null;
  if (analysisSearch.caseId === id) return;
  analysisSearch.caseId = id;
  analysisSearch.filter = id ? loadFilter(id) : emptyFilter();
  analysisSearch.period = emptyAnalysisPeriod();
  reset(analysisSearch.catalog);
  reset(analysisSearch.timeline);
}

/** Replace the shared fact-time window after a Timeline or Map handoff. */
export function setAnalysisPeriod(caseId, value) {
  openAnalysisCase(caseId);
  const next = normalizeAnalysisPeriod(value);
  const changed = JSON.stringify(analysisSearch.period) !== JSON.stringify(next);
  if (changed) analysisSearch.period = next;
  const slot = analysisSearch.catalog;
  slot.modified = catalogQuestionModified(slot);
  if (changed) slot.changeVersion += 1;
}

/** Replace the catalog question from either surface and remember it for this case. */
export function setAnalysisFilter(caseId, filter) {
  openAnalysisCase(caseId);
  const next = normalizeFilter(filter);
  const changed = signature(analysisSearch.filter) !== signature(next);
  if (changed) analysisSearch.filter = next;
  if (caseId) saveFilter(caseId, next);
  const slot = analysisSearch.catalog;
  slot.modified = catalogQuestionModified(slot);
  if (changed) slot.changeVersion += 1;
}

/** Open a named recipe on the surfaces of its own family. */
export function activateAnalysisView(caseId, view) {
  openAnalysisCase(caseId);
  const slot = viewSlot(view?.surface);
  reset(slot);
  slot.activeView = view;
  slot.snapshotId = view?.mode === 'snapshot' ? view.id : null;
  slot.saveState = view?.mode === 'live' ? 'saved' : 'idle';
  if (viewFamily(view?.surface) !== 'catalog') return;
  analysisSearch.filter = normalizeFilter(view?.spec?.query?.filter);
  analysisSearch.period = normalizeAnalysisPeriod(view?.spec?.timeline);
  if (caseId) saveFilter(caseId, analysisSearch.filter);
}

/** Accept an autosave response without replaying its presentation over newer edits. */
export function adoptSavedAnalysisView(caseId, view) {
  const slot = view ? viewSlot(view.surface) : null;
  if (analysisSearch.caseId !== caseId || !slot || slot.activeView?.id !== view.id) return false;
  slot.activeView = view;
  return true;
}

/** Carry a rename onto the reading a surface is holding.
 *
 *  The label has to land here as well as in the menu: an autosave sends the name it
 *  is holding, so a live view left on the old one would write it straight back. */
export function renameAnalysisView(caseId, viewId, name) {
  if (analysisSearch.caseId !== caseId) return false;
  const slot = [analysisSearch.catalog, analysisSearch.timeline].find(
    (candidate) => candidate.activeView?.id === viewId
  );
  if (!slot) return false;
  slot.activeView = { ...slot.activeView, name };
  return true;
}

/** Leave the named reading of one family. The catalog question can stay on screen
 *  or be dropped with it. */
export function leaveAnalysisView(caseId, surface, { clear = false } = {}) {
  openAnalysisCase(caseId);
  reset(viewSlot(surface));
  if (clear && viewFamily(surface) === 'catalog') {
    setAnalysisFilter(caseId, emptyFilter());
    setAnalysisPeriod(caseId, emptyAnalysisPeriod());
  }
}
