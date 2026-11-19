/**
 * What a note's PDF warns about, the same list in two places: under the Page
 * pane's bar as the note is typed (`preview.js` reads it from the page's headers),
 * and in the export dialog before anything is written (`checkNotes`).
 *
 * Each warning has its words, the 0-based line of the note it is about or null,
 * and a kind. The server renders the notes in memory for the check and writes
 * nothing (`POST notes/pdf/check`), in the edition asked for. The check also counts
 * each note's internal passages, and for the public edition says how many it leaves
 * out, as a warning of the kind `internal` that is no fault (`isLeftOut`).
 *
 * While the sources are listed, the outside links are counted too: those with no
 * archived copy (`unarchived`) and those the case holds nothing of, so no day says
 * when they were read (`unseen`). Each is one line however many links it counts; the
 * check sends the links behind it as `items`, each its words, its address and its line,
 * which the dialog folds under the line (`linksSummary`). The Page pane says the line.
 * A style that checks each link (a report's, `engine/notelook.py`) sends one warning per
 * link instead, each with its own line and no `items`.
 */
import { api } from '../api.js';

/** What a warning is about (`engine/notes_pdf.py`); anything else reads as `other`. */
export const WARNING_KINDS = [
  'missing', 'unsourced', 'open-task', 'local-link', 'empty-section', 'setting', 'other', 'internal', 'count', 'address',
  'unarchived', 'unseen',
];

/** How many links a folded list names before it counts the rest. */
export const LINKS_NAMED = 3;

/** The internal passages a public edition leaves out: said, but nothing to fix. */
export function isLeftOut(warning) {
  return warning?.kind === 'internal';
}

/** A web folder given no address: said beside the address field, not among the faults. */
export function isNoAddress(warning) {
  return warning?.kind === 'address';
}

export function warningKind(value) {
  return WARNING_KINDS.includes(value) ? value : 'other';
}

function readLine(line) {
  return Number.isInteger(line) && line >= 0 ? line : null;
}

/** One link a grouped warning counts: its words (its address when it has none), its address, its line. */
function readLinked(item) {
  const url = typeof item?.url === 'string' ? item.url : '';
  const text = String(item?.text ?? '').trim() || url;
  return text ? { text, url, line: readLine(item?.line) } : null;
}

/**
 * A warning as the server gave it: its words, its line or null, its kind, and for a
 * line that counts links, those links as `items` (left out when it lists none).
 */
export function readWarning(item) {
  const warning = { text: String(item?.text ?? ''), line: readLine(item?.line), kind: warningKind(item?.kind) };
  const items = Array.isArray(item?.items) ? item.items.map(readLinked).filter(Boolean) : [];
  return items.length ? { ...warning, items } : warning;
}

/** `example.org` for a link's address, as the list names where each one goes. */
export function linkHost(url) {
  try {
    const name = new URL(url).hostname.toLowerCase();
    return name.startsWith('www.') ? name.slice(4) : name;
  } catch {
    return '';
  }
}

/** What a folded list of links says: the first few by their words, then how many more. */
export function linksSummary(items, named = LINKS_NAMED) {
  const list = Array.isArray(items) ? items : [];
  const shown = list.slice(0, named).map((item) => `“${item.text}”`).join(' · ');
  const rest = list.length - Math.min(list.length, named);
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

/**
 * The notes of a check that have something to say, in the order asked, each with
 * its title (the case notes' own when the server gives none) and its warnings.
 */
export function readCheck(answer) {
  const notes = Array.isArray(answer?.notes) ? answer.notes : [];
  return notes
    .filter((item) => item && typeof item.note === 'string')
    .map((item) => ({
      note: item.note,
      title: String(item.title || (item.note === 'case' ? 'Case notes' : 'Untitled note')),
      warnings: (Array.isArray(item.warnings) ? item.warnings : []).map(readWarning).filter((warning) => warning.text),
    }))
    .filter((item) => item.warnings.length);
}

/** How many internal passages the checked notes hold between them, chapters included. */
export function internalCount(answer) {
  const notes = Array.isArray(answer?.notes) ? answer.notes : [];
  return notes.reduce((sum, item) => sum + (Number.isInteger(item?.internal) && item.internal > 0 ? item.internal : 0), 0);
}

/** A line an HTML check lists (a clip turned into a link, a point of view), with its note and line. */
function listed(item, note, title) {
  const text = String(item?.text ?? '').trim();
  if (!text) return null;
  const line = item?.line;
  return { note, title, text, line: Number.isInteger(line) && line >= 0 ? line : null };
}

/**
 * What an HTML check says beside the warnings, over every note asked: `weight`, the
 * bytes the files would weigh together; `links`, the clips that go out as a poster and
 * a Watch link rather than inside the file; `pov`, the points where a filmer stood,
 * which a public file keeps unless they are rounded; `earlier`, how many public
 * editions came before, which is when the dialog asks what changed.
 */
export function readHtmlCheck(answer) {
  const notes = (Array.isArray(answer?.notes) ? answer.notes : []).filter((item) => item && typeof item.note === 'string');
  const titled = (item) => String(item.title || (item.note === 'case' ? 'Case notes' : 'Untitled note'));
  const lists = (key) => notes.flatMap((item) => (Array.isArray(item[key]) ? item[key] : [])
    .map((entry) => listed(entry, item.note, titled(item))).filter(Boolean));
  const count = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
  return {
    weight: notes.reduce((sum, item) => sum + count(item.weight), 0),
    links: lists('links'),
    pov: lists('pov'),
    earlier: notes.reduce((most, item) => Math.max(most, count(item.earlier)), 0),
    // a web folder's maps go live over OpenFreeMap once online, which the dialog says
    live: notes.some((item) => item.live === true),
  };
}

/**
 * Ask what the files of these notes would warn about, from the notes as saved, in
 * `edition`: `{ found, internal }`, the notes with something to say and the
 * internal passages they hold. With `format: 'html'` the server checks the HTML
 * pages instead, and the answer holds what `readHtmlCheck` reads too; with
 * `format: 'web'` the web folders, in the public edition, which also say when they
 * have no address and whether their maps go live online (`live`).
 */
export async function checkNotes(caseId, noteIds, { signal, edition = 'internal', format = 'pdf' } = {}) {
  const html = format === 'html' || format === 'web';
  const body = html ? { notes: noteIds, edition: format === 'web' ? 'public' : edition, format } : { notes: noteIds, edition };
  const answer = await api.post(`/api/cases/${caseId}/notes/pdf/check`, body, { signal });
  return { found: readCheck(answer), internal: internalCount(answer), ...(html ? readHtmlCheck(answer) : {}) };
}
