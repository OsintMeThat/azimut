/**
 * A table in a note as a grid of cells: read from its pipes the way every
 * renderer of the note reads it, and written back changing only the lines a
 * gesture touches. The grid editor and the charts stand on it; nothing here
 * touches the editor.
 *
 * Reading follows `engine/notes_markdown.py` (markdown-it's GFM table, after
 * `case_references`), which the PDF, the HTML report and WordPress share:
 * - a row is split at every `|` except an escaped one (the character before it is
 *   a backslash) and the ones the renderers rewrite away before they split: the
 *   pipe of a chip (`[[entity:id|label]]`, `[[media:id|label]]`) and the pipes in
 *   a picture's braces (`{caption="a|b"}`). A pipe inside a code span splits too;
 * - a row with fewer cells than the header is padded with empty ones; cells past
 *   the header's count are never shown;
 * - a table ends at a blank line or a line that opens another block (a list, a
 *   heading, a quote, a fence, a rule, an HTML block, a `:::` line), so a line of
 *   prose written right under a table is one of its rows.
 *
 * A cell's text is its Markdown with the escaping backslash of each pipe taken
 * off (`a|b`, not `a\|b`), which is what the analyst types. Writing escapes the
 * pipes again, never a chip's. A new line typed in a cell becomes a space: a
 * `<br>` would print as the four characters in the PDF and the HTML report.
 *
 * Tables are values: every change returns a new table, the whole new text and the
 * line changes that turn the old text into it (`{ from, to, insert }`, offsets in
 * the table's own text), for the editor to dispatch as one transaction.
 */

import { readLook } from './tableLook.js';

// ── What the renderers rewrite before they split a row ─────────────────────────
// The same patterns as `engine/notetext.py` and `lib/markdown.js`.
const ENTITY_REF = /\[\[entity:([A-Za-z0-9_-]+)\|([^\]]+)\]\]/g;
const MEDIA_REF = /\[\[media:([A-Za-z0-9_-]+)\|([^\]]+)\]\](?:\{([^}\n]+)\})?/g;
const IMAGE_ATTRS = /!\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)\s*\{([^}\n]+)\}/g;

/** The most rows a pasted or imported table keeps; a line under it names the cut. */
export const MAX_ROWS = 500;

function pipesIn(text, from, to, into) {
  for (let index = text.indexOf('|', from); index !== -1 && index < to; index = text.indexOf('|', index + 1)) into.add(index);
}

/** Where the pipes are that a renderer turns into something else before it splits the row. */
function hiddenPipes(text) {
  const hidden = new Set();
  if (!text.includes('[[') && !text.includes('{')) return hidden;
  for (const match of text.matchAll(IMAGE_ATTRS)) {
    const end = match.index + match[0].length;
    pipesIn(text, end - match[4].length - 1, end, hidden);
  }
  for (const match of text.matchAll(ENTITY_REF)) hidden.add(match.index + 9 + match[1].length);
  for (const match of text.matchAll(MEDIA_REF)) {
    hidden.add(match.index + 8 + match[1].length);
    if (match[3] !== undefined) {
      const end = match.index + match[0].length;
      pipesIn(text, end - match[3].length - 1, end, hidden);
    }
  }
  return hidden;
}

/**
 * A cell's text as written between its pipes, turned into the text the analyst
 * edits: the backslash before each escaped pipe comes off.
 */
export function unescapeCell(raw) {
  const text = String(raw ?? '');
  if (!text.includes('\\|')) return text;
  const hidden = hiddenPipes(text);
  let out = '';
  let last = 0;
  for (let index = text.indexOf('|'); index !== -1; index = text.indexOf('|', index + 1)) {
    if (index > 0 && text[index - 1] === '\\' && !hidden.has(index)) {
      out += text.slice(last, index - 1);
      last = index;
    }
  }
  return out + text.slice(last);
}

/**
 * A cell's text as it is written between pipes: each `|` gets a backslash, except
 * a chip's own pipe, the pipes in a picture's braces, and a pipe the analyst
 * already escaped (an odd run of backslashes before it), which every reader takes
 * as escaped already.
 */
export function escapeCell(text) {
  const value = String(text ?? '');
  if (!value.includes('|')) return value;
  const hidden = hiddenPipes(value);
  let out = '';
  let last = 0;
  for (let index = value.indexOf('|'); index !== -1; index = value.indexOf('|', index + 1)) {
    if (hidden.has(index)) continue;
    let slashes = 0;
    while (index - slashes - 1 >= 0 && value[index - slashes - 1] === '\\') slashes += 1;
    if (slashes % 2 === 1) continue;
    out += `${value.slice(last, index)}\\`;
    last = index;
  }
  return out + value.slice(last);
}

/** What a typed cell holds: one line (a new line is a space), without the spaces around it. */
export function cellText(typed) {
  return String(typed ?? '').replace(/\s*(?:\r\n|\r|\n|\u2028|\u2029)\s*/g, ' ').trim();
}

// ── Lines ───────────────────────────────────────────────────────────────────────

/** Spaces a line starts with, a tab counting to the next multiple of four, as markdown-it counts them. */
function indentWidth(line) {
  let width = 0;
  for (const char of line) {
    if (char === ' ') width += 1;
    else if (char === '\t') width += 4 - (width % 4);
    else break;
  }
  return width;
}

// markdown-it's own list (`common/html_blocks.py`): a line opening one of these is an HTML block.
const BLOCK_TAGS = 'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h1|h2|h3|h4|h5|h6|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';
const BLOCK_TAG = new RegExp(`^</?(?:${BLOCK_TAGS})(?:\\s|/?>|$)`, 'i');
const BLOCK_OPENERS = [
  /^ {0,3}(?:`{3,}|~{3,})/, // a fence
  /^ {0,3}>/, // a quote or a callout
  /^ {0,3}(?:(?:-[ \t]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})$/, // a rule
  /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/, // a list item
  /^ {0,3}#{1,6}(?:[ \t]|$)/, // a heading
  /^ {0,3}:::/, // an aligned block, steps, a story or a map: the renderers cut the note there first
];

/**
 * What ends the HTML block a line opens, as markdown-it reads one: its closing tag,
 * the end of a comment, or a blank line. Null when it opens none; a table inside
 * one is HTML text, not a table.
 */
function htmlBlock(line) {
  if (indentWidth(line) >= 4) return null;
  const start = line.trimStart();
  if (/^<(?:script|pre|style|textarea)(?:\s|>|$)/i.test(start)) return /<\/(?:script|pre|style|textarea)>/i;
  if (start.startsWith('<!--')) return /-->/;
  if (start.startsWith('<?')) return /\?>/;
  if (/^<![A-Z]/.test(start)) return />/;
  if (start.startsWith('<![CDATA[')) return /\]\]>/;
  if (BLOCK_TAG.test(start)) return /^\s*$/;
  return null;
}

/**
 * Whether a line ends a table above it: blank, indented as code, or opening
 * another block (a comment among them: guidance, a page break, the cover line).
 */
function endsTable(line) {
  return !line.trim() || indentWidth(line) >= 4 || BLOCK_OPENERS.some((pattern) => pattern.test(line)) || htmlBlock(line) !== null;
}

/**
 * A row as written: what stands before its first pipe (`indent`), whether it opens
 * and closes with a pipe, each cell with the spaces around it, and what follows.
 * `slots` holds every written cell, those past the header's count too.
 */
function readLine(line) {
  const indent = line.slice(0, line.length - line.trimStart().length);
  const tail = indent.length === line.length ? '' : line.slice(line.trimEnd().length);
  const body = line.slice(indent.length, line.length - tail.length);
  const hidden = hiddenPipes(body);
  const parts = [];
  let last = 0;
  for (let index = body.indexOf('|'); index !== -1; index = body.indexOf('|', index + 1)) {
    if ((index > 0 && body[index - 1] === '\\') || hidden.has(index)) continue;
    parts.push(body.slice(last, index));
    last = index + 1;
  }
  parts.push(body.slice(last));
  let lead = false;
  let trail = false;
  if (parts.length > 1 && parts[0] === '') {
    lead = true;
    parts.shift();
  }
  if (parts.length > 1 && parts[parts.length - 1] === '') {
    trail = true;
    parts.pop();
  }
  const slots = parts.map((part) => {
    const before = part.slice(0, part.length - part.trimStart().length);
    const raw = part.slice(before.length).trimEnd();
    return { before, raw, after: part.slice(before.length + raw.length), text: unescapeCell(raw) };
  });
  return { indent, lead, slots, trail, tail };
}

/** `left`, `center`, `right` or null, from a delimiter cell (`:---`, `:---:`, `---:`). */
function alignOf(raw) {
  const left = raw.startsWith(':');
  const right = raw.endsWith(':') && raw.length > 1;
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
}

/** The delimiter row under the header, as markdown-it accepts it, or null. */
function readDelimiter(line) {
  if (indentWidth(line) >= 4) return null;
  const body = line.trimStart();
  if (body.length < 2 || !'|-:'.includes(body[0])) return null;
  if (!'|-: \t'.includes(body[1]) || (body[0] === '-' && /[ \t]/.test(body[1]))) return null;
  if (!/^[-:| \t]*$/.test(body.trimEnd())) return null;
  // markdown-it splits it on every pipe and allows an empty cell only at either end
  const pieces = body.split('|');
  for (let index = 1; index < pieces.length - 1; index += 1) if (!pieces[index].trim()) return null;
  const read = readLine(line);
  if (!read.slots.length || read.slots.some((slot) => !/^:?-+:?$/.test(slot.raw))) return null;
  return read;
}

/**
 * `line` read as a header, when it can be one: not a code line, holding a pipe the
 * renderers see (an escaped one counts, as in markdown-it), more than a lone `|`.
 */
function headerLine(line) {
  if (indentWidth(line) >= 4) return null;
  const body = line.trim();
  if (body === '|' || !body.includes('|')) return null;
  const hidden = hiddenPipes(body);
  let seen = false;
  for (let index = body.indexOf('|'); index !== -1 && !seen; index = body.indexOf('|', index + 1)) seen = !hidden.has(index);
  return seen ? readLine(line) : null;
}

/** The lines of a text with the break after each (the last one's is ''), CRLF kept. */
function splitLines(text) {
  const lines = [];
  const pattern = /\r\n|\n|\r/g;
  let start = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    lines.push({ text: text.slice(start, match.index), eol: match[0], from: start });
    start = match.index + match[0].length;
  }
  lines.push({ text: text.slice(start), eol: '', from: start });
  return lines;
}

// ── Reading a table ─────────────────────────────────────────────────────────────

/**
 * @typedef {'left'|'center'|'right'|null} Align
 * @typedef {{ header: string[], align: Align[], rows: string[][], layout: object }} Table
 *   `header` and each row hold one string per column, the cell's Markdown with
 *   its pipes unescaped; a short row is padded with ''. `layout` is how the text
 *   was written (opaque): it is what lets an unchanged table write back byte for
 *   byte, and a changed one keep its own spacing.
 */

/**
 * The table `text` holds, or null when it is not exactly one table (a header line,
 * the delimiter row, then rows). A line break or blank lines after the last row
 * are kept as they were.
 * @returns {Table|null}
 */
export function parseTable(text) {
  const source = String(text ?? '');
  const lines = splitLines(source);
  let end = lines.length;
  while (end > 0 && !lines[end - 1].text.trim()) end -= 1;
  if (end < 2) return null;
  const head = headerLine(lines[0].text);
  const delimiter = head && readDelimiter(lines[1].text);
  if (!delimiter || head.slots.length !== delimiter.slots.length) return null;
  for (let index = 2; index < end; index += 1) if (endsTable(lines[index].text)) return null;
  const columns = head.slots.length;
  const bodyLines = lines.slice(2, end).map((line) => ({ ...readLine(line.text), eol: line.eol }));
  const finalFrom = lines[end - 1].from + lines[end - 1].text.length;
  const layout = {
    lines: {
      header: { ...head, eol: lines[0].eol },
      delimiter: { ...delimiter, eol: lines[1].eol },
      rows: bodyLines,
    },
    final: source.slice(finalFrom),
  };
  layout.style = styleOf(layout, columns);
  return {
    header: head.slots.map((slot) => slot.text),
    align: delimiter.slots.map((slot) => alignOf(slot.raw)),
    rows: bodyLines.map((line) => cellsOf(line, columns)),
    layout,
  };
}

/** A row's cells, padded or cut to the header's count as the renderers do. */
function cellsOf(line, columns) {
  const cells = new Array(columns);
  for (let index = 0; index < columns; index += 1) cells[index] = line.slots[index]?.text ?? '';
  return cells;
}

/**
 * Every table of a note as markdown-it finds it, with where it stands: `from` and
 * `to` are offsets in `text` (`to` before the last row's line break), `line` the
 * 0-based number of its header line. Tables inside a fence, an HTML block or a
 * quote are left out: the grid edits the ones standing on their own.
 *
 * A settings line under the last row (`tableLook.js`) is no row: it is `look`, its
 * settings with where it stands (`from`, `to`), and `end` is where the table's block
 * ends, that line included (`to` without one).
 * @returns {{ from: number, to: number, end: number, line: number, table: Table, look: object|null }[]}
 */
export function tablesIn(text) {
  const source = String(text ?? '');
  const lines = splitLines(source);
  const found = [];
  let fence = null;
  let html = null;
  for (let index = 0; index < lines.length - 1; index += 1) {
    const line = lines[index].text;
    if (html) {
      if (html.test(line)) html = null;
      continue;
    }
    const opened = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (opened && opened[1][0] === fence[0] && opened[1].length >= fence.length && !line.slice(opened[0].length).trim()) fence = null;
      continue;
    }
    if (opened) {
      fence = opened[1];
      continue;
    }
    const head = headerLine(line);
    const delimiter = head && readDelimiter(lines[index + 1].text);
    if (!delimiter) {
      const block = htmlBlock(line);
      if (block && !block.test(line.slice(line.indexOf('<') + 1))) html = block;
      continue;
    }
    if (head.slots.length !== delimiter.slots.length) continue;
    let last = index + 1;
    while (last + 1 < lines.length && !endsTable(lines[last + 1].text)) last += 1;
    const from = lines[index].from;
    const end = lines[last].from + lines[last].text.length;
    const settings = last > index + 1 ? readLook(lines[last].text) : null;
    const rows = settings ? last - 1 : last;
    const to = lines[rows].from + lines[rows].text.length;
    const look = settings && { ...settings, from: lines[last].from, to: end };
    found.push({ from, to, end, line: index, table: parseTable(source.slice(from, to)), look });
    index = last;
  }
  return found;
}

/**
 * The table a position of a note's text stands in (its header line to its last
 * row), as `tablesIn` finds it, or null. The editor's own parser draws a table a
 * little differently (it starts after the first line's indent, and a table in a
 * `::: center` block runs on to the closing `:::`), so the grid takes its lines
 * from here.
 */
export function tableAt(text, position) {
  return tablesIn(text).find((found) => found.from <= position && position <= found.end) ?? null;
}

// ── How a table is written ──────────────────────────────────────────────────────

const ASCII = /^[\x20-\x7e]*$/;
const WIDE = /[\p{Emoji_Presentation}\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{20000}-\u{3FFFD}]/u;
const ZERO_WIDTH = /^[\p{M}\p{Cf}]+$/u;
const graphemes = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

/** How many columns of a monospace font a text takes: a wide sign or an emoji two, a mark none. */
export function displayWidth(text) {
  const value = String(text ?? '');
  if (ASCII.test(value)) return value.length;
  let width = 0;
  const parts = graphemes ? Array.from(graphemes.segment(value), (part) => part.segment) : Array.from(value);
  for (const part of parts) {
    if (ZERO_WIDTH.test(part)) continue;
    width += WIDE.test(part) || part.includes('\uFE0F') ? 2 : 1;
  }
  return width;
}

function mostCommon(values, fallback) {
  const counts = new Map();
  let best = fallback;
  let top = 0;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > top) {
      top = count;
      best = value;
    }
  }
  return best;
}

/** Whether a slot is followed by a pipe on its line, which is when its width is fixed. */
function closed(line, index) {
  return index < line.slots.length - 1 || line.trail;
}

/**
 * How the table was written, for the lines and cells a change writes anew: pipes
 * at the ends or not, the spaces around a cell, its line breaks, and whether the
 * columns were padded to line up (and to which widths).
 */
function styleOf(layout, columns) {
  const all = [layout.lines.header, layout.lines.delimiter, ...layout.lines.rows];
  const filled = [];
  const empty = [];
  for (const line of all) {
    line.slots.forEach((slot, index) => {
      if (index >= columns) return;
      if (slot.raw) filled.push({ line, index, slot });
      else if (closed(line, index)) empty.push(slot.before + slot.after);
    });
  }
  const leads = all.filter((line) => line.lead).length;
  const trails = all.filter((line) => line.trail).length;
  const inner = filled.filter(({ line, index }) => (index > 0 || line.lead) && closed(line, index));
  const style = {
    lead: leads * 2 >= all.length,
    trail: trails * 2 >= all.length,
    before: mostCommon(inner.map(({ slot }) => slot.before), ' '),
    after: mostCommon(inner.map(({ slot }) => slot.after), ' '),
    empty: mostCommon(empty, ' '),
    eol: mostCommon(all.map((line) => line.eol).filter(Boolean), '\n'),
    dashes: Math.max(1, mostCommon(layout.lines.delimiter.slots.map((slot) => slot.raw.replace(/:/g, '').length), 3)),
    widths: null,
    sides: null,
  };
  const padded = measurePadding(all, columns);
  if (padded) {
    const shortest = (values) => values.reduce((short, value) => (value.length < short.length ? value : short), values[0] ?? ' ');
    Object.assign(style, padded, { before: shortest(inner.map(({ slot }) => slot.before)), after: shortest(inner.map(({ slot }) => slot.after)) });
  }
  return style;
}

/**
 * The widths the columns were padded to, when they were: every closed cell of a
 * column as wide as the others, and some cell carrying more than one space. A
 * table whose cells merely happen to line up is not taken as padded.
 */
function measurePadding(lines, columns) {
  let roomy = false;
  for (const line of lines) {
    for (const slot of line.slots) if (slot.before.length > 1 || slot.after.length > 1) roomy = true;
  }
  if (!roomy) return null;
  const widths = new Array(columns).fill(null);
  for (const line of lines) {
    for (let index = 0; index < Math.min(columns, line.slots.length); index += 1) {
      if (!closed(line, index)) continue;
      const slot = line.slots[index];
      const width = displayWidth(slot.before + slot.raw + slot.after);
      if (widths[index] === null) widths[index] = width;
      else if (widths[index] !== width) return null;
    }
  }
  // text set right in its padding (a column of numbers) stays set right, and centred stays centred
  const sides = widths.map((_, index) => {
    const slots = [lines[0], ...lines.slice(2)].filter((line) => closed(line, index) && line.slots[index]?.raw).map((line) => line.slots[index]);
    const lefts = new Set(slots.map((slot) => slot.before.length));
    const rights = new Set(slots.map((slot) => slot.after.length));
    if (lefts.size <= 1) return 'right';
    return rights.size <= 1 ? 'left' : 'both';
  });
  return { widths, sides };
}

/** Whether a cell written first on a line without its opening pipe would open another block instead. */
function opensBlock(raw) {
  return !raw || /^(?:[-+*>#<=_~`:]|\d{1,9}[.)](?:\s|$))/.test(raw);
}

function dashesFor(align, length) {
  const left = align === 'left' || align === 'center' ? ':' : '';
  const right = align === 'right' || align === 'center' ? ':' : '';
  return left + '-'.repeat(Math.max(1, length - left.length - right.length)) + right;
}

/**
 * Written cells joined into a line. A cell ending in a backslash gets a space
 * before the next pipe, which it would escape otherwise.
 */
function joinLine(indent, lead, slots, trail, tail) {
  const pieces = slots.map((slot, index) => {
    const piece = slot.before + slot.raw + slot.after;
    return piece.endsWith('\\') && (index < slots.length - 1 || trail) ? `${piece} ` : piece;
  });
  return indent + (lead ? '|' : '') + pieces.join('|') + (trail ? '|' : '') + tail;
}

/** One cell as a changed line writes it: its text escaped, its spacing kept or the table's own. */
function writeSlot(text, slot, index, draft, edge) {
  const { style } = draft;
  const kept = slot && slot.text === text;
  const open = edge.first && !edge.lead;
  if (kept && !draft.normalize && !draft.repad.has(index)) {
    // an unchanged cell keeps its bytes; one that stood at an open end of its line
    // gets the table's space once a pipe stands there
    const before = edge.openedStart && !open && !slot.before ? style.before : slot.before;
    const after = edge.openedEnd && !(edge.last && !edge.trail) && !slot.after ? style.after : slot.after;
    return before === slot.before && after === slot.after ? slot : { ...slot, before, after };
  }
  const raw = kept ? slot.raw : escapeCell(text);
  const width = style.widths?.[index] ?? null;
  if (width !== null && !(edge.last && !edge.trail)) {
    const before = open ? '' : style.before;
    const free = Math.max(0, width - displayWidth(before + raw) - style.after.length);
    const side = style.sides?.[index] ?? 'right';
    const left = side === 'left' ? free : side === 'both' ? Math.floor(free / 2) : 0;
    return { before: before + ' '.repeat(left), raw, after: style.after + ' '.repeat(free - left), text };
  }
  if (!raw) return { before: open ? '' : style.empty, raw, after: '', text };
  let { before, after } = style;
  if (slot?.raw && !draft.normalize) ({ before, after } = slot);
  // a cell that stood at a line's open end gets the table's spacing once a pipe closes it
  if (open) before = '';
  else if (!before) before = style.before;
  if (edge.last && !edge.trail) after = '';
  else if (!after) after = style.after;
  return { before, raw, after, text };
}

/**
 * A row's line. Unchanged, it is its own bytes. Changed, its unchanged cells keep
 * theirs, its changed ones their spacing, and a short row stays short unless a
 * cell past its end now holds something.
 */
function writeRow(line, cells, draft, header = false) {
  const columns = cells.length;
  const written = line ? (draft.normalize ? line.slots.slice(0, columns) : line.slots) : [];
  if (line && !draft.normalize && !draft.repad.size && cells.every((cell, index) => (written[index]?.text ?? '') === cell)) {
    return joinLine(line.indent, line.lead, line.slots, line.trail, line.tail);
  }
  let filled = columns - 1;
  while (filled >= 0 && cells[filled] === '') filled -= 1;
  // the header and a new row hold every column; a row written short stays short
  let count = header || !line ? columns : Math.max(Math.min(written.length, columns), filled + 1);
  if (count === 0) count = columns;
  let lead = line ? line.lead : draft.style.lead;
  let trail = line ? line.trail : draft.style.trail;
  // a line must stay a row: no empty first cell or block mark without the opening pipe,
  // no empty last cell without the closing one, and a header holds a pipe
  if (!lead && opensBlock(escapeCell(cells[0]))) lead = true;
  if (!trail && cells[count - 1] === '') trail = true;
  if (header && columns === 1 && !lead && !trail) trail = true;
  const extras = draft.normalize ? [] : written.slice(columns);
  const slots = [];
  for (let index = 0; index < count; index += 1) {
    const edge = {
      first: index === 0,
      last: index === count - 1 && !extras.length,
      lead,
      trail,
      openedStart: Boolean(line && !line.lead && index === 0),
      openedEnd: Boolean(line && !line.trail && index === line.slots.length - 1),
    };
    slots.push(writeSlot(cells[index], written[index], index, draft, edge));
  }
  return joinLine(line?.indent ?? '', lead, [...slots, ...extras], trail, line?.tail ?? '');
}

/** The delimiter row: each column's colons, and its dashes as long as they were. */
function writeDelimiter(line, align, draft) {
  const { style } = draft;
  const lead = line ? line.lead : style.lead;
  const trail = line ? line.trail : style.trail;
  const slots = align.map((side, index) => {
    const slot = line?.slots[index];
    if (slot && alignOf(slot.raw) === side && !draft.normalize && !draft.repad.has(index)) return slot;
    const width = style.widths?.[index] ?? null;
    let before = slot && !draft.normalize ? slot.before : style.before;
    let after = slot && !draft.normalize ? slot.after : style.after;
    if (index === 0 && !lead) before = '';
    if (index === align.length - 1 && !trail) after = '';
    if (width !== null && !(index === align.length - 1 && !trail)) {
      return { before, raw: dashesFor(side, width - before.length - after.length), after };
    }
    const dashes = Math.max(3, slot ? slot.raw.replace(/:/g, '').length : style.dashes);
    return { before, raw: dashesFor(side, dashes + (side === 'center' ? 2 : side ? 1 : 0)), after };
  });
  return joinLine(line?.indent ?? '', lead, slots, trail, line?.tail ?? '');
}

/**
 * What a change hands the writer: copies of the model, the written line under each
 * row (null for a new one), the style, and whether every line is written again in
 * the table's spacing (a column change) or some columns padded again.
 */
function draftOf(table) {
  const layout = table.layout ?? FRESH;
  const { style } = layout;
  return {
    header: [...table.header],
    align: [...table.align],
    rows: [...table.rows],
    lines: { header: layout.lines.header, delimiter: layout.lines.delimiter, rows: [...layout.lines.rows] },
    style: { ...style, widths: style.widths && [...style.widths], sides: style.sides && [...style.sides] },
    final: layout.final,
    normalize: false,
    repad: new Set(),
  };
}

/** How a table made from cells is written: `| a | b |` over `| --- | --- |`. */
const FRESH = Object.freeze({
  lines: { header: null, delimiter: null, rows: [] },
  final: '',
  style: { lead: true, trail: true, before: ' ', after: ' ', empty: ' ', eol: '\n', dashes: 3, widths: null, sides: null },
});

function writeDraft(draft) {
  const lines = [draft.lines.header, draft.lines.delimiter, ...draft.rows.map((_, index) => draft.lines.rows[index] ?? null)];
  let text = writeRow(draft.lines.header, draft.header, draft, true);
  text += (lines[0]?.eol || draft.style.eol) + writeDelimiter(draft.lines.delimiter, draft.align, draft);
  draft.rows.forEach((row, index) => {
    text += (lines[index + 1]?.eol || draft.style.eol) + writeRow(lines[index + 2], row, draft);
  });
  return text + draft.final;
}

/** The table's text: byte for byte what it was read from when nothing changed. */
export function serializeTable(table) {
  return writeDraft(draftOf(table));
}

/**
 * A table made from cells (a new table, a paste, a file), written the usual way:
 * `| a | b |`, `| --- |`, one space around each cell. Cells are Markdown.
 * @returns {Table}
 */
export function newTable({ header = [], rows = [], align = [] } = {}) {
  const columns = rows.reduce((most, row) => Math.max(most, row.length), Math.max(1, header.length));
  const pad = (cells) => Array.from({ length: columns }, (_, index) => cellText(cells?.[index] ?? ''));
  const draft = draftOf({ header: pad(header), align: Array.from({ length: columns }, (_, index) => align[index] ?? null), rows: rows.map(pad) });
  return parseTable(writeDraft(draft));
}

// ── Changes ─────────────────────────────────────────────────────────────────────

/** A text cut after each line break, so the pieces join back into it. */
function linePieces(text) {
  return text.match(/[^\r\n]*(?:\r\n|\n|\r)|[^\r\n]+$/g) ?? [];
}

/** The smallest change turning `was` into `is` at `offset`, never cutting a character in two. */
function narrowed(offset, was, is) {
  let start = 0;
  while (start < was.length && start < is.length && was[start] === is[start]) start += 1;
  if (start > 0 && /[\uD800-\uDBFF]/.test(was[start - 1])) start -= 1;
  let end = 0;
  while (end < was.length - start && end < is.length - start && was[was.length - 1 - end] === is[is.length - 1 - end]) end += 1;
  if (end > 0 && /[\uDC00-\uDFFF]/.test(was[was.length - end])) end -= 1;
  return { from: offset + start, to: offset + was.length - end, insert: is.slice(start, is.length - end) };
}

/**
 * The changes turning `before` into `after`, in `before`'s offsets: the lines both
 * share at either end are left alone, and when as many lines stand between, each
 * changed line is its own change, so the editor keeps every other line's marks.
 * @returns {{ from: number, to: number, insert: string }[]}
 */
export function lineChanges(before, after) {
  if (before === after) return [];
  const old = linePieces(before);
  const now = linePieces(after);
  let start = 0;
  while (start < old.length && start < now.length && old[start] === now[start]) start += 1;
  let oldEnd = old.length;
  let newEnd = now.length;
  while (oldEnd > start && newEnd > start && old[oldEnd - 1] === now[newEnd - 1]) {
    oldEnd -= 1;
    newEnd -= 1;
  }
  let offset = 0;
  for (let index = 0; index < start; index += 1) offset += old[index].length;
  if (oldEnd - start !== newEnd - start) return [narrowed(offset, old.slice(start, oldEnd).join(''), now.slice(start, newEnd).join(''))];
  const changes = [];
  for (let index = start; index < oldEnd; index += 1) {
    if (old[index] !== now[index]) changes.push(narrowed(offset, old[index], now[index]));
    offset += old[index].length;
  }
  return changes;
}

/** `text` with `changes` made, each given in the original text's offsets. */
export function applyChanges(text, changes) {
  let out = String(text);
  for (const change of [...changes].sort((a, b) => b.from - a.from)) out = out.slice(0, change.from) + change.insert + out.slice(change.to);
  return out;
}

/**
 * The outcome of a change: the new table (read back from its text, so its layout
 * is that text's), the text, and the changes from the old text.
 * @returns {{ table: Table, text: string, changes: { from: number, to: number, insert: string }[] }}
 */
function finish(table, draft) {
  const before = serializeTable(table);
  const text = writeDraft(draft);
  const next = parseTable(text);
  if (!next) throw new Error(`tableText: a change wrote something that is not a table:\n${text}`);
  return { table: next, text, changes: lineChanges(before, text) };
}

function checkRow(table, row, header = false) {
  if (!Number.isInteger(row) || row < (header ? -1 : 0) || row >= table.rows.length) throw new RangeError(`No row ${row}`);
}

function checkColumn(table, column) {
  if (!Number.isInteger(column) || column < 0 || column >= table.header.length) throw new RangeError(`No column ${column}`);
}

const clampIndex = (value, length) => Math.max(0, Math.min(length, Number.isInteger(value) ? value : length));

/** In a padded table, a column too narrow for a new text widens on every line, so the pipes keep lining up. */
function widen(draft, column, text) {
  const width = draft.style.widths?.[column];
  if (width === null || width === undefined) return;
  const needed = displayWidth(draft.style.before + escapeCell(text)) + draft.style.after.length;
  if (needed > width) {
    draft.style.widths[column] = needed;
    draft.repad.add(column);
  }
}

/** Columns added at the end of a draft, for a paste wider than the table. */
function growColumns(draft, columns) {
  const added = columns - draft.header.length;
  if (added <= 0) return;
  const blank = new Array(added).fill('');
  draft.header = [...draft.header, ...blank];
  draft.align = [...draft.align, ...new Array(added).fill(null)];
  draft.rows = draft.rows.map((cells) => [...cells, ...blank]);
  if (draft.style.widths) {
    draft.style.widths.push(...new Array(added).fill(draft.style.before.length + 3 + draft.style.after.length));
    draft.style.sides.push(...new Array(added).fill('right'));
  }
  draft.normalize = true;
}

/**
 * A cell set to what was typed (`row` -1 is the header). Only that line changes,
 * unless the table is padded and the text is wider than its column.
 */
export function setCell(table, row, column, typed) {
  checkRow(table, row, true);
  checkColumn(table, column);
  const text = cellText(typed);
  const draft = draftOf(table);
  if (row === -1) draft.header[column] = text;
  else draft.rows[row] = draft.rows[row].map((cell, at) => (at === column ? text : cell));
  widen(draft, column, text);
  return finish(table, draft);
}

/**
 * Cells (Markdown, a grid's rows) pasted from `{ row, column }` on, `row` -1
 * starting in the header, adding the rows and columns they need at the end.
 */
export function pasteInto(table, { row = 0, column = 0 } = {}, cells = []) {
  if (!Number.isInteger(row) || row < -1 || row > table.rows.length) throw new RangeError(`No row ${row}`);
  if (!Number.isInteger(column) || column < 0 || column > table.header.length) throw new RangeError(`No column ${column}`);
  const grid = cells.map((line) => line.map(cellText));
  const draft = draftOf(table);
  growColumns(draft, grid.reduce((most, line) => Math.max(most, column + line.length), draft.header.length));
  while (draft.rows.length < row + grid.length) {
    draft.rows.push(new Array(draft.header.length).fill(''));
    draft.lines.rows.push(null);
  }
  grid.forEach((line, offset) => {
    const target = row + offset;
    const cellsThere = target === -1 ? draft.header : [...draft.rows[target]];
    line.forEach((text, at) => {
      cellsThere[column + at] = text;
      widen(draft, column + at, text);
    });
    if (target !== -1) draft.rows[target] = cellsThere;
  });
  return finish(table, draft);
}

/** A row (empty, or `cells`) put in at `at`, the end by default. */
export function insertRow(table, at = table.rows.length, cells = []) {
  const index = clampIndex(at, table.rows.length);
  const draft = draftOf(table);
  const row = draft.header.map((_, column) => cellText(cells[column] ?? ''));
  draft.rows.splice(index, 0, row);
  draft.lines.rows.splice(index, 0, null);
  row.forEach((text, column) => widen(draft, column, text));
  return finish(table, draft);
}

/** A copy of row `at` put in under it, written exactly as it is. */
export function duplicateRow(table, at) {
  checkRow(table, at);
  const draft = draftOf(table);
  draft.rows.splice(at + 1, 0, [...draft.rows[at]]);
  draft.lines.rows.splice(at + 1, 0, draft.lines.rows[at]);
  return finish(table, draft);
}

/** Row `at` taken out. */
export function removeRow(table, at) {
  checkRow(table, at);
  const draft = draftOf(table);
  draft.rows.splice(at, 1);
  draft.lines.rows.splice(at, 1);
  return finish(table, draft);
}

/** Row `from` moved so it ends at index `to`; each row keeps its own line. */
export function moveRow(table, from, to) {
  checkRow(table, from);
  checkRow(table, to);
  return reorderRows(table, moveIndex(table.rows.length, from, to));
}

function moveIndex(length, from, to) {
  const order = Array.from({ length }, (_, index) => index);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  return order;
}

function reorderRows(table, order) {
  const draft = draftOf(table);
  const lines = draft.lines.rows;
  draft.rows = order.map((index) => table.rows[index]);
  draft.lines.rows = order.map((index) => lines[index] ?? null);
  return finish(table, draft);
}

/** Every written line's cells changed on copies, so the table read before stays as it was. */
function changeSlots(draft, change) {
  const copy = (line) => line && { ...line, slots: change([...line.slots]) };
  draft.lines.header = copy(draft.lines.header);
  draft.lines.delimiter = copy(draft.lines.delimiter);
  draft.lines.rows = draft.lines.rows.map(copy);
}

/**
 * A column put in at `at` (the end by default), with its header, side and cells.
 * Every line is written again, in the table's own spacing.
 */
export function insertColumn(table, at = table.header.length, { header = '', align = null, cells = [] } = {}) {
  const index = clampIndex(at, table.header.length);
  const draft = draftOf(table);
  const head = cellText(header);
  const column = table.rows.map((_, row) => cellText(cells[row] ?? ''));
  draft.header.splice(index, 0, head);
  draft.align.splice(index, 0, align);
  draft.rows = draft.rows.map((row, at) => [...row.slice(0, index), column[at], ...row.slice(index)]);
  changeSlots(draft, (slots) => {
    if (slots.length >= index) slots.splice(index, 0, undefined);
    return slots;
  });
  if (draft.style.widths) {
    const widest = Math.max(3, displayWidth(escapeCell(head)), ...column.map((text) => displayWidth(escapeCell(text))));
    draft.style.widths.splice(index, 0, draft.style.before.length + widest + draft.style.after.length);
    draft.style.sides.splice(index, 0, align === 'right' ? 'left' : 'right');
  }
  draft.normalize = true;
  return finish(table, draft);
}

/** Column `at` taken out of every line. A table keeps one column at least. */
export function removeColumn(table, at) {
  checkColumn(table, at);
  if (table.header.length === 1) throw new RangeError('A table keeps one column at least');
  const draft = draftOf(table);
  const without = (cells) => cells.filter((_, index) => index !== at);
  draft.header = without(draft.header);
  draft.align = without(draft.align);
  draft.rows = draft.rows.map(without);
  changeSlots(draft, (slots) => {
    if (slots.length > at) slots.splice(at, 1);
    return slots;
  });
  if (draft.style.widths) {
    draft.style.widths.splice(at, 1);
    draft.style.sides.splice(at, 1);
  }
  draft.normalize = true;
  return finish(table, draft);
}

/** Column `from` moved so it ends at index `to`, its cells keeping their text. */
export function moveColumn(table, from, to) {
  checkColumn(table, from);
  checkColumn(table, to);
  const order = moveIndex(table.header.length, from, to);
  const draft = draftOf(table);
  const permute = (cells) => order.map((index) => cells[index]);
  draft.header = permute(draft.header);
  draft.align = permute(draft.align);
  draft.rows = draft.rows.map(permute);
  changeSlots(draft, (slots) => {
    const moved = permute(slots);
    while (moved.length && moved[moved.length - 1] === undefined) moved.pop();
    return moved;
  });
  if (draft.style.widths) {
    draft.style.widths = permute(draft.style.widths);
    draft.style.sides = permute(draft.style.sides);
  }
  draft.normalize = true;
  return finish(table, draft);
}

/** A column's side: 'left', 'center', 'right' or null. Only the delimiter row changes. */
export function setAlign(table, column, align) {
  checkColumn(table, column);
  if (![null, 'left', 'center', 'right'].includes(align)) throw new RangeError(`No side ${align}`);
  const draft = draftOf(table);
  draft.align[column] = align;
  return finish(table, draft);
}

/**
 * A column filled: with `value`, or what `value(cells, row)` returns for each row.
 * `onlyEmpty` leaves the cells that hold something; `from` and `to` bound the rows.
 */
export function fillColumn(table, column, value, { onlyEmpty = false, from = 0, to = table.rows.length } = {}) {
  checkColumn(table, column);
  const draft = draftOf(table);
  draft.rows = draft.rows.map((cells, row) => {
    if (row < from || row >= to || (onlyEmpty && cells[column] !== '')) return cells;
    const text = cellText(typeof value === 'function' ? value(cells, row) : value);
    widen(draft, column, text);
    return cells.map((cell, at) => (at === column ? text : cell));
  });
  return finish(table, draft);
}

// ── Sorting ─────────────────────────────────────────────────────────────────────

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * The rows sorted by a column, stably: by number when the column is numbers, by
 * date when it is dates, else as words (`V2` before `V10`). Empty cells and cells
 * that do not read go last either way. Total rows at the bottom (`**Total**`, a
 * row in bold) stay there. `kind` forces 'number', 'date' or 'text'.
 * @returns {{ table: Table, text: string, changes: object[], kind: string }}
 */
export function sortRows(table, column, direction = 'asc', { kind = 'auto', decimal } = {}) {
  checkColumn(table, column);
  let pinned = table.rows.length;
  while (pinned > 0 && isTotalRow(table.rows[pinned - 1])) pinned -= 1;
  const sorted = table.rows.slice(0, pinned);
  const texts = sorted.map((row) => row[column]);
  const used = kind === 'auto' ? columnKind(table.header[column], texts, decimal) : kind;
  let keys;
  if (used === 'number') keys = readColumn(table.header[column], texts, { decimal }).readings.map((reading) => (reading ? (reading.value ?? reading.range?.[0] ?? null) : null));
  else if (used === 'date') keys = dateKeys(texts);
  else keys = texts.map((text) => plainText(text) || null);
  const sign = direction === 'desc' ? -1 : 1;
  const order = sorted.map((_, index) => index).sort((a, b) => {
    const left = keys[a];
    const right = keys[b];
    if (left === null || right === null) return (left === null) - (right === null);
    const compared = typeof left === 'string' ? collator.compare(left, right) : left - right;
    return sign * compared;
  });
  for (let index = pinned; index < table.rows.length; index += 1) order.push(index);
  return { ...reorderRows(table, order), kind: used };
}

function columnKind(header, texts, decimal) {
  const read = readColumn(header, texts, { decimal });
  const amounts = read.readings.filter((reading) => reading && (reading.value !== null || reading.range)).length;
  // a column of ranges (`$120k-$250k`) sorts by number too, on its low end
  if (read.numeric || (amounts && amounts >= 0.75 * read.filled)) return 'number';
  const filled = texts.filter((text) => !blank(text));
  const dates = filled.filter((text) => readDate(text)).length;
  return dates && dates >= 0.75 * filled.length ? 'date' : 'text';
}

/** Keys that put dates in order; a date written without its year takes the column's usual year. */
function dateKeys(texts) {
  const dates = texts.map((text) => readDate(text));
  const year = mostCommon(dates.filter((date) => date?.year).map((date) => date.year), 0);
  return dates.map((date) => (date ? (((date.year ?? year) * 13 + date.month) * 32 + (date.day ?? 0)) * 1440 + date.minutes : null));
}

// ── Reading cells as words, numbers and dates ───────────────────────────────────

/** A cell's Markdown as the words it shows: chips and links as their labels, no marks. */
export function plainText(markdown) {
  return String(markdown ?? '')
    .replace(MEDIA_REF, (_match, _id, label) => label)
    .replace(ENTITY_REF, (_match, _id, label) => label)
    .replace(/!\[([^\]]*)\]\([^)]*\)(?:\{[^}\n]*\})?/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    .replace(/(\*\*|__|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])([*_])(?=\S)([\s\S]*?\S)\2(?![\w*])/g, '$1$3')
    .replace(/(`+)([\s\S]*?)\1/g, '$2')
    .replace(/\\([!-/:-@[-`{-~])/g, '$1')
    .trim();
}

/** Whether a row reads as a total: its first cell in bold, or naming a total. */
export function isTotalRow(cells) {
  const first = (cells ?? []).find((cell) => String(cell).trim()) ?? '';
  if (/^\s*(\*\*|__)[\s\S]+\1\s*$/.test(first)) return true;
  return /^(?:total|totals|grand total|subtotal|sum|overall)\b/i.test(plainText(first));
}

const PLACEHOLDER = /^(?:[-–—‒?]+|n\/?a)$/i;
const blank = (text) => {
  const plain = plainText(text);
  return !plain || PLACEHOLDER.test(plain);
};

const FLOOR = /^(?:≥|>=|⩾|>|at least|no (?:fewer|less) than|more than|over|min(?:imum)?\.?(?=\s|\d|$))\s*/i;
const CEILING = /^(?:≤|<=|⩽|<|up to|at most|no more than|fewer than|less than|under|max(?:imum)?\.?(?=\s|\d|$))\s*/i;
const APPROX = /^(?:~|≈|∼|about|around|approx(?:imately|\.)?|roughly|nearly|almost|some|circa|ca\.|c\.)\s*/i;
const CURRENCY = /^(?:US\$|A\$|C\$|HK\$|NZ\$|\$|€|£|¥|₹|₽|₺|₴|₪|﷼|(?:USD|EUR|GBP|JPY|CNY|RUB|UAH|TRY|SAR|AED|YER|ILS|IRR|CHF|CAD|AUD|INR|EGP|QAR|KWD|OMR|JOD|LBP|SYP|IQD)(?=[\s\d]))\s?/;
const NUMBER = /^(\d{1,3}(?:([,.' \u00a0\u202f’])\d{3})(?:\2\d{3})*(?!\d)|\d+)([.,]\d+)?/;
const MULTIPLIER = /^(?:\s?(bn|billion|billions|mn|million|millions|thousand)\b|(k|K|M|Mn|B|Bn)(?![\p{L}\d]))/u;
const SCALE = { k: 1e3, K: 1e3, thousand: 1e3, M: 1e6, Mn: 1e6, mn: 1e6, million: 1e6, millions: 1e6, B: 1e9, Bn: 1e9, bn: 1e9, billion: 1e9, billions: 1e9 };
const UNIT = /^(?:\s?(%|‰|°[CF]?|€|£|\$|¥|₽|₺|₴|₪)|\s?(USD|EUR|GBP|AED|SAR|YER)|\s?([a-zµ][a-zµ²³/]{0,3})(?![\p{L}\d])|\s([\p{L}][\p{L}’'-]{0,15}))/iu;
const RANGE = /^\s*(?:[-–—]|to)\s*/i;

/**
 * The number a written cell holds, or null when it is not one: `41`, `1 234,5`,
 * `$8.3M`, `80%`, `≥ 41` or `41+` (a floor), `up to 20` (a ceiling), `~12` (about).
 * `8–10` is a range: no single value, its two ends in `range`. `decimal` says which
 * of `.` and `,` is the decimal mark when the cell alone cannot tell (`1,234`).
 * @returns {null | { value: number|null, range: [number, number]|null, floor: boolean, ceiling: boolean, approx: boolean, unit: string, decimal: '.'|',', thousands: string }}
 */
export function readNumber(text, { decimal } = {}) {
  let rest = plainText(text);
  if (!rest || PLACEHOLDER.test(rest)) return null;
  const date = readDate(rest);
  if (date && date.length === rest.length) return null;
  const reading = { value: null, range: null, floor: false, ceiling: false, approx: false, unit: '', decimal: decimal ?? '.', thousands: '' };
  for (let changed = true; changed;) {
    changed = false;
    for (const [pattern, flag] of [[FLOOR, 'floor'], [CEILING, 'ceiling'], [APPROX, 'approx']]) {
      const match = pattern.exec(rest);
      if (match && match[0]) {
        reading[flag] = true;
        rest = rest.slice(match[0].length);
        changed = true;
      }
    }
  }
  const tail = /\s*(?:\+|\s(?:or|and) more|\s(?:or (?:less|fewer)))$/i.exec(rest);
  if (tail) {
    if (/less|fewer/i.test(tail[0])) reading.ceiling = true;
    else reading.floor = true;
    rest = rest.slice(0, rest.length - tail[0].length);
  }
  const first = readAmount(rest, decimal);
  if (!first) return null;
  rest = rest.slice(first.length);
  reading.unit = first.unit;
  reading.thousands = first.thousands;
  if (first.decimal) reading.decimal = first.decimal;
  const between = RANGE.exec(rest);
  if (between && rest.length > between[0].length) {
    const second = readAmount(rest.slice(between[0].length), decimal);
    if (!second || rest.length !== between[0].length + second.length) return null;
    // `8-10M` scales both ends; `$120k-$250k` each its own
    reading.range = [scaled(first.value, first.scaled ? first.scale : second.scale), scaled(second.value, second.scale)];
    reading.unit = first.unit || second.unit;
    return reading;
  }
  if (rest.trim()) return null;
  reading.value = scaled(first.value, first.scale);
  return reading;
}

/** `8.3` times a million as 8300000, not 8300000.000000001. */
function scaled(value, scale) {
  return scale === 1 ? value : Number((value * scale).toPrecision(15));
}

/** One amount at the start of `text`: sign, currency, digits, scale and unit. */
function readAmount(text, decimal) {
  let at = 0;
  let unit = '';
  let sign = 1;
  if (/^[-−]/.test(text)) {
    sign = -1;
    at += 1;
  }
  const currency = CURRENCY.exec(text.slice(at));
  if (currency) {
    unit = currency[0].trim();
    at += currency[0].length;
  }
  if (sign === 1 && /^[-−]/.test(text.slice(at))) {
    sign = -1;
    at += 1;
  }
  const number = NUMBER.exec(text.slice(at));
  if (!number) return null;
  at += number[0].length;
  const [, whole, group, fraction] = number;
  let value;
  let thousands = '';
  let mark = fraction ? fraction[0] : '';
  if (group && fraction && fraction[0] === group) return null;
  if (group && !fraction && (group === ',' || group === '.') && whole.split(group).length === 2 && group === decimal) {
    value = Number(whole.replace(group, '.'));
    mark = group;
  } else {
    if (group) thousands = group;
    value = Number(whole.split(group || '\u0000').join('') + (fraction ? `.${fraction.slice(1)}` : ''));
  }
  let scale = 1;
  let scaled = false;
  const multiplier = MULTIPLIER.exec(text.slice(at));
  if (multiplier) {
    scale = SCALE[multiplier[1] ?? multiplier[2]];
    scaled = true;
    at += multiplier[0].length;
  }
  const suffix = UNIT.exec(text.slice(at));
  if (suffix) {
    const word = suffix[1] ?? suffix[2] ?? suffix[3] ?? suffix[4];
    if (!MONTHS[monthKey(word)] && !/^(?:to|or|and)$/i.test(word)) {
      unit = unit || word;
      at += suffix[0].length;
    }
  }
  return { value: sign * value, scale, scaled, unit, thousands, decimal: mark, length: at };
}

/**
 * Which of `.` and `,` is a column's decimal mark, and what groups its thousands:
 * a cell holding both says it, `1,5` says comma, `12.7590` says point, `1,234,567`
 * says the comma groups thousands. Nothing telling leaves `fallback`.
 */
function separators(texts, fallback) {
  let comma = 0;
  let point = 0;
  const groups = [];
  for (const text of texts) {
    const core = /\d[\d,.' \u00a0\u202f’]*\d|\d/.exec(plainText(text))?.[0];
    if (!core) continue;
    const match = NUMBER.exec(core);
    if (!match) continue;
    const [whole, , group, fraction] = [match[0], match[1], match[2], match[3]];
    if (fraction) {
      if (fraction[0] === ',') comma += 1;
      else point += 1;
    }
    if (group) {
      groups.push(group);
      if (!fraction && (group === ',' || group === '.') && whole.split(group).length > 2) {
        if (group === ',') point += 0.5;
        else comma += 0.5;
      }
    }
  }
  const decimal = comma > point ? ',' : point > comma ? '.' : fallback ?? '.';
  const thousands = mostCommon(groups.filter((group) => group !== decimal), '');
  return { decimal, thousands };
}

/**
 * How one column reads as numbers, for a chart: whether it is numbers (three
 * quarters of its filled cells at least), each row's value (null where a cell is
 * empty, a range or words), which values are floors (`≥ 41`, `41+`, or a header
 * saying "at least"), its decimal mark and thousands separator, and the unit most
 * of its numbers carry.
 */
function readColumn(header, texts, { decimal } = {}) {
  const marks = separators(texts, decimal);
  const readings = texts.map((text) => readNumber(text, { decimal: marks.decimal }));
  const headerFloor = /\bat least\b|\bminimum\b|≥/i.test(plainText(header));
  const filled = texts.filter((text) => !blank(text)).length;
  const numbers = readings.filter((reading) => reading && reading.value !== null);
  const count = numbers.length;
  return {
    numeric: count > 0 && count >= 0.75 * filled,
    values: readings.map((reading) => reading?.value ?? null),
    floors: readings.map((reading) => Boolean(reading && reading.value !== null && (reading.floor || headerFloor))),
    floor: headerFloor || (count > 0 && numbers.every((reading) => reading.floor)),
    decimal: marks.decimal,
    thousands: marks.thousands,
    unit: mostCommon(numbers.map((reading) => reading.unit), ''),
    count,
    filled,
    readings,
  };
}

/**
 * Every column of a table read as numbers (see `readColumn`), one entry per
 * column, for the charts to pick their values from.
 */
export function readColumns(table, { decimal } = {}) {
  return table.header.map((header, column) => ({ column, header, ...readColumn(header, table.rows.map((row) => row[column]), { decimal }) }));
}

const MONTHS = {
  jan: 1, january: 1, janv: 1, janvier: 1,
  feb: 2, february: 2, fev: 2, fevr: 2, fevrier: 2,
  mar: 3, march: 3, mars: 3,
  apr: 4, april: 4, avr: 4, avril: 4,
  may: 5, mai: 5,
  jun: 6, june: 6, juin: 6,
  jul: 7, july: 7, juil: 7, juillet: 7,
  aug: 8, august: 8, aout: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, december: 12, decembre: 12,
};

function monthKey(word) {
  return String(word ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\.$/, '');
}

const ISO_DATE = /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?:[T ](\d{1,2}):(\d{2}))?(?!\d)/;
const NUMERIC_DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/;
const DAY_MONTH = /^(\d{1,2})(?:st|nd|rd|th|er)?(?:\s*[-–—]\s*\d{1,2}(?:st|nd|rd|th)?)?\s+(\p{L}+)\.?(?:,?\s+(\d{4}))?(?![\p{L}\d])/u;
const MONTH_DAY = /^(\p{L}+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*[-–—]\s*\d{1,2})?(?:,?\s+(\d{4}))?(?![\p{L}\d])/u;
const MONTH_YEAR = /^(\p{L}+)\.?\s+(\d{4})(?!\d)/u;

/**
 * The date a cell starts with: `2026-11-13`, `13/11/2026`, `13 Nov 2026`,
 * `Nov 13, 2026`, `Nov 2026`, `13 Nov`, or a span like `4-6 Nov` (its first day).
 * English and French month names. `length` is how much of the text it took.
 * @returns {null | { year: number|null, month: number, day: number|null, minutes: number, length: number }}
 */
export function readDate(text) {
  const value = plainText(text);
  const valid = (year, month, day, minutes, length) => (month >= 1 && month <= 12 && (day === null || (day >= 1 && day <= 31))
    ? { year, month, day, minutes, length } : null);
  let match = ISO_DATE.exec(value);
  if (match) {
    const minutes = match[4] ? Number(match[4]) * 60 + Number(match[5]) : 0;
    return valid(Number(match[1]), Number(match[2]), match[3] ? Number(match[3]) : null, minutes, match[0].length);
  }
  match = NUMERIC_DATE.exec(value);
  if (match) {
    let [day, month] = [Number(match[1]), Number(match[2])];
    if (month > 12 && day <= 12) [day, month] = [month, day];
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return valid(year, month, day, 0, match[0].length);
  }
  match = DAY_MONTH.exec(value);
  if (match && MONTHS[monthKey(match[2])]) return valid(match[3] ? Number(match[3]) : null, MONTHS[monthKey(match[2])], Number(match[1]), 0, match[0].length);
  match = MONTH_DAY.exec(value);
  if (match && MONTHS[monthKey(match[1])]) return valid(match[3] ? Number(match[3]) : null, MONTHS[monthKey(match[1])], Number(match[2]), 0, match[0].length);
  match = MONTH_YEAR.exec(value);
  if (match && MONTHS[monthKey(match[1])]) return valid(Number(match[2]), MONTHS[monthKey(match[1])], null, 0, match[0].length);
  return null;
}

// ── Pasting and importing ───────────────────────────────────────────────────────

/**
 * @typedef {{ format: 'html'|'tsv'|'csv', cells: string[][], header: boolean, caption?: string, delimiter?: string }} Grid
 *   `cells` are Markdown, one row each, all as long; `header` says whether the
 *   first row reads as a header (the caller may decide otherwise).
 */

/**
 * Plain text as Markdown that shows exactly it: the marks that would turn into
 * emphasis, code, a link or HTML get a backslash. A lone `*` or `~` stays as
 * written, as nothing pairs with it. `context` is the whole cell, when the text is
 * one piece of it. Pipes are left to the writer.
 */
export function escapeText(text, context = text) {
  const value = String(text ?? '');
  const whole = String(context ?? '');
  const pairs = (mark) => whole.split(mark).length > 2;
  const link = /\]\(|\[\[|\]\[/.test(whole);
  return value.replace(/[\\`*_~[\]<&]/g, (mark, at) => {
    if (mark === '\\') return /[!-/:-@[-`{-~]/.test(value[at + 1] ?? '') ? '\\\\' : mark;
    if (mark === '<') return /[A-Za-z/!?]/.test(value[at + 1] ?? '') ? '\\<' : mark;
    if (mark === '&') return /^&(?:#\d{1,7}|#[xX][\da-fA-F]{1,6}|[A-Za-z][A-Za-z\d]{1,31});/.test(value.slice(at)) ? '\\&' : mark;
    if (mark === '[' || mark === ']') return link ? `\\${mark}` : mark;
    if (mark === '_' && /[\p{L}\d]/u.test(value[at - 1] ?? '') && /[\p{L}\d]/u.test(value[at + 1] ?? '')) return mark;
    return pairs(mark) ? `\\${mark}` : mark;
  });
}

/** A plain cell (a spreadsheet's, a CSV's) as Markdown: one line, its marks escaped. */
function plainCell(text) {
  return escapeText(cellText(text));
}

/** Whether a first row reads as names over the rows rather than as a row: words, none repeated, no number or date. */
export function guessHeader(cells) {
  if (!cells || cells.length < 2) return false;
  const first = cells[0].filter((cell) => !blank(cell));
  if (!first.length) return false;
  if (first.some((cell) => readNumber(cell) || readDate(cell))) return false;
  return new Set(first.map((cell) => plainText(cell).toLowerCase())).size === first.length;
}

/** Records of a delimited text, quotes read the way spreadsheets write them. */
function splitRecords(text, delimiter) {
  const records = [];
  let record = [];
  let at = 0;
  const length = text.length;
  const lastQuote = text.lastIndexOf('"');
  const fieldEnd = (from) => {
    let end = from;
    while (end < length && text[end] !== delimiter && text[end] !== '\n' && text[end] !== '\r') end += 1;
    return end;
  };
  while (at <= length) {
    let field;
    if (text[at] === '"' && at < lastQuote) {
      let value = '';
      let from = at + 1;
      let done = false;
      while (!done) {
        const quote = text.indexOf('"', from);
        if (quote === -1) break;
        if (text[quote + 1] === '"') {
          value += text.slice(from, quote + 1);
          from = quote + 2;
          continue;
        }
        const next = text[quote + 1];
        if (next === undefined || next === delimiter || next === '\n' || next === '\r') {
          field = value + text.slice(from, quote);
          at = quote + 1;
        }
        done = true;
      }
    }
    if (field === undefined) {
      const end = fieldEnd(at);
      field = text.slice(at, end);
      at = end;
    }
    record.push(field);
    if (at >= length) {
      records.push(record);
      break;
    }
    if (text[at] === delimiter) {
      at += 1;
      if (at === length) {
        record.push('');
        records.push(record);
        break;
      }
      continue;
    }
    at += text[at] === '\r' && text[at + 1] === '\n' ? 2 : 1;
    records.push(record);
    record = [];
    if (at === length) break;
  }
  return records.filter((row, index) => !(index === records.length - 1 && row.length === 1 && row[0] === ''));
}

const DELIMITERS = ['\t', ';', ',', '|'];

/**
 * The separator a delimited text uses: the one that splits its first records into
 * the same number of fields, more than one. Tab, then `;` (a French spreadsheet,
 * whose decimal mark is the comma), then `,`, then `|`. Null when none does.
 */
export function guessDelimiter(text) {
  const sample = String(text ?? '').replace(/^\uFEFF/, '').slice(0, 65536);
  let best = null;
  let bestShare = 0;
  for (const delimiter of DELIMITERS) {
    const records = splitRecords(sample, delimiter).slice(0, 50).filter((row) => row.some((cell) => cell.trim()));
    if (!records.length) continue;
    const counts = records.map((row) => row.length);
    const usual = mostCommon(counts, 1);
    if (usual < 2) continue;
    const share = counts.filter((count) => count === usual).length / counts.length;
    if (share > bestShare + 1e-9 && share >= 0.8) {
      best = delimiter;
      bestShare = share;
    }
  }
  return best;
}

/** A grid made even: every row as long, empty rows and columns at the edges dropped. */
function evenGrid(rows) {
  const filled = (row) => row.some((cell) => cell !== '');
  let start = 0;
  let end = rows.length;
  while (start < end && !filled(rows[start])) start += 1;
  while (end > start && !filled(rows[end - 1])) end -= 1;
  const kept = rows.slice(start, end);
  let width = Math.max(0, ...kept.map((row) => row.length));
  while (width > 0 && kept.every((row) => (row[width - 1] ?? '') === '')) width -= 1;
  return kept.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''));
}

/**
 * A CSV or TSV text as a grid: quotes, doubled quotes, line breaks inside quotes,
 * a byte-order mark and Excel's `sep=;` first line are read. The separator is
 * guessed unless given; a text with one field a line is one column.
 * @returns {Grid|null}
 */
export function readDelimited(text, { delimiter } = {}) {
  let source = String(text ?? '').replace(/^\uFEFF/, '');
  const hint = /^sep=(.)\r?\n/i.exec(source);
  if (hint) source = source.slice(hint[0].length);
  const used = delimiter ?? hint?.[1] ?? guessDelimiter(source) ?? ',';
  const cells = evenGrid(splitRecords(source, used).map((row) => row.map(plainCell)));
  if (!cells.length || !cells[0].length) return null;
  return { format: used === '\t' ? 'tsv' : 'csv', cells, header: guessHeader(cells), delimiter: used };
}

/** Whether clipboard text is a spreadsheet's cells: tab-separated, every row as long. */
function tabular(text) {
  if (!text.includes('\t')) return false;
  const records = splitRecords(text.replace(/^\uFEFF/, ''), '\t').filter((row) => row.some((cell) => cell.trim()));
  return records.length > 0 && records.every((row) => row.length === records[0].length) && records[0].length > 1;
}

/**
 * What the clipboard holds, as a grid: its HTML table (Excel, LibreOffice, Google
 * Sheets, a web page), else its tab-separated text. Null when it holds no table,
 * so a paste of words stays words; a single cell comes back as a 1×1 grid.
 * @returns {Grid|null}
 */
export function readClipboard({ html = '', text = '' } = {}) {
  const fromHtml = html ? readHtmlTable(html) : null;
  if (fromHtml) return fromHtml;
  if (text && tabular(text)) return readDelimited(text, { delimiter: '\t' });
  return null;
}

/**
 * A text file's table: `.tsv` and `.tab` are tab-separated, anything else has its
 * separator guessed.
 * @returns {Grid|null}
 */
export function readFile(text, { name = '' } = {}) {
  const delimiter = /\.(?:tsv|tab)$/i.test(name) ? '\t' : undefined;
  return readDelimited(text, { delimiter });
}

const SKIPPED = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'TITLE', 'META', 'LINK', 'COLGROUP', 'COL', 'CAPTION', 'BUTTON', 'svg', 'SVG']);
const BLOCK_ELEMENTS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'DL', 'DT', 'DD', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'TABLE', 'TR', 'FIGURE', 'FIGCAPTION']);

function hiddenElement(element) {
  return element.hasAttribute?.('hidden') || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(element.getAttribute?.('style') ?? '');
}

/** An address a link may keep: absolute http(s), its spaces and brackets encoded. */
function linkAddress(href) {
  const value = String(href ?? '').trim();
  if (!/^https?:\/\/\S/i.test(value)) return '';
  return value.replace(/[\s()<>]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

/** A cell of an HTML table as Markdown: its words, its web links kept, one line. */
function htmlCell(element) {
  const pieces = [];
  const words = (node) => {
    let out = '';
    for (const child of node.childNodes) {
      if (child.nodeType === 3) out += child.data;
      else if (child.nodeType === 1 && !SKIPPED.has(child.tagName) && !hiddenElement(child)) out += child.tagName === 'BR' ? ' ' : words(child);
    }
    return out;
  };
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        pieces.push({ text: child.data });
        continue;
      }
      if (child.nodeType !== 1 || SKIPPED.has(child.tagName) || hiddenElement(child)) continue;
      if (child.tagName === 'BR') {
        pieces.push({ text: '\n' });
        continue;
      }
      const href = child.tagName === 'A' ? linkAddress(child.getAttribute('href')) : '';
      if (href) {
        pieces.push({ text: words(child), href });
        continue;
      }
      const block = BLOCK_ELEMENTS.has(child.tagName);
      if (block) pieces.push({ text: '\n' });
      walk(child);
      if (block) pieces.push({ text: '\n' });
    }
  };
  walk(element);
  const squeeze = (text) => text.replace(/[ \t\n\r\f]+/g, ' ');
  const whole = squeeze(pieces.map((piece) => piece.text).join(''));
  let out = '';
  for (const piece of pieces) {
    const text = squeeze(piece.text);
    if (piece.href && text.trim()) {
      // a link's words never hold a bracket that would end them
      const label = escapeText(text.trim(), whole).replace(/(?<!\\)[[\]]/g, '\\$&');
      out += `${/^\s/.test(text) ? ' ' : ''}[${label}](${piece.href})${/\s$/.test(text) ? ' ' : ''}`;
    } else out += escapeText(text, whole);
  }
  // the pieces met across a line break or a tag: their spaces fold into one, as a page shows them
  return cellText(out.replace(/[ \t\n\r\f]{2,}/g, ' '));
}

/** A row's own cells. */
function cellsOfRow(row) {
  return Array.from(row.children).filter((cell) => cell.tagName === 'TD' || cell.tagName === 'TH');
}

/** A table's own rows, not those of a table inside one of its cells. */
function ownRows(table) {
  return Array.from(table.querySelectorAll('tr')).filter((row) => row.closest('table') === table);
}

const MAX_SPAN = 200;

/**
 * The table of an HTML clipboard, or null. With several, the one with the most
 * cells of its own (a page's data table rather than the layout around it).
 * Merged cells are spread out: a cell spanning rows repeats down them, so each row
 * stands whole, and one spanning columns fills the first and leaves the others
 * empty (in a header of several rows, its words head each column under it).
 * `<th>` rows and `<thead>` make the header; otherwise it is guessed.
 * @returns {Grid|null}
 */
export function readHtmlTable(html) {
  const source = String(html ?? '');
  if (!/<table[\s>]/i.test(source) || typeof DOMParser === 'undefined') return null;
  const document = new DOMParser().parseFromString(source, 'text/html');
  let chosen = null;
  let most = 0;
  for (const table of document.querySelectorAll('table')) {
    const count = ownRows(table).reduce((sum, row) => sum + cellsOfRow(row).length, 0);
    if (count > most) {
      most = count;
      chosen = table;
    }
  }
  if (!chosen) return null;
  const rows = ownRows(chosen).filter((row) => !hiddenElement(row));
  const slots = rows.map(() => []);
  rows.forEach((row, at) => {
    let column = 0;
    for (const cell of cellsOfRow(row)) {
      while (slots[at][column]) column += 1;
      const across = Math.min(MAX_SPAN, Math.max(1, Number.parseInt(cell.getAttribute('colspan') ?? '1', 10) || 1));
      const down = Math.min(rows.length - at, Math.max(1, Number.parseInt(cell.getAttribute('rowspan') ?? '1', 10) || 1));
      const text = htmlCell(cell);
      const heading = cell.tagName === 'TH';
      for (let dy = 0; dy < down; dy += 1) {
        for (let dx = 0; dx < across; dx += 1) {
          if (column + dx >= MAX_SPAN) continue;
          slots[at + dy][column + dx] = { text, heading, across: dx > 0 };
        }
      }
      column += across;
    }
  });
  const inHead = rows.map((row) => row.parentElement?.tagName === 'THEAD');
  let heads = inHead.lastIndexOf(true) + 1;
  if (!heads) {
    while (heads < rows.length - 1 && slots[heads].length && slots[heads].every((slot) => !slot || slot.heading)) heads += 1;
  }
  const width = Math.max(0, ...slots.map((row) => row.length));
  const body = (row) => Array.from({ length: width }, (_, column) => (row[column] && !row[column].across ? row[column].text : ''));
  let cells;
  let header = heads > 0;
  if (heads > 1) {
    const merged = Array.from({ length: width }, (_, column) => {
      const words = [];
      for (let at = 0; at < heads; at += 1) {
        const text = slots[at][column]?.text ?? '';
        if (text && words[words.length - 1] !== text) words.push(text);
      }
      return words.join(' ');
    });
    cells = [merged, ...slots.slice(heads).map(body)];
  } else cells = slots.map(body);
  cells = evenGrid(cells);
  if (!cells.length || !cells[0].length) return null;
  if (!header) header = guessHeader(cells);
  const caption = Array.from(chosen.children).find((child) => child.tagName === 'CAPTION');
  const grid = { format: 'html', cells, header };
  if (caption?.textContent.trim()) grid.caption = cellText(caption.textContent);
  return grid;
}

/**
 * A grid as a table: its first row the header when `header` says so (the guess
 * by default), else an empty header the analyst names. Columns of numbers are set
 * right unless `alignNumbers` is false. Past `maxRows` rows are cut, and `cut`
 * says how many, for the line that names it.
 * @returns {{ table: Table, text: string, cut: number }}
 */
export function gridToTable(grid, { header = grid.header, maxRows = MAX_ROWS, alignNumbers = true } = {}) {
  const width = Math.max(1, ...grid.cells.map((row) => row.length));
  const pad = (row) => Array.from({ length: width }, (_, index) => row?.[index] ?? '');
  const head = header ? pad(grid.cells[0]) : new Array(width).fill('');
  const all = (header ? grid.cells.slice(1) : grid.cells).map(pad);
  const rows = all.slice(0, maxRows);
  const draft = newTable({ header: head, rows });
  const align = alignNumbers ? readColumns(draft).map((column) => (column.numeric ? 'right' : null)) : null;
  const table = align?.some(Boolean) ? newTable({ header: head, rows, align }) : draft;
  return { table, text: serializeTable(table), cut: all.length - rows.length };
}
