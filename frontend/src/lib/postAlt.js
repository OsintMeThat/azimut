/**
 * Alt text for the pictures of a post: what each one says to a screen reader.
 *
 * Optional and off by default. One box in Post, beside the first picture of the post,
 * puts an **Alt text** field under every picture (never under a video); the next posts
 * start the way the last one left it (`post_alt_text`). A field starts with words the
 * case already holds, once, and keeps whatever the analyst writes over them.
 *
 * **Kept by picture.** A draft's `alt` maps a case path to its text, so a description
 * follows its picture when a video thread is laid out again in another order and the
 * picture moves to another post. It is written only while the box is on and a text
 * exists, so a post without one keeps the shape it always had. The extension takes
 * each post's texts beside its files (`alt` on a hand-off post) and fills each
 * picture's description in the site's composer; nothing is posted.
 */
import { isDefaultName } from './naming.js';

/** What the box says on hover, the one place it is said. */
export const ALT_BOX_TITLE = 'Describes each picture for people using a screen reader';

/** The longest text a field takes: Bluesky's limit, the larger of the two. */
export const ALT_MAX = 2000;

/**
 * What X and Bluesky take as a picture's description.
 *
 * Platforms change these without notice, so they live in this one table, each with the
 * day it was checked and where, as `lib/videoLimits.js` keeps the video limits. What was
 * read off something other than the platform's own help page is named in `unverified`.
 */
export const ALT_LIMITS = Object.freeze({
  x: Object.freeze({
    name: 'X',
    limit: 1000,
    // counted as characters: one per code point here
    count: 'characters',
    checked: '2026-11-11',
    source: 'https://docs.x.com/x-api/media/create-media-metadata',
    note: 'X developer docs, Create Media metadata: alt_text.text, maxLength 1000. help.x.com refused the request (403).',
    // the docs give the API's limit and say nothing of how X counts a character
    unverified: Object.freeze(['count']),
  }),
  bluesky: Object.freeze({
    name: 'Bluesky',
    limit: 2000,
    // the official app compares String length: UTF-16 code units
    count: 'utf16',
    checked: '2026-11-11',
    source: 'https://github.com/bluesky-social/social-app/blob/main/src/lib/constants.ts',
    note: 'MAX_ALT_TEXT = 2000 in the official app, which cuts a longer text with an ellipsis when its alt text dialog closes.',
    // read off the app's source, not a help page; the post lexicon was not read
    unverified: Object.freeze(['limit']),
  }),
});

/** A target's row in ALT_LIMITS, X for anything else. */
export function altLimit(target) {
  return ALT_LIMITS[target] ?? ALT_LIMITS.x;
}

/** A text's length as the target counts its alt text. */
export function altLength(target, text) {
  const value = String(text ?? '');
  return altLimit(target).count === 'utf16' ? value.length : [...value].length;
}

const said = (text) => typeof text === 'string' && text.trim() !== '';
/** A text cut to the longest a field takes, never through the middle of a character. */
const bounded = (text) => (text.length > ALT_MAX ? [...text].slice(0, ALT_MAX).join('') : text);

/**
 * What a draft keeps of the texts: those of the pictures it carries that say something,
 * or null for none, which leaves `alt` out of the draft.
 */
export function altRecord(texts, pictures) {
  const kept = {};
  for (const path of pictures ?? []) {
    const text = texts?.[path];
    if (said(text)) kept[path] = bounded(text);
  }
  return Object.keys(kept).length ? kept : null;
}

/** A saved `alt` as this build reads it: bounded texts by case path, null for nothing. */
export function readAltRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  const kept = {};
  for (const [path, text] of Object.entries(record)) {
    if (path && said(text)) kept[path] = bounded(text);
  }
  return Object.keys(kept).length ? kept : null;
}

/**
 * The hand-off's posts with their pictures' texts (`alt`, by file), on the posts that
 * carry one. A post without one is handed over as it always was.
 */
export function withAltTexts(posts, texts) {
  return (posts ?? []).map((post) => {
    const alt = {};
    for (const path of post.files ?? []) {
      if (said(texts?.[path])) alt[path] = bounded(texts[path].trim());
    }
    return Object.keys(alt).length ? { ...post, alt } : post;
  });
}

const places = (count) => `${count} ${count === 1 ? 'place' : 'places'}`;

/** What a kind's own picture is called when its post has no name of its own. */
const START_NAMES = Object.freeze({ compare: 'Before and after', plate: 'Map' });

/**
 * The words a picture's field starts with, from what the case already says of it, or ''.
 *
 * - `sheet`, `map`: a video thread's contact sheet or map of its `count` places.
 * - `proof`: a proof's picture says the proof's own sentence (`description`), else nothing.
 * - `start`: a Compare or Map plate picture says its post's name and dates as the start
 *   gave them (`name`, `date`); a numbered name says the kind's instead.
 */
export function altSuggestion({ role, count = 0, description = '', kind = '', name = '', date = '' } = {}) {
  if (role === 'sheet') return `Pictures of the ${places(count)} geolocated in the video, numbered as in the post`;
  if (role === 'map') return `Map of the ${places(count)} geolocated in the video, numbered as in the post`;
  if (role === 'proof') return String(description ?? '').trim();
  if (role === 'start' && Object.hasOwn(START_NAMES, kind)) {
    const named = String(name ?? '').trim();
    const title = named && !isDefaultName(named, 'draft') ? named : START_NAMES[kind];
    return [title, String(date ?? '').trim()].filter(Boolean).join(', ');
  }
  return '';
}
