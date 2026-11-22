/**
 * Footnotes, as a note writes them: Pandoc's inline `^[words]`, a comment the reader opens
 * from a small letter, a, b… in reading order. The documents a note makes read them in
 * `engine/notes_markdown.py`; this is the Notebook's reading, which draws each as a chip
 * with its letter and writes what the Footnote field says.
 *
 * Both readings are held to `tests/fixtures/footnotes.json`: brackets balance, a backslash
 * escapes, code is skipped, and one never closed or holding nothing stays text.
 */

/** A line that opens or closes fenced code, where nothing is a footnote. */
const FENCE = /^\s*(```|~~~)/;

/** How many backticks run from `at`. */
function backticks(line, at) {
  let end = at;
  while (line[end] === '`') end += 1;
  return end - at;
}

/** Where the code span opening at `at` ends: after the next run exactly as long, or -1 when none closes it. */
function codeEnd(line, at) {
  const run = backticks(line, at);
  let search = at + run;
  for (let close = line.indexOf('`', search); close >= 0; close = line.indexOf('`', search)) {
    const length = backticks(line, close);
    if (length === run) return close + run;
    search = close + length;
  }
  return -1;
}

/**
 * Each footnote written on a line, `{ from, to, words }`, `from`–`to` its whole `^[…]`
 * shifted by `offset`, `words` what its brackets hold as written.
 */
export function findFootnotes(text, offset = 0) {
  const line = String(text ?? '');
  const found = [];
  if (!line.includes('^[')) return found;
  let at = 0;
  let opened = -1;
  let depth = 0;
  for (;;) {
    if (at >= line.length) {
      if (opened < 0) return found;
      // one never closed is text: read on from just after its `^`
      at = opened + 1;
      opened = -1;
      continue;
    }
    const char = line[at];
    if (char === '\\') at += 2;
    else if (char === '`') {
      const end = codeEnd(line, at);
      at = end > 0 ? end : at + backticks(line, at);
    } else if (opened < 0 && line.startsWith('^[', at)) {
      opened = at;
      depth = 1;
      at += 2;
    } else if (opened >= 0 && char === '[') {
      depth += 1;
      at += 1;
    } else if (opened >= 0 && char === ']' && depth === 1) {
      const words = line.slice(opened + 2, at);
      if (words.trim()) {
        found.push({ from: offset + opened, to: offset + at + 1, words });
        at += 1;
      } else {
        // `^[]` holds nothing, so it is no footnote
        at = opened + 1;
      }
      opened = -1;
    } else {
      if (opened >= 0 && char === ']') depth -= 1;
      at += 1;
    }
  }
}

/** Every footnote of a note in reading order, fenced code left out: the order their letters run in. */
export function footnotesOf(doc) {
  const found = [];
  let fenced = false;
  let from = 0;
  for (const line of String(doc ?? '').split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    else if (!fenced) found.push(...findFootnotes(line, from));
    from += line.length + 1;
  }
  return found;
}

/** The letter of footnote `index` (from 0) in reading order: a to z, then aa, ab…, as every document letters them. */
export function footnoteLetter(index) {
  let rest = index + 1;
  let letters = '';
  while (rest > 0) {
    const digit = (rest - 1) % 26;
    letters = String.fromCharCode(97 + digit) + letters;
    rest = Math.floor((rest - 1) / 26);
  }
  return letters;
}

/** A footnote's words as a reader sees them: chips and links by their words, no marks. */
export function footnoteText(words) {
  return String(words ?? '')
    .replace(/\[\[(?:entity|media):[A-Za-z0-9_-]+\|([^\]\n]+)\]\](?:\{[^}\n]*\})?/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|\*|`)/g, '')
    .replace(/\\([[\]\\^*_`~])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `words` as a footnote: `^[words]` on one line, a bracket that would end it early escaped. */
export function footnoteMarkdown(words) {
  const said = String(words ?? '').replace(/\s*\n\s*/g, ' ').trim();
  const written = `^[${said}]`;
  const [one] = findFootnotes(written);
  if (one && one.from === 0 && one.to === written.length) return written;
  return `^[${said.replace(/(?<!\\)([[\]])/g, '\\$1')}]`;
}
