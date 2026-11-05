/**
 * A note's two editions: Internal, the note whole, and Public, without its internal
 * passages (`> [!internal]`, drawn by `engine/notes_pdf.py`).
 *
 * Which one a note prints in is remembered in this browser, note by note, and is
 * Internal the first time. The export dialog and the Page pane read and set the same
 * choice, so the pages seen are the pages written. A note with no internal passage
 * has nothing to choose: the server names its PDF by its day alone and records it
 * as public, whatever is asked.
 *
 * Every export is a file of its own that the note keeps a record of (`GET
 * notes/{id}/editions`): when, which edition, the file, its pages and fingerprints.
 * Check hashes the file again; Show opens its folder. Nothing is fetched.
 */
import { api } from '../api.js';

export const INTERNAL = 'internal';
export const PUBLIC = 'public';
export const EDITIONS = [INTERNAL, PUBLIC];

/** What Check says of a file, by the state the server answers. */
export const CHECK_SAID = {
  unchanged: 'Unchanged since it was written',
  changed: 'This file is not the one Azimut wrote',
  missing: 'File missing',
};

const KEY = 'azimut:note-editions';
/** How many notes' choices are kept, the oldest let go first. */
const KEPT = 500;

function load(storage) {
  try {
    const value = JSON.parse(storage?.getItem(KEY) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** Only Public is written down: a note with nothing kept is Internal. */
let chosen = $state(load(globalThis.localStorage));

const keyOf = (caseId, noteId) => `${caseId}/${noteId || 'case'}`;

/** The edition a note prints in: `public` when chosen so, `internal` otherwise. */
export function editionOf(caseId, noteId) {
  return chosen[keyOf(caseId, noteId)] === PUBLIC ? PUBLIC : INTERNAL;
}

/** Several notes printed together: Public when every one of them is set so. */
export function editionOfAll(caseId, noteIds) {
  return noteIds.length && noteIds.every((id) => editionOf(caseId, id) === PUBLIC) ? PUBLIC : INTERNAL;
}

/** Keep the edition `noteIds` print in, for this browser. */
export function keepEdition(caseId, noteIds, edition, storage = globalThis.localStorage) {
  const next = { ...chosen };
  for (const id of noteIds) {
    const key = keyOf(caseId, id);
    delete next[key];
    if (edition === PUBLIC) next[key] = PUBLIC;
  }
  const keys = Object.keys(next);
  for (const old of keys.slice(0, Math.max(0, keys.length - KEPT))) delete next[old];
  chosen = next;
  try {
    storage?.setItem(KEY, JSON.stringify(next));
  } catch { /* this browser keeps nothing; the choice holds for this visit */ }
}

/** For tests: read the kept choices again from `storage`. */
export function reloadEditions(storage = globalThis.localStorage) {
  chosen = load(storage);
}

const HEX = /^[0-9a-f]{64}$/;

/** An edition as the server lists it, or null when a part is not what an export writes. */
export function readEdition(item) {
  if (!item || typeof item.at !== 'string' || !EDITIONS.includes(item.edition)) return null;
  if (typeof item.file !== 'string' || !item.file || !Number.isInteger(item.pages)) return null;
  return {
    at: item.at,
    edition: item.edition,
    file: item.file,
    folder: String(item.folder ?? ''),
    pages: item.pages,
    pdf_sha256: HEX.test(item.pdf_sha256 ?? '') ? item.pdf_sha256 : '',
    text_sha256: HEX.test(item.text_sha256 ?? '') ? item.text_sha256 : '',
  };
}

/** The PDFs a note was exported as, newest first. */
export async function listEditions(caseId, noteId) {
  const answer = await api.get(`/api/cases/${caseId}/notes/${noteId || 'case'}/editions`);
  return (Array.isArray(answer?.editions) ? answer.editions : []).map(readEdition).filter(Boolean);
}

/** An edition as the server finds it in the note's record: never a path it opens. */
const refOf = (edition) => ({ at: edition.at, file: edition.file, folder: edition.folder });

/** Whether an edition's file is the one written: `unchanged`, `changed` or `missing`. */
export async function checkEdition(caseId, noteId, edition) {
  const answer = await api.post(`/api/cases/${caseId}/notes/${noteId || 'case'}/editions/check`, refOf(edition));
  return CHECK_SAID[answer?.state] ? answer.state : 'missing';
}

/** Open the folder an edition was written to. */
export function showEdition(caseId, noteId, edition) {
  return api.post(`/api/cases/${caseId}/notes/${noteId || 'case'}/editions/reveal`, refOf(edition));
}

/** `5 Nov 2026, 14:03`: when an edition was written, on this machine's clock. */
export function editionDay(at) {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return '';
  return when.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
