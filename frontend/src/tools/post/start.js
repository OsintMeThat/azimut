/**
 * The one way into Post with something to post: a kind, and the case files the post
 * carries. Post's own New post gallery starts through the same composer road, and so do
 * the other tools' To Post (a plate's export, a Compare or Detect picture), so a post
 * started from anywhere opens on the same screen with its media already placed
 * (`lib/post.js` `startMediaPlan`: on the first post, except a geolocation's, which
 * keeps it for the proof).
 *
 * A tool that files what it made can say what it is about as well (`about`): the name
 * of what it came from, its own sentence when it has one, the days its media show (or
 * the day before and the day after, for a before and after) and the credit line they
 * carry. `startFields` turns that into the composer's fields, the way Geo Proof's To
 * Post hands a proof over.
 *
 * What Post had open is saved under its own name first and makes way, as it does for a
 * proof sent with To Post. Nothing is posted: the post opens to be read and published
 * by the analyst.
 */
import { uiState } from '../../lib/state.svelte.js';
import { normalizePostKind, postDate } from '../../lib/post.js';

/** The longest words a start carries, as the composer's own fields take them. */
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 4000;
const MAX_CREDITS = 2000;
/** A day, a day and a time, or a UTC instant, as the case stores them. */
const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?~?$/;

const words = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
/** A date as the case stores it, or null for a side whose date is not known. */
const known = (value) => (typeof value === 'string' && DATE.test(value.trim()) ? value.trim() : null);

/** What joins the first day to the last in a post's date, and a before to an after. */
export const DATE_ARROW = ' → ';
/** What a side of a before and after reads while its date is not known. */
export const UNKNOWN_DATE = '?';

/**
 * What a start says about its media, kept to what the composer can use: `title` the
 * name of what it came from (a plate, a comparison, a pin), `description` its own
 * sentence and never one made up, `dates` the days its media show, oldest first and
 * each once, and `credits` the line their face carries.
 *
 * A before and after says `span` instead, `{ before, after }`, each side kept where it
 * stands and null when its picture has no known date, so the post reads which was
 * which. It is there only when the tool gave one.
 */
export function startAbout(about) {
  const given = isObject(about) ? about : {};
  const dates = [...new Set((Array.isArray(given.dates) ? given.dates : [])
    .map(known)
    .filter(Boolean))].sort();
  const span = isObject(given.span) ? { before: known(given.span.before), after: known(given.span.after) } : null;
  return {
    title: words(given.title, MAX_TITLE),
    description: typeof given.description === 'string' ? given.description.trim().slice(0, MAX_DESCRIPTION) : '',
    dates,
    ...(span ? { span } : {}),
    credits: words(given.credits, MAX_CREDITS),
  };
}

/**
 * The composer's fields a start fills: the post's `name`, `#description`, `#date` and
 * `#credits`. The date is one day, or the first and the last joined by an arrow
 * (`2024-05-01 → 2025-06-01`); a before and after always says both sides, a side with
 * no known date as `?` for the analyst to complete (`spanNote`).
 */
export function startFields(about) {
  const { title, description, dates, span, credits } = startAbout(about);
  return { name: title, description, date: span ? spanDate(span) : daysDate(dates), credits };
}

/** The first day and the last, or the one. */
function daysDate(dates) {
  const first = dates.length ? postDate(dates[0]) : '';
  const last = dates.length > 1 ? postDate(dates.at(-1)) : '';
  return last && last !== first ? `${first}${DATE_ARROW}${last}` : first;
}

/** Both sides of a before and after, or the one day when both are that day. */
function spanDate({ before, after }) {
  const [first, last] = [before, after].map((side) => (side ? postDate(side) : UNKNOWN_DATE));
  return before && after && first === last ? first : `${first}${DATE_ARROW}${last}`;
}

/**
 * What the Date field says under it while a side of a before and after still reads `?`,
 * or nothing: a `?` never goes out unnoticed.
 */
export function spanNote(date) {
  const sides = String(date ?? '').split(DATE_ARROW.trim()).map((side) => side.trim());
  if (sides.length !== 2) return '';
  const [before, after] = sides.map((side) => side === UNKNOWN_DATE);
  if (before && after) return 'Neither picture has a known date.';
  if (before || after) return `The ${before ? 'before' : 'after'} picture has no known date.`;
  return '';
}

/** The most pieces a start carries, and the longest text one holds. */
export const MAX_PIECES = 200;
export const MAX_PIECE_TEXT = 20_000;
const MAX_PIECE_WORDS = 200;
/** The longest alt text a picture piece carries: what Post's field takes (`postAlt.js`). */
const MAX_PIECE_ALT = 2000;
const MAX_PIECE_PATH = 512;
const MAX_PIECE_URL = 2000;
const MEDIA_TYPES = new Set(['image', 'video', 'gif']);
const VIDEO_PATH = /\.(mp4|webm|mov|m4v|mkv)$/i;

/** Text cut to `max` UTF-16 units without splitting a surrogate pair at the end. */
function capped(text, max) {
  if (text.length <= max) return text;
  const end = /[\uD800-\uDBFF]/.test(text[max - 1]) ? max - 1 : max;
  return text.slice(0, end);
}

/** A case-relative path as a piece names it, or '' for anything else. */
function casePath(value) {
  const path = typeof value === 'string' ? value.trim() : '';
  if (!path || path.length > MAX_PIECE_PATH || path.startsWith('/') || path.includes('\0')) return '';
  return path.split(/[\\/]/).includes('..') ? '' : path;
}

/** One piece as Post reads it, or null for one it cannot use. */
function startPiece(piece) {
  if (!isObject(piece)) return null;
  const id = typeof piece.id === 'string' && piece.id.trim() ? { id: piece.id.trim() } : {};
  if (piece.kind === 'text') {
    const text = typeof piece.text === 'string' ? capped(piece.text.trim(), MAX_PIECE_TEXT).trim() : '';
    return text ? { kind: 'text', text, ...(piece.heading === true ? { heading: true } : {}) } : null;
  }
  if (piece.kind === 'media') {
    const path = casePath(piece.path);
    if (!path && !id.id) return null;
    const type = MEDIA_TYPES.has(piece.type) ? piece.type
      : VIDEO_PATH.test(path) ? 'video' : /\.gif$/i.test(path) ? 'gif' : 'image';
    const alt = type === 'image' ? words(piece.alt, MAX_PIECE_ALT) : '';
    return { kind: 'media', path, type, ...id, ...(alt ? { alt } : {}) };
  }
  if (piece.kind === 'proof') {
    const name = words(piece.name, MAX_PIECE_WORDS);
    return name || id.id ? { kind: 'proof', name, ...id } : null;
  }
  if (piece.kind === 'source') {
    const url = typeof piece.url === 'string' ? piece.url.trim() : '';
    if (url.length > MAX_PIECE_URL || !/^https?:\/\/\S+$/i.test(url)) return null;
    const label = words(piece.label, MAX_PIECE_WORDS);
    return { kind: 'source', url, ...(label && label !== url ? { label } : {}) };
  }
  return null;
}

/**
 * What a start hands Post to lay out as posts (`tools/post/pieces.js`), kept to what it
 * can use: a text with words in it, a heading said as such; a picture, a video or a GIF
 * by its case path, a picture with the alt text it comes with (a chart's title); a proof
 * by its name; a source by its web address. Each may carry
 * its entity `id` as well. An unknown kind, an empty text, a path climbing out of the
 * case or a source that is no web address is dropped, and past `MAX_PIECES` nothing is
 * kept. The Notebook hands a note over this way (`startPost`'s `pieces`).
 */
export function startPieces(pieces) {
  const kept = [];
  for (const piece of Array.isArray(pieces) ? pieces : []) {
    if (kept.length >= MAX_PIECES) break;
    const one = startPiece(piece);
    if (one) kept.push(one);
  }
  return kept;
}

/**
 * Start a post of `kind` carrying `media` (case-relative paths, in order), and show
 * Post. `about` is what the media show (`startAbout`). `pieces`, when a tool hands
 * words and files to be laid out as several posts (`startPieces`), ride along.
 */
export function startPost(kind, media = [], about = null, pieces = null) {
  const laid = startPieces(pieces);
  uiState.postStart = {
    kind: normalizePostKind(kind),
    media: (media ?? []).filter((path) => typeof path === 'string' && path),
    about: startAbout(about),
    ...(laid.length ? { pieces: laid } : {}),
  };
  uiState.tool = 'post';
}
