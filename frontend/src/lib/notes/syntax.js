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
import { CORNERS, writeAttrs } from './pictureSize.js';
import { PLACEHOLDERS, SIGNATURE_BLOCK, builtInLine } from './reportParts.js';

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
/**
 * The two blocks an HTML page plays (`engine/notes_html.py`), as `/` writes them
 * empty: each picture put inside opens a step. A PDF prints them in order, the
 * pictures then the words.
 */
export const STEPS_BLOCK = `::: steps\n${hintLine('One picture a line, each a step with its caption: / › Case picture')}\n:::`;
export const STORY_BLOCK = `::: story\n${hintLine('A picture, then the words read beside it. {zoom=x,y,w,h} after a picture moves in on a part of it')}\n:::`;
/** The names a block of steps or a story opens with. */
export const PLAYED_BLOCK = /^:::[ \t]*(steps|story)[ \t]*$/;
/** A chart as the raw Markdown's `/` › Chart writes it: a kind over a table to fill (`engine/notes_charts.py`). */
export const CHART_STARTER = '::: chart\nkind: bars\n| Category | Count |\n| --- | ---: |\n|  |  |\n|  |  |\n:::';
/** A map's block (`::: map`), which an HTML page draws as a map and a PDF as its picture. */
export const MAP_BLOCK = /^:::[ \t]*map[ \t]*$/;
const DIAGRAM = '```mermaid\nflowchart LR\n  A[Tip] --> B[Check]\n  B --> C[Confirmed]\n```';

/** The `:::` blocks `/` › Alignment offers: where a line sits, or a corner of the cover. */
const ALIGNMENTS = [
  { id: 'center', label: 'Align centre', icon: 'alignCentreH', words: 'centre center middle', hint: 'The line, centred' },
  { id: 'right', label: 'Align right', icon: 'alignRight', words: 'right', hint: 'The line, at the right' },
  ...CORNERS.map((corner) => ({
    id: corner, label: `Corner: ${corner.replace('-', ' ')}`, icon: corner.endsWith('left') ? 'alignLeft' : 'alignRight',
    words: `corner pin cover logo ${corner.replace('-', ' ')}`, hint: 'Pinned on the cover, else aligned',
  })),
];

/**
 * What `/` inserts. A `line` command replaces the start of the line it is typed
 * on (a heading, a list); a `block` one goes on lines of its own; a `wrap` one
 * puts the line in a `:::` block; an `action` opens something (the record
 * picker, a file) rather than writing text; a `text` one writes its words where it
 * is typed (a field the PDF fills in). A `menu` command is a group: it stands in the
 * bare list and, picked, types its name so the commands of its `group` (offered only
 * once something is typed) come up together. `hint` is the line under its name in the
 * menu, `icon` (or `glyph`, a heading's level) what it is drawn with; where it stands
 * in the menu is `INSERT_SECTIONS`'s to say.
 */
export const SLASH_COMMANDS = [
  { id: 'h1', label: 'Heading 1', icon: 'text', glyph: 'H1', words: 'title h1', line: '# ', hint: 'A part of the note' },
  { id: 'h2', label: 'Heading 2', icon: 'text', glyph: 'H2', words: 'subtitle h2 section', line: '## ', hint: 'A section' },
  { id: 'h3', label: 'Heading 3', icon: 'text', glyph: 'H3', words: 'h3', line: '### ', hint: 'A smaller section' },
  { id: 'entry', label: 'Log entry', icon: 'clock', words: 'journal date time now stamp', entry: true, hint: 'A heading with the time now' },
  { id: 'task', label: 'To-do', icon: 'check', words: 'task checkbox todo', line: '- [ ] ', hint: 'A box to tick, listed in the To-do' },
  { id: 'bullet', label: 'Bulleted list', icon: 'list', words: 'list bullet', line: '- ', hint: 'A simple list' },
  { id: 'numbered', label: 'Numbered list', icon: 'numbered', words: 'list ordered number', line: '1. ', hint: 'A list in order' },
  { id: 'callout', label: 'Callout', icon: 'quote', words: 'callout box', menu: 'callout', hint: 'Confirmed, unverified, lead, limits…' },
  // every kind is found by its name; Internal also stands in the bare list, the others under Callout
  ...CALLOUTS.map((callout) => ({
    id: `callout-${callout.kind}`, label: callout.label, icon: callout.kind === 'internal' ? 'lock' : 'quote',
    words: `callout box ${callout.words ?? ''} ${callout.hint}`, line: `${calloutMarkdown(callout.kind)}`, colour: callout.colour,
    hint: callout.hint, ...(callout.kind === 'internal' ? {} : { group: 'callout' }),
  })),
  { id: 'quote', label: 'Quote', icon: 'quote', words: 'blockquote cite', line: '> ', hint: 'Words someone said or wrote' },
  { id: 'cite', label: 'Case item', icon: 'at', words: 'mention reference link entity place person', action: 'cite', hint: 'A place, a person or a file, as a chip' },
  { id: 'picture', label: 'Case picture', icon: 'image', words: 'media image photo capture video', action: 'picture', hint: 'From the case’s media, captures and proofs' },
  { id: 'upload', label: 'Image from a file', icon: 'upload', words: 'upload picture file', action: 'upload', hint: 'Added to the case’s media' },
  { id: 'map', label: 'Interactive map', icon: 'mapArea', words: 'map layers plate proofs front timeline slider interactive', action: 'map', hint: 'Layers, a plate or proofs, in HTML', notes: true },
  { id: 'include', label: 'Include a note', icon: 'note', words: 'chapter report embed note', action: 'include', hint: 'As a chapter', notes: true },
  { id: 'hint', label: 'Guidance', icon: 'help', words: 'hint guide help template', hint: 'Grey, never printed', template: true },
  { id: 'table', label: 'Table', icon: 'table', words: 'grid columns rows spreadsheet csv file', block: TABLE, action: 'table', hint: 'Rows by columns, or from a file' },
  { id: 'chart', label: 'Chart', icon: 'chart', words: 'chart graph bars pie donut pictograms waffle timeline figures plot', action: 'chart', hint: 'Drawn from a table, picked by its picture' },
  { id: 'diagram', label: 'Diagram', icon: 'network', words: 'mermaid flowchart', block: DIAGRAM },
  { id: 'steps', label: 'Steps', icon: 'columns', words: 'stepper slides sequence carousel before after days', block: STEPS_BLOCK, hint: 'Pictures one at a time, in HTML' },
  { id: 'story', label: 'Story', icon: 'text', words: 'scrollytelling scroll narrative sticky zoom', block: STORY_BLOCK, hint: 'Words scroll beside a picture, in HTML' },
  { id: 'code', label: 'Code', icon: 'hash', words: 'code block monospace', block: '```\n\n```', hint: 'Kept as typed, in a fixed-width face' },
  { id: 'divider', label: 'Divider', icon: 'minus', words: 'rule line separator hr', block: '---', hint: 'A line across the page' },
  { id: 'pagebreak', label: 'Page break', icon: 'file', words: 'new page pdf break', block: PAGE_BREAK, hint: 'PDF only' },
  { id: 'cover', label: 'Cover page', icon: 'file', words: 'first page front title report', action: 'cover', hint: 'Page 1, as you write it' },
  { id: 'signature', label: 'Signature', icon: 'edit', words: 'sign name role organisation author', block: SIGNATURE_BLOCK, hint: 'From Settings › Publishing' },
  { id: 'my-logo', label: 'Your logo', icon: 'image', words: 'logo brand organisation picture', block: builtInLine('my-logo'), hint: 'From Settings › Publishing' },
  { id: 'align', label: 'Alignment', icon: 'alignCentreH', words: 'align', menu: 'align', hint: 'Centred or at the right' },
  // a corner is found by 'align' as it always was, and stands under Cover corner
  ...ALIGNMENTS.map(({ id, ...rest }) => ({
    id: `align-${id}`, ...rest, words: `align alignment ${rest.words}`, wrap: id, group: CORNERS.includes(id) ? 'corner' : 'align',
  })),
  { id: 'date', label: 'Today’s date', icon: 'calendar', words: 'day today', today: true, hint: 'Year, month, day' },
  { id: 'corner', label: 'Cover corner', icon: 'cornerTR', words: 'corner pin cover logo', menu: 'corner', hint: 'A logo or words in a corner of the cover' },
  { id: 'field', label: 'Field', icon: 'tag', words: 'field placeholder fill print', menu: 'field', hint: 'Your name, the title or the day, filled in when printed' },
  ...PLACEHOLDERS.map((field) => ({
    id: `field-${field.id}`, label: `Field: ${field.word.toLowerCase()}`, icon: 'tag', words: `field placeholder print ${field.id}`,
    text: `{${field.id}}`, hint: field.said, group: 'field',
  })),
];

/**
 * The insert menu's five parts, in order, and the entries each shows in the bare
 * list, in order: what `/` and the + in the margin open on. An entry of a group
 * (a callout's kind, a corner) comes up under its group's entry. An entry listed
 * nowhere stands at the end of its own `section`, Figures else.
 */
export const INSERT_SECTIONS = [
  { id: 'text', label: 'Text', ids: ['h1', 'h2', 'h3', 'bullet', 'numbered', 'task', 'quote', 'callout', 'callout-internal', 'code', 'date', 'entry', 'hint'] },
  { id: 'media', label: 'Media', ids: ['picture', 'upload', 'steps', 'story', 'my-logo'] },
  { id: 'case', label: 'From the case', ids: ['cite', 'map', 'include'] },
  { id: 'layout', label: 'Layout', ids: ['divider', 'pagebreak', 'cover', 'align', 'corner', 'signature', 'field'] },
  { id: 'figures', label: 'Figures', ids: ['table', 'chart', 'diagram'] },
];

/** The line under an entry's name, for the entries that carry none of their own. */
const ROW_HINTS = {
  table: 'Rows and columns',
  diagram: 'Boxes and arrows, drawn from text',
};

/** The line an entry shows under its name in the menu. */
export function slashHint(command) {
  return command.hint ?? ROW_HINTS[command.id] ?? '';
}

/** Where every entry stands in the menu, `{ section, order }` by id: a group's entries just after their group's own. */
function menuPlaces() {
  const places = new Map();
  let order = 0;
  const place = (command, section) => {
    if (places.has(command.id)) return;
    places.set(command.id, { section, order: order++ });
    if (command.menu) {
      for (const member of SLASH_COMMANDS) if (member.group === command.menu) place(member, section);
    }
  };
  const byId = new Map(SLASH_COMMANDS.map((command) => [command.id, command]));
  for (const section of INSERT_SECTIONS) {
    for (const id of section.ids) if (byId.has(id)) place(byId.get(id), section.id);
  }
  for (const command of SLASH_COMMANDS) {
    const own = INSERT_SECTIONS.some((section) => section.id === command.section) ? command.section : 'figures';
    place(command, own);
  }
  return places;
}

let places = null;

/** The part of the menu an entry stands in: `{ id, label, rank }`. */
export function slashSection(command) {
  places ??= menuPlaces();
  const id = places.get(command.id)?.section ?? 'figures';
  const rank = INSERT_SECTIONS.findIndex((section) => section.id === id);
  return { id, label: INSERT_SECTIONS[rank].label, rank };
}

/** The group entry whose name `query` is (`callout` for Callout), or null. */
export function slashGroup(query) {
  const wanted = foldText(String(query ?? '').trim());
  return SLASH_COMMANDS.find((command) => command.menu && command.menu === wanted) ?? null;
}

/**
 * The commands matching what is typed after `/`, best first, in the menu's order
 * when two match as well. With nothing typed, the bare list: every entry in its
 * part of the menu, a group's entries left under their group. A template offers
 * guidance and no chapter (a note of one case has no place in it); a note the
 * other way round.
 */
export function slashMatches(query, { template = false } = {}) {
  places ??= menuPlaces();
  const order = (command) => places.get(command.id)?.order ?? Infinity;
  const wanted = foldText(String(query ?? '').trim());
  const offered = SLASH_COMMANDS.filter((command) => (template ? !command.notes : !command.template));
  if (!wanted) return offered.filter((command) => !command.group).sort((a, b) => order(a) - order(b));
  const scored = [];
  for (const command of offered) {
    if (command.menu) continue;
    const label = foldText(command.label);
    const words = foldText(`${command.label} ${command.words}`);
    const rank = label.startsWith(wanted) ? 0 : words.split(/\s+/).some((word) => word.startsWith(wanted)) ? 1
      : words.includes(wanted) ? 2 : -1;
    if (rank >= 0) scored.push({ command, rank });
  }
  return scored.sort((a, b) => a.rank - b.rank || order(a.command) - order(b.command)).map((row) => row.command);
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
  if (command.action || command.menu) return null;
  if (command.wrap) return wrapInBlock(command.wrap, before);
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
  if (command.text) return { text: command.text, cursor: command.text.length };
  if (command.template) {
    // guidance is a line of its own, the cursor where its words go
    const text = `${alone ? '' : '\n\n'}${hintLine()}\n`;
    return { text, cursor: text.length - 5 };
  }
  const lead = alone ? '' : '\n\n';
  const text = `${lead}${command.block}\n`;
  // inside the fence of a code block, on the first empty cell of a table, and on the guidance a played block opens with
  const played = command.id === 'steps' || command.id === 'story';
  const inner = command.id === 'code' ? lead.length + 4 : command.id === 'table' ? text.length - 6
    : played ? text.length - 5 : text.length;
  return { text, cursor: inner };
}

/**
 * `words` set in a `::: name` block, and where the cursor lands: at the end of the
 * words, or on the empty line inside when there are none. The text replaces the
 * whole line it was typed on.
 */
export function wrapInBlock(name, words = '') {
  const inner = String(words).trim();
  const open = `::: ${name}\n`;
  return { text: `${open}${inner}\n:::`, cursor: open.length + inner.length };
}

/** A note's Markdown with a block added at its end, a blank line between. */
export function appended(text, block) {
  const body = String(text ?? '');
  const add = String(block ?? '').trim();
  if (!add) return body;
  if (!body.trim()) return `${add}\n`;
  return `${body.replace(/\s*$/, '')}\n\n${add}\n`;
}
