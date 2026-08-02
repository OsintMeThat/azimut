/**
 * What the Post Composer does with a proof handed over by the Proof Composer
 * ("To Post").
 *
 * A second proof is a second piece of work, so it gets its own thread: the one
 * on screen is written to its own file first, then makes way. Sending the same
 * proof again is the same work edited, so it stays in the thread that already
 * carries it.
 */

/** `'apply'` to load the proof into the thread on screen, `'file-then-apply'`
 *  to save that thread and start a fresh one for the proof. */
export function planProofHandoff({ incomingPng, currentPng, hasContent }) {
  if (incomingPng && incomingPng === currentPng) return 'apply';
  return hasContent ? 'file-then-apply' : 'apply';
}

/**
 * Name to file the outgoing thread under. A bound draft keeps its own name
 * (it writes back over its own file). An unbound one whose name is already
 * taken would land on another draft, and the handoff has nobody to ask, so it
 * takes `fresh` instead.
 */
export function filingName({ title, bound, takenSlugs, slug, fresh }) {
  if (bound) return title;
  return takenSlugs.has(slug) ? fresh : title;
}
