/**
 * A web map: a note whose whole page is one map, laid out as a map page (`look.web = "map"`,
 * `engine/notes_html.py`), published with the note's own Export › Web folder or Publish to
 * GitHub Pages. Made in one press from Notebook › New › Web map or from a row of My layers:
 * the map is put as any map is (`mapPut.js`), framed on its layers and its ground filed once,
 * and the note opens on it, its map settings card for the rest.
 */
import { createNote } from '../notes.js';
import { reloadCase } from '../state.svelte.js';
import { mapRequest, putMap } from './mapPut.js';
import { hintLine, writeLook } from './look.js';

/** How a web map prints: a Web article laid out as a map page. */
export const WEB_MAP_LOOK = Object.freeze({ style: 'article', web: 'map' });

/** What a new web map's note says before its map: where its subtitle and its words go. */
export const WEB_MAP_HINT = 'The first line under the title says what the map shows. Words after the map go in the panel beside it.';

/** A web map's note: the hint, a line for its subtitle, then its map. */
export function webMapBody(block) {
  return `${hintLine(WEB_MAP_HINT)}\n\n${String(block ?? '').trim()}\n`;
}

/** Whether a note row is a web map. */
export const isWebMap = (row) => row?.look?.web === 'map';

/**
 * Make a web map of `layers` (their names), `title` its name: the map put (its ground filed),
 * the note made with it and its look set. Answers the note; nothing is made when the map cannot be.
 */
export async function makeWebMap(caseId, { title, layers = [], folder = '' }, deps = {}) {
  const { put = putMap, create = createNote, look = writeLook, reload = reloadCase, signal } = deps;
  const { text } = await put(caseId, mapRequest({ title, layers }), { signal });
  if (!text) throw new Error('The map could not be made');
  const note = await create(caseId, { title, folder, content: webMapBody(text) });
  await look(caseId, note.id, WEB_MAP_LOOK);
  await reload();
  return note;
}
