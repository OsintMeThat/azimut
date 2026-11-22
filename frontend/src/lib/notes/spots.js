/**
 * A double-click on the Page pane's preview takes the note there, as a TeX viewer takes
 * its source there: the PDF says where each block of the text starts on its page and
 * which line of the note it comes from (`X-Note-Spots`, `engine/notes_pdf.py`), and the
 * HTML page writes that line on each element (`data-line`, `engine/notes_html.py`).
 * The word double-clicked puts the cursor on it in that paragraph (`editor/writing.js`).
 */

/** The spots a PDF preview's header lists, flat (page, top in thousandths, line), as `{ page, top, line }`. */
export function readSpots(flat) {
  const spots = [];
  const values = Array.isArray(flat) ? flat : [];
  for (let at = 0; at + 2 < values.length; at += 3) {
    const [page, top, line] = values.slice(at, at + 3).map(Number);
    if ([page, top, line].every(Number.isInteger) && page >= 0 && line >= 0) spots.push({ page, top: top / 1000, line });
  }
  return spots;
}

/**
 * The line of the note a point of page `page` (0-based) comes from, `top` its height down
 * the page as a fraction: the last block that starts above it on that page, else the
 * block running on from an earlier page, else the line the page starts at (`pages`).
 */
export function spotLine(spots, pages, page, top) {
  let found = null;
  for (const spot of spots ?? []) {
    if (spot.page > page || (spot.page === page && spot.top > top + 0.004)) break;
    found = spot;
  }
  return found ? found.line : pages?.[page] ?? 0;
}

const WORD = /[\p{L}\p{N}'’-]/u;

/** The word around character `at` of `text`, or "" for none worth looking for. */
export function wordAt(text, at) {
  const words = String(text ?? '');
  let from = Math.max(0, Math.min(words.length - 1, Math.floor(at)));
  if (!WORD.test(words[from] ?? '')) return '';
  let to = from;
  while (from > 0 && WORD.test(words[from - 1])) from -= 1;
  while (to < words.length && WORD.test(words[to])) to += 1;
  const word = words.slice(from, to).replace(/^['’-]+|['’-]+$/g, '');
  return word.length > 1 ? word : '';
}

/**
 * The word under point (`x`, `y`), in PDF units with y up, of a page whose text PDF.js
 * read (`items`, each with its `str`, `transform` and `width`): the run under the point,
 * its letters taken as evenly wide.
 */
export function wordUnder(items, x, y) {
  for (const item of items ?? []) {
    const text = String(item?.str ?? '');
    const [, , , d = 0, e = 0, f = 0] = item?.transform ?? [];
    const width = Number(item?.width) || 0;
    const height = Math.abs(Number(item?.height) || Number(d) || 0);
    if (!text.trim() || !width || !height) continue;
    if (x < e || x > e + width || y < f - height * 0.3 || y > f + height) continue;
    return wordAt(text, ((x - e) / width) * text.length);
  }
  return '';
}
