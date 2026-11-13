/**
 * A note sent to Post, the Notebook's To Post: its public edition, or the stretch
 * selected in it, as the start of a Free post thread.
 *
 * The Notebook never builds the thread. The server reads the note into pieces
 * (`POST notes/{id}/pieces`, `engine/notepieces.py`): its words, its pictures, its
 * proofs and its sources, in order, with every internal passage left out by the
 * PDF's own rule. Post makes the posts from them (`tools/post/start.js`); nothing
 * is published. What could not go (internal passages, tables, diagrams, the rest)
 * is said once, in one toast.
 */
import { api } from '../api.js';
import { toast } from '../state.svelte.js';
import { startPost } from '../../tools/post/start.js';

/** What stays out, by the key the server counts it under, and how one of it is called. */
const LEFT_OUT = [
  ['internal', 'internal passage'],
  ['tables', 'table'],
  ['diagrams', 'diagram'],
  ['other', 'other part'],
];

/** How long the toast saying what stayed out is up: long enough to read a list. */
const SAID_FOR = 6000;

/**
 * What stayed out, as one sentence: `2 internal passages and 1 table stay out`, or
 * '' when nothing did.
 */
export function leftOutSaid(left) {
  const parts = LEFT_OUT
    .map(([key, noun]) => [Math.max(0, Math.floor(Number(left?.[key]) || 0)), noun])
    .filter(([count]) => count > 0)
    .map(([count, noun]) => `${count} ${noun}${count > 1 ? 's' : ''}`);
  if (!parts.length) return '';
  const listed = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  const one = parts.length === 1 && parts[0].startsWith('1 ');
  return `${listed} ${one ? 'stays' : 'stay'} out`;
}

/**
 * The browser's selection as the route reads it, or null for the whole note. The
 * offsets are the editor's own, UTF-16 code units, which the server turns into its
 * own characters.
 */
function stretch(selection) {
  const start = Number(selection?.from);
  const end = Number(selection?.to);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return null;
  return { start, end };
}

/**
 * Send `text` (the note as the editor holds it) to Post, the stretch `selection`
 * (`{ from, to }`) of it when one is given. Opens Post on a Free post holding the
 * pieces and answers true; with nothing that can go, Post stays shut, the toast says
 * why, and it answers false.
 */
export async function noteToPost(caseId, noteId, text, selection = null) {
  const answer = await api.post(`/api/cases/${caseId}/notes/${noteId}/pieces`, {
    text: String(text ?? ''),
    selection: stretch(selection),
  });
  const pieces = Array.isArray(answer?.pieces) ? answer.pieces : [];
  const said = leftOutSaid(answer?.left);
  if (!pieces.length) {
    toast(said ? `Nothing to post: ${said}` : 'Nothing to post', 'warn', SAID_FOR);
    return false;
  }
  startPost('free', [], { title: String(answer?.title ?? '') }, pieces);
  if (said) toast(said, 'info', SAID_FOR);
  return true;
}
