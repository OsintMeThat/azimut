/**
 * A video thread as plain data: the posts that put the proofs of one long video online,
 * in one of four orders. Post turns each piece into a post through its templates
 * (`lib/videoPost.js`); nothing here writes a word of the post itself.
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
 *     media: [{ kind: 'video', path } | { kind: 'picture', path, proof } | { kind: 'sheet' } | { kind: 'map' }] }
 *
 * `{ kind: 'sheet' }` is the contact sheet (`lib/proofSheet.js`) and `{ kind: 'map' }`
 * the recap map (`lib/recapMap.js`), drawn in the browser and filed in the case, so
 * neither has a path here. Neither X nor Bluesky puts a video and pictures in one post
 * (`lib/videoLimits.js`), so the recap picture and the video always go in posts of their
 * own: Recap first opens on the map or the sheet (`recap`) with `#scenes`, all numbering
 * the places the same way, and the video follows. Neither picture prints a title:
 * `#scenes` is their legend.
 *
 * **The time.** One formatter for every time a post prints (`timecode`): an instant
 * `[0:15]`, a passage `[0:00–0:07]`, several side by side `[0:00–0:07] [1:05–1:12]`, and
 * nothing for a proof about the whole video. `#scenes` is the video's places, one a
 * line and numbered as the sheet numbers them, `1. [0:00–0:07] Road bridge`, the title
 * alone for the whole video. The clock is `lib/scenes.js`'s, never written here.
 */
import { labelCoords, ownName } from './naming.js';
import { isAbandoned, momentTime, sceneList, sceneMoments, sceneTime, sceneTitle, sortMoments, unplaced } from './scenes.js';
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
/** What each order puts where, in a line under its name. */
export const ORDER_WORDS = Object.freeze({
  recap: 'The places on a map or the proofs sheet, then the video, then a post per place',
  video: 'The video, then a post per place',
  proof: 'The first place, then the video, then the other places',
  all: 'One post with the places and their pictures',
});

/** Why a proof of the video is no post of the thread. */
export const LEFT_WHY = Object.freeze({
  abandoned: 'Abandoned',
  unplaced: 'No place yet',
  nopicture: 'No picture yet',
});

/** The most pictures one post holds, on both platforms. */
export const PICTURES_PER_POST = Math.min(...Object.values(VIDEO_LIMITS).map((t) => t.pictures));

/** The moments of a list that are times, in clip order. */
function timed(moments) {
  return sortMoments((Array.isArray(moments) ? moments : []).filter((m) => Number.isFinite(m?.start)));
}

/** One moment as a post prints it: `[0:15]` for an instant, `[0:00–0:07]` for a passage. */
export const bracketTime = (moment) => `[${momentTime(moment)}]`;

/** `#timecode`: every moment of a proof, `[0:00–0:07] [1:05–1:12]`, or '' for the whole video. */
export function timecode(moments) {
  return timed(moments).map(bracketTime).join(' ');
}

/** A timecode where room is short, a contact sheet's cell: the first time, the rest counted, `[0:00–0:07] +1`. */
export function shortTimecode(moments) {
  const shown = timed(moments);
  if (!shown.length) return '';
  return shown.length > 1 ? `${bracketTime(shown[0])} +${shown.length - 1}` : bracketTime(shown[0]);
}

/**
 * What `#scenes`, a post's heading and the thread's column call a place of the video:
 * the proof's name when the analyst gave it one, else where it stands as the case knows
 * it (`place`) with its point's plus code, which tells two places of one region apart
 * (`Al Jawf, Yemen (7H872G9H+FC)`), else the plus code or the point alone, else its
 * time. Never "Proof 3", a name the app gave.
 */
export function placeLabel(row) {
  const own = ownName(sceneTitle(row ?? {}), 'proof');
  if (own) return own;
  const where = String(row?.place ?? '').trim();
  const plus = String(row?.plus_code ?? '').trim();
  if (where) return plus ? `${where} (${plus})` : where;
  if (plus) return plus;
  const point = (row?.points ?? []).find((one) => Number.isFinite(one?.lat) && Number.isFinite(one?.lon));
  return labelCoords(point) || sceneTime(row ?? {});
}

/** One line of `#scenes`: its number, the time and the place, or the number and the place alone. */
export function sceneLine(slide, number) {
  const time = timecode(slide.moments);
  return `${number}. ${time ? `${time} ` : ''}${slide.label ?? slide.title}`;
}

/** `#scenes`: the places of the thread with their times, one a line, numbered from 1. */
export function scenesText(slides) {
  return (slides ?? []).map((slide, i) => sceneLine(slide, i + 1)).join('\n');
}

/**
 * The slides a thread posts, out of what `GET /scenes?video=` answered: the proofs in
 * the strip's clip order, each `{ name, id, title, label, moments, png, clip, row }`,
 * `title` its name and `label` what the thread calls it (`placeLabel`), and `left`, the
 * proofs it does not post with why (`LEFT_WHY`). Each row keeps the colour Inspect's bar
 * and the strip give its scene, the scenes still to prove counted.
 */
export function videoSlides(answer) {
  const scenes = (answer?.scenes ?? []).filter((s) => s?.kind === 'proof' || s?.kind === 'draft');
  const ordered = sceneList(scenes, scenes.filter((s) => s.kind === 'draft'), answer?.taken ?? [])
    .filter((row) => row.kind === 'proof');
  const slides = [];
  const left = [];
  for (const row of ordered) {
    const title = sceneTitle(row);
    const label = placeLabel(row);
    const why = isAbandoned(row) ? 'abandoned' : unplaced(row) ? 'unplaced' : !row.png ? 'nopicture' : null;
    if (why) {
      left.push({ name: row.proof, title, label, why });
      continue;
    }
    slides.push({
      name: row.proof,
      id: row.proof_id ?? null,
      title,
      label,
      moments: sceneMoments(row),
      png: row.png,
      clip: row.clip ?? null,
      row,
    });
  }
  return { video: answer?.video ?? null, slides, left };
}

/** What Recap first's recap carries: the places on a map, or the proofs sheet. */
export const RECAPS = Object.freeze(['map', 'sheet']);

/** Whether a thread of `count` places in this order carries the contact sheet, `recap` its recap's picture. */
export function usesSheet(order, count, recap = 'sheet') {
  if (count < 1) return false;
  return (order === 'recap' && recap !== 'map') || (order === 'all' && count > PICTURES_PER_POST);
}

const proofOf = (slide) => ({ name: slide.name, id: slide.id ?? null, title: slide.title });

/** A post about one place: its picture, and its time. */
function proofPiece(slide, video) {
  return {
    role: 'proof',
    proof: proofOf(slide),
    tokens: { '#video': video.title, '#timecode': timecode(slide.moments) },
    media: slide.png ? [{ kind: 'picture', path: slide.png, proof: slide.name }] : [],
  };
}

/**
 * The thread of one video in one order, as pieces.
 *
 * - `video`: `{ path, title }`, the video the slides are of, and the thread's title (`#video`),
 *   the analyst's own words, '' for none.
 * - `slides`: what `videoSlides` keeps, in the order to post them.
 * - `clip`: a case path to post in place of the whole video (a cut, `lib/postClip.js`), or null.
 * - `link`: the video goes out as its link rather than a file, so its post carries none.
 * - `recap`: what Recap first's recap carries, `map` or `sheet` (`RECAPS`).
 */
export function videoThread({ video, slides, order = DEFAULT_ORDER, clip = null, link = false, recap = 'sheet' }) {
  if (!ORDERS.includes(order)) throw new Error(`no thread order ${order}`);
  const named = { path: video?.path ?? null, title: video?.title ?? '' };
  const list = slides ?? [];
  const footage = !link && (clip || named.path) ? [{ kind: 'video', path: clip || named.path }] : [];
  const scenes = scenesText(list);
  const each = list.map((slide) => proofPiece(slide, named));
  const lead = { role: 'video', tokens: { '#video': named.title, '#scenes': scenes }, media: footage };

  if (order === 'all') {
    // past four places, the sheet shows every one of them where four pictures could not
    const media = usesSheet('all', list.length)
      ? [{ kind: 'sheet' }]
      : list.filter((s) => s.png).map((s) => ({ kind: 'picture', path: s.png, proof: s.name }));
    return [{ role: 'all', tokens: { '#video': named.title, '#scenes': scenes }, media }];
  }
  if (order === 'recap') {
    if (!list.length) return [lead];
    const picture = { kind: recap === 'map' ? 'map' : 'sheet' };
    return [{ role: 'recap', tokens: { '#video': named.title, '#scenes': scenes }, media: [picture] }, lead, ...each];
  }
  if (order === 'video') return [lead, ...each];
  // proof first: the strongest place, then the video it comes from, then the rest
  const [first, ...rest] = each;
  return first ? [first, lead, ...rest] : [lead];
}

/** The thread in each of the four orders, by order. */
export function videoThreads(input) {
  return Object.fromEntries(ORDERS.map((order) => [order, videoThread({ ...input, order })]));
}
