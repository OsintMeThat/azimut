/**
 * Pieces laid out as the posts of a Free post: what the Notebook hands Post (`startPost`'s
 * `pieces`, `start.js` `startPieces`) turned into a thread for the analyst to read in the
 * preview, edit and publish. Nothing here posts, reads the network or the case: the
 * composer resolves each piece to what it shows (`resolvePieces`'s input) and asks how
 * long a post may be (`fitsOn`, the count the composer shows under each post).
 *
 * **Texts.** A heading opens a post, and the paragraphs after it join that post, a blank
 * line between, while they fit. A heading right after another heading joins it. A text
 * over the platform's limit is cut (`cutText`): at a line break first, then at a
 * sentence's end, then between two words, never inside a word, a link, a @mention or a
 * point's coordinates. A word longer than a whole post stays whole, alone and over the
 * limit, for the analyst to see in red.
 *
 * **Files.** A picture joins the post before it, up to four. A video or a GIF goes alone,
 * since X and Bluesky put four pictures, one GIF or one video in a post and never mix
 * them; what does not fit opens a post with no text. A proof is a post of its own: its
 * picture and its points. A source is a line of the post before it while it fits, the
 * sources after it a line each, else a post of its own. A file, a proof or a source ends
 * the paragraphs' grouping: the next paragraph opens a post.
 *
 * **What stays out** is counted, never dropped in silence: the pieces the case does not
 * hold (`missing`, counted by the composer) and the posts past the 21 a post holds
 * (`past`), said in one sentence (`leftWords`).
 */
import { MAX_POST_MEDIA, postCharacterCount, postTarget } from '../../lib/post.js';
import { bidiSafe } from '../../lib/bidi.js';
import { MAX_THREAD_POSTS } from '../../lib/videoPost.js';

/** Whether a post's text fits the platform, counted as the composer counts it. */
export function fitsOn(target) {
  const { limit } = postTarget(target);
  return (text) => postCharacterCount(target, bidiSafe(text, target)) <= limit;
}

// A point's coordinates are one word to the cutter: decimal degrees as `bidi.js` reads
// them, and degrees, minutes and seconds with their hemispheres.
const DMS = String.raw`\d{1,3}°\s*\d{1,2}['′]\s*\d{1,2}(?:[.,]\d+)?["″]\s*[NSns]`;
const DMS_EAST = String.raw`\d{1,3}°\s*\d{1,2}['′]\s*\d{1,2}(?:[.,]\d+)?["″]\s*[EWew]`;
const COORDINATES = new RegExp(
  String.raw`[-+]?\d{1,3}\.\d+\s*,\s*[-+]?\d{1,3}\.\d+|${DMS}\s*,?\s*${DMS_EAST}`,
  'g',
);
// What holds a protected run's spaces while the text is cut: no space, so no cut there.
const HELD = '';
const HOLD_SPACE = /\s/g;
const HELD_SPACE = new RegExp(HELD, 'g');
// A sentence ends on its stop and the space after it, in Latin, Arabic and CJK script.
const SENTENCE_END = /(?<=[.!?…؟۔。！？])\s+/u;

const hold = (text) => text.replace(COORDINATES, (run) => run.replace(HOLD_SPACE, HELD));
const release = (text) => text.replace(HELD_SPACE, ' ');

/**
 * Units packed into chunks that fit, joined by `joiner`. A unit too long for a chunk
 * is handed to `split`, the next level down, whose last chunk keeps packing. `first`
 * judges the first chunk when `leading` (the thread's first post, with less room).
 */
function pack(units, joiner, { first, rest }, split, leading) {
  const out = [];
  let current = '';
  const fits = (text) => (leading && out.length === 0 ? first : rest)(text);
  for (const unit of units) {
    const joined = current ? `${current}${joiner}${unit}` : unit;
    if (fits(joined)) {
      current = joined;
      continue;
    }
    if (current) {
      out.push(current);
      current = '';
    }
    if (fits(unit)) {
      current = unit;
      continue;
    }
    const parts = split ? split(unit, leading && out.length === 0) : [unit];
    out.push(...parts.slice(0, -1));
    current = parts.at(-1) ?? '';
  }
  if (current) out.push(current);
  return out;
}

/**
 * A text cut into posts that each fit (`fits`, or `first` for the first one): at line
 * breaks, then at sentence ends, then between words. Coordinates, links and @mentions
 * are words. A text that fits whole comes back whole.
 */
export function cutText(text, fits, { first = fits } = {}) {
  const value = String(text ?? '').trim();
  if (!value) return [];
  const judge = { first: (t) => first(release(t)), rest: (t) => fits(release(t)) };
  const words = (sentence, leading) => pack(sentence.split(/\s+/).filter(Boolean), ' ', judge, null, leading);
  const sentences = (line, leading) => pack(line.split(SENTENCE_END).filter(Boolean), ' ', judge, words, leading);
  return pack(hold(value).split('\n'), '\n', judge, sentences, true)
    .map((chunk) => release(chunk).trim())
    .filter(Boolean);
}

/**
 * The posts a note's pieces make, each `{ text, mediaPaths, mediaType }` as the
 * composer holds a post, the first being the thread's first post.
 *
 * `pieces` are resolved: `{ kind: 'text', text, heading? }`, `{ kind: 'media', path,
 * type: 'image' | 'video' | 'gif' }`, `{ kind: 'proof', png, text }` (its points) and
 * `{ kind: 'source', url, label? }`. `fits` judges a post; `first`, the first post,
 * which the analyst's template shares with its mention. Answers `{ posts, past }`,
 * `past` the posts beyond the `max` a post holds, left out.
 */
export function piecePosts(pieces, { fits, first = fits, max = MAX_THREAD_POSTS } = {}) {
  const posts = [];
  let open = null; // the post the next piece may join
  let grouping = false; // whether a paragraph may still join it
  const fitsAt = (index) => (index === 0 ? first : fits);
  const begin = (text = '', mediaPaths = [], mediaType = 'none') => {
    open = { text, mediaPaths, mediaType, tail: text ? 'text' : 'media', headings: false, alone: false };
    posts.push(open);
    return open;
  };
  const room = (text) => fitsAt(posts.length - 1)(text);

  for (const piece of pieces ?? []) {
    if (piece.kind === 'text') {
      const joins = open && grouping && (!piece.heading || open.headings);
      if (joins && room(`${open.text}\n\n${piece.text}`)) {
        open.text = `${open.text}\n\n${piece.text}`;
        open.headings = open.headings && piece.heading === true;
      } else {
        for (const chunk of cutText(piece.text, fits, { first: fitsAt(posts.length) })) begin(chunk);
        open.headings = piece.heading === true;
      }
      open.tail = 'text';
      grouping = true;
      continue;
    }
    if (piece.kind === 'media') {
      const type = piece.type === 'video' ? 'video' : 'images';
      const single = piece.type !== 'image';
      if (open?.mediaPaths.includes(piece.path)) continue; // said twice in a row, posted once
      const fitsIn = open && (
        !open.mediaPaths.length
        || (!single && !open.alone && open.mediaType === 'images' && open.mediaPaths.length < MAX_POST_MEDIA)
      );
      if (fitsIn) {
        open.mediaPaths.push(piece.path);
        open.mediaType = type;
      } else {
        begin('', [piece.path], type);
      }
      open.alone = single;
      open.tail = 'media';
      grouping = false;
      continue;
    }
    if (piece.kind === 'proof') {
      const chunks = cutText(piece.text, fits, { first: fitsAt(posts.length) });
      begin(chunks[0] ?? '', piece.png ? [piece.png] : [], piece.png ? 'images' : 'none');
      for (const chunk of chunks.slice(1)) begin(chunk);
      grouping = false;
      continue;
    }
    if (piece.kind === 'source') {
      const line = piece.label ? `${piece.label} ${piece.url}` : piece.url;
      const joined = open?.text ? `${open.text}${open.tail === 'source' ? '\n' : '\n\n'}${line}` : line;
      if (open && room(joined)) open.text = joined;
      else begin(line);
      open.tail = 'source';
      grouping = false;
    }
  }
  const kept = posts.slice(0, Math.max(0, max));
  return {
    posts: kept.map(({ text, mediaPaths, mediaType }) => ({ text, mediaPaths: [...mediaPaths], mediaType })),
    past: posts.length - kept.length,
  };
}

/**
 * The note's pieces as the composer resolves them before laying them out: a proof by
 * its name in the case's proof list (`GET /proofs`), its picture and its points written
 * as a Geolocation post writes them (`pointsText`). A proof the list does not hold, or
 * one never exported, is missing; so is a file or a proof named only by its id, since
 * nothing reads an entity by id without the whole graph.
 */
export function resolvePieces(pieces, { proofs = [], pointsText = () => '' } = {}) {
  const byName = new Map((proofs ?? []).map((row) => [row?.name, row]));
  const resolved = [];
  let missing = 0;
  for (const piece of pieces ?? []) {
    if (piece.kind === 'media' && !piece.path) missing += 1;
    else if (piece.kind === 'proof') {
      const row = piece.name ? byName.get(piece.name) : null;
      if (row?.png) resolved.push({ kind: 'proof', png: row.png, text: pointsText(row) });
      else missing += 1;
    } else resolved.push(piece);
  }
  return { pieces: resolved, missing };
}

/** What stayed out of the thread, in one sentence, or '' when nothing did. */
export function leftWords({ missing = 0, past = 0 } = {}) {
  const parts = [];
  if (missing) parts.push(`${missing} ${missing === 1 ? 'file or proof' : 'files or proofs'} not found in the case`);
  if (past) parts.push(`${past} ${past === 1 ? 'post' : 'posts'} past the ${MAX_THREAD_POSTS} a thread holds`);
  return parts.length ? `Left out of the thread: ${parts.join(', and ')}.` : '';
}
