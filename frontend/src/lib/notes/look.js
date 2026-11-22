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
 * how the HTML page is laid out, is one too: the server keeps it only once set. So is
 * `counter`, the GoatCounter site a map page's web folder counts its readers on. And what the
 * note is on the analyst's site, `category`, `role` (a page, off the site's lists, or unlisted, in none),
 * `list_image` (the picture of its line in the list), `place` (where it stands on the site's map), `author` and
 * `author_image` (who wrote it when it is not the analyst, and their picture), which the publish dialog chooses
 * and the Look only carries, so that saving a look never drops them.
 *
 * The style is the profile: it says what the document carries after its text, the
 * sources list and how it is written, the five annexes and how strict the check is
 * about links (`STYLE_DEFAULTS`, Azimut's own; Settings › Publishing › Styles changes
 * them for every note). `sources_style`, `annexes` and `link_check` change them for
 * one note, late keys like the others. So does `sources_list`, which list of sources a
 * note with sources ends on: "" decides from the note itself (`sourcesListOf`). And
 * `method_list` and `geolocations_list`, the same three ways for the How this was made
 * and Geolocations annexes against the note's own Method or Geolocations section
 * (`annexListOf`).
 */
import { api } from '../api.js';
import { counterCode } from '../goatcounterSetup.js';
import { placeOf } from '../websiteSetup.js';

export const DEFAULT_LOOK = Object.freeze({
  style: 'plain',
  font: '',
  size: '',
  page: 'a4',
  accent: '',
  tlp: '',
  cover: Object.freeze({ on: false, mode: '', top: false, subtitle: '', image: '', date: '', marks: Object.freeze([]) }),
  toc: false,
  numbered: false,
  sources: '',
  web: '',
  sources_style: '',
  link_check: '',
  sources_list: '',
  method_list: '',
  geolocations_list: '',
  signed: '',
  annexes: Object.freeze({}),
});

/** What the style's cover may carry beside its title, in the order it is kept (`notelook.COVER_MARKS`). */
export const COVER_MARKS = [
  { id: 'azimut', label: 'Azimut logo' },
  { id: 'logo', label: 'My logo' },
  { id: 'signature', label: 'Signature' },
];

/** Where the document is signed with the analyst's name ("" nowhere). */
export const SIGNED = [
  { id: '', label: 'Off' },
  { id: 'title', label: 'Under the title' },
  { id: 'end', label: 'At the end' },
];

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

/**
 * Which list of sources a note with sources ends on: the numbered one written from what
 * it cites, its own section as written (its links still checked, nothing numbered), or
 * both. "" decides from the note (`sourcesListOf`), as `engine/notelook.py` does.
 */
export const SOURCES_LISTS = [
  { id: 'generated', label: 'Generated' },
  { id: 'own', label: 'My own section' },
  { id: 'both', label: 'Both' },
];

/** A heading line opening the note's own list of sources (`engine/notes_markdown.py`, `OWN_SOURCES`). */
const OWN_SOURCES = /^ {0,3}#{1,6}[ \t]+(?:\d+(?:\.\d+)*\.?[ \t]+)?[*_]*(sources|references)[*_]*[ \t]*:?[ \t]*(?:#+[ \t]*)?$/i;
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})/;

/** The word a note's own sources section is headed with, 'sources' or 'references', or '' when it has none: code left out. */
export function ownSources(text) {
  let fence = '';
  for (const line of String(text ?? '').split(/\r\n|\r|\n/)) {
    const marks = FENCE_LINE.exec(line);
    if (fence) {
      if (marks && marks[1][0] === fence[0] && marks[1].length >= fence.length) fence = '';
      continue;
    }
    if (marks) {
      fence = marks[1];
      continue;
    }
    const found = OWN_SOURCES.exec(line);
    if (found) return found[1].toLowerCase();
  }
  return '';
}

/** The list of sources a look ends on for a note holding `text`: as set, else its own section when it has one. */
export function sourcesListOf(look, text) {
  return normaliseLook(look).sources_list || (ownSources(text) ? 'own' : 'generated');
}

/**
 * The two annexes a note may hold a section of its own for, the heading that opens it
 * (`engine/notes_markdown.py`, `OWN_SECTIONS`, both read against
 * `tests/fixtures/own-sections.json`) and the look's key choosing between them.
 */
export const OWN_SECTIONS = {
  method: {
    key: 'method_list',
    heading: /^ {0,3}#{1,6}[ \t]+(?:\d+(?:\.\d+)*\.?[ \t]+)?[*_]*(?:our[ \t]+)?(?:methods?|methodology|how[ \t]+this[ \t]+was[ \t]+made)(?![A-Za-z0-9])/i,
  },
  geolocations: {
    key: 'geolocations_list',
    heading: /^ {0,3}#{1,6}[ \t]+(?:\d+(?:\.\d+)*\.?[ \t]+)?[*_]*(?:(?:annex|appendix)(?:[ \t]+[A-Za-z0-9]{1,3})?[ \t]*:[ \t]*)?(?:our[ \t]+)?geolocations(?![A-Za-z0-9])/i,
  },
};

/** Whether a note holds its own section `which` (`method` or `geolocations`): a heading line of its own, code left out. */
export function ownSection(text, which) {
  const heading = OWN_SECTIONS[which]?.heading;
  if (!heading) return false;
  let fence = '';
  for (const line of String(text ?? '').split(/\r\n|\r|\n/)) {
    const marks = FENCE_LINE.exec(line);
    if (fence) {
      if (marks && marks[1][0] === fence[0] && marks[1].length >= fence.length) fence = '';
      continue;
    }
    if (marks) {
      fence = marks[1];
      continue;
    }
    if (heading.test(line)) return true;
  }
  return false;
}

/** How a look prints the annex `which` for a note holding `text`: as set, else its own section when it has one. */
export function annexListOf(look, text, which) {
  const set = OWN_SECTIONS[which] ? normaliseLook(look)[OWN_SECTIONS[which].key] : '';
  return set || (ownSection(text, which) ? 'own' : 'generated');
}

/**
 * What a note includes after its text, said in one line for the Look's folded group:
 * its list of sources (`listing`, from `sourcesListOf`), how many annexes (those the
 * note's own section stands in for left out, `annexLists` from `annexListOf`) and how its
 * links are checked. `Academic sources · 5 annexes · links grouped`.
 */
export function includesSummary(profile, listing, annexLists = {}) {
  const written = (SOURCES_STYLES.find((one) => one.id === profile.sources_style) ?? SOURCES_STYLES[2]).label;
  const parts = [];
  if (!profile.sources) parts.push('No sources list');
  else if (listing === 'own') parts.push('Your own sources');
  else if (listing === 'both') parts.push(`Your own and ${written.toLowerCase()} sources`);
  else parts.push(`${written} sources`);
  // an annex the note's own section stands in for is not printed
  const annexes = ANNEXES.filter((annex) => profile[annex.id] && annexLists[annex.id] !== 'own').length;
  parts.push(annexes ? `${annexes} ${annexes === 1 ? 'annex' : 'annexes'}` : 'no annex');
  if (profile.sources) parts.push(profile.link_check === 'each' ? 'each link checked' : 'links grouped');
  return parts.join(' · ');
}

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
  { id: 'map', label: 'Map page' },
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
/** The longest a category's name is (`notelook.CATEGORY_MAX`). */
const CATEGORY_MAX = 60;
/** The longest an article's author is (`notelook.AUTHOR_MAX`). */
const AUTHOR_MAX = 120;
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
  const counter = counterCode(given.counter) || '';
  const category = String(given.category ?? '').split(/\s+/).filter(Boolean).join(' ').slice(0, CATEGORY_MAX);
  const role = given.role === 'page' || given.role === 'unlisted' ? given.role : '';
  const listImage = /^[A-Za-z0-9_-]{1,64}$/.test(String(given.list_image ?? '')) ? String(given.list_image) : '';
  const place = placeOf(given.place);
  const author = String(given.author ?? '').split(/\s+/).filter(Boolean).join(' ').slice(0, AUTHOR_MAX);
  const authorImage = /^[A-Za-z0-9_-]{1,64}$/.test(String(given.author_image ?? '')) ? String(given.author_image) : '';
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
      marks: COVER_MARKS.map((mark) => mark.id).filter((id) => Array.isArray(cover.marks) && cover.marks.includes(id)),
    },
    toc: Boolean(given.toc),
    numbered: Boolean(given.numbered),
    sources: pick(given.sources ?? '', SOURCES, ''),
    web: pick(given.web ?? '', WEBS, ''),
    sources_style: pick(given.sources_style ?? '', SOURCES_STYLES, ''),
    link_check: pick(given.link_check ?? '', LINK_CHECKS, ''),
    sources_list: pick(given.sources_list ?? '', SOURCES_LISTS, ''),
    method_list: pick(given.method_list ?? '', SOURCES_LISTS, ''),
    geolocations_list: pick(given.geolocations_list ?? '', SOURCES_LISTS, ''),
    signed: pick(given.signed ?? '', SIGNED, ''),
    annexes: annexesOf(given.annexes),
    ...(header && { header }),
    ...(footer && { footer }),
    ...(counter && { counter }),
    ...(category && { category }),
    ...(role && { role }),
    ...(listImage && { list_image: listImage }),
    ...(place && { place }),
    ...(author && { author }),
    ...(authorImage && { author_image: authorImage }),
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
      || whole.sources_style !== '' || whole.link_check !== '' || whole.sources_list !== '' || whole.method_list !== ''
      || whole.geolocations_list !== '' || Object.keys(whole.annexes).length > 0,
    text: Boolean(whole.font || whole.size),
    page: whole.page !== DEFAULT_LOOK.page || Boolean(whole.accent || whole.tlp),
    cover: whole.cover.on || whole.signed !== '',
    bands: Boolean(whole.header || whole.footer),
  };
}

/** A look a template can carry: no picture, no day, no place and no author of a case. */
export function templateLook(look) {
  const whole = normaliseLook(look);
  const kept = { ...whole, cover: { ...whole.cover, image: '', date: '' } };
  delete kept.list_image;
  delete kept.place;
  delete kept.author;
  delete kept.author_image;
  return kept;
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
