/**
 * What a report is covered and signed with, as ordinary Markdown the analyst can
 * edit: a first page of its own above a `<!-- cover -->` line, words filled in
 * when the PDF is made (`{title}`, `{date}`, `{name}`, `{role}`,
 * `{organisation}`), and three pictures every note can show without a case file
 * (`azimut:logo`, `azimut:my-logo`, `azimut:my-signature`).
 *
 * The server fills and draws all of it (`engine/notes_pdf.py`); the editor only
 * draws what it will read, from the identity Settings › Publishing keeps.
 */

import { writeAttrs } from './pictureSize.js';

/** `<!-- cover -->` alone on its line: what is above it is page 1, with Look › Cover on Your own page. */
export const COVER_LINE = /^[ \t]*<!--[ \t]*cover[ \t]*-->[ \t]*$/i;
export const COVER_RULE = '<!-- cover -->';

/** The words a note may hold that the PDF fills in, and what fills each. */
export const PLACEHOLDERS = [
  { id: 'title', word: 'Title', said: "The note's title, filled in when the PDF is made" },
  { id: 'date', word: 'Date', said: 'The cover day, else the day the PDF is made' },
  { id: 'name', word: 'Name', said: 'Your name, from Settings › Publishing', setting: 'name' },
  { id: 'role', word: 'Role', said: 'Your role, from Settings › Publishing', setting: 'role' },
  { id: 'organisation', word: 'Organisation', said: 'Your organisation, from Settings › Publishing', setting: 'organisation' },
];

/** `{title}` and the rest, wherever they sit on a line. */
export const PLACEHOLDER = /\{(title|date|name|role|organisation)\}/g;

/** Every placeholder in a stretch of text, with where it sits. */
export function findPlaceholders(text, offset = 0) {
  return [...String(text ?? '').matchAll(PLACEHOLDER)].map((match) => ({
    from: offset + match.index, to: offset + match.index + match[0].length, id: match[1],
  }));
}

/** The pictures a note shows with no case file: each read from this computer, never fetched. */
export const BUILT_IN_PICTURES = [
  { id: 'logo', alt: 'Azimut', label: 'Azimut logo', width: '25%', unset: '' },
  { id: 'my-logo', alt: 'Logo', label: 'Your logo', width: '25%', unset: 'No logo set in Settings › Publishing', setting: 'logo' },
  { id: 'my-signature', alt: 'Signature', label: 'Your signature', width: '30%', unset: 'No signature set in Settings › Publishing', setting: 'signature' },
];

/** `azimut:logo` and its two kin, as an image's address. */
export const BUILT_IN_ADDRESS = /^azimut:(logo|my-logo|my-signature)$/;

export function builtInPicture(id) {
  return BUILT_IN_PICTURES.find((picture) => picture.id === id) ?? null;
}

/**
 * The line a picture is put in with: `![Logo](azimut:my-logo){width=25%}`. A
 * picture inside `::: center` still prints at the left unless its line says
 * where, so the cover and the signature write their place.
 */
export function builtInLine(id, align = '') {
  const picture = builtInPicture(id);
  return picture ? `![${picture.alt}](azimut:${picture.id})${writeAttrs({ width: picture.width, align })}` : '';
}

/**
 * Who signs, as Settings › Publishing keeps it: three lines of words and whether
 * the two pictures are set. `rev` changes when a picture is replaced, so the
 * editor asks for it again.
 */
export const NO_IDENTITY = Object.freeze({ name: '', role: '', organisation: '', logo: false, signature: false, rev: 0 });

/** The address the editor draws a built-in picture from, or '' while it is not set. */
export function builtInSrc(id, identity = NO_IDENTITY) {
  const picture = builtInPicture(id);
  if (!picture) return '';
  if (picture.setting && !identity?.[picture.setting]) return '';
  return `/api/notes/pictures/${picture.id}${picture.setting ? `?v=${identity?.rev ?? 0}` : ''}`;
}

/** What the editor shows for a placeholder: the value Settings holds, or '' to show its grey word. */
export function placeholderValue(id, identity = NO_IDENTITY) {
  const setting = PLACEHOLDERS.find((item) => item.id === id)?.setting;
  return setting ? String(identity?.[setting] ?? '').trim() : '';
}

/** The page 1 `/` › Cover page writes, at the very top: the mark in a corner, then the title and the day. */
export const COVER_SKELETON = [
  '::: top-right',
  builtInLine('logo', 'right'),
  ':::',
  '',
  '::: center',
  '# {title}',
  '',
  '<!--? A line under the title: what this report is -->',
  '',
  '{date}',
  ':::',
  COVER_RULE,
].join('\n');

/**
 * The block `/` › Signature writes: the picture, then who signs and when, one
 * line each. A line ends on a backslash, a hard break, or the PDF would run the
 * three into one; a line left empty is dropped when it prints.
 */
export const SIGNATURE_BLOCK = [
  '::: right',
  builtInLine('my-signature', 'right'),
  '',
  '**{name}**\\',
  '{role}, {organisation}\\',
  '{date}',
  ':::',
].join('\n');

/** The 0-based line of the cover rule, outside code, or -1. */
export function coverLineIndex(text) {
  const lines = String(text ?? '').split('\n');
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const open = /^\s*(```|~~~)/.exec(lines[index]);
    if (open) {
      if (!fence) fence = open[1];
      else if (lines[index].trim().startsWith(fence)) fence = null;
      continue;
    }
    if (!fence && COVER_LINE.test(lines[index])) return index;
  }
  return -1;
}

export function hasCover(text) {
  return coverLineIndex(text) >= 0;
}

/**
 * The change that writes the cover at the top of a note, over any blank lines it
 * starts with, and where the cursor goes in it: on the guidance under the title,
 * the first line to write. Null when the note has a cover already.
 */
export function coverChange(text) {
  const body = String(text ?? '');
  if (hasCover(body)) return null;
  const blank = /^\s*\n/.exec(body)?.[0].length ?? 0;
  return { from: 0, to: blank, insert: `${COVER_SKELETON}\n\n`, cursor: COVER_SKELETON.indexOf('<!--?') };
}
