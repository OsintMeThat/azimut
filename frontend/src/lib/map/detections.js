/**
 * Detect's home list, worked out from the two listings the panel reads: the
 * saved detections and the runs of the case. A run names the detection it
 * belongs to (`followup_id`), so each detection carries its own history and
 * the runs started without saving one stand on their own.
 */

import { foldText } from '../textFold.js';

export const ACTIVE = Object.freeze(['queued', 'running']);
export const isActive = (row) => ACTIVE.includes(row?.status);

export const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
/** `1 pass`, `3 passes`: the one word `plural` cannot make. */
export const passCount = (count) => `${count} ${count === 1 ? 'pass' : 'passes'}`;

/**
 * Each saved detection with its runs, newest first, and the one working now.
 * Timestamps are only seconds deep, so two runs of one routine can share one;
 * the pass they swept settles the order between them.
 */
export const byRecency = (one, two) =>
  `${two.created_at ?? ''}${two.dates?.[1] ?? ''}`.localeCompare(`${one.created_at ?? ''}${one.dates?.[1] ?? ''}`);

export function detectionsWithRuns(watches, runs) {
  return watches.map((watch) => {
    const history = runs.filter((run) => run.followup_id === watch.id).sort(byRecency);
    const working = history.filter(isActive);
    // A catch-up queues several passes; the one sweeping now leads, then the oldest waiting.
    const active = working.find((run) => run.status === 'running') ?? working.at(-1) ?? null;
    const ready = history.filter((run) => run.status === 'ready');
    return { ...watch, history, latest: history[0] ?? null, active, working,
      lastPass: ready.map((run) => run.dates?.[1] ?? '').filter(Boolean).sort().at(-1) ?? '' };
  });
}

/** The candidates of a routine's finished runs, oldest pass first, for a sparkline. */
export function countsOf(history) {
  return (history ?? []).filter((run) => run.status === 'ready' && run.dates?.[1])
    .sort((one, two) => one.dates[1].localeCompare(two.dates[1]))
    .map((run) => ({ value: run.count ?? 0, toReview: run.to_review ?? 0, date: run.dates[1] }));
}

/** `3 Nov · 21 days ago`: when a routine last read a pass, said against today. */
export function freshness(day, today = new Date().toISOString().slice(0, 10)) {
  const found = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day ?? '');
  if (!found) return { text: '', stale: false, days: null };
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86400000);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(found[2]) - 1];
  const ago = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  // Sentinel-2 comes back every two to five days: past ten, passes have been missed
  return { text: `${Number(found[3])} ${month} · ${ago}`, stale: days > STALE_DAYS, days };
}

/** Days after the last pass read past which a routine has surely missed some. */
export const STALE_DAYS = 10;

/** Runs no saved detection claims: started once, or left by one since deleted. */
export function singleRuns(watches, runs) {
  const saved = new Set(watches.map((watch) => watch.id));
  return runs.filter((run) => !run.followup_id || !saved.has(run.followup_id));
}

/**
 * The Saved tab in groups: each routine with its runs, newest first, then the
 * passes swept once, which include the runs of a routine since deleted. A
 * routine that has not run yet has nothing to show here.
 */
export function savedGroups(watches, runs) {
  const routines = watches
    .map((watch) => ({ id: watch.id, kind: 'routine', title: watch.title, colour: watch.colour ?? '',
      runs: runs.filter((run) => run.followup_id === watch.id).sort(byRecency) }))
    .filter((group) => group.runs.length);
  const once = singleRuns(watches, runs).sort(byRecency);
  return once.length ? [...routines, { id: 'once', kind: 'once', title: 'One passes', colour: '', runs: once }] : routines;
}

/** The two days a run compared, as a row line, or '' before it has them. */
export function runDays(run) {
  const [a, b] = run?.dates ?? [];
  if (!b) return '';
  return a && a !== b ? `${a} → ${b}` : b;
}

function found(run) {
  if (!run.count) return 'nothing found';
  if (run.to_review) return `${run.to_review} to review`;
  return `${plural(run.count, 'candidate')}, all reviewed`;
}

/**
 * Where a run stands, in the words the list shows, and a tone for its colour.
 * A finished run leads with the day of the pass it swept, because across a
 * detection's history that is what tells one run from the next.
 */
export function runState(run) {
  if (!run) return { tone: 'idle', text: 'Not run yet' };
  switch (run.status) {
    case 'queued': return { tone: 'busy', text: 'Queued' };
    case 'running': return { tone: 'busy', text: `Running · ${run.progress ?? 0}/${run.total ?? 0} tiles` };
    case 'failed': return { tone: 'warn', text: run.message ? `Failed · ${run.message}` : 'Failed' };
    case 'cancelled': return { tone: 'idle', text: 'Cancelled' };
    case 'no_new_imagery': return { tone: 'idle', text: 'No new pass since the last run' };
    case 'ready': {
      const day = run.dates?.[1];
      const text = found(run);
      return { tone: run.to_review ? 'new' : 'done', text: day ? `${day} · ${text}` : text[0].toUpperCase() + text.slice(1) };
    }
    default: return { tone: 'idle', text: run.status ?? '' };
  }
}

/** How a detection picks its imagery, short enough for a list row. */
/** Past five routines the list gets a search box; below, a glance finds one. */
export const ROUTINE_SEARCH_FROM = 6;

/** Whether a routine answers every word of a search, in its title, note or analyzer. */
export function routineMatches(routine, query) {
  const text = foldText([routine.title, routine.note, routine.analyzer].filter(Boolean).join(' '));
  return foldText(query).split(/\s+/).filter(Boolean).every((word) => text.includes(word));
}

export function ruleLabel(rule, single) {
  if (rule === 'manual') return 'fixed dates';
  if (single) return 'newest pass';
  return rule === 'latest_reference' ? 'newest pass against a reference' : 'newest pass against the last run';
}

/** What to say when a run settles, or null when there is nothing to say. */
export function settledMessage(run) {
  const title = run.title || 'Detection';
  switch (run.status) {
    case 'ready':
      return run.count
        ? { text: `${title}: ${plural(run.count, 'candidate')} to review`, kind: 'ok' }
        : { text: `${title}: nothing passed the thresholds`, kind: 'info' };
    case 'no_new_imagery': return { text: `${title}: no new pass since the last run`, kind: 'info' };
    case 'failed': return { text: `${title} failed: ${run.message || 'see Detect'}`, kind: 'warn' };
    default: return null;
  }
}
