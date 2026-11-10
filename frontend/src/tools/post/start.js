/**
 * The one way into Post with something to post: a kind, and the case files the post
 * carries. Post's own New post gallery starts through the same composer road, and so do
 * the other tools' To Post (a plate's export, a Compare or Detect picture), so a post
 * started from anywhere opens on the same screen with its media already placed
 * (`lib/post.js` `startMediaPlan`: on the first post, except a geolocation's, which
 * keeps it for the proof).
 *
 * A tool that files what it made can say what it is about as well (`about`): the name
 * of what it came from, its own sentence when it has one, the days its media show and
 * the credit line they carry. `startFields` turns that into the composer's fields, the
 * way Geo Proof's To Post hands a proof over.
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

/**
 * What a start says about its media, kept to what the composer can use: `title` the
 * name of what it came from (a plate, a comparison, a pin), `description` its own
 * sentence and never one made up, `dates` the days its media show, oldest first and
 * each once, and `credits` the line their face carries.
 */
export function startAbout(about) {
  const given = about && typeof about === 'object' && !Array.isArray(about) ? about : {};
  const dates = [...new Set((Array.isArray(given.dates) ? given.dates : [])
    .filter((value) => typeof value === 'string' && DATE.test(value.trim()))
    .map((value) => value.trim()))].sort();
  return {
    title: words(given.title, MAX_TITLE),
    description: typeof given.description === 'string' ? given.description.trim().slice(0, MAX_DESCRIPTION) : '',
    dates,
    credits: words(given.credits, MAX_CREDITS),
  };
}

/**
 * The composer's fields a start fills: the post's `name`, `#description`, `#date` (one
 * day, or the first and the last, as Compare names a pair) and `#credits`.
 */
export function startFields(about) {
  const { title, description, dates, credits } = startAbout(about);
  const first = dates.length ? postDate(dates[0]) : '';
  const last = dates.length > 1 ? postDate(dates.at(-1)) : '';
  return { name: title, description, date: last && last !== first ? `${first} to ${last}` : first, credits };
}

/**
 * Start a post of `kind` carrying `media` (case-relative paths, in order), and show
 * Post. `about` is what the media show (`startAbout`).
 */
export function startPost(kind, media = [], about = null) {
  uiState.postStart = {
    kind: normalizePostKind(kind),
    media: (media ?? []).filter((path) => typeof path === 'string' && path),
    about: startAbout(about),
  };
  uiState.tool = 'post';
}
