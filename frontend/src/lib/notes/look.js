/**
 * How a note prints: its look (a style, a typeface and a text size, a page size,
 * an accent, a TLP marking, a cover, a table of contents, numbered headings, a
 * list of sources at the end), and the two lines a report is made of, chapters
 * and guidance.
 *
 * A look is kept beside the note, never in its Markdown (`notes/{id}/look`), so
 * a note without one prints exactly as before. The server checks every look it
 * is given; what is here only fills the defaults and reads what it answers.
 *
 * `header` and `footer` are the late keys: a band of three one-line slots that
 * replaces the style's own running header or footer, written only once a slot is
 * filled, so a look that never used them reads and writes as it always did. `web`,
 * how the HTML page is laid out, is one too: the server keeps it only once set.
 *
 * The style is the profile: it says what the document carries after its text, the
 * sources list and how it is written, the five annexes and how strict the check is
 * about links (`STYLE_DEFAULTS`, Azimut's own; Settings › Publishing › Styles changes
 * them for every note). `sources_style`, `annexes` and `link_check` change them for
 * one note, late keys like the others.
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
  web: '',
  sources_style: '',
  link_check: '',
  annexes: Object.freeze({}),
});

/**
 * Each style, in the order the Look lists them, what it gives in a line, and the
 * typeface it sets its text in when none is picked (`engine/notes_style.py`).
 */
export const STYLES = [
  { id: 'report', label: 'Report', note: 'Academic sources, every annex', font: 'serif' },
  { id: 'article', label: 'Web article', note: 'Sources for the web, credits, corrections', font: 'serif' },
  { id: 'brief', label: 'Brief', note: 'Verdict first, one or two pages', font: 'sans' },
  { id: 'journal', label: 'Journal', note: 'Dated entries, times in the margin', font: 'serif' },
  { id: 'plain', label: 'Plain', note: 'The note as it reads, nothing added', font: 'serif' },
];

/** What a document may add after its text, beside the sources list, in the order it prints them. */
export const ANNEXES = [
  { id: 'geolocations', label: 'Geolocations', note: 'every proof cited' },
  { id: 'credits', label: 'Credits', note: 'imagery, maps, footage' },
  { id: 'method', label: 'How this was made', note: 'generated facts' },
  { id: 'limits', label: 'Limits', note: 'the Limits boxes' },
  { id: 'editions', label: 'Editions & corrections', note: 'what changed' },
];

/** How the sources list writes each source ("" is the style's own). */
export const SOURCES_STYLES = [
  { id: 'academic', label: 'Academic' },
  { id: 'web', label: 'Web' },
  { id: 'short', label: 'Short' },
];

/** How the check before export names the links with no archived copy or no seen day. */
export const LINK_CHECKS = [
  { id: 'each', label: 'Each link' },
  { id: 'grouped', label: 'One line' },
];

/**
 * What each style carries when nobody changed it: Azimut's own, decided in
 * `engine/notelook.py` (`PROFILES`). `tests/fixtures/note-styles.json` holds both to
 * the same table; Settings answers it with what Settings › Publishing › Styles changed.
 */
const no = { geolocations: false, credits: false, method: false, limits: false, editions: false };
export const STYLE_DEFAULTS = Object.freeze({
  plain: Object.freeze({ sources: false, sources_style: 'short', ...no, link_check: 'grouped' }),
  report: Object.freeze({
    sources: true, sources_style: 'academic', geolocations: true, credits: true, method: true, limits: true, editions: true,
    link_check: 'grouped',
  }),
  brief: Object.freeze({ sources: true, sources_style: 'short', ...no, link_check: 'grouped' }),
  journal: Object.freeze({ sources: true, sources_style: 'short', ...no, link_check: 'grouped' }),
  article: Object.freeze({ sources: true, sources_style: 'web', ...no, credits: true, editions: true, link_check: 'grouped' }),
});

/** A styles table as Settings answers it, each style whole: what it lacks is Azimut's own. */
export function stylesTable(given) {
  const table = {};
  for (const [style, own] of Object.entries(STYLE_DEFAULTS)) {
    const kept = given && typeof given === 'object' && given[style] && typeof given[style] === 'object' ? given[style] : {};
    const row = { ...own };
    for (const key of Object.keys(own)) {
      const value = kept[key];
      if (typeof value === typeof own[key] && (key !== 'sources_style' || SOURCES_STYLES.some((one) => one.id === value))
        && (key !== 'link_check' || LINK_CHECKS.some((one) => one.id === value))) row[key] = value;
    }
    table[style] = row;
  }
  return table;
}

/** Each of a look's profile switches as the note has it: the look's own, else its style's (`table`). */
export function profileOf(look, table = STYLE_DEFAULTS) {
  const whole = normaliseLook(look);
  const own = stylesTable(table)[whole.style];
  const profile = { ...own };
  if (whole.sources) profile.sources = whole.sources === 'on';
  if (whole.sources_style) profile.sources_style = whole.sources_style;
  if (whole.link_check) profile.link_check = whole.link_check;
  for (const annex of ANNEXES) {
    const set = whole.annexes[annex.id];
    if (set) profile[annex.id] = set === 'on';
  }
  return profile;
}

/** Which of a look's profile switches the note changed from its style's, by key. */
export function profileChanged(look) {
  const whole = normaliseLook(look);
  const changed = { sources: Boolean(whole.sources), sources_style: Boolean(whole.sources_style), link_check: Boolean(whole.link_check) };
  for (const annex of ANNEXES) changed[annex.id] = Boolean(whole.annexes[annex.id]);
  return changed;
}

/** The look with one profile switch set for this note, or back to the style's own (`value` null). */
export function withProfile(look, key, value) {
  const whole = normaliseLook(look);
  if (ANNEXES.some((annex) => annex.id === key)) {
    const annexes = { ...whole.annexes };
    if (value === null) delete annexes[key];
    else annexes[key] = value ? 'on' : 'off';
    return normaliseLook({ ...whole, annexes });
  }
  if (key === 'sources') return normaliseLook({ ...whole, sources: value === null ? '' : value ? 'on' : 'off' });
  return normaliseLook({ ...whole, [key]: value ?? '' });
}

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

/** How the HTML page is laid out, the PDF the same either way (`engine/notelook.py`, `Web`). */
export const WEBS = [
  { id: '', label: 'Article' },
  { id: 'story', label: 'Story' },
];

/** The styles that print no list of sources unless it is turned on, as Azimut ships them. */
export const SOURCES_OFF_STYLES = Object.keys(STYLE_DEFAULTS).filter((style) => !STYLE_DEFAULTS[style].sources);

export const SUBTITLE_MAX = 200;

/**
 * The two running bands of a page and their three slots. A slot is a line of
 * words (`{title}`, `{date}`, `{page}`, `{pages}`, `{name}`, `{role}`,
 * `{organisation}` are filled in when the PDF is made) or one of the two logos.
 */
export const BANDS = [
  { id: 'header', label: 'Header' },
  { id: 'footer', label: 'Footer' },
];
export const SLOTS = [
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Centre' },
  { id: 'right', label: 'Right' },
];
export const BAND_MAX = 120;

/** A slot that holds a logo instead of words: the analyst's own, or the app's. */
export const SLOT_LOGOS = [
  { id: 'azimut:my-logo', label: 'Your logo' },
  { id: 'azimut:logo', label: 'Azimut logo' },
];

/** The words a style prints in each band when the look leaves it empty (`engine/notes_style.py`). */
export function bandStyleOwn(style) {
  const none = { left: '', center: '', right: '' };
  return {
    header: none,
    footer: style === 'plain' ? { ...none, left: '{title}', right: '{page}' } : { ...none, left: '{date}', right: 'Page {page} / {pages}' },
  };
}

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

/** A slot as kept: one line, trimmed, at most `BAND_MAX` characters. */
export function slotText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, BAND_MAX).trimEnd();
}

/** A band as kept: its three slots, or null when all are empty. */
function bandOf(value) {
  const given = value && typeof value === 'object' ? value : {};
  const band = { left: slotText(given.left), center: slotText(given.center), right: slotText(given.right) };
  return band.left || band.center || band.right ? band : null;
}

const pick = (value, choices, fallback) => (choices.some((choice) => choice.id === value) ? value : fallback);

/** The annexes a look sets, each 'on' or 'off', in their order; the ones left to the style are left out. */
function annexesOf(value) {
  const given = value && typeof value === 'object' ? value : {};
  const kept = {};
  for (const annex of ANNEXES) if (given[annex.id] === 'on' || given[annex.id] === 'off') kept[annex.id] = given[annex.id];
  return kept;
}
const HEX = /^#[0-9a-f]{6}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A whole look from whatever was kept: missing keys take the default, unknown ones are dropped. */
export function normaliseLook(look) {
  const given = look && typeof look === 'object' ? look : {};
  const cover = given.cover && typeof given.cover === 'object' ? given.cover : {};
  const accent = String(given.accent ?? '').toLowerCase();
  const date = String(cover.date ?? '');
  const header = bandOf(given.header);
  const footer = bandOf(given.footer);
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
    web: pick(given.web ?? '', WEBS, ''),
    sources_style: pick(given.sources_style ?? '', SOURCES_STYLES, ''),
    link_check: pick(given.link_check ?? '', LINK_CHECKS, ''),
    annexes: annexesOf(given.annexes),
    ...(header && { header }),
    ...(footer && { footer }),
  };
}

/**
 * Which sections of the Look hold something set, a note with no look holding none:
 * what the panel's tabs mark with a dot. Style counts the contents, numbering and
 * sources switches and the web page's layout too, Page its paper, accent and marking.
 */
export function sectionsSet(look) {
  const whole = normaliseLook(look);
  return {
    style: whole.style !== DEFAULT_LOOK.style || whole.toc || whole.numbered || whole.sources !== '' || whole.web !== ''
      || whole.sources_style !== '' || whole.link_check !== '' || Object.keys(whole.annexes).length > 0,
    text: Boolean(whole.font || whole.size),
    page: whole.page !== DEFAULT_LOOK.page || Boolean(whole.accent || whole.tlp),
    cover: whole.cover.on,
    bands: Boolean(whole.header || whole.footer),
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

/** The words a style's own value of a switch is said with: `Report's own`. */
export function styleOwn(style) {
  return `${styleLabel(style)}'s own`;
}

/** Whether a look ends on the list of sources: as it was set, or as its style has it (`table`). */
export function sourcesOn(look, table = STYLE_DEFAULTS) {
  return profileOf(look, table).sources;
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
