/**
 * A note kept beside whatever tool is open, and the way things get into it.
 *
 * The panel is the app's, not a tool's: it stays open from the Map to a video to
 * the Board, so a note is written where the looking is done. Whether it is open
 * and how wide is remembered for the browser; which note it shows, per case.
 *
 * `cite` is what "Cite in note" presses everywhere: the reference goes in at the
 * cursor of the note being written (the Notebook's when it is the tool on screen,
 * the panel's otherwise), and the panel opens when nothing is being written.
 */
import { panelWidth } from '../panelWidth.js';
import { citation } from './syntax.js';

const KEY = 'azimut:noteDock';
const NOTE_KEY = (caseId) => `azimut:noteDock:${caseId}`;
/** The panel's width, dragged at its edge and kept like every side panel's. */
export const dockWidth = panelWidth({ key: 'azimut:noteDockW', min: 300, max: 760, def: 380, fraction: 0.5 });

function readOpen() {
  try {
    return localStorage.getItem(KEY) === 'open';
  } catch {
    return false;
  }
}

export const noteDock = $state({
  open: readOpen(),
  width: dockWidth.loadWidth(),
  /** Text waiting for the panel's editor to mount and take it. */
  pending: '',
  /** The note last picked for the panel, so a panel already open follows the pick. */
  noteFor: null,
});

export function setDockOpen(open) {
  noteDock.open = Boolean(open);
  try {
    localStorage.setItem(KEY, noteDock.open ? 'open' : 'closed');
  } catch { /* storage may be off; the panel still works for this visit */ }
}

/** The note the panel shows for this case: a filed note's id, or null for Case notes. */
export function dockNote(caseId) {
  try {
    return localStorage.getItem(NOTE_KEY(caseId)) || null;
  } catch {
    return null;
  }
}

export function setDockNote(caseId, noteId) {
  try {
    if (noteId) localStorage.setItem(NOTE_KEY(caseId), noteId);
    else localStorage.removeItem(NOTE_KEY(caseId));
  } catch { /* the panel falls back to Case notes */ }
  noteDock.noteFor = { caseId, noteId: noteId ?? null };
}

const TOLD_KEY = 'azimut:noteDock:told';

/**
 * Whether this is the panel's first opening in this browser, which it says what
 * it is for on. Asking counts as the opening: the line is shown once.
 */
export function firstOpening(storage = globalThis.localStorage) {
  try {
    if (storage?.getItem(TOLD_KEY)) return false;
    storage?.setItem(TOLD_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** Open the panel on a note, from the Notebook or a menu. */
export function openInDock(caseId, noteId) {
  setDockNote(caseId, noteId);
  setDockOpen(true);
}

// The editors writing right now, each able to take text at its cursor.
const writers = new Map();

/** An editor on screen says it can take text (`where` is `notebook` or `dock`); returns its goodbye. */
export function offerWriter(where, insert) {
  writers.set(where, insert);
  return () => {
    if (writers.get(where) === insert) writers.delete(where);
  };
}

/**
 * Put text into the note being written. `tool` is the tool on screen: the
 * Notebook's editor takes it when the Notebook is open on a note, the panel's
 * otherwise, and a closed panel opens and takes it once it has loaded.
 */
export function writeIntoNote(text, { tool } = {}) {
  if (!text) return 'none';
  if (tool === 'notebook' && writers.has('notebook')) {
    writers.get('notebook')(text);
    return 'notebook';
  }
  if (noteDock.open && writers.has('dock')) {
    writers.get('dock')(text);
    return 'dock';
  }
  noteDock.pending = noteDock.pending ? `${noteDock.pending} ${text}` : text;
  setDockOpen(true);
  return 'opened';
}

/** "Cite in note": a record, as its reference, into the note being written. */
export function citeInNote(entity, options = {}) {
  return writeIntoNote(citation(entity), options);
}

/** The panel's editor takes what was waiting for it. */
export function takePending() {
  const text = noteDock.pending;
  noteDock.pending = '';
  return text;
}
