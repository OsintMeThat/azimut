/**
 * A table's settings line: how it shows in the report, written in braces right under
 * its last row, as a picture's braces are (`{width=50% caption="…"}`):
 *
 *     | # | Identification | Grade |
 *     | --- | --- | --- |
 *     | 1 | Streit Cougar | confirmed |
 *     {search=always fold=20 stripes colour="Grade"}
 *
 * The engine reads the same line (`engine/notes_tables.py`, whose docstring lists the
 * keys); `fixtures/table-looks.json` holds both to one reading. A line counts only when
 * it is braces alone and names a key this knows, so a table whose last row is `{x}`
 * keeps that row. Each key is written only when it is not its default, and a table
 * with nothing set has no line: it reads as every table did before.
 */

export const SEARCHES = ['auto', 'always', 'never'];
export const DENSITIES = ['comfortable', 'compact'];
/** The folds the settings card offers; a line may write any up to `MAX_FOLD`. */
export const FOLDS = [0, 10, 20, 50];
export const MAX_FOLD = 500;
/** What one quoted value may run to, as a picture's caption. */
export const MAX_TEXT = 300;

export const DEFAULT_LOOK = Object.freeze({
  search: 'auto', sort: true, fold: 0, stickyHeader: true, stickyColumn: false,
  // null leaves it to the style: a styled PDF stripes its tables, the web page does not
  stripes: null, colour: '', density: 'comfortable', caption: '', source: '', rest: '',
});

const LINE = /^[ \t]*\{([^{}\n]*)\}[ \t\r]*$/;
const TOKEN = /[ \t]*([A-Za-z][A-Za-z0-9_-]*)(?:[ \t]*=[ \t]*(?:"([^"}\n]*)"|([^\s"{}|]+)))?[ \t]*/y;
const KEYS = {
  search: 'search', sort: 'sort', fold: 'fold', header: 'stickyHeader', 'first-column': 'stickyColumn',
  stripes: 'stripes', colour: 'colour', color: 'colour', density: 'density', caption: 'caption', source: 'source',
};
const ON = ['on', 'yes', 'true'];
const OFF = ['off', 'no', 'false'];

/** A caption, a source or a column's name as the braces can hold it: one line, no quote, brace or pipe. */
export function cleanLookText(text) {
  return String(text ?? '').replace(/["{}|]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT).trim();
}

function flag(value) {
  if (value === undefined) return true;
  const folded = value.toLowerCase();
  return ON.includes(folded) ? true : OFF.includes(folded) ? false : null;
}

function readValue(key, value) {
  const folded = (value ?? '').toLowerCase();
  if (key === 'search') return SEARCHES.includes(folded) ? folded : null;
  if (key === 'sort' || key === 'stripes') return flag(value);
  if (key === 'fold') {
    if (OFF.includes(folded)) return 0;
    return /^\d+$/.test(folded) && Number(folded) > 0 && Number(folded) <= MAX_FOLD ? Number(folded) : null;
  }
  if (key === 'header' || key === 'first-column') {
    if (value === undefined) return true;
    return ['sticky', ...ON].includes(folded) ? true : ['scrolls', ...OFF].includes(folded) ? false : null;
  }
  if (key === 'density') return DENSITIES.includes(folded) ? folded : null;
  return cleanLookText(value) || null;
}

/** The settings `line` writes, `{ ...DEFAULT_LOOK, … }`, or null when it is no settings line. */
export function readLook(line) {
  const match = LINE.exec(String(line ?? ''));
  if (!match) return null;
  const body = match[1];
  const look = { ...DEFAULT_LOOK };
  const rest = [];
  let known = false;
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < body.length) {
    const at = TOKEN.lastIndex;
    const token = TOKEN.exec(body);
    if (!token || TOKEN.lastIndex === at) {
      if (body.slice(at).trim()) return null;
      break;
    }
    const key = token[1].toLowerCase();
    if (!(key in KEYS)) {
      rest.push(token[0].trim());
      continue;
    }
    known = true;
    const value = readValue(key === 'color' ? 'colour' : key, token[2] ?? token[3]);
    if (value !== null) look[KEYS[key]] = value;
  }
  if (!known) return null;
  look.rest = rest.join(' ');
  return look;
}

/** The line `look` is written as, each key only when it is not its default; '' when nothing is set. */
export function writeLook(look) {
  const set = { ...DEFAULT_LOOK, ...look };
  const parts = [];
  if (set.search !== DEFAULT_LOOK.search) parts.push(`search=${set.search}`);
  if (!set.sort) parts.push('sort=off');
  if (set.fold) parts.push(`fold=${set.fold}`);
  if (!set.stickyHeader) parts.push('header=scrolls');
  if (set.stickyColumn) parts.push('first-column=sticky');
  if (set.stripes !== null) parts.push(set.stripes ? 'stripes' : 'stripes=off');
  if (cleanLookText(set.colour)) parts.push(`colour="${cleanLookText(set.colour)}"`);
  if (set.density !== DEFAULT_LOOK.density) parts.push(`density=${set.density}`);
  if (cleanLookText(set.caption)) parts.push(`caption="${cleanLookText(set.caption)}"`);
  if (cleanLookText(set.source)) parts.push(`source="${cleanLookText(set.source)}"`);
  if (!parts.length) return '';
  if (set.rest) parts.push(set.rest);
  return `{${parts.join(' ')}}`;
}

/**
 * `text` without the settings lines standing right under a table's row, for a reader
 * that draws a table its own way (the Markdown shown as HTML): to it the line is a row.
 */
export function withoutLookLines(text) {
  const lines = String(text ?? '').split('\n');
  if (!lines.some((line) => line.includes('{'))) return String(text ?? '');
  const quote = /^[ \t]*(?:>[ \t]?)*/;
  return lines.filter((line, index) => !(index > 0 && lines[index - 1].includes('|') && readLook(line.replace(quote, '')))).join('\n');
}
