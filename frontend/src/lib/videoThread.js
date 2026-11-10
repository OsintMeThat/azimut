/**
 * A video thread as plain data: the posts that put the proofs of one long video online,
 * in one of four orders. Post (wave 2) turns each piece into a post through its
 * templates; nothing here writes a word of the post itself.
 *
 * **What goes in.** A video's slides, its proofs in clip order as the strip reads them
 * (`GET /cases/{id}/scenes?video=`, `lib/proofSlides.js`). A scene still to prove is no
 * slide. Of the proofs, a thread posts the ones that show a place on a picture: the
 * abandoned, the ones still being geolocated (no place yet) and the ones never exported
 * (no picture) are left out, and listed in `left` with why, so a composer can say so
 * (`videoSlides`). Their order is the strip's, unless the caller hands its own.
 *
 * **What comes out.** For each order, a list of pieces. A piece is one post's role,
 * its token values (`#video`, `#timecode`, `#scenes`), the proof it is about, and its
 * media by case path:
 *
 *   { role, proof?: { name, id, title }, tokens: { '#video', '#timecode'?, '#scenes'? },
 *     media: [{ kind: 'video', path } | { kind: 'picture', path, proof } | { kind: 'sheet' }] }
 *
 * `{ kind: 'sheet' }` is the contact sheet (`lib/proofSheet.js`), built in the browser
 * when the post is made, so it has no path yet. Neither X nor Bluesky puts a video and
 * pictures in one post (`lib/videoLimits.js`), so the recap's contact sheet follows its
 * video in a post of its own (`role: 'sheet'`) where the platform says so.
 *
 * **The time.** `#timecode` is a proof's passages, `0:00–0:07 · 1:05–1:12`, and nothing
 * for a proof about the whole video: no passage, no timecode, anywhere. `#scenes` is
 * the video's places, one a line, `0:00–0:07 Road bridge`, the title alone for the whole
 * video. The words are `lib/scenes.js`'s, never written here.
 */
import { compactTime, isAbandoned, isStretch, momentTime, sceneList, sceneMoments, sceneTitle, unplaced } from './scenes.js';
import { VIDEO_LIMITS } from './videoLimits.js';

/** The four orders, the default first: one template start each. */
export const ORDERS = Object.freeze(['recap', 'video', 'proof', 'all']);
export const DEFAULT_ORDER = 'recap';
/** What each order is called where one is picked. */
export const ORDER_NAMES = Object.freeze({
  recap: 'Recap first',
  video: 'Video first',
  proof: 'Proof first',
  all: 'All in one',
});

/**
 * Whether an instant prints its time. An open question for the owner, settled on a
 * sample thread: `plain` prints it as any time is printed (`0:03`), `none` prints only
 * the passages, so a proof of instants alone has no timecode.
 */
export const INSTANT_TIMES = Object.freeze(['plain', 'none']);
export const DEFAULT_INSTANTS = 'plain';

/** Why a proof of the video is no post of the thread. */
export const LEFT_WHY = Object.freeze({
  abandoned: 'Abandoned',
  unplaced: 'No place yet',
  nopicture: 'No picture yet',
});

/** The most pictures one post holds, on both platforms. */
const PICTURES_PER_POST = Math.min(...Object.values(VIDEO_LIMITS).map((t) => t.pictures));

/**
 * The moments a timecode prints, by the instants rule.
 * @param {Array<{start: number, end: number|null}>} moments
 */
function printed(moments, instants = DEFAULT_INSTANTS) {
  const all = moments ?? [];
  return instants === 'none' ? all.filter(isStretch) : all;
}

/** `#timecode`: every passage of a proof, `0:00–0:07 · 1:05–1:12`, or '' for the whole video. */
export function timecode(moments, { instants = DEFAULT_INSTANTS } = {}) {
  return printed(moments, instants).map(momentTime).join(' · ');
}

/** A timecode where room is short, a contact sheet's cell: the first time, the rest counted, `0:00–0:07 +1`. */
export function shortTimecode(moments, { instants = DEFAULT_INSTANTS } = {}) {
  const shown = printed(moments, instants);
  return shown.length ? compactTime({ kind: 'proof', moments: shown }) : '';
}

/** One line of `#scenes`: the time and the title, or the title alone. */
export function sceneLine(slide, options = {}) {
  const time = timecode(slide.moments, options);
  return time ? `${time} ${slide.title}` : slide.title;
}

/** `#scenes`: the places of the thread with their times, one a line. */
export function scenesText(slides, options = {}) {
  return (slides ?? []).map((slide) => sceneLine(slide, options)).join('\n');
}

/**
 * The slides a thread posts, out of what `GET /scenes?video=` answered: the proofs in
 * the strip's clip order, each `{ name, id, title, moments, png, row }`, and `left`, the
 * proofs it does not post with why (`LEFT_WHY`).
 */
export function videoSlides(answer) {
  const listed = (answer?.scenes ?? []).filter((s) => s?.kind === 'proof');
  const ordered = sceneList(listed, [], answer?.taken ?? []);
  const slides = [];
  const left = [];
  for (const row of ordered) {
    const title = sceneTitle(row);
    const why = isAbandoned(row) ? 'abandoned' : unplaced(row) ? 'unplaced' : !row.png ? 'nopicture' : null;
    if (why) {
      left.push({ name: row.proof, title, why });
      continue;
    }
    slides.push({
      name: row.proof,
      id: row.proof_id ?? null,
      title,
      moments: sceneMoments(row),
      png: row.png,
      clip: row.clip ?? null,
      row,
    });
  }
  return { video: answer?.video ?? null, slides, left };
}

const proofOf = (slide) => ({ name: slide.name, id: slide.id ?? null, title: slide.title });

/** A post about one place: its picture, and its time. */
function proofPiece(slide, video, options) {
  return {
    role: 'proof',
    proof: proofOf(slide),
    tokens: { '#video': video.title, '#timecode': timecode(slide.moments, options) },
    media: slide.png ? [{ kind: 'picture', path: slide.png, proof: slide.name }] : [],
  };
}

/**
 * The thread of one video in one order, as pieces.
 *
 * - `video`: `{ path, title }`, the video the slides are of, its title as Media gives it.
 * - `slides`: what `videoSlides` keeps, in the order to post them.
 * - `clip`: a case path to post in place of the whole video (a cut, `lib/postClip.js`), or null.
 * - `platform`: `x` or `bluesky`, for whether a video and pictures share a post.
 * - `instants`: whether an instant prints its time (`INSTANT_TIMES`).
 */
export function videoThread({ video, slides, order = DEFAULT_ORDER, clip = null, platform = 'x', instants = DEFAULT_INSTANTS }) {
  if (!ORDERS.includes(order)) throw new Error(`no thread order ${order}`);
  const options = { instants };
  const named = { path: video?.path ?? null, title: video?.title ?? '' };
  const list = slides ?? [];
  const mix = Boolean(VIDEO_LIMITS[platform]?.mix);
  const footage = clip || named.path ? [{ kind: 'video', path: clip || named.path }] : [];
  const scenes = scenesText(list, options);
  const each = list.map((slide) => proofPiece(slide, named, options));

  if (order === 'all') {
    const shown = list.slice(0, PICTURES_PER_POST);
    return [{
      role: 'all',
      tokens: { '#video': named.title, '#scenes': scenes },
      media: shown.filter((s) => s.png).map((s) => ({ kind: 'picture', path: s.png, proof: s.name })),
      // the places the text names that no picture shows
      unpictured: list.slice(PICTURES_PER_POST).map(proofOf),
    }];
  }
  if (order === 'recap') {
    const recap = { role: 'recap', tokens: { '#video': named.title, '#scenes': scenes }, media: footage };
    if (!list.length) return [recap];
    const sheet = [{ kind: 'sheet' }];
    // the sheet with the video where the platform takes both in one post, else just after it
    if (mix || !footage.length) return [{ ...recap, media: [...footage, ...sheet] }, ...each];
    return [recap, { role: 'sheet', tokens: { '#video': named.title }, media: sheet }, ...each];
  }
  const lead = { role: 'video', tokens: { '#video': named.title }, media: footage };
  if (order === 'video') return [lead, ...each];
  // proof first: the strongest place, then the video it comes from, then the rest
  const [first, ...rest] = each;
  return first ? [first, lead, ...rest] : [lead];
}

/** The thread in each of the four orders, by order. */
export function videoThreads(input) {
  return Object.fromEntries(ORDERS.map((order) => [order, videoThread({ ...input, order })]));
}
