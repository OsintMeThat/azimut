/**
 * Putting what a tool shows into the note pinned to the side, in one press.
 *
 * A tool offers what it can put (`offerPuts` in `lib/noteHere.svelte.js`): a picture,
 * a table, coordinates, a quote. Pressing one runs its `put()`, which files what has
 * to be filed and answers the Markdown to insert. The text lands in the pinned note
 * at its cursor, or at its end when nobody has written in it this visit, on lines of
 * its own; the note scrolls to it and lights it, and a picture opens its caption.
 * The toast that follows names the note and offers Undo, which takes the text back
 * and sends what was filed only for it to the case Trash.
 *
 * The note pinned is the one the panel beside the tools shows (`NoteDock`), which
 * says so here while it is open. With none, nothing is offered and every tool stays
 * as it was.
 */
import { dismissToast, reloadCase, toast } from '../state.svelte.js';
import { deleteEntities } from '../trash.js';
import { editNote, flush, noteReady, openNote, releaseNote } from './noteDoc.svelte.js';
import { appended } from './syntax.js';

export { registerOpener, openerFor } from './openers.js';

/** How long a put runs before it says it is working. */
export const BUSY_AFTER = 400;

// Raw, not proxied: the editor handle is compared by identity and must stay itself.
let current = $state.raw(null);

/** The note on the side: `pinned.current` is `{ caseId, noteId, title, editor }`, or null. */
export const pinned = {
  get current() {
    return current;
  },
};

/**
 * The panel says which note it shows, with the handle its editor is driven by.
 * Answers its undoing, which only clears what it set.
 */
export function pinNote(target) {
  const next = target?.caseId ? { ...target } : null;
  current = next;
  return () => {
    if (current === next) current = null;
  };
}

/** The note pinned to the side, `{ caseId, noteId, title }`, or null when none is. */
export function pinnedNote() {
  const target = pinned.current;
  return target ? { caseId: target.caseId, noteId: target.noteId ?? null, title: target.title ?? '' } : null;
}

/** A note's title as a menu row names it: cut at a word near `max` characters. */
export function shortTitle(title, max = 24) {
  const words = String(title ?? '').replace(/\s+/g, ' ').trim() || 'Note';
  if (words.length <= max) return words;
  const cut = words.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** A note's text without `text`, when it holds exactly one copy of it; else null. */
export function withoutText(body, text) {
  const value = String(body ?? '');
  const at = text ? value.indexOf(text) : -1;
  if (at < 0 || value.indexOf(text, at + 1) >= 0) return null;
  return `${value.slice(0, at)}${value.slice(at + text.length)}`;
}

/** Send what was filed only for an insert to the case Trash, as one group. */
async function trashFiled(caseId, filed) {
  if (!filed.length) return;
  await deleteEntities(caseId, filed);
  await reloadCase();
}

/** Take a put back from a note no editor here shows, if its one copy is still there. */
async function takeBackFromNote(caseId, noteId, text) {
  const doc = openNote(caseId, noteId);
  try {
    await noteReady(doc);
    if (doc.error || doc.elsewhere) return false;
    const without = withoutText(doc.text, text);
    if (without === null) return false;
    editNote(doc, without);
    doc.revision += 1;
    await flush(doc);
    return !doc.saveError;
  } finally {
    await releaseNote(doc);
  }
}

/** Add a put at the end of a note no editor here shows: answers the text as written. */
async function appendToPinned(caseId, noteId, text) {
  const doc = openNote(caseId, noteId);
  try {
    await noteReady(doc);
    if (doc.error) throw new Error(doc.error);
    if (doc.elsewhere) throw new Error('This note is open in another tab');
    const before = doc.text;
    const after = appended(before, text);
    editNote(doc, after);
    doc.revision += 1;
    await flush(doc);
    if (doc.saveError) throw new Error(doc.saveError);
    return after.slice(before.replace(/\s*$/, '').length);
  } finally {
    await releaseNote(doc);
  }
}

/**
 * Put `offer` in the pinned note. Answers what landed, `{ text, filed }`, or null when
 * nothing did: no note pinned, the put refused or failed (its message is shown), or
 * it was cancelled.
 */
export async function putInNote(offer, { busyAfter = BUSY_AFTER } = {}) {
  const target = pinned.current;
  if (!target || typeof offer?.put !== 'function') return null;
  const { caseId, noteId, title, editor } = target;
  const name = shortTitle(title);
  // where it goes is decided on the press, and held while it is being made
  const returnTo = typeof document === 'undefined' ? null : document.activeElement;
  const spot = editor?.spot?.() ?? null;
  const controller = new AbortController();
  let busy = null;
  const timer = setTimeout(() => {
    busy = toast(offer.busy || `Putting it in “${name}”…`, 'info', 0, { label: 'Cancel', onClick: () => controller.abort() });
  }, busyAfter);

  let result;
  try {
    result = await offer.put({ signal: controller.signal });
  } catch (error) {
    if (spot !== null) editor?.release?.(spot);
    if (!controller.signal.aborted && error?.name !== 'AbortError') toast(error?.message || 'Nothing was put in the note', 'danger');
    return null;
  } finally {
    clearTimeout(timer);
    if (busy !== null) dismissToast(busy);
  }

  const text = String(result?.text ?? '').replace(/^\n+|\s+$/g, '');
  const filed = [...new Set((result?.filed ?? []).filter(Boolean))];
  if (controller.signal.aborted || !text) {
    if (spot !== null) editor?.release?.(spot);
    // made for an insert that will not happen: nothing it filed stays behind
    await trashFiled(caseId, filed).catch(() => {});
    if (!controller.signal.aborted) toast('There was nothing to put in the note', 'warn');
    return null;
  }

  // the panel may have closed or moved to another note meanwhile: it still goes where it was asked to
  const live = Boolean(editor?.alive?.() && pinned.current?.editor === editor && spot !== null);
  let landed = null;
  let written = text;
  try {
    if (live) {
      landed = editor.place(spot, text, { inline: Boolean(result.inline) });
      if (!landed) throw new Error('This note cannot be written here now');
      written = landed.text;
      if (offer.picture && !result.inline) void editor.caption?.(landed, { returnTo });
    } else {
      if (spot !== null) editor?.release?.(spot);
      written = await appendToPinned(caseId, noteId, text);
    }
  } catch (error) {
    await trashFiled(caseId, filed).catch(() => {});
    toast(error?.message || 'The note could not take it', 'danger');
    return null;
  }

  toast(`Put in “${name}”`, 'ok', 8000, {
    label: 'Undo',
    onClick: async () => {
      try {
        const back = landed && editor?.alive?.() ? editor.takeBack(landed) : await takeBackFromNote(caseId, noteId, written);
        if (!back) {
          toast('That part of the note was changed since, so it stays', 'warn');
          return;
        }
        await trashFiled(caseId, filed);
        toast(filed.length ? 'Taken back. What was filed for it is in the Trash' : 'Taken back', 'info', 3000);
      } catch (error) {
        toast(error?.message || 'Could not take it back', 'danger');
      }
    },
  });
  return { text, filed };
}
