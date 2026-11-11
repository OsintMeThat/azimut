/**
 * A video thread written: the pieces of `lib/videoThread.js` turned into the posts Post
 * shows, each a text from its template and the case files it carries.
 *
 * **The layout** is a template's (`lib/post.js` VIDEO_THREAD_STARTERS): its order, its
 * recap text (`body`), and the texts of the video's post and of each place's (`posts`).
 * A text per kind of post rather than per order: a place says the same in every order,
 * and keeps the words the analyst gave it when the thread changes order.
 *
 * **The tokens.** The recap and the video's post say `#video`, `#scenes`, `#mention` and
 * `#source`, the video's link. A place's post says its own: `#description` (the proof's
 * sentence, else its title when the analyst named it), `#timecode`, `#coordinates`
 * (every point, the first in decimal), `#date`, and the thread's `#video`, `#mention`
 * and `#source`. `#place` and `#pluscode` are its point's address, filled once read
 * (`placeFacts`). A token with nothing to say drops its line, as in every post.
 *
 * **A post** is `{ key, role, proof, text, mediaType, mediaPaths }`: `key` names the post
 * across a rebuild (`video`, `recap`, `all`, `place:<proof>`), so words the analyst
 * changed stay on their post when the thread changes order.
 */
import { buildTweet1, postDate, POINT_SEPARATOR, THREAD_ROLES, VIDEO_ORDERS, VIDEO_THREAD_STARTERS } from './post.js';
import { isDefaultName } from './naming.js';
import { DEFAULT_ORDER, videoThread } from './videoThread.js';

/** The most posts a thread holds: the first, and the twenty a draft keeps after it (`api/drafts.py`). */
export const MAX_THREAD_POSTS = 21;

/** The start a thread opens on without a template: Recap first. */
const FIRST_START = VIDEO_THREAD_STARTERS.find((one) => one.order === DEFAULT_ORDER);

/**
 * A thread's layout from a template's data (or a start's), the default start filling
 * what it leaves out: `{ order, recap, video, place }`.
 */
export function videoLayout(data = {}) {
  const posts = Array.isArray(data?.posts) ? data.posts : [];
  const text = (role) => {
    const found = posts.find((one) => one?.role === role);
    return typeof found?.body === 'string' ? found.body : FIRST_START.posts.find((one) => one.role === role).body;
  };
  return {
    order: VIDEO_ORDERS.includes(data?.order) ? data.order : DEFAULT_ORDER,
    recap: typeof data?.body === 'string' && data.body.trim() ? data.body : FIRST_START.body,
    video: text('video'),
    place: text('place'),
  };
}

/** A layout's texts as a template or a draft keeps them beside its `body`. */
export const layoutPosts = (layout) => THREAD_ROLES.map((role) => ({ role, body: layout[role] }));

/** The link a video goes out as: the address it was downloaded from or stated with. */
export function videoLink(item) {
  const source = item?.source ?? {};
  for (const value of [source.webpage_url, source.url]) {
    if (typeof value === 'string' && /^https?:\/\//i.test(value.trim())) return value.trim();
  }
  return '';
}

/** A place's coordinates as a post carries them: every point a line, its name before it. */
export function placeCoords(points) {
  return (Array.isArray(points) ? points : [])
    .filter((point) => typeof point?.coords === 'string' && point.coords.trim())
    .map((point) => (point.label ? `${point.label}${POINT_SEPARATOR}${point.coords.trim()}` : point.coords.trim()))
    .join('\n');
}

/**
 * The token values of a place's post, from its slide (`videoThread.videoSlides`): its
 * row as `GET /scenes?video=` answered it, and its time. `common` is the thread's own:
 * `video`, `mention`, `source`. `facts` is its point's address once read: `place`, `plusCode`.
 */
export function placeFields(slide, common = {}, facts = {}) {
  const row = slide?.row ?? {};
  const first = (row.points ?? []).find((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon));
  const description = typeof row.description === 'string' && row.description.trim()
    ? row.description.trim()
    : (isDefaultName(slide?.title ?? '', 'proof') ? '' : slide?.title ?? '');
  return {
    ...common,
    description,
    timecode: slide?.timecode ?? '',
    coordsText: placeCoords(row.points),
    lat: first?.lat,
    lon: first?.lon,
    date: postDate(row.when, row.when_zone),
    place: facts.place ?? '',
    plusCode: facts.plusCode ?? '',
  };
}

const typeOf = (media) => (media.some((one) => one.kind === 'video') ? 'video' : media.length ? 'images' : 'none');

/**
 * The posts of a video thread.
 *
 * - `video`: `{ path, title }`; `slides`: the places to post, in order (`videoSlides`).
 * - `layout`: `videoLayout`'s; `common`: `{ mention, source }`, the source being the
 *   video's link (`videoLink`), and `#video` the thread's title, the analyst's.
 * - `sheet`: the contact sheet's case path once filed, else its post waits for it.
 * - `recap`: what Recap first's recap carries, `map` or `sheet`; `map`: the recap map's
 *   case path once made, else the recap waits for it.
 * - `clip`: a clip to post in place of the whole video; `link`: the video goes as its link.
 * - `facts`: each place's address by proof name, once read (`placeFields`).
 * - `extra`: the template's boilerplate posts, texts after the thread.
 *
 * Answers `{ posts, cut }`: `cut` counts the places past what a thread holds.
 */
export function videoPosts({
  video, slides = [], layout = videoLayout(), common = {}, sheet = null, clip = null, link = false, facts = {}, extra = [],
  recap = 'sheet', map = null,
}) {
  const named = { path: video?.path ?? null, title: video?.title ?? '' };
  const shared = { video: named.title, mention: common.mention ?? '', source: common.source ?? '' };
  const pieces = videoThread({ video: named, slides, order: layout.order, clip, link, recap });
  const byName = new Map(slides.map((slide) => [slide.name, slide]));
  const posts = pieces.map((piece) => {
    const media = piece.media.flatMap((one) => {
      if (one.kind === 'sheet') return sheet ? [{ kind: 'picture', path: sheet }] : [];
      if (one.kind === 'map') return map ? [{ kind: 'picture', path: map }] : [];
      return one.path ? [one] : [];
    });
    const files = { mediaType: typeOf(media), mediaPaths: media.map((one) => one.path).slice(0, 4) };
    if (piece.role === 'proof') {
      const slide = byName.get(piece.proof.name);
      const fields = placeFields({ ...slide, timecode: piece.tokens['#timecode'] }, shared, facts[piece.proof.name]);
      return { key: `place:${piece.proof.name}`, role: 'place', proof: piece.proof.name, text: buildTweet1(layout.place, fields), ...files };
    }
    const fields = { ...shared, scenes: piece.tokens['#scenes'] ?? '' };
    let text = buildTweet1(piece.role === 'video' ? layout.video : layout.recap, fields);
    // the video gone as its link: the post says it, whatever its text holds
    if (piece.role === 'video' && link && shared.source && !text.includes(shared.source)) {
      text = text ? `${text}\n\n${shared.source}` : shared.source;
    }
    return { key: piece.role, role: piece.role, proof: null, text, ...files };
  });
  const words = (extra ?? []).map((one) => String(one?.text ?? '')).filter((text) => text.trim());
  const room = Math.max(1, MAX_THREAD_POSTS - words.length);
  const kept = posts.slice(0, room);
  const cut = posts.slice(room).filter((post) => post.role === 'place').length;
  const tail = words.slice(0, MAX_THREAD_POSTS - kept.length)
    .map((text, i) => ({ key: `extra:${i}`, role: 'extra', proof: null, text, mediaType: 'none', mediaPaths: [] }));
  return { posts: [...kept, ...tail], cut };
}

/** What a post of a thread is called above it. */
export function threadPostLabel(post, titles = new Map()) {
  if (!post?.role) return 'Context';
  if (post.role === 'recap') return 'Recap';
  if (post.role === 'video') return post.mediaType === 'video' ? 'Video' : 'Video link';
  if (post.role === 'all') return 'All in one';
  if (post.role === 'extra') return 'Context';
  return titles.get(post.proof) ?? post.proof ?? 'Place';
}

