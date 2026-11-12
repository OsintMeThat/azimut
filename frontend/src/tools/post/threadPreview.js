/**
 * The thread as it goes out, read for its preview (`ThreadPreview.svelte`), from what the
 * composer hands the extension (`lib/post.js` `handoffThread`): each post's text cut into
 * what the site shows as words, a link, a mention or a hashtag, counted against the
 * platform's limit with the part past it marked, and its pictures framed the way the site
 * frames them. Pure: no DOM, no network, nothing read but what it is given.
 *
 * **The count is the composer's** (`postCharacterCount`), so Write and Preview never say
 * two numbers for one post. What is coloured as a link, a mention or a hashtag follows
 * each site's own rules as far as they are known (`@atproto/api` rich-text for Bluesky,
 * read 2026-11-12; X's public behaviour), and only colours: it never changes the count.
 */
import {
  blueskyLinks, blueskyShortUrl, MAX_HANDOFF_FILES, normalizePostTarget, postCharacterCount, postTarget, X_LINK_WEIGHT,
  xLinks,
} from '../../lib/post.js';
import { fileUrl } from '../../lib/fileUrl.js';

/** The most pictures a post carries: the hand-off leaves any past them behind. */
export const PREVIEW_PICTURES = MAX_HANDOFF_FILES;

/** A picture's shape until its thumbnail says its own. */
export const DEFAULT_RATIO = 16 / 9;

const VIDEO_FILE = /\.(mp4|webm|mov|m4v|mkv)$/i;

// X: a handle of 1 to 15 letters, digits or `_`, not glued to a word, an address or a
// longer handle; a hashtag of letters and digits holding a letter, not glued to a word.
const X_MENTION = /(^|[^A-Za-z0-9_!#$%&*@＠])([@＠][A-Za-z0-9_]{1,15})(?![A-Za-z0-9_@＠]|:\/\/)/g;
const X_TAG = /(^|[^&\p{L}\p{M}\p{N}_])([#＃](?![\uFE0F\u20E3])[\p{L}\p{M}\p{N}_]*[\p{L}\p{M}][\p{L}\p{M}\p{N}_]*)/gu;

// Bluesky (`MENTION_REGEX`, `TAG_REGEX` in @atproto/api rich-text): a mention is a whole
// domain handle, `@name.bsky.social`; `@GeoConfirmed` stays words there. A hashtag holds
// a character that is not a digit, a space or punctuation, and loses its closing
// punctuation. Which top-level domains count is the app's list; a last part of two
// letters or more stands in for it here.
const SKY_MENTION = /(^|\s|\()(@[a-zA-Z0-9.-]+)\b/g;
const SKY_HANDLE = /^@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:[a-z]{2,}|test)$/i;
const SKY_SKIP = '\\u00AD\\u2060\\u200A\\u200B\\u200C\\u200D\\u20e2';
const SKY_TAG = new RegExp(
  `(^|\\s)([#＃](?!\\ufe0f)[^\\s${SKY_SKIP}]*[^\\d\\s\\p{P}${SKY_SKIP}]+[^\\s${SKY_SKIP}]*)`,
  'gu',
);
const SKY_TAG_END = /\p{P}+$/u;

const isBluesky = (target) => normalizePostTarget(target) === 'bluesky';

/**
 * A link as X shows it: no `https://` or `www.`, cut after 25 characters with `…`. X
 * writes this from its own records, so it reads as about what the post will show.
 */
export function xDisplayUrl(url) {
  const bare = String(url ?? '').replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const chars = [...bare];
  return chars.length > 25 ? `${chars.slice(0, 25).join('')}…` : bare;
}

// one for every reading: making a segmenter costs more than cutting a post with it
let graphemes = null;

/** A text's units as the site counts them: graphemes on Bluesky, characters on X. */
function units(target, text) {
  if (isBluesky(target) && typeof Intl?.Segmenter === 'function') {
    graphemes ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return Array.from(graphemes.segment(text), (one) => one.segment);
  }
  return [...text];
}

/** The mentions and hashtags in a run of words, as the site makes them: `{ start, end, kind }`. */
function marks(target, text) {
  const found = [];
  const sky = isBluesky(target);
  for (const match of text.matchAll(sky ? SKY_MENTION : X_MENTION)) {
    if (sky && !SKY_HANDLE.test(match[2])) continue;
    const start = match.index + match[1].length;
    found.push({ start, end: start + match[2].length, kind: 'mention' });
  }
  for (const match of text.matchAll(sky ? SKY_TAG : X_TAG)) {
    let tag = match[2];
    if (sky) {
      tag = tag.replace(SKY_TAG_END, '');
      if (tag.length < 2 || units(target, tag.slice(1)).length > 64) continue;
    }
    const start = match.index + match[1].length;
    found.push({ start, end: start + tag.length, kind: 'tag' });
  }
  return found.sort((a, b) => a.start - b.start).filter((one, i, all) => i === 0 || one.start >= all[i - 1].end);
}

/** A run of words, its mentions and hashtags apart. */
function wordParts(target, text) {
  const parts = [];
  let at = 0;
  for (const mark of marks(target, text)) {
    if (mark.start > at) parts.push({ kind: 'text', text: text.slice(at, mark.start) });
    parts.push({ kind: mark.kind, text: text.slice(mark.start, mark.end) });
    at = mark.end;
  }
  if (at < text.length) parts.push({ kind: 'text', text: text.slice(at) });
  return parts;
}

/**
 * A post's text in the pieces the site shows: `{ kind, text, href?, weight? }`, `kind`
 * being `text`, `link`, `mention` or `tag`. A link reads as the site shows it (`text`)
 * and points at the whole address (`href`); X counts it as `X_LINK_WEIGHT` whatever it
 * shows, and the closing punctuation the address took in that count stays words.
 */
export function textParts(target, text) {
  const value = String(text ?? '');
  const sky = isBluesky(target);
  const parts = [];
  let at = 0;
  for (const link of sky ? blueskyLinks(value) : xLinks(value)) {
    if (link.start > at) parts.push(...wordParts(target, value.slice(at, link.start)));
    if (sky) {
      parts.push({ kind: 'link', text: blueskyShortUrl(link.url), href: link.url });
    } else {
      const core = link.url.replace(/[.,;:!?]+$/, '').replace(/\)$/, (end) => (link.url.includes('(') ? end : ''));
      parts.push({ kind: 'link', text: xDisplayUrl(core), href: core, weight: X_LINK_WEIGHT });
      if (core.length < link.url.length) parts.push({ kind: 'text', text: link.url.slice(core.length), weight: 0 });
    }
    at = link.end;
  }
  if (at < value.length) parts.push(...wordParts(target, value.slice(at)));
  return parts;
}

/**
 * What a post says against its platform's limit: its pieces, each `over` once past the
 * limit (a run of words cut where the limit falls, a link whole), its `count` as the
 * composer gives it, the `limit`, and how far `over` it goes.
 */
export function previewText(target, text) {
  const value = String(text ?? '');
  const { limit } = postTarget(target);
  const count = postCharacterCount(target, value);
  // a post that fits, as most do, needs no walk to find where its limit falls
  if (count <= limit) return { parts: textParts(target, value).map(({ weight, ...part }) => ({ ...part, over: false })), count, limit, over: 0 };
  const parts = [];
  let used = 0;
  for (const part of textParts(target, value)) {
    const pieces = part.weight === undefined ? units(target, part.text) : null;
    const weight = part.weight ?? pieces.length;
    if (used >= limit) {
      parts.push({ ...part, over: true });
    } else if (used + weight <= limit) {
      parts.push({ ...part, over: false });
    } else if (!pieces) {
      parts.push({ ...part, over: true });
    } else {
      const room = limit - used;
      parts.push({ ...part, text: pieces.slice(0, room).join(''), over: false });
      parts.push({ ...part, text: pieces.slice(room).join(''), over: true });
    }
    used += weight;
  }
  return { parts: parts.map(({ weight, ...part }) => part), count, limit, over: count - limit };
}

/**
 * A post's pictures as its preview shows them: each file a picture (`video` for a video)
 * on the thumbnail the case keeps for it, a proof's from the proofs list, else the file
 * itself, in a box sized before it loads; a video with no thumbnail shows no picture,
 * never its bytes. `alt` is the picture's text when the post hands one over.
 */
export function postPictures(files, { caseId = '', media = null, proofs = null, alt = null } = {}) {
  const proofThumbs = new Map((proofs ?? []).filter((row) => row?.png && row?.thumb).map((row) => [row.png, row.thumb]));
  return (files ?? []).slice(0, PREVIEW_PICTURES).map((path) => {
    const row = media?.get?.(path) ?? null;
    const video = row ? row.kind === 'video' : VIDEO_FILE.test(path);
    const thumb = row?.thumbnail || proofThumbs.get(path) || null;
    const src = thumb ? fileUrl(caseId, thumb) : video ? null : fileUrl(caseId, path);
    const text = typeof alt?.[path] === 'string' ? alt[path].trim() : '';
    return { path, video, src, alt: text };
  });
}

/**
 * The frame of a post's one picture, as width over height: X shows a picture between
 * 3:4 and 2:1 and crops past that; Bluesky, on a wide screen, keeps the picture whole
 * in a frame never taller than wide, the picture at its left. `picture` is the shape
 * the picture is drawn at inside it.
 */
export function singleFrame(target, ratio) {
  const shape = Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_RATIO;
  if (isBluesky(target)) return { frame: Math.max(shape, 1), picture: shape };
  const kept = Math.min(2, Math.max(3 / 4, shape));
  return { frame: kept, picture: kept };
}

/**
 * The frame of two to four pictures, as width over height: X lays them in a 16:9 block,
 * Bluesky two or three side by side in a 2:1 one and four in a 3:2 one.
 */
export function gridFrame(target, count) {
  if (count < 2) return null;
  if (isBluesky(target)) return count >= 4 ? 3 / 2 : 2;
  return 16 / 9;
}

/** Who a reply goes under, as the post shows it: `@name`, or '' when its address does not say. */
export function replyHandle(reply) {
  const url = String(reply?.url ?? '');
  const x = /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\//.exec(url);
  if (x) return `@${x[1]}`;
  const sky = /^https:\/\/bsky\.app\/profile\/([^/?#]+)\/post\//.exec(url);
  if (sky && !sky[1].startsWith('did:')) return `@${decodeURIComponent(sky[1])}`;
  return '';
}

/** Whose posts they read as: the handle Settings signs proofs with, else *You*, and its first letter. */
export function previewAuthor(handle) {
  const said = String(handle ?? '').trim();
  const initial = said.replace(/^@+/, '').match(/[\p{L}\p{N}]/u)?.[0] ?? '';
  return { name: said || 'You', initial: initial.toUpperCase() };
}

/** The line over the preview: how many posts go out. */
export function threadWords(count) {
  return `${count} ${count === 1 ? 'post' : 'posts'}`;
}
