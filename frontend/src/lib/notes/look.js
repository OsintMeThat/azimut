/**
 * How a note prints: its look (a style, a page size, an accent, a TLP marking,
 * a cover, a table of contents, numbered headings), and the two lines a report
 * is made of, chapters and guidance.
 *
 * A look is kept beside the note, never in its Markdown (`notes/{id}/look`), so
 * a note without one prints exactly as before. The server checks every look it
 * is given; what is here only fills the defaults and reads what it answers.
 */
import { api } from '../api.js';

export const DEFAULT_LOOK = Object.freeze({
  style: 'plain',
  page: 'a4',
  accent: '',
  tlp: '',
  cover: Object.freeze({ on: false, subtitle: '', image: '', date: '' }),
  toc: false,
  numbered: false,
});

export const STYLES = [
  { id: 'plain', label: 'Plain', note: 'The note as it reads' },
  { id: 'report', label: 'Report', note: 'Cover, contents, numbered parts' },
  { id: 'brief', label: 'Brief', note: 'Verdict first, one or two pages' },
  { id: 'journal', label: 'Journal', note: 'Dated entries, times in the margin' },
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

export const SUBTITLE_MAX = 200;

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
    page: pick(given.page, PAGES, DEFAULT_LOOK.page),
    accent: HEX.test(accent) ? accent : '',
    tlp: pick(given.tlp ?? '', TLPS, ''),
    cover: {
      on: Boolean(cover.on),
      subtitle: String(cover.subtitle ?? '').slice(0, SUBTITLE_MAX),
      image: String(cover.image ?? ''),
      date: DAY.test(date) ? date : '',
    },
    toc: Boolean(given.toc),
    numbered: Boolean(given.numbered),
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

// -- the two lines a report is made of ------------------------------------------

/** `[[include:<id>]]` alone on its line: the note it names, printed as a chapter. */
export const INCLUDE_LINE = /^\[\[include:([A-Za-z0-9_-]+)\]\][ \t]*$/;

/** `<!--? … -->` alone on its line: guidance a template leaves, never printed. */
export const HINT_LINE = /^[ \t]*<!--\?[ \t]*(.*?)[ \t]*-->[ \t]*$/;

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
