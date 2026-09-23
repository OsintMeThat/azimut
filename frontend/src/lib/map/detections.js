/**
 * Detect's home list, worked out from the two listings the panel reads: the
 * saved detections and the runs of the case. A run names the detection it
 * belongs to (`followup_id`), so each detection carries its own history and
 * the runs started without saving one stand on their own.
 */

export const ACTIVE = Object.freeze(['queued', 'running']);
export const isActive = (row) => ACTIVE.includes(row?.status);

export const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

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
    return { ...watch, history, latest: history[0] ?? null, active: history.find(isActive) ?? null };
  });
}

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
