/**
 * Whether a note is shown as the PDF it prints to, remembered for the browser by
 * where it is shown: the Notebook draws the pages beside the note, the note on the
 * side and the extension's panel in place of it, having no room for both.
 */
const KEYS = {
  notebook: 'azimut:notebook-page',
  dock: 'azimut:noteDock-page',
  panel: 'azimut:notePanel-page',
};

/** Whether `where` (`notebook`, `dock` or `panel`) last showed the pages. */
export function readPageView(where, storage = globalThis.localStorage) {
  try {
    return storage?.getItem(KEYS[where]) === '1';
  } catch {
    return false;
  }
}

export function keepPageView(where, on, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEYS[where], on ? '1' : '0');
  } catch { /* this browser keeps nothing; the choice holds for this visit */ }
}
