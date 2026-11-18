/**
 * The address a note's web folder will live at, typed in the export dialog.
 *
 * It is kept note by note in this browser, as the edition a note prints in is
 * (`editions.svelte.js`), and the note's record of editions keeps the one each web
 * folder was made for, which the dialog falls back on. The server checks it again at
 * its edge (`engine/notes_web.py`, `address`); this says what is wrong while it is typed.
 */

const KEY = 'azimut:note-web-address';
/** How many notes' addresses are kept, the oldest let go first. */
const KEPT = 500;
/** The longest address a folder may be given, as the server bounds it. */
export const MAX_ADDRESS = 300;

const keyOf = (caseId, noteId) => `${caseId}/${noteId || 'case'}`;

function load(storage) {
  try {
    const value = JSON.parse(storage?.getItem(KEY) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/** The address kept for a note, or ''. */
export function readAddress(caseId, noteId, storage = globalThis.localStorage) {
  const value = load(storage)[keyOf(caseId, noteId)];
  return typeof value === 'string' ? value : '';
}

/** Keep the address typed for a note, or forget it when the field is emptied. */
export function keepAddress(caseId, noteId, value, storage = globalThis.localStorage) {
  const kept = load(storage);
  const key = keyOf(caseId, noteId);
  delete kept[key];
  const typed = String(value ?? '').trim();
  if (typed) kept[key] = typed;
  const keys = Object.keys(kept);
  for (const old of keys.slice(0, Math.max(0, keys.length - KEPT))) delete kept[old];
  try {
    storage?.setItem(KEY, JSON.stringify(kept));
  } catch { /* this browser keeps nothing; the address holds for this visit */ }
}

/**
 * What is wrong with a typed address, in the words the server would answer, or '' when
 * it will do (an empty field will too: the folder works without one).
 */
export function addressProblem(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (text.length > MAX_ADDRESS) return `The address is longer than ${MAX_ADDRESS} characters.`;
  if (/[\s"'<>\\`^{|}]/.test(text) || [...text].some((char) => char.charCodeAt(0) < 32)) return 'The address holds a character an address cannot.';
  let url;
  try {
    url = new URL(text);
  } catch {
    return 'That is not an address.';
  }
  if (url.protocol !== 'https:') return 'The address must start with https://.';
  if (url.username || url.password || text.slice(8).split('/')[0].includes('@')) return 'The address must not hold a name or a password.';
  const host = url.hostname.replace(/\.$/, '');
  if (!host.includes('.') || host.startsWith('.') || host.includes('..')) return 'The address needs a site name, such as your-name.github.io.';
  if (text.includes('?') || text.includes('#')) return 'The address must not hold ? or #.';
  return '';
}
