/**
 * What a note exports to: a PDF; one HTML page that holds everything it shows and
 * reads offline (`engine/notes_html.py`); a web folder ready to put online, with the
 * picture card a link to it shows on X (`engine/notes_web.py`); or a WordPress draft.
 * The Page pane draws the first two.
 *
 * The export dialog and the Page pane each remember the last one picked, for this
 * browser, apart: a page read as HTML while writing does not decide what the next
 * export writes. PDF the first time, as before HTML existed.
 */

export const PDF = 'pdf';
export const HTML = 'html';
export const WEB = 'web';
export const WORDPRESS = 'wordpress';
/** What the export dialog offers, in its order, and what the Page pane draws. */
export const FORMATS = [PDF, HTML, WEB, WORDPRESS];
export const PAGE_FORMATS = [PDF, HTML];
/** What goes out in the public edition only: a page put online. */
export const PUBLIC_ONLY = [WEB, WORDPRESS];
/** How the export dialog names each, and the Page pane, where there are two. */
export const FORMAT_LABELS = { [PDF]: 'PDF', [HTML]: 'HTML page', [WEB]: 'Web folder', [WORDPRESS]: 'WordPress draft' };
export const PAGE_LABELS = { [PDF]: 'PDF', [HTML]: 'HTML' };

const KEYS = {
  export: 'azimut:note-export-format',
  page: 'azimut:note-page-format',
};
const OFFERED = { export: FORMATS, page: PAGE_FORMATS };

/** The format `where` (`export` or `page`) last used: `pdf` unless another it offers was kept. */
export function readFormat(where, storage = globalThis.localStorage) {
  try {
    const kept = storage?.getItem(KEYS[where]);
    return (OFFERED[where] ?? PAGE_FORMATS).includes(kept) ? kept : PDF;
  } catch {
    return PDF;
  }
}

export function keepFormat(where, format, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEYS[where], (OFFERED[where] ?? PAGE_FORMATS).includes(format) ? format : PDF);
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
