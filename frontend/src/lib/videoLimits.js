/**
 * What X and Bluesky take in one post, and whether a video fits.
 *
 * Platforms change these without notice, so they live in this one table, each with
 * the day it was checked and where. A field read off something other than the
 * platform's own page is named in `unverified`. Wave 2's composer asks `videoFits`
 * of a whole video and offers the cut (`postClip.js`) when it is over.
 *
 * Bytes are counted in thousands, the smaller reading of "MB" and "GB": a file the
 * table calls within the limit is within it whichever way the platform counts.
 */
import { CLIP_AUDIO_KBPS, CLIP_VIDEO_KBPS } from './postClip.js';
import { shortClock } from './scenes.js';

const MB = 1000 ** 2;
const GB = 1000 ** 3;

export const VIDEO_LIMITS = Object.freeze({
  x: Object.freeze({
    name: 'X',
    // a default account; Premium and verified accounts go further
    seconds: 20 * 60,
    bytes: 8 * GB,
    premium: Object.freeze({ seconds: 125 * 60, bytes: 16 * GB }),
    minSeconds: 0.5,
    pictures: 4,
    pictureBytes: 5 * MB,
    videos: 1,
    // "up to 4 photos, 1 animated GIF or 1 video in a Post"
    mix: false,
    checked: '2026-11-10',
    source: 'https://docs.x.com/x-api/media/quickstart/best-practices',
    note: 'X developer docs, media best practices, which say post video caps match the X app. help.x.com refused the request (403).',
    // the app has taken photos and a video in one post since 2022, which the docs do not say
    unverified: Object.freeze(['mix']),
  }),
  bluesky: Object.freeze({
    name: 'Bluesky',
    seconds: 10 * 60,
    bytes: 300 * MB,
    premium: null,
    minSeconds: 0,
    pictures: 4,
    pictureBytes: 1 * MB,
    videos: 1,
    mix: false,
    checked: '2026-11-10',
    source: 'https://bsky.app/profile/bsky.app/post/3mtwf7gxkwc2r',
    note: 'The @bsky.app announcement of 2026-08-25: videos up to 10 minutes, files up to 300 MB.',
    // read off the post lexicon (`app.bsky.embed.images`, `app.bsky.embed.video`), not a help page
    unverified: Object.freeze(['pictureBytes', 'mix']),
  }),
});

/** The platforms the table knows, in the order Post offers them. */
export const PLATFORMS = Object.freeze(Object.keys(VIDEO_LIMITS));

const known = (value) => Number.isFinite(value) && value >= 0;

/**
 * Whether a video fits one post on `platform`: `{ fits, over, unknown, limit }`.
 * `over` names what is past the limit, `seconds` or `bytes`; `unknown` what was not
 * given, which is never counted as over. `premium` reads the Premium limits where the
 * platform has them.
 */
export function videoFits(platform, { seconds = null, bytes = null } = {}, { premium = false } = {}) {
  const table = VIDEO_LIMITS[platform];
  if (!table) throw new Error(`no video limits for ${platform}`);
  const limit = premium && table.premium ? { ...table.premium, minSeconds: table.minSeconds } : table;
  const over = [];
  const unknown = [];
  if (!known(seconds)) unknown.push('seconds');
  else if (seconds > limit.seconds || seconds < limit.minSeconds) over.push('seconds');
  if (!known(bytes)) unknown.push('bytes');
  else if (bytes > limit.bytes) over.push('bytes');
  return { fits: over.length === 0, over, unknown, limit: { seconds: limit.seconds, bytes: limit.bytes } };
}

/**
 * The most a clip of `seconds` weighs once cut (`engine/postclips.py`): its rate is
 * capped, so this is a ceiling, not a guess at the usual size. A few per cent of the
 * container is counted on top.
 */
export function clipBytesAtMost(seconds) {
  if (!known(seconds)) return null;
  return Math.ceil((seconds * (CLIP_VIDEO_KBPS + CLIP_AUDIO_KBPS) * 1000) / 8 * 1.03);
}

/** Whether the clip of a passage would fit one post on `platform`, before it is cut. */
export function passageFits(platform, passage, options = {}) {
  const seconds = Number.isFinite(passage?.start) && Number.isFinite(passage?.end) ? passage.end - passage.start : null;
  return videoFits(platform, { seconds, bytes: clipBytesAtMost(seconds) }, options);
}

/** The platforms a video is over the limit on, by name: what a composer says when it offers the cut. */
export function overOn(video, options = {}) {
  return PLATFORMS.filter((platform) => !videoFits(platform, video, options).fits).map((p) => VIDEO_LIMITS[p].name);
}

/** A limit in minutes, as the words under a video say it. */
const minutes = (seconds) => (seconds % 60 ? shortClock(seconds) : `${seconds / 60} minutes`);
/** A size the way the platforms write theirs, in thousands: `300 MB`, `8 GB`, `1.2 GB`. */
const size = (bytes) => (bytes >= GB ? `${Number((bytes / GB).toFixed(1))} GB` : `${Math.max(1, Math.round(bytes / MB))} MB`);

/**
 * What a composer says of a video `videoFits` found over the limit on `platform`: how
 * long or how big it is, and what the platform takes. A platform with a paid tier says
 * the free account's, which is what the table holds by default.
 */
export function overWords(platform, fit, { seconds = null, bytes = null } = {}) {
  const table = VIDEO_LIMITS[platform];
  if (!table || fit?.fits !== false) return '';
  const account = table.premium ? ' from a free account' : '';
  if (fit.over.includes('seconds') && seconds < table.minSeconds) {
    return `This video is under ${table.minSeconds} s, shorter than ${table.name} takes.`;
  }
  if (fit.over.includes('seconds')) {
    return `This video runs ${shortClock(seconds)}, and ${table.name} takes ${minutes(fit.limit.seconds)}${account}.`;
  }
  return `This video is ${size(bytes)}, and ${table.name} takes ${size(fit.limit.bytes)}${account}.`;
}
