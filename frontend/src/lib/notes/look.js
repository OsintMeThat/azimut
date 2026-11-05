/**
 * How a note prints: its look (a style, a typeface and a text size, a page size,
 * an accent, a TLP marking, a cover, a table of contents, numbered headings, a
 * list of sources at the end), and the two lines a report is made of, chapters
 * and guidance.
 *
 * A look is kept beside the note, never in its Markdown (`notes/{id}/look`), so
 * a note without one prints exactly as before. The server checks every look it
 * is given; what is here only fills the defaults and reads what it answers.
 */
import { api } from '../api.js';

export const DEFAULT_LOOK = Object.freeze({
  style: 'plain',
  font: '',
  size: '',
  page: 'a4',
  accent: '',
  tlp: '',
  cover: Object.freeze({ on: false, mode: '', top: false, subtitle: '', image: '', date: '' }),
  toc: false,
  numbered: false,
  sources: '',
});

/** Each style, and the typeface it sets its text in when none is picked (`engine/notes_style.py`). */
export const STYLES = [
  { id: 'plain', label: 'Plain', note: 'The note as it reads', font: 'serif' },
  { id: 'report', label: 'Report', note: 'Cover, contents, numbered parts', font: 'serif' },
  { id: 'brief', label: 'Brief', note: 'Verdict first, one or two pages', font: 'sans' },
  { id: 'journal', label: 'Journal', note: 'Dated entries, times in the margin', font: 'serif' },
];

/**
 * The typefaces a note can print in, "" being the style's own. The labels are
 * stand-ins until the server names each family (`GET /api/notes/fonts`).
 */
export const FONTS = [
  { id: '', label: "Style's own" },
  { id: 'serif', label: 'Noto Serif', note: 'Serif text, sans headings' },
  { id: 'sans', label: 'Noto Sans', note: 'Sans throughout' },
  { id: 'book', label: 'Literata', note: 'A book serif for long write-ups' },
  { id: 'modern', label: 'IBM Plex Sans', note: 'A clean sans for short briefs' },
];

/** The text size, against the style's own: headings, tables and captions follow. */
export const SIZES = [
  { id: 'small', label: 'Smaller' },
  { id: '', label: 'Normal' },
  { id: 'large', label: 'Larger' },
];

export const PAGES = [
  { id: 'a4', label: 'A4' },
  { id: 'letter', label: 'Letter' },
];

/** FIRST TLP 2.0: coloured words on black, as every page prints them. */
export const TLPS = [
  { id: '', label: 'None' },
  { id: 'clear', label: 'CLEAR', colour: '#ffffff' },
  { id: 'green', label: 'GREEN', colour: '#33ff00' },
  { id: 'amber', label: 'AMBER', colour: '#ffc000' },
  { id: 'amber-strict', label: 'AMBER+STRICT', colour: '#ffc000' },
  { id: 'red', label: 'RED', colour: '#ff2b2b' },
];

/** The list of sources at the end: "" follows the style, on for every style but Plain. */
export const SOURCES = [
  { id: '', label: "Style's own" },
  { id: 'on', label: 'On' },
  { id: 'off', label: 'Off' },
];

/** The styles that print no list of sources unless it is turned on (`engine/notelook.py`). */
export const SOURCES_OFF_STYLES = ['plain'];

export const SUBTITLE_MAX = 200;

/**
 * The cover: none, the style's own (title, subtitle, picture, day), or the
 * analyst's own page, what sits above the `<!-- cover -->` line
 * (`lib/notes/reportParts.js`). `mode` and `top` are written only once set, as
 * the late keys are, so an older Azimut still reads a look that never used them.
 */
export const COVERS = [
  { id: 'off', label: 'Off' },
  { id: 'style', label: "The style's" },
  { id: 'own', label: 'Your own page' },
];
const COVER_MODES = [{ id: '' }, { id: 'own' }];

/** Which of the three covers a look prints. */
export function coverChoice(look) {
  const { cover } = normaliseLook(look);
  return !cover.on ? 'off' : cover.mode === 'own' ? 'own' : 'style';
}

/** The cover part of a look for one of the three choices, the rest kept. */
export function coverFor(choice) {
  if (choice === 'own') return { on: true, mode: 'own' };
  if (choice === 'style') return { on: true, mode: '' };
  return { on: false, mode: '' };
}

/** A look with the analyst's own first page. */
export function ownCover(look) {
  const whole = normaliseLook(look);
  return normaliseLook({ ...whole, cover: { ...whole.cover, ...coverFor('own') } });
}

const pick = (value, choices, fallback) => (choices.some((choice) => choice.id === value) ? value : fallback);
const HEX = /^#[0-9a-f]{6}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A whole look from whatever was kept: missing keys take the default, unknown ones are dropped. */
export function normaliseLook(look) {
  const given = look && typeof look === 'object' ? look : {};
  const cover = given.cover && typeof given.cover === 'object' ? given.cover : {};
  const accent = String(given.accent ?? '').toLowerCase();
  const date = String(cover.date ?? '');
  return {
    style: pick(given.style, STYLES, DEFAULT_LOOK.style),
    font: pick(given.font ?? '', FONTS, ''),
    size: pick(given.size ?? '', SIZES, ''),
    page: pick(given.page, PAGES, DEFAULT_LOOK.page),
    accent: HEX.test(accent) ? accent : '',
    tlp: pick(given.tlp ?? '', TLPS, ''),
    cover: {
      on: Boolean(cover.on),
      mode: pick(cover.mode ?? '', COVER_MODES, ''),
      top: Boolean(cover.top),
      subtitle: String(cover.subtitle ?? '').slice(0, SUBTITLE_MAX),
      image: String(cover.image ?? ''),
      date: DAY.test(date) ? date : '',
    },
    toc: Boolean(given.toc),
    numbered: Boolean(given.numbered),
    sources: pick(given.sources ?? '', SOURCES, ''),
  };
}

/** A look a template can carry: no picture and no day of a case. */
export function templateLook(look) {
  const whole = normaliseLook(look);
  return { ...whole, cover: { ...whole.cover, image: '', date: '' } };
}

/** The look a report made from the home starts with: a cover, then the contents. */
export function reportLook() {
  return normaliseLook({ style: 'report', cover: { on: true }, toc: true });
}

/** Whether a look differs from the one every note has without one. */
export function isPlainLook(look) {
  return JSON.stringify(normaliseLook(look)) === JSON.stringify(normaliseLook(null));
}

export function styleLabel(style) {
  return STYLES.find((item) => item.id === style)?.label ?? 'Plain';
}

/** Whether a look ends on the list of sources: as it was set, or as its style has it. */
export function sourcesOn(look) {
  const whole = normaliseLook(look);
  return whole.sources ? whole.sources === 'on' : !SOURCES_OFF_STYLES.includes(whole.style);
}

/** The typeface a look prints its text in: the one picked, or its style's own. */
export function lookFont(look) {
  const whole = normaliseLook(look);
  return whole.font || STYLES.find((item) => item.id === whole.style)?.font || 'serif';
}

/** A note of the home that reads as a report: a style of its own, or chapters. */
export function isReport(row) {
  return Boolean((row?.look?.style && row.look.style !== 'plain') || row?.includes > 0);
}

/** `case` for the case notes, the note's id otherwise. */
function lookKey(noteId) {
  return noteId || 'case';
}

export async function readLook(caseId, noteId) {
  const answer = await api.get(`/api/cases/${caseId}/notes/${lookKey(noteId)}/look`);
  return normaliseLook(answer?.look);
}

export async function writeLook(caseId, noteId, look) {
  const answer = await api.put(`/api/cases/${caseId}/notes/${lookKey(noteId)}/look`, normaliseLook(look));
  return normaliseLook(answer?.look);
}

// -- the lines a report is made of ----------------------------------------------

/** `[[include:<id>]]` alone on its line: the note it names, printed as a chapter. */
export const INCLUDE_LINE = /^\[\[include:([A-Za-z0-9_-]+)\]\][ \t]*$/;

/** `<!--? … -->` alone on its line: guidance a template leaves, never printed. */
export const HINT_LINE = /^[ \t]*<!--\?[ \t]*(.*?)[ \t]*-->[ \t]*$/;

/** `<!-- pagebreak -->` alone on its line: the PDF starts a new page there, and nothing else shows it. */
export const PAGE_BREAK_LINE = /^[ \t]*<!--[ \t]*page[ \t-]?break[ \t]*-->[ \t]*$/i;
export const PAGE_BREAK = '<!-- pagebreak -->';

export function includeLine(noteId) {
  return `[[include:${noteId}]]`;
}

export function hintLine(text = '') {
  return `<!--? ${String(text).replace(/-->/g, '').replace(/\n/g, ' ').trim()} -->`;
}

/** The body of a report made of these notes, in this order, one chapter each. */
export function reportBody(noteIds) {
  return noteIds.length ? `${noteIds.map(includeLine).join('\n\n')}\n` : '';
}
