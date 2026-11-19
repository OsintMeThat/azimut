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
 * notes/{id}/editions`): when, which edition, PDF or HTML, the file, its pages and
 * fingerprints.
 * Check hashes the file again; Show opens its folder. Nothing is fetched. A note sent
 * to WordPress is recorded too, as its draft (`readDraft`): the site, the post and its
 * edit link, one line per draft however often it was sent again. A note published to
 * GitHub Pages is recorded once per publish (`readPublished`): its address, the
 * repository and the commit; Check reads the page back from the repository, on its
 * press, and the page is opened at its address.
 *
 * A public edition also keeps the text it printed (`kept`), which What changed compares
 * (`editionCompare.js`); the line it drafts waits here for the note's next export.
 */
import { webLink } from '../wordpressSetup.js';
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

/** What Check says of a page published to GitHub Pages, read back from its repository. */
export const CHECK_SAID_PAGE = {
  unchanged: 'Unchanged since it was published',
  changed: 'The page on GitHub is not the one Azimut published',
  missing: 'Page missing from the repository',
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
  corrections = loadCorrections(storage);
}

/*
 * The What changed line drafted in the Editions dialog (Write the correction from this),
 * kept per note in this browser until the next public export of that note sends it. The
 * export dialog starts from it; it reaches a page only through that dialog's field, after
 * the analyst has read and changed it there or not.
 */
const CORRECTIONS = 'azimut:note-corrections';
/** The longest line, as the server keeps it (`api/notes.py` MAX_CHANGES). */
export const MAX_CORRECTION = 300;

function loadCorrections(storage) {
  try {
    const value = JSON.parse(storage?.getItem(CORRECTIONS) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

let corrections = $state(loadCorrections(globalThis.localStorage));

/** The line drafted for a note's next public export, or ''. */
export function correctionFor(caseId, noteId) {
  const line = corrections[keyOf(caseId, noteId)];
  return typeof line === 'string' ? line.slice(0, MAX_CORRECTION) : '';
}

/** Keep `line` for a note's next public export; an empty line lets it go. */
export function keepCorrection(caseId, noteId, line, storage = globalThis.localStorage) {
  const next = { ...corrections };
  const key = keyOf(caseId, noteId);
  delete next[key];
  const said = String(line ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_CORRECTION);
  if (said) next[key] = said;
  const keys = Object.keys(next);
  for (const old of keys.slice(0, Math.max(0, keys.length - KEPT))) delete next[old];
  corrections = next;
  try {
    storage?.setItem(CORRECTIONS, JSON.stringify(next));
  } catch { /* this browser keeps nothing; the line holds for this visit */ }
}

const HEX = /^[0-9a-f]{64}$/;

/**
 * An edition as the server lists it, or null when a part is not what an export writes.
 * `format` is `pdf`, `html` or `web`; an HTML page or a web folder has no pages to
 * count, its fingerprint (a web folder's page's) is read under either name the record
 * gives it, and a web folder keeps the `address` it was made for.
 */
export function readEdition(item) {
  if (!item || typeof item.at !== 'string' || !EDITIONS.includes(item.edition)) return null;
  const format = item.format === 'html' || item.format === 'web' ? item.format : 'pdf';
  if (typeof item.file !== 'string' || !item.file) return null;
  if (!Number.isInteger(item.pages) && format === 'pdf') return null;
  const sha = [item.sha256, item.pdf_sha256].find((value) => HEX.test(value ?? '')) ?? '';
  return {
    at: item.at,
    edition: item.edition,
    format,
    file: item.file,
    folder: String(item.folder ?? ''),
    pages: Number.isInteger(item.pages) ? item.pages : 0,
    pdf_sha256: sha,
    text_sha256: HEX.test(item.text_sha256 ?? '') ? item.text_sha256 : '',
    ...(format === 'web' ? { address: typeof item.address === 'string' && item.address.startsWith('https://') ? item.address : '' } : {}),
  };
}

/** The files a note was exported as, PDF, HTML and web folders, newest first. */
export async function listEditions(caseId, noteId) {
  return (await readEditions(caseId, noteId)).editions;
}

/**
 * A note's editions, newest first, and `kept`: the SHA-256 of each public text kept for
 * What changed (`engine/noteeditions.py`), newest first.
 */
export async function readEditions(caseId, noteId) {
  const answer = await api.get(`/api/cases/${caseId}/notes/${noteId || 'case'}/editions`);
  return {
    editions: (Array.isArray(answer?.editions) ? answer.editions : []).map(readListed).filter(Boolean),
    kept: (Array.isArray(answer?.kept) ? answer.kept : []).filter((sha) => HEX.test(sha ?? '')),
  };
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

/** An edition as the server lists it: a file's (`readEdition`), a WordPress draft's or a published page's. */
export function readListed(item) {
  if (item?.format === 'wordpress') return readDraft(item);
  if (item?.format === 'github') return readPublished(item);
  return readEdition(item);
}

/**
 * A page published to GitHub Pages as the record keeps it, or null: `format: 'github'`,
 * its short name as `file`, its https address, the repository, the commit and the
 * page's SHA-256. Show opens the address; Check asks the repository.
 */
export function readPublished(item) {
  if (!item || typeof item.at !== 'string' || item.edition !== PUBLIC) return null;
  const address = webLink(item.address);
  const commit = /^[0-9a-f]{40}$/.test(item.commit ?? '') ? item.commit : '';
  const repository = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/.test(item.repository ?? '') ? item.repository : '';
  if (!address.startsWith('https://') || !commit || !repository || typeof item.file !== 'string' || !item.file) return null;
  return {
    at: item.at,
    edition: PUBLIC,
    format: 'github',
    file: item.file,
    folder: '',
    pages: 0,
    pdf_sha256: HEX.test(item.sha256 ?? '') ? item.sha256 : '',
    text_sha256: HEX.test(item.text_sha256 ?? '') ? item.text_sha256 : '',
    address,
    repository,
    commit,
  };
}

/**
 * A WordPress draft as the record keeps it, or null: `format: 'wordpress'`, no file, its
 * site, post and two links, each kept only when it is a web address.
 */
export function readDraft(item) {
  if (!item || typeof item.at !== 'string' || item.edition !== PUBLIC) return null;
  const site = webLink(item.site) ? String(item.site) : '';
  const edit = webLink(item.edit);
  if (!site || !edit || !Number.isInteger(item.post) || item.post <= 0) return null;
  return {
    at: item.at,
    edition: PUBLIC,
    format: 'wordpress',
    file: '',
    folder: '',
    pages: 0,
    pdf_sha256: '',
    text_sha256: HEX.test(item.text_sha256 ?? '') ? item.text_sha256 : '',
    site,
    post: item.post,
    edit,
    preview: webLink(item.preview),
  };
}
