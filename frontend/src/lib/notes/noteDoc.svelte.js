/**
 * The notes open in this tab, one copy each, whoever shows them.
 *
 * The Notebook, the note beside the tools and a task ticked from the To-do all
 * write the same note, so they share one document: its text, whether it is saved,
 * and whether another browser tab has it. Typing is written after a short pause;
 * anything about to read the file (an export, a tick from outside) flushes first,
 * and a tab closing sends what is still waiting with `keepalive`.
 *
 * One note, one tab (`lib/oneTab.js`): a tab that opens a note takes it, and a
 * tab that had it writes what it has, stops editing, and says so. It can take
 * the note back, which reads it again.
 */
import { api } from '../api.js';
import { docTabs } from '../oneTab.js';
import { appended } from './syntax.js';

export const NOTE_CHANNEL = 'azimut:note-open';
export const SAVE_DELAY = 700;

/** The case's own notes have no entity; the tabs and the routes call them `case`. */
export const CASE_NOTES = 'case';

const open = new Map();

export function noteKey(caseId, noteId) {
  return `${caseId}:${noteId ?? CASE_NOTES}`;
}

export function noteEndpoint(caseId, noteId) {
  return noteId && noteId !== CASE_NOTES ? `/api/cases/${caseId}/notes/${noteId}` : `/api/cases/${caseId}/notes`;
}

function createDoc(caseId, noteId, { Channel } = {}) {
  const doc = $state({
    caseId,
    noteId: noteId && noteId !== CASE_NOTES ? noteId : null,
    text: '',
    loaded: false,
    error: '',
    saved: true,
    saving: false,
    saveError: '',
    elsewhere: false,
    /** Bumped when the text changes from outside the editor showing it. */
    revision: 0,
  });
  const name = doc.noteId ?? CASE_NOTES;
  const state = { users: 0, timer: null, waiting: null, writes: Promise.resolve(), edits: 0 };
  const tabs = docTabs(NOTE_CHANNEL, {
    Channel,
    onlost: async () => {
      await flush(doc);
      doc.elsewhere = true;
      tabs.saved(caseId, name);
    },
    // the tab that had it has written it: read it again, unless it was typed in here meanwhile
    onsaved: () => {
      if (!doc.elsewhere && state.edits === state.editsAtHold) void reload(doc);
    },
  });
  state.tabs = tabs;
  state.hold = () => {
    state.editsAtHold = state.edits;
    tabs.hold(caseId, name);
  };
  internals.set(doc, state);
  return doc;
}

const internals = new WeakMap();

async function load(doc) {
  try {
    const body = await api.get(noteEndpoint(doc.caseId, doc.noteId));
    doc.text = body.text ?? '';
    doc.error = '';
    doc.revision += 1;
  } catch (error) {
    doc.error = error.message || 'The note could not be read';
  } finally {
    doc.loaded = true;
  }
}

async function reload(doc) {
  const state = internals.get(doc);
  if (!state || state.waiting) return;
  await load(doc);
}

/**
 * The note `noteId` of `caseId` (null or `case` for the case's own), opened for one
 * more user. Each `openNote` is matched by a `releaseNote`.
 */
export function openNote(caseId, noteId, options = {}) {
  const key = noteKey(caseId, noteId);
  let doc = open.get(key);
  if (!doc) {
    doc = createDoc(caseId, noteId, options);
    open.set(key, doc);
    internals.get(doc).loading = load(doc);
    internals.get(doc).hold();
  }
  internals.get(doc).users += 1;
  return doc;
}

/** Resolves once the note's text has been read. */
export function noteReady(doc) {
  return internals.get(doc)?.loading ?? Promise.resolve();
}

/** One user is done with the note; the last one writes what is waiting and lets it go. */
export async function releaseNote(doc) {
  const state = internals.get(doc);
  if (!state) return;
  state.users -= 1;
  if (state.users > 0) return;
  open.delete(noteKey(doc.caseId, doc.noteId));
  await flush(doc);
  state.tabs.close();
}

/** The note as typed: written after a pause. */
export function editNote(doc, text) {
  const state = internals.get(doc);
  if (!state || doc.elsewhere || text === doc.text) return;
  doc.text = text;
  doc.saved = false;
  state.edits += 1;
  schedule(doc, state);
}

function schedule(doc, state) {
  clearTimeout(state.timer);
  const contents = doc.text;
  const edit = state.edits;
  state.waiting = { contents, edit };
  state.timer = setTimeout(() => {
    state.timer = null;
    void write(doc, state);
  }, SAVE_DELAY);
}

function write(doc, state) {
  const waiting = state.waiting;
  state.waiting = null;
  if (!waiting) return state.writes;
  doc.saving = true;
  state.writes = state.writes.then(async () => {
    try {
      await api.put(noteEndpoint(doc.caseId, doc.noteId), { text: waiting.contents });
      doc.saveError = '';
      if (state.edits === waiting.edit) doc.saved = true;
    } catch (error) {
      doc.saveError = error.message || 'not saved';
    } finally {
      doc.saving = Boolean(state.waiting);
    }
  });
  return state.writes;
}

/** Write what is waiting now, and resolve once every write so far has landed. */
export async function flush(doc) {
  const state = internals.get(doc);
  if (!state) return;
  clearTimeout(state.timer);
  state.timer = null;
  await write(doc, state);
}

/** Try the failed write again. */
export function retrySave(doc) {
  const state = internals.get(doc);
  if (!state) return;
  doc.saved = false;
  schedule(doc, state);
  return flush(doc);
}

/** Take a note back from the tab that opened it since: read it again and hold it. */
export async function takeBack(doc) {
  const state = internals.get(doc);
  if (!state) return;
  doc.elsewhere = false;
  state.hold();
  await load(doc);
}

/** Text the server has just written (a task ticked from outside), shown without writing it again. */
export function adoptSaved(doc, text) {
  if (!internals.get(doc) || text === doc.text) return;
  doc.text = text;
  doc.revision += 1;
}

/**
 * The one change turning `was` into `now`, as CodeMirror takes it: the stretch
 * between what they share at the start and at the end. Null when equal.
 */
export function differing(was, now) {
  if (was === now) return null;
  let start = 0;
  const shortest = Math.min(was.length, now.length);
  while (start < shortest && was[start] === now[start]) start += 1;
  let end = 0;
  while (end < shortest - start && was[was.length - 1 - end] === now[now.length - 1 - end]) end += 1;
  return { from: start, to: was.length - end, insert: now.slice(start, now.length - end) };
}

/** The open copy of a note in this tab, if any. */
export function openCopy(caseId, noteId) {
  return open.get(noteKey(caseId, noteId)) ?? null;
}

/**
 * Add a block at the end of a note, open here or not: the way a capture or a
 * citation lands in a note nobody is typing in.
 */
export async function appendToNote(caseId, noteId, block) {
  const doc = openNote(caseId, noteId);
  try {
    await noteReady(doc);
    if (doc.error) throw new Error(doc.error);
    if (doc.elsewhere) throw new Error('This note is open in another tab');
    editNote(doc, appended(doc.text, block));
    doc.revision += 1;
    await flush(doc);
    if (doc.saveError) throw new Error(doc.saveError);
  } finally {
    await releaseNote(doc);
  }
}

// A tab closing runs no timer and no teardown, so what is still waiting goes now.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const doc of open.values()) {
      const waiting = internals.get(doc)?.waiting;
      if (waiting) api.put(noteEndpoint(doc.caseId, doc.noteId), { text: waiting.contents }, { keepalive: true }).catch(() => {});
    }
  });
}

/** For tests: forget every open note. */
export function resetOpenNotes() {
  for (const doc of open.values()) {
    const state = internals.get(doc);
    clearTimeout(state?.timer);
    state?.tabs.close();
  }
  open.clear();
}
