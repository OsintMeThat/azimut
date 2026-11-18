/**
 * The two files a note exports to: a PDF, or one HTML page that holds everything it
 * shows and reads offline (`engine/notes_html.py`).
 *
 * The export dialog and the Page pane each remember the last one picked, for this
 * browser, apart: a page read as HTML while writing does not decide what the next
 * export writes. PDF the first time, as before HTML existed.
 */

export const PDF = 'pdf';
export const HTML = 'html';
export const FORMATS = [PDF, HTML];

const KEYS = {
  export: 'azimut:note-export-format',
  page: 'azimut:note-page-format',
};

/** The format `where` (`export` or `page`) last used: `pdf` unless `html` was kept. */
export function readFormat(where, storage = globalThis.localStorage) {
  try {
    return storage?.getItem(KEYS[where]) === HTML ? HTML : PDF;
  } catch {
    return PDF;
  }
}

export function keepFormat(where, format, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEYS[where], format === HTML ? HTML : PDF);
  } catch { /* this browser keeps nothing; the choice holds for this visit */ }
}

/** `12.4 MB`, `640 KB`: what a file weighs, as the export dialog says it. */
export function weightWords(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}

/** The weight an HTML export aims under (`engine/notes_html.py`), which the dialog warns past. */
export const HTML_BUDGET = 25 * 1024 * 1024;
