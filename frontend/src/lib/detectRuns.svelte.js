/**
 * What Detect is doing, said outside Detect.
 *
 * A run is queued in the case and keeps going whichever tool is open, so its
 * progress can't live in Detect's column alone: the top bar marks it while
 * anything is queued or running, and a toast says when one settles, with a way
 * back to its results. Detect's own list reads the same rows.
 *
 * This reads the case's run list, a local file listing, and asks again only
 * while something is still working. It never starts a run or fetches imagery.
 */
import { api } from './api.js';
import { reloadCase, toast, uiState } from './state.svelte.js';
import { isActive, settledMessage } from './map/detections.js';

export const POLL_MS = 1500;

export const detectRuns = $state({ caseId: null, rows: [] });

let timer = null;
let era = 0;
let asked = 0;
let applied = 0;
/** Whether this case's runs were read before, so a new row is news rather than history. */
let known = false;

/** Detect, opened on one of its saved items (`runs-<id>`, `followups-<id>`…). */
export function openDetect(stem) {
  uiState.tool = 'detect';
  uiState.openAnalyzer = stem;
}

/**
 * Toast every run that settled since the last read: one that was working, and
 * one that was not there at all, since a run can fail or finish from the cache
 * before the first read after it started. True when any settled.
 */
function announce(before, after) {
  const working = new Set(before.filter(isActive).map((row) => row.id));
  const seen = new Set(before.map((row) => row.id));
  let settled = false;
  for (const row of after) {
    if (isActive(row) || !(working.has(row.id) || (known && !seen.has(row.id)))) continue;
    settled = true;
    const said = settledMessage(row);
    if (!said) continue;
    const action = row.status === 'ready' && row.count
      ? { label: 'Review', onClick: () => openDetect(`runs-${row.id}`) } : null;
    toast(said.text, said.kind, 8000, action);
  }
  return settled;
}

function schedule() {
  clearTimeout(timer);
  timer = null;
  if (detectRuns.rows.some(isActive)) {
    const caseId = detectRuns.caseId;
    timer = setTimeout(() => void refreshRuns(caseId).catch(() => {}), POLL_MS);
  }
}

/**
 * Read the case's runs now, and keep reading while any is working. Another
 * case is other work: switching drops the old rows and never announces them.
 * Answers are applied in the order they were asked, so a slow one can't put
 * back a run list the next one already moved past.
 */
export async function refreshRuns(caseId) {
  if ((caseId ?? null) !== detectRuns.caseId) {
    era++;
    clearTimeout(timer);
    timer = null;
    detectRuns.caseId = caseId ?? null;
    detectRuns.rows = [];
    known = false;
  }
  if (!caseId) return [];
  const mine = era;
  const order = ++asked;
  const rows = await api.get(`/api/cases/${caseId}/analysis/runs`);
  if (mine !== era || order < applied) return rows;
  applied = order;
  const settled = announce(detectRuns.rows, rows);
  known = true;
  detectRuns.rows = rows;
  schedule();
  if (settled) await reloadCase().catch(() => {});
  return rows;
}
