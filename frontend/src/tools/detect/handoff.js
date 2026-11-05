/**
 * The candidate a note's picture asks Detect to show, held until its run is
 * open. A plain module so the opener that writes it loads without the tool.
 */
const held = { run: null, candidate: null };

/** Detect is to land on `candidate` once run `run` is open. */
export function holdCandidate(run, candidate) {
  held.run = run;
  held.candidate = candidate;
}

/** The candidate asked for in run `run`, once, or null. */
export function takeCandidate(run) {
  if (!run || held.run !== run) return null;
  const candidate = held.candidate;
  held.run = null;
  held.candidate = null;
  return candidate;
}
