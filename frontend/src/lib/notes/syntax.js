/**
 * What the note editor reads in a note and offers to write into it, as plain
 * functions: the case references it draws as chips, the coordinates it makes
 * clickable, the records `@` offers and the blocks `/` inserts.
 *
 * The format stays the Markdown the PDF and `lib/markdown.js` read; nothing here
 * adds a syntax a note on disk would need to be read with.
 */
import { fileUrl } from '../fileUrl.js';
import { entityReference, mediaReference } from '../markdown.js';
import { foldText } from '../textFold.js';
import { CALLOUTS, calloutMarkdown } from './callouts.js';
import { PAGE_BREAK, hintLine } from './look.js';
import { writeAttrs } from './pictureSize.js';

/** `[[entity:id|label]]` and `[[media:id|label]]{width=… align=…}`. */
export const REFERENCE = /\[\[(entity|media):([A-Za-z0-9_-]+)\|([^\]\n]+)\]\](?:\{([^}\n]+)\})?/g;

/** Every case reference in a stretch of text, with where it sits. */
export function findReferences(text, offset = 0) {
  const found = [];
  for (const match of String(text ?? '').matchAll(REFERENCE)) {
    found.push({
      from: offset + match.index,
      to: offset + match.index + match[0].length,
      kind: match[1],
      id: match[2],
      label: match[3],
      attrs: match[4] ?? '',
    });
  }
  return found;
}

/**
 * A decimal latitude, longitude pair: `33.5138, 36.2765`. Three decimals at least,
 * so a version number or a score is not taken for a place; a full stop may end the
 * sentence it closes.
 */
const COORDINATES = /(?<![\w.])(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})(?!\w|\.\d)/g;

/** Every coordinate pair in a stretch of text that is a real point on Earth. */
export function findCoordinates(text, offset = 0) {
  const found = [];
  for (const match of String(text ?? '').matchAll(COORDINATES)) {
    const lat = Number(match[1]);
    const lon = Number(match[2]);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    found.push({ from: offset + match.index, to: offset + match.index + match[0].length, lat, lon });
  }
  return found;
}

/** A URL pasted on its own, which the editor offers to file as a bookmark. */
export function pastedUrl(text) {
  const value = String(text ?? '').trim();
  if (!/^https?:\/\/\S+$/i.test(value) || value.length > 2000) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The records whose file is a picture a note can show: a proof's is its PNG. */
const PICTURE_TYPES = new Set(['media', 'capture', 'proof']);

/** The reference a record is cited by: a picture shows, anything else is named. */
export function citation(entity) {
  if (!entity?.id) return '';
  const shows = PICTURE_TYPES.has(entity.type) && entity.attrs?.path
    && (entity.attrs?.kind ?? 'image') !== 'video';
  return shows ? mediaReference(entity) : entityReference(entity);
}

/**
 * A picture a tool puts in a note: its reference, under the label given (the
 * record's own name else), with a width and a caption when they are known. The
 * caption is a measured fact or the analyst's own sentence, never the tool's.
 */
export function picturePut(entity, { label = '', width = '', caption = '' } = {}) {
  if (!entity?.id) return '';
  const named = String(label || entity.label || '').trim() || 'Picture';
  return `${mediaReference({ id: entity.id, label: named })}${writeAttrs({ width, caption })}`;
}

/** A point as a note writes it: decimal degrees to five places, about a metre, which the note makes a chip. */
export function pointText(lat, lon) {
  const y = Number(lat);
  const x = Number(lon);
  if (!Number.isFinite(y) || !Number.isFinite(x) || Math.abs(y) > 90 || Math.abs(x) > 180) return '';
  return `${y.toFixed(5)}, ${x.toFixed(5)}`;
}

/** An image just added to the case, as the note shows it: its media when it has one, its file else. */
export function uploadedImage(caseId, item, entity) {
  return entity ? mediaReference(entity) : `![${item.filename}](${fileUrl(caseId, item.path)})`;
}

/**
 * The records `@` offers for what is typed after it: a name starting with it
 * first, then one holding it, suggestions left out.
 */
export function mentionMatches(entities, query, limit = 30) {
  const wanted = foldText(String(query ?? '').trim());
  const rows = [];
  for (const entity of entities ?? []) {
    if (!entity?.id || !entity.label || entity.provenance?.status === 'suggested') continue;
    const label = foldText(entity.label);
    const rank = !wanted ? 1 : label.startsWith(wanted) ? 0 : label.includes(wanted) ? 1 : -1;
    if (rank >= 0) rows.push({ entity, rank });
  }
  rows.sort((a, b) => a.rank - b.rank || a.entity.label.localeCompare(b.entity.label));
  return rows.slice(0, limit).map((row) => row.entity);
}

/** `2026-11-04 14:32 (UTC+1)`: the analyst's own clock, as a log entry is dated. */
export function logStamp(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const offset = -now.getTimezoneOffset();
  const hours = Math.trunc(Math.abs(offset) / 60);
  const minutes = Math.abs(offset) % 60;
  const zone = offset === 0 ? 'UTC' : `UTC${offset > 0 ? '+' : '-'}${hours}${minutes ? `:${pad(minutes)}` : ''}`;
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} (${zone})`;
}

const TABLE = '| Source | Status |\n| --- | --- |\n|  |  |';
const DIAGRAM = '```mermaid\nflowchart LR\n  A[Tip] --> B[Check]\n  B --> C[Confirmed]\n```';

/**
 * What `/` inserts. A `line` command replaces the start of the line it is typed
 * on (a heading, a list); a `block` one goes on lines of its own; an `action`
 * opens something (the record picker, a file) rather than writing text.
 */
export const SLASH_COMMANDS = [
  { id: 'h1', label: 'Heading 1', icon: 'text', words: 'title h1', line: '# ' },
  { id: 'h2', label: 'Heading 2', icon: 'text', words: 'subtitle h2 section', line: '## ' },
  { id: 'h3', label: 'Heading 3', icon: 'text', words: 'h3', line: '### ' },
  { id: 'entry', label: 'Log entry', icon: 'clock', words: 'journal date time now stamp', entry: true },
  { id: 'task', label: 'To-do', icon: 'check', words: 'task checkbox todo', line: '- [ ] ' },
  { id: 'bullet', label: 'Bulleted list', icon: 'list', words: 'list bullet', line: '- ' },
  { id: 'numbered', label: 'Numbered list', icon: 'numbered', words: 'list ordered number', line: '1. ' },
  ...CALLOUTS.map((callout) => ({
    id: `callout-${callout.kind}`, label: callout.label, icon: 'quote', words: `callout box ${callout.hint}`,
    line: `${calloutMarkdown(callout.kind)}`, colour: callout.colour, hint: callout.hint,
  })),
  { id: 'quote', label: 'Quote', icon: 'quote', words: 'blockquote cite', line: '> ' },
  { id: 'cite', label: 'Case item', icon: 'at', words: 'mention reference link entity place person', action: 'cite' },
  { id: 'picture', label: 'Case picture', icon: 'image', words: 'media image photo capture video', action: 'picture' },
  { id: 'upload', label: 'Image from a file', icon: 'upload', words: 'upload picture file', action: 'upload' },
  { id: 'include', label: 'Include a note', icon: 'note', words: 'chapter report embed note', action: 'include', hint: 'As a chapter', notes: true },
  { id: 'hint', label: 'Guidance', icon: 'help', words: 'hint guide help template', hint: 'Grey, never printed', template: true },
  { id: 'table', label: 'Table', icon: 'table', words: 'grid columns', block: TABLE },
  { id: 'diagram', label: 'Diagram', icon: 'network', words: 'mermaid flowchart chart', block: DIAGRAM },
  { id: 'code', label: 'Code', icon: 'hash', words: 'code block monospace', block: '```\n\n```' },
  { id: 'divider', label: 'Divider', icon: 'minus', words: 'rule line separator hr', block: '---' },
  { id: 'pagebreak', label: 'Page break', icon: 'file', words: 'new page pdf break', block: PAGE_BREAK, hint: 'PDF only' },
  { id: 'date', label: 'Today’s date', icon: 'calendar', words: 'day today', today: true },
];

/**
 * The commands matching what is typed after `/`, best first. A template offers
 * guidance and no chapter (a note of one case has no place in it); a note the
 * other way round.
 */
export function slashMatches(query, { template = false } = {}) {
  const wanted = foldText(String(query ?? '').trim());
  const offered = SLASH_COMMANDS.filter((command) => (template ? !command.notes : !command.template));
  if (!wanted) return offered;
  const scored = [];
  for (const command of offered) {
    const label = foldText(command.label);
    const words = foldText(`${command.label} ${command.words}`);
    const rank = label.startsWith(wanted) ? 0 : words.split(/\s+/).some((word) => word.startsWith(wanted)) ? 1
      : words.includes(wanted) ? 2 : -1;
    if (rank >= 0) scored.push({ command, rank });
  }
  return scored.sort((a, b) => a.rank - b.rank).map((row) => row.command);
}

/** `2026-11-04`, the day a `/date` writes. */
export function today(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The text a command writes, and where the cursor lands in it, for a command typed
 * on a line holding `before` (what precedes the `/`) and nothing after the query.
 * `null` for an action, which the editor carries out itself.
 */
export function slashInsert(command, { before = '', now = new Date() } = {}) {
  if (command.action) return null;
  const alone = !before.trim();
  if (command.line) {
    const text = alone ? command.line : `\n${command.line}`;
    return { text, cursor: text.length };
  }
  if (command.entry) {
    const text = `${alone ? '' : '\n\n'}### ${logStamp(now)}\n`;
    return { text, cursor: text.length };
  }
  if (command.today) {
    const text = today(now);
    return { text, cursor: text.length };
  }
  if (command.template) {
    // guidance is a line of its own, the cursor where its words go
    const text = `${alone ? '' : '\n\n'}${hintLine()}\n`;
    return { text, cursor: text.length - 5 };
  }
  const lead = alone ? '' : '\n\n';
  const text = `${lead}${command.block}\n`;
  // inside the fence of a code block, and on the first empty cell of a table
  const inner = command.id === 'code' ? lead.length + 4 : command.id === 'table' ? text.length - 6 : text.length;
  return { text, cursor: inner };
}

/** A note's Markdown with a block added at its end, a blank line between. */
export function appended(text, block) {
  const body = String(text ?? '');
  const add = String(block ?? '').trim();
  if (!add) return body;
  if (!body.trim()) return `${add}\n`;
  return `${body.replace(/\s*$/, '')}\n\n${add}\n`;
}
