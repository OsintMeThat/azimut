/**
 * What the Post Composer does with a proof handed over by the Proof Composer
 * ("To Post").
 *
 * A second proof is a second piece of work, so it gets its own thread: the one
 * on screen is written to its own file first, then makes way. Sending the same
 * proof again is the same work edited, so it stays in the thread that already
 * carries it while that thread is still a draft, and a post of it the case holds as
 * a draft opens rather than a second one starting (`proofPosts`). A post that went
 * out is done: the proof starts a new one.
 */
import { draftState } from './postHome.js';

/** `'apply'` to load the proof into the thread on screen, `'file-then-apply'`
 *  to save that thread and start a fresh one for the proof. `standing` is where the
 *  thread on screen stands (`lib/post.js` `postState`). */
export function planProofHandoff({ incomingPng, currentPng, hasContent, standing = 'draft' }) {
  if (incomingPng && incomingPng === currentPng && standing === 'draft') return 'apply';
  return hasContent ? 'file-then-apply' : 'apply';
}

/**
 * What the case holds of a proof's posts, from `GET /drafts` rows, the post on screen
 * (`except`) left out: `open`, the latest saved of those still a draft, to open in
 * place of a new one, and `posted`, whether one of them went out.
 */
export function proofPosts(drafts, png, { except = null } = {}) {
  const mine = (Array.isArray(drafts) ? drafts : [])
    .filter((row) => png && row?.proof === png && typeof row.name === 'string' && row.name !== except);
  const open = mine
    .filter((row) => draftState(row) === 'draft')
    .sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))[0] ?? null;
  return { open, posted: mine.some((row) => draftState(row) !== 'draft') };
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
