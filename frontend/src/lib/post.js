/**
 * Post Composer thread logic — pure functions, no Svelte/DOM here.
 *
 * A thread template is a **body string with tokens** (#place, #coordinates, …).
 * The analyst arranges the tokens in the order and line layout they want; a
 * template is that layout plus the default mention, the media-tweet flag and any
 * boilerplate extra tweets. It carries no case content — the tokens are filled
 * from the live draft at build time. Some accounts drop the place line or post
 * bare coordinates; a token body expresses either without special-casing.
 */

import { entityReference, mediaReference } from './markdown.js';

/**
 * What a post is made from, as New post offers it. A draft or a template that says
 * nothing is a Geolocation one, which is what every post was before kinds existed,
 * so the kind is written only when it is another (`statedPostKind`).
 */
export const POST_KINDS = Object.freeze([
  { id: 'geolocation', label: 'Geolocation', many: 'geolocations', icon: 'crosshair', text: 'A proof, its point and its source, as Post has always written it.' },
  { id: 'video', label: 'Video thread', many: 'video threads', icon: 'video', text: 'The proofs of one video, in the order you pick.' },
  { id: 'plate', label: 'Map plate', many: 'plate posts', icon: 'plate', text: 'A plate’s picture or video, its legend and its credits.' },
  { id: 'compare', label: 'Compare', many: 'compare posts', icon: 'compare', text: 'A before and after from Compare, with its dates and its credits.' },
  { id: 'free', label: 'Free post', many: 'free posts', icon: 'edit', text: 'Your own words and up to four pictures or a video per post.' },
].map((kind) => Object.freeze(kind)));

/** The kinds New post can start: a kind left out keeps its card, greyed, until it is built. */
export const STARTABLE_POST_KINDS = Object.freeze(['geolocation', 'video', 'plate', 'compare', 'free']);

/** A known kind, or Geolocation for anything else: an old draft, a hand-edited one. */
export function normalizePostKind(kind) {
  return POST_KINDS.some((one) => one.id === kind) ? kind : 'geolocation';
}

/** The kind as a draft or a template writes it: absent for Geolocation, so neither changes shape. */
export function statedPostKind(kind) {
  const known = normalizePostKind(kind);
  return known === 'geolocation' ? undefined : known;
}

/** A kind's row in POST_KINDS. */
export function postKind(kind) {
  return POST_KINDS.find((one) => one.id === normalizePostKind(kind));
}

// The tokens an analyst can drop into a thread body. `sample` feeds the editor
// preview so the layout reads before any real draft exists; `kinds` are the
// templates whose editor offers it. Every token is known to every body, so a line
// holding one with nothing to say drops wherever it is written.
// `#timecode` is the time the proof states in its video, `[0:00–0:07]` (lib/videoThread.js),
// for a geolocation and for each place of a video thread; `#scenes` the places of a video
// thread; `#credits` the imagery credits of the post's media. Empty, each drops its line.
export const TWEET_TOKENS = [
  { tag: '#place', label: 'Place', sample: 'Bakhmut, Donetsk, Ukraine', kinds: ['geolocation', 'video'] },
  { tag: '#pluscode', label: 'Plus code', sample: '8FPGXXXX+XX', kinds: ['geolocation', 'video'] },
  { tag: '#coordinates', label: 'Coordinates', sample: '48.850000, 2.350000', kinds: ['geolocation', 'video'] },
  { tag: '#description', label: 'Description', sample: 'Rooftop match against the reference imagery', kinds: ['geolocation', 'video', 'plate', 'compare', 'free'] },
  { tag: '#mention', label: 'Mention', sample: '@GeoConfirmed', kinds: ['geolocation', 'video', 'plate', 'compare', 'free'] },
  { tag: '#source', label: 'Source', sample: 'https://x.com/example/status/1', kinds: ['geolocation', 'video', 'compare', 'free'] },
  { tag: '#date', label: 'Date', sample: '2025-10-24 14:30 UTC+3', kinds: ['geolocation', 'video', 'plate', 'compare', 'free'] },
  { tag: '#video', label: 'Video title', sample: 'Convoy on the coast road', kinds: ['geolocation', 'video'] },
  { tag: '#timecode', label: 'Timecode', sample: '[0:00–0:07]', kinds: ['geolocation', 'video'] },
  { tag: '#scenes', label: 'Scenes', sample: '1. [0:00–0:07] Road bridge\n2. [0:15] Port gate\n3. Hilltop village', kinds: ['video'] },
  { tag: '#credits', label: 'Credits', sample: 'Imagery: Copernicus Sentinel-2', kinds: ['geolocation', 'video', 'plate', 'compare', 'free'] },
];

/** The tokens a kind's template editor offers. */
export function tokensForKind(kind) {
  const known = normalizePostKind(kind);
  return TWEET_TOKENS.filter((token) => token.kinds.includes(known));
}

export const MAX_POST_MEDIA = 4;

/**
 * Publishing targets share the same prepared thread, but apply their own
 * character rules and composer address.
 *
 * Mastodon was here and was dropped: there is no one address to open. Its share
 * link is a redirector that asks which server first, so the app could not say
 * where the thread was going, and the extension could not fill a page nobody
 * knew the name of — one target of three behaving differently, invisibly, until
 * Publish was pressed. A draft saved with it opens on X (normalizePostTarget).
 */
export const POST_TARGETS = Object.freeze({
  x: { id: 'x', label: 'X', limit: 280, limitLabel: '280' },
  bluesky: { id: 'bluesky', label: 'Bluesky', limit: 300, limitLabel: '300' },
});

const URL_RE = /https?:\/\/\S+/g;

/** Accept stored legacy drafts and unknown values without breaking the form. */
export function normalizePostTarget(target) {
  return Object.hasOwn(POST_TARGETS, target) ? target : 'x';
}

/** Return a target profile, falling back to X for old or hand-edited drafts. */
export function postTarget(target) {
  return POST_TARGETS[normalizePostTarget(target)];
}

/** X reserves a fixed length for every HTTP(S) URL, whatever the URL is. */
export function weightedUrlLength(text) {
  const value = String(text ?? '');
  const stripped = value.replace(URL_RE, '');
  const urls = value.match(URL_RE)?.length ?? 0;
  return [...stripped].length + urls * 23;
}

/** Bluesky limits posts by visible Unicode grapheme clusters, not code units. */
export function graphemeLength(text) {
  const value = String(text ?? '');
  if (typeof Intl?.Segmenter === 'function') {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length;
  }
  return [...value].length;
}

/** Count text according to the selected target's documented rule. */
export function postCharacterCount(target, text) {
  return normalizePostTarget(target) === 'bluesky'
    ? graphemeLength(text)
    : weightedUrlLength(text);
}

/** Build a compose handoff for the first post. Replies stay on the clipboard. */
export function postComposeUrl(target, text) {
  const encoded = encodeURIComponent(String(text ?? ''));
  return normalizePostTarget(target) === 'bluesky'
    ? `https://bsky.app/intent/compose?text=${encoded}`
    : `https://x.com/intent/post?text=${encoded}`;
}

/**
 * Where the capture extension opens the thread.
 *
 * The **full** composer rather than the intent page, because that is the one that
 * builds a thread: the intent posts a single message, and the whole point here is
 * the run of posts under the first.
 *
 * The text rides in the URL as well as being typed, so the first post is filled
 * even when the page changes under the script and nothing else lands.
 */
export function postHandoffUrl(target, text) {
  const encoded = encodeURIComponent(String(text ?? ''));
  return normalizePostTarget(target) === 'bluesky'
    ? `https://bsky.app/intent/compose?text=${encoded}`
    : `https://x.com/compose/post?text=${encoded}`;
}

// A post's own address on each site. X answers to its old name and its mobile host too;
// a Bluesky post is a profile (handle or did) and a record key.
const X_POST = /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})(?:[/?#].*)?$/i;
const BLUESKY_POST = /^https:\/\/bsky\.app\/profile\/([^/?#\s]+)\/post\/([A-Za-z0-9]{1,64})(?:[/?#].*)?$/i;

/**
 * The post the source line points at, when it is one Post can reply under: the first
 * address of the line that is an X or a Bluesky post. `url` is its canonical address,
 * the page the extension opens; `id` is X's status id, what its reply intent takes.
 * Null for any other source, so the action is never offered for a page it cannot answer.
 */
export function replyTarget(sourceLine) {
  for (const raw of sourceUrls(sourceLine)) {
    const found = postAddress(raw.replace(/[),.;]+$/, ''));
    if (found) return found;
  }
  return null;
}

/** One address as an X or Bluesky post, canonical, or null. */
function postAddress(address) {
  const x = X_POST.exec(address);
  if (x) return { site: 'x', id: x[2], url: `https://x.com/${x[1]}/status/${x[2]}` };
  const bluesky = BLUESKY_POST.exec(address);
  if (bluesky) {
    return { site: 'bluesky', id: bluesky[2], url: `https://bsky.app/profile/${bluesky[1]}/post/${bluesky[2]}` };
  }
  return null;
}

/**
 * The address the analyst pasted for a post that went out: an X status or a Bluesky
 * post, written the one way the server keeps it (`api/drafts.py` POSTED_URL), or null.
 * Pasted as the browser shows it, so a missing `https://` and a share's `?s=20` pass.
 */
export function postedAddress(text) {
  let address = String(text ?? '').trim().replace(/[),.;]+$/, '');
  if (/^http:\/\//i.test(address)) address = `https://${address.slice(7)}`;
  else if (!/^https:\/\//i.test(address)) address = `https://${address}`;
  const found = postAddress(address);
  return found ? { site: found.site, url: found.url } : null;
}

/**
 * Where a post stands, from its draft's `publish` record: a **draft**, one **posted**
 * once the analyst marked it so (with its link or without, `posted_at`), or **changed**
 * since. A draft from before says nothing and is a draft, and so is one an earlier build
 * only opened the site with (`opened_at`). `api/drafts.py` reads the same record.
 */
export function postState(publish) {
  if (!publish || typeof publish !== 'object') return 'draft';
  const linked = postedAddress(publish.url);
  if (publish.url != null && !linked) return 'draft';
  const marked = typeof publish.posted_at === 'string' && publish.posted_at;
  if (!linked && !marked) return 'draft';
  return publish.changed === true ? 'changed' : 'posted';
}

/** The words a state goes by, on a card's pill and in the Open list's filter. */
export const POST_STATES = Object.freeze([
  { id: 'draft', label: 'Draft' },
  { id: 'posted', label: 'Posted' },
  { id: 'changed', label: 'Changed since posted' },
].map((state) => Object.freeze(state)));

/** A state as a pill says it. */
export function postStateLabel(state) {
  return (POST_STATES.find((one) => one.id === state) ?? POST_STATES[0]).label;
}

// X's ids count milliseconds from its own epoch in their top bits (a snowflake), and a
// Bluesky record key is a TID: base32-sortable, microseconds since 1970 in its top bits.
const X_EPOCH = 1288834974657n;
const TID_ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';
// Before the first snowflake an id says nothing of its day; after tomorrow it is no post's.
const FIRST_DAY = Date.UTC(2010, 10, 5);

/**
 * The moment a post went out, read off its own link with no network: an X status id or a
 * Bluesky TID holds it. An ISO string, or null for a link that holds none (a Bluesky
 * record key that is no TID, an id from before X's snowflakes, anything else).
 */
export function postLinkDate(url, now = Date.now()) {
  const found = postAddress(String(url ?? ''));
  if (!found) return null;
  let ms = null;
  if (found.site === 'x') {
    ms = Number((BigInt(found.id) >> 22n) + X_EPOCH);
  } else if (/^[2-7a-z]{13}$/.test(found.id) && TID_ALPHABET.indexOf(found.id[0]) < 16) {
    let value = 0n;
    for (const char of found.id) value = (value << 5n) | BigInt(TID_ALPHABET.indexOf(char));
    ms = Number((value >> 10n) / 1000n);
  }
  if (ms === null || ms < FIRST_DAY || ms > now + 86_400_000) return null;
  return new Date(ms).toISOString();
}

/** When a post went out: its link's own date, else the moment it was marked posted. */
export function postedWhen(posted) {
  return postLinkDate(posted?.url) ?? (typeof posted?.at === 'string' && posted.at ? posted.at : null);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A post's day as its pill and its card say it, on this machine's clock: *9 Nov*, the year added outside this one. '' when it says none. */
export function postedDay(iso, now = new Date()) {
  const at = new Date(String(iso ?? ''));
  if (!iso || Number.isNaN(at.getTime())) return '';
  const day = `${at.getDate()} ${MONTHS[at.getMonth()]}`;
  return at.getFullYear() === now.getFullYear() ? day : `${day} ${at.getFullYear()}`;
}

/**
 * A proof's `posted` record (`api/drafts.py`) as its Details list it: each post's site, its
 * day and its link when it has one. An entry whose link is no post is left out.
 */
export function proofPostLines(entries, now = new Date()) {
  return (Array.isArray(entries) ? entries : []).flatMap((one) => {
    if (!one || typeof one !== 'object') return [];
    const out = postedAddress(one.url);
    if (one.url != null && !out) return [];
    const site = out?.site ?? (Object.hasOwn(POST_TARGETS, one.site) ? one.site : null);
    if (!site) return [];
    return [{ site, url: out?.url ?? null, day: postedDay(postedWhen({ url: out?.url, at: one.at }), now) }];
  });
}

/**
 * A short fingerprint of what a post says and carries, kept when it is marked posted, so
 * an edit after that reads as *Changed since posted* (and going back reads as posted).
 */
export function postFingerprint(text) {
  let hash = 0x811c9dc5;
  for (const char of String(text ?? '')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * X's own reply page: the reply box under the post `id`, with the text filled in. The
 * one road to a reply that needs no extension; Bluesky has no such page.
 */
export function replyIntentUrl(id, text) {
  return `https://x.com/intent/post?in_reply_to=${encodeURIComponent(String(id))}&text=${encodeURIComponent(String(text ?? ''))}`;
}

/**
 * The first post as it goes out under the source: the line naming the source leaves,
 * since the post sits right under it. An untouched post is rebuilt without its source,
 * so a line holding the source and something else keeps the rest; one the analyst
 * rewrote loses only the lines that hold one of the source's addresses. The composer
 * shows what this gives, so a link typed back in afterwards goes out as typed.
 */
export function replyPostText({ text, edited = false, body, fields = {} } = {}) {
  if (!edited) return buildTweet1(body, { ...fields, source: '' });
  const urls = sourceUrls(fields.source);
  if (!urls.length) return String(text ?? '');
  const kept = String(text ?? '').split('\n').filter((line) => !urls.some((url) => line.includes(url)));
  const collapsed = [];
  for (const line of kept) {
    if (line.trim() === '' && collapsed[collapsed.length - 1]?.trim() === '') continue;
    collapsed.push(line);
  }
  while (collapsed.length && collapsed[0].trim() === '') collapsed.shift();
  while (collapsed.length && collapsed[collapsed.length - 1].trim() === '') collapsed.pop();
  return collapsed.join('\n');
}

/** What one post may carry: four images, or one video, is every site's rule. */
export const MAX_HANDOFF_FILES = 4;

/**
 * The thread as the extension hands it over: one entry per post, in order, each
 * with the text to type and the case files to attach.
 *
 * A post with no text and no file is not a post; one with a picture and no text
 * is. Anything past the per-post limit is **counted, not dropped in silence** —
 * the caller says how many stayed behind, since the alternative is a thread that
 * looks complete and is missing an image.
 */
export function handoffThread(posts) {
  const kept = [];
  let dropped = 0;
  for (const post of posts ?? []) {
    const text = String(post?.text ?? '');
    const files = (post?.files ?? []).filter(Boolean);
    if (!text.trim() && !files.length) continue;
    if (files.length > MAX_HANDOFF_FILES) dropped += files.length - MAX_HANDOFF_FILES;
    kept.push({ text, files: files.slice(0, MAX_HANDOFF_FILES) });
  }
  return { posts: kept, dropped };
}

/**
 * Turn a prepared social thread into a readable case-note report.
 *
 * ``proofEntity`` and ``mediaEntities`` use the Notebook's local reference
 * syntax, so saved reports keep clickable case links and render their evidence
 * from local media instead of copying files or embedding base64 data.
 */
export function postReportMarkdown({
  title,
  place,
  plusCode,
  coordinates,
  points = [],
  dms,
  mapLinks = {},
  description,
  source,
  attachments = [],
  proofEntity = null,
  mediaEntities = [],
  posted = null,
} = {}) {
  const clean = (value) => String(value ?? '').trim();
  const cell = (value) => clean(value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  const inlineCode = (value) => `\`${clean(value).replace(/`/g, '\\`')}\``;
  const reportTitle = clean(title) || 'Untitled report';
  const location = [
    clean(place) && ['Place', cell(place)],
    clean(coordinates) && ['Coordinates', inlineCode(coordinates)],
    clean(dms) && ['DMS', inlineCode(dms)],
    clean(plusCode) && ['Plus code', inlineCode(plusCode)],
  ].filter(Boolean);
  const mapRows = Object.entries(mapLinks ?? {})
    .map(([label, href]) => [cell(label), clean(href)])
    .filter(([, href]) => /^https?:\/\//i.test(href));
  if (mapRows.length) {
    location.push([
      'Maps',
      mapRows.map(([label, href]) => `[${label}](${href})`).join(' · '),
    ]);
  }
  const cleanAttachments = [...new Set(attachments.map(clean).filter(Boolean))];
  const sections = [`# ${reportTitle}`];

  if (location.length) {
    sections.push([
      '## Location',
      '',
      '| Detail | Value |',
      '| --- | --- |',
      ...location.map(([label, value]) => `| ${label} | ${value} |`),
    ].join('\n'));
  }
  // Every point the proof argues, once there is more than one. Location above
  // is the conclusion — the address the post is written about — and this is the
  // rest of what the picture shows, which a tweet has no room to name.
  const listed = (points ?? []).filter((one) => clean(one?.coords));
  if (listed.length > 1) {
    sections.push([
      '## Points',
      '',
      '| Point | Coordinates |',
      '| --- | --- |',
      ...listed.map((one, i) => `| ${cell(one.label) || `Point ${i + 1}`} | ${inlineCode(one.coords)} |`),
    ].join('\n'));
  }
  if (clean(description)) sections.push(`## Assessment\n\n${clean(description)}`);
  if (clean(source)) sections.push(`## Source\n\n${sourceSection(source)}`);
  // where the post went out, once the analyst said it did, its link when they gave one
  const out = postedAddress(posted?.url);
  if (out || (posted && posted.url == null && Object.hasOwn(POST_TARGETS, posted.site))) {
    const day = /^\d{4}-\d{2}-\d{2}/.exec(clean(postedWhen(posted)))?.[0];
    const said = `On ${postTarget(out?.site ?? posted.site).label}${day ? `, ${day}` : ''}`;
    sections.push(`## Posted\n\n${out ? `[${said}](${out.url})` : said}`);
  }
  const mediaByPath = new Map(
    mediaEntities
      .filter((entity) => entity?.id && entity?.attrs?.path)
      .map((entity) => [entity.attrs.path, entity]),
  );
  const evidence = [];
  if (proofEntity?.id && proofEntity.attrs?.path) {
    evidence.push([
      '### Proof',
      entityReference(proofEntity),
      '',
      '::: center',
      `${mediaReference(proofEntity)}{width=100% align=center}`,
      ':::',
    ].join('\n'));
  } else if (cleanAttachments[0]?.startsWith('proofs/')) {
    evidence.push(`### Proof\n\n- ${inlineCode(cleanAttachments[0])}`);
  }

  const mediaPaths = cleanAttachments.filter((path) => !path.startsWith('proofs/'));
  const renderedMedia = mediaPaths.map((path) => {
    const entity = mediaByPath.get(path);
    if (!entity) return `- ${inlineCode(path)}`;
    return [
      `### ${cell(entity.label || path)}`,
      entityReference(entity),
      '',
      '::: center',
      `${mediaReference(entity)}{width=100% align=center}`,
      ':::',
    ].join('\n');
  });
  if (renderedMedia.length) evidence.push(...renderedMedia);
  if (evidence.length) sections.push(`## Evidence\n\n${evidence.join('\n\n')}`);
  return `${sections.join('\n\n')}\n`;
}

/** DOM events are not valid tweet ids when a click handler opens the picker. */
export function normalizePostMediaPickerTarget(target) {
  return Number.isInteger(target) ? target : null;
}

/** Build the conventional prefix used for a tweet that carries media. */
export function mediaTweetLabel(type, number) {
  return `${number}/ ${type === 'video' ? 'Video' : 'Image'}:`;
}

/** Build a media tweet from its conventional prefix and optional body. */
export function mediaTweetText(type, text, number) {
  const label = mediaTweetLabel(type, number);
  return String(text ?? '').trim() ? `${label}\n${String(text).trim()}` : label;
}

/**
 * Change an untouched media prefix when its attachment type changes. Once the
 * analyst edits that prefix, their text is left alone.
 */
export function retargetMediaTweetText(text, currentType, nextType, number) {
  const value = String(text ?? '');
  const nextLabel = mediaTweetLabel(nextType, number);
  if (!value.trim()) return nextLabel;
  if (currentType === 'none') return value;

  const currentLabel = mediaTweetLabel(currentType, number);
  if (value.trim() === currentLabel) return nextLabel;
  if (value.startsWith(`${currentLabel}\n`)) {
    return `${nextLabel}${value.slice(currentLabel.length)}`;
  }
  return value;
}

/** Renumber an untouched media prefix while preserving custom text. */
export function renumberMediaTweetText(text, type, currentNumber, nextNumber) {
  const value = String(text ?? '');
  const currentLabel = mediaTweetLabel(type, currentNumber);
  const nextLabel = mediaTweetLabel(type, nextNumber);
  if (value.trim() === currentLabel) return nextLabel;
  if (value.startsWith(`${currentLabel}\n`)) {
    return `${nextLabel}${value.slice(currentLabel.length)}`;
  }
  return value;
}

/** Create an editable media tweet at its position in the thread. */
export function newPostMediaTweet(id, number, mediaType = 'none') {
  return {
    id,
    text: mediaType === 'none' ? '' : mediaTweetText(mediaType, '', number),
    mediaPaths: [],
    mediaType,
    isMediaTweet: true,
    mediaTextIncludesPrefix: true,
  };
}

/** Return the exact text copied for an extra context or media tweet. */
export function extraPostTweetText(tweet, number) {
  const text = String(tweet?.text ?? '').trim();
  if (tweet?.mediaType === 'none' || !tweet?.mediaPaths?.length) return text;
  return tweet.mediaTextIncludesPrefix ? text : mediaTweetText(tweet.mediaType, text, number);
}

/**
 * Toggle one library item in a tweet's media selection. This composer keeps
 * images and videos in separate tweets, so the other kind replaces the group.
 */
export function togglePostMedia({ mediaPaths = [], mediaType = 'none' }, item) {
  if (!item || !['image', 'video'].includes(item.kind)) {
    return { mediaPaths, mediaType, outcome: 'unsupported' };
  }
  if (mediaPaths.includes(item.path)) {
    return {
      mediaPaths: mediaPaths.filter((path) => path !== item.path),
      mediaType,
      outcome: 'removed',
    };
  }

  const itemType = item.kind === 'video' ? 'video' : 'images';
  if (mediaType !== 'none' && mediaType !== itemType) {
    return { mediaPaths: [item.path], mediaType: itemType, outcome: 'replaced' };
  }
  if (mediaPaths.length >= MAX_POST_MEDIA) {
    return { mediaPaths, mediaType, outcome: 'limit' };
  }
  return {
    mediaPaths: [...mediaPaths, item.path],
    mediaType: itemType,
    outcome: 'added',
  };
}

/** Show only the library items accepted by the tweet's selected media mode. */
export function postMediaForType(items, mediaType) {
  const kind = mediaType === 'video' ? 'video' : mediaType === 'images' ? 'image' : null;
  return kind ? (items ?? []).filter((item) => item.kind === kind) : [];
}

/**
 * Pack proof-linked media into same-type tweets while preserving the order in
 * which each type first appears. Every group respects X's media-item limit.
 */
export function groupPostMedia(mediaPaths, kindForPath) {
  const buckets = new Map();
  for (const path of mediaPaths ?? []) {
    const mediaType = kindForPath(path) === 'video' ? 'video' : 'images';
    if (!buckets.has(mediaType)) buckets.set(mediaType, []);
    buckets.get(mediaType).push(path);
  }

  const groups = [];
  for (const [mediaType, paths] of buckets) {
    for (let i = 0; i < paths.length; i += MAX_POST_MEDIA) {
      groups.push({ mediaType, mediaPaths: paths.slice(i, i + MAX_POST_MEDIA) });
    }
  }
  return groups;
}

/** A video by its extension, for a path the case's media list does not hold (a plate's export). */
const VIDEO_FILE = /\.(mp4|webm|mov|m4v|mkv)$/i;

/**
 * Where the media a post starts with go (`startPost`). A Geolocation post keeps its
 * first post for the proof, so they fill the media post and the ones after it, as a
 * proof's source media always did. Every other kind puts the first group on its first
 * post, a picture post being what a plate or a free post is. Groups follow
 * `groupPostMedia`: four pictures or one kind per post.
 */
export function startMediaPlan(kind, paths, kindOf = () => 'image') {
  const known = (paths ?? []).filter((path) => typeof path === 'string' && path);
  const groups = groupPostMedia([...new Set(known)], (path) => {
    const said = kindOf(path);
    return said === 'video' || (!said && VIDEO_FILE.test(path)) ? 'video' : 'image';
  });
  const first = normalizePostKind(kind) === 'geolocation' ? null : groups.shift() ?? null;
  return { first, media: groups.shift() ?? null, more: groups };
}

// token → the field key it pulls its value from (see tweetFields)
const TOKEN_FIELD = {
  '#place': 'place',
  '#pluscode': 'plusCode',
  '#coordinates': 'coordinates',
  '#description': 'description',
  '#mention': 'mention',
  '#source': 'source',
  '#date': 'date',
  '#video': 'video',
  '#timecode': 'timecode',
  '#scenes': 'scenes',
  '#credits': 'credits',
};

// A template can omit a draft field by leaving its token out of the body.
// Coordinates also supply the plus code and can resolve a place, so keep that
// field available whenever either of those tokens is present.
const FIELD_TOKENS = {
  description: ['#description'],
  coordinates: ['#coordinates', '#pluscode', '#place'],
  place: ['#place'],
  mention: ['#mention'],
  source: ['#source'],
  date: ['#date'],
  timecode: ['#timecode'],
};

// A token ends where the word does: `#placement` is text, not `#place` and "ment",
// and a `#dates` hashtag a template already carried stays a hashtag.
const TOKEN_TAIL = '(?![\\p{L}\\p{N}_])';
const TOKEN_RE = new RegExp(
  `#(?:${Object.keys(TOKEN_FIELD).map((tag) => tag.slice(1)).join('|')})${TOKEN_TAIL}`,
  'giu',
);

/** The tokens a body holds, lower-cased, in the order it holds them. */
export function bodyTokens(body) {
  return (String(body ?? '').match(TOKEN_RE) ?? []).map((token) => token.toLowerCase());
}

/**
 * `#words` in a body that look like a token and are not one: `#coordinate`,
 * `#Sources`, `#plus_code`. Each would go out as text, silently, so the editor
 * names them. Close means one edit away, or the same letters with the
 * separators and a final `s` taken out; a real hashtag is left alone.
 */
export function misspelledTokens(body) {
  const tags = Object.keys(TOKEN_FIELD).map((tag) => tag.slice(1));
  const found = [];
  for (const [whole, word] of String(body ?? '').matchAll(/#([\p{L}\p{N}_-]+)/gu)) {
    const lower = word.toLowerCase();
    if (tags.includes(lower)) continue;
    const bare = lower.replace(/[-_]/g, '').replace(/s$/, '');
    const near = tags.find((tag) => bare === tag || editDistance(lower, tag) === 1);
    if (near && !found.some((f) => f.written === whole)) found.push({ written: whole, meant: `#${near}` });
  }
  return found;
}

/** A body with every whole-word `written` swapped for `meant`, and nothing else touched. */
export function fixMisspelledToken(body, written, meant) {
  const escaped = String(written).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(body ?? '').replace(
    new RegExp(`${escaped}(?![\\p{L}\\p{N}_-])`, 'gu'),
    () => meant,
  );
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    row = next;
  }
  return row[b.length];
}

// The classic GeoConfirmed thread, as a token body. Place + plus code on the
// first line, then description, decimal coordinates, mention, and a labelled
// source — each separated by a blank line. The time a proof of a video states sits
// right under its description; a photo's proof has none and the line drops.
export const DEFAULT_TWEET_BODY = [
  '#place - #pluscode',
  '',
  '#description',
  '#timecode',
  '',
  '#coordinates',
  '',
  '#mention',
  '',
  'Source: #source',
].join('\n');

/**
 * Layouts a new post template can start from, so a blank body is never the first
 * thing an analyst faces. Each one only replaces the body: the mention, the media
 * post and the boilerplate stay as they were.
 */
export const POST_TEMPLATE_STARTERS = Object.freeze([
  { id: 'classic', label: 'Classic', body: DEFAULT_TWEET_BODY },
  { id: 'coordinates', label: 'Coordinates only', body: '#coordinates\n\n#mention' },
  { id: 'short', label: 'Short', body: '#place\n#coordinates\n#timecode\n\nSource: #source' },
  {
    id: 'dated',
    label: 'With date',
    body: [
      '#place - #pluscode',
      '',
      '#description',
      '#timecode',
      '',
      'Filmed: #date',
      '',
      '#coordinates',
      '',
      '#mention',
      '',
      'Source: #source',
    ].join('\n'),
  },
].map((starter) => Object.freeze(starter)));

/** A video thread's orders (lib/videoThread.js ORDERS), and the posts beside its recap. */
export const VIDEO_ORDERS = Object.freeze(['recap', 'video', 'proof', 'all']);
export const THREAD_ROLES = Object.freeze(['video', 'place']);

// What each place of a video thread says by default: its sentence, the time it shows,
// and where it is. The recap names the places as the contact sheet numbers them.
const PLACE_TEXT = '#description\n#timecode\n\n#coordinates';
const RECAP_TEXT = '#video\n\n#scenes\n\n#mention';
const threadTexts = (video, place = PLACE_TEXT) => Object.freeze([
  Object.freeze({ role: 'video', body: video }),
  Object.freeze({ role: 'place', body: place }),
]);

/**
 * A video thread's starts, one per order (lib/videoThread.js). Each is a recap text
 * (`body`: Recap first's first post, All in one's one post), the video's post and each
 * place's (`posts`). The mention goes where the thread opens.
 */
export const VIDEO_THREAD_STARTERS = Object.freeze([
  { id: 'recap', label: 'Recap first', order: 'recap', body: RECAP_TEXT, posts: threadTexts('Source: #source') },
  { id: 'video', label: 'Video first', order: 'video', body: RECAP_TEXT, posts: threadTexts('#video\n\n#mention\n\nSource: #source') },
  { id: 'proof', label: 'Proof first', order: 'proof', body: RECAP_TEXT, posts: threadTexts('#video\n\n#scenes\n\n#mention\n\nSource: #source') },
  { id: 'all', label: 'All in one', order: 'all', body: '#video\n\n#scenes\n\n#mention\n\nSource: #source', posts: threadTexts('Source: #source') },
].map((starter) => Object.freeze({ ...starter, mediaEnabled: false })));

/**
 * The starts New template offers, per kind. Geolocation keeps the four above, and a
 * video thread one per order. A plate post and a free post get one each and a compare
 * post two, with no media post scaffolded under them: their pictures ride on the first post.
 */
export const POST_KIND_STARTERS = Object.freeze({
  geolocation: POST_TEMPLATE_STARTERS,
  video: VIDEO_THREAD_STARTERS,
  plate: Object.freeze([
    Object.freeze({ id: 'plate', label: 'Plate', body: '#description\n\n#credits\n\n#mention', mediaEnabled: false }),
  ]),
  compare: Object.freeze([
    Object.freeze({ id: 'compare', label: 'Before and after', body: '#description\n\n#date\n\n#credits\n\n#mention', mediaEnabled: false }),
    Object.freeze({ id: 'compare-dates', label: 'Dates first', body: '#date\n\n#description\n\n#credits\n\n#mention', mediaEnabled: false }),
  ]),
  free: Object.freeze([
    Object.freeze({ id: 'free', label: 'Text and source', body: '#description\n\n#mention\n\nSource: #source', mediaEnabled: false }),
  ]),
});

/** A kind's starts. */
export function postStarters(kind) {
  return POST_KIND_STARTERS[normalizePostKind(kind)];
}

/**
 * Whether a post of this template goes out as a reply under its source by default,
 * when that source is an X or a Bluesky post. A template that says nothing does not.
 */
export function replyByDefault(templateData) {
  return templateData?.reply === true;
}

/** What separates a point's name from its coordinates, on the one line it gets. */
export const POINT_SEPARATOR = ' — ';

/** One coordinate line split into its optional name and its coordinates. */
export function splitPointLine(line) {
  const text = String(line ?? '').trim();
  const at = text.indexOf(POINT_SEPARATOR);
  if (at < 0) return { label: '', coords: text };
  return {
    label: text.slice(0, at).trim(),
    coords: text.slice(at + POINT_SEPARATOR.length).trim(),
  };
}

/** The lines a coordinate block holds, dropping the empty ones. */
export function pointLines(text) {
  return String(text ?? '')
    .split('\n')
    .map(splitPointLine)
    .filter((one) => one.coords);
}

/**
 * The coordinates a post carries, one point per line.
 *
 * A proof shows more than one place often enough — three impacts, a building,
 * the camera — and the analyst reads the numbers, so the tweet carries all of
 * them rather than the conclusion alone. The first line is the one the post
 * resolved, so it reads in decimal as it always has; the rest read as they were
 * written, and a name keeps its line either way.
 */
export function postCoordinates(text, { lat, lon } = {}) {
  const lines = pointLines(text);
  if (lat != null && lon != null) {
    const decimal = `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}`;
    if (lines.length) lines[0] = { ...lines[0], coords: decimal };
    else lines.push({ label: '', coords: decimal });
  }
  return lines
    .map((one) => (one.label ? `${one.label}${POINT_SEPARATOR}${one.coords}` : one.coords))
    .join('\n');
}

/** Resolve the live draft into the string each token stands for ('' when absent). */
export function tweetFields({
  place, plusCode, description, lat, lon, coordsText, mention, source, date,
  video, timecode, scenes, credits,
} = {}) {
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  return {
    place: place?.trim() ?? '',
    // Place and plus code are one point's address, and that point is the
    // conclusion: the header of a tweet is about the proof, not about impact 2.
    plusCode: plusCode ?? '',
    coordinates: postCoordinates(coordsText, { lat, lon }),
    description: description?.trim() ?? '',
    mention: mention?.trim() ?? '',
    source: source?.trim() ?? '',
    date: date?.trim() ?? '',
    // the media's title as the case names it, never its file name (`videoTitle`)
    video: text(video),
    timecode: text(timecode),
    scenes: text(scenes),
    credits: text(credits),
  };
}

/**
 * What `#video` says: the title Media gives the video, or nothing. A file name is
 * what the analyst's disk calls it, not what a reader should, so a video without a
 * title leaves the token empty and its line drops.
 */
export function videoTitle(item) {
  return typeof item?.title === 'string' ? item.title.trim() : '';
}

const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;

/** An offset as a reader writes it: `UTC+2`, `UTC-3:30`, plain `UTC` at zero. */
function offsetLabel(minutes) {
  if (!minutes) return 'UTC';
  const sign = minutes < 0 ? '-' : '+';
  const whole = Math.abs(minutes);
  const tail = whole % 60 ? `:${String(whole % 60).padStart(2, '0')}` : '';
  return `UTC${sign}${Math.floor(whole / 60)}${tail}`;
}

function offsetAtInstant(zone, millis) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(millis))
    .find((one) => one.type === 'timeZoneName')?.value ?? '';
  const match = /GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?/.exec(part);
  if (!match) return null;
  if (!match[1]) return 0;
  const value = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === '-' ? -value : value;
}

/**
 * Minutes a named zone stands from UTC at a local wall-clock reading. Read twice:
 * the first guess takes the clock as UTC, which lands up to a day off and can sit
 * across a clock change from the moment meant, so the offset is read again at the
 * instant that guess points to.
 */
function zoneOffsetAt(zone, day, hour, minute) {
  try {
    const wall = Date.parse(`${day}T${hour}:${minute}:00Z`);
    const first = offsetAtInstant(zone, wall);
    if (first == null) return null;
    return offsetAtInstant(zone, wall - first * 60_000);
  } catch {
    return null;
  }
}

function stampParts(raw) {
  const match = STAMP.exec(raw);
  if (!match) return null;
  const [, day, hour, minute, second, offset] = match;
  const clock = second === '00' ? `${hour}:${minute}` : `${hour}:${minute}:${second}`;
  return { day, hour, minute, clock, offset };
}

function stampZone(parts, zone) {
  if (parts.offset === 'Z') return 'UTC';
  if (parts.offset) {
    const [h, m] = parts.offset.slice(1).split(':').map(Number);
    return offsetLabel((parts.offset[0] === '-' ? -1 : 1) * (h * 60 + m));
  }
  if (!zone) return '';
  const minutes = zoneOffsetAt(zone, parts.day, parts.hour, parts.minute);
  return minutes == null ? '' : offsetLabel(minutes);
}

/**
 * A stated date as a post carries it: the case's own value, written the same way
 * in every language. A date or a range of dates goes out exactly as stored,
 * qualifiers included. A time drops the `T` nobody reads and says which clock it
 * is on, as an offset from UTC: the zone it was stated in, read on that day, so a
 * summer reading in Kyiv says `UTC+3` and a winter one `UTC+2`. A time with no zone
 * goes out bare, since naming one would be inventing it.
 */
export function postDate(when, zone = null) {
  const raw = String(when ?? '').trim();
  if (!raw) return '';
  const [from, to] = raw.split('/');
  const start = stampParts(from);
  if (!start) return raw;
  if (to === undefined) {
    const label = stampZone(start, zone);
    return `${start.day} ${start.clock}${label ? ` ${label}` : ''}`;
  }
  const end = stampParts(to);
  if (!end) return raw;
  const startLabel = stampZone(start, zone);
  const endLabel = stampZone(end, zone);
  const tail = end.day === start.day ? end.clock : `${end.day} ${end.clock}`;
  if (startLabel === endLabel) {
    return `${start.day} ${start.clock}/${tail}${endLabel ? ` ${endLabel}` : ''}`;
  }
  return `${start.day} ${start.clock}${startLabel ? ` ${startLabel}` : ''}/${tail}${endLabel ? ` ${endLabel}` : ''}`;
}

/**
 * Render a thread body into the first tweet, substituting tokens with the
 * draft's values. Layout rules, so a partly-filled draft still reads clean:
 *  - a line whose tokens are *all* empty is dropped whole (label and all) —
 *    "Source: #source" vanishes when there's no source, "#place - #pluscode"
 *    when neither is known;
 *  - a dangling separator left by one empty side of a combined line is trimmed
 *    ("Bakhmut - " → "Bakhmut");
 *  - runs of blank lines collapse to one, and the ends are trimmed.
 */
export function buildTweet1(body, rawFields = {}) {
  const fields = tweetFields(rawFields);
  const out = [];
  for (const line of String(body ?? '').split('\n')) {
    const tokens = line.match(TOKEN_RE);
    if (tokens && tokens.every((t) => !fields[TOKEN_FIELD[t.toLowerCase()]])) {
      continue; // token-driven line with nothing to show
    }
    let text = line.replace(TOKEN_RE, (m) => fields[TOKEN_FIELD[m.toLowerCase()]] ?? '');
    text = text
      .replace(/^\s*[-·,]\s*/, '') // leading separator from an empty first token
      .replace(/\s*[-·,]\s*$/, '') // trailing separator from an empty last token
      .replace(/[ \t]+$/, '');
    out.push(text);
  }
  const collapsed = [];
  for (const l of out) {
    if (l.trim() === '' && collapsed[collapsed.length - 1]?.trim() === '') continue;
    collapsed.push(l);
  }
  while (collapsed.length && collapsed[0].trim() === '') collapsed.shift();
  while (collapsed.length && collapsed[collapsed.length - 1].trim() === '') collapsed.pop();
  return collapsed.join('\n');
}

/** Whether a template body uses a draft field in its first tweet. */
export function templateUsesPostField(body, field) {
  const tokens = FIELD_TOKENS[field];
  if (!tokens) return true;
  const held = bodyTokens(body);
  return tokens.some((token) => held.includes(token));
}

//: What an address looks like inside a source line. The composer joins several with
//: its own separator, so the middle dot ends one as surely as a space does.
const SOURCE_URL = /https?:\/\/[^\s·]+/gi;

/** Every address a proof's source line holds, in the order it holds them. */
export function sourceUrls(sourceLine) {
  return String(sourceLine ?? '').match(SOURCE_URL) ?? [];
}

/**
 * The Source section's body: a link per address, or the line as it stands.
 *
 * A line that is nothing but addresses becomes one link each, because wrapping the
 * whole line in a single href made a dead link the moment a proof rested on two
 * posts. A line carrying anything else is prose the analyst typed, and prose is
 * printed rather than linked.
 */
export function sourceSection(sourceLine) {
  const text = String(sourceLine ?? '').trim();
  const urls = sourceUrls(text);
  if (!urls.length) return text;
  if (text.replace(SOURCE_URL, ' ').replace(/[\s·,;|]+/g, '')) return text;
  if (urls.length === 1) return `[Open original source](${urls[0]})`;
  // A list, because Markdown needs one to break a line at all and a reader needs one to
  // tell four sources apart.
  return urls.map((url) => `- [${url}](${url})`).join('\n');
}

/**
 * Find original downloaded media behind a proof whose source matches the proof
 * source line. Derived PNGs, collages and satellite captures are excluded.
 */
export function proofSourceMediaPaths(caseData, proofPng, proofSource, mediaItems = []) {
  const wantedUrls = new Set(sourceUrls(proofSource));
  if (!wantedUrls.size) return [];
  const entities = Array.isArray(caseData?.entities) ? caseData.entities : [];
  const links = Array.isArray(caseData?.links) ? caseData.links : [];
  const proof = entities.find((e) => e.type === 'proof' && e.attrs?.path === proofPng);
  if (!proof) return [];

  const byId = new Map(entities.map((entity) => [entity.id, entity]));
  const sources = new Map();
  for (const link of links) {
    if (link.type !== 'derived-from') continue;
    const list = sources.get(link.from) ?? [];
    list.push(link.to);
    sources.set(link.from, list);
  }

  function collect(id, seen = new Set()) {
    if (seen.has(id)) return [];
    const nextSeen = new Set(seen);
    nextSeen.add(id);
    const entity = byId.get(id);
    if (!entity) return [];
    const children = (sources.get(id) ?? []).map((child) => byId.get(child)).filter(Boolean);
    const mediaChildren = children.filter((child) => child.type === 'media');
    if (entity.type === 'media') {
      if (mediaChildren.length) return mediaChildren.flatMap((child) => collect(child.id, nextSeen));
      return entity.attrs?.path ? [entity.attrs.path] : [];
    }
    return children.flatMap((child) => collect(child.id, nextSeen));
  }

  const itemByPath = new Map(mediaItems.map((item) => [item.path, item]));
  return [...new Set(collect(proof.id))].filter((path) => {
    const source = itemByPath.get(path)?.source;
    if (source?.type !== 'download') return false;
    return [source.url, source.webpage_url].some((url) => wantedUrls.has(url));
  });
}

/**
 * The source media a proof's post carries, with the clip cut for its post in place of
 * the whole video it was cut from (`engine/postclips.py`, `{ video, path }`). The clip
 * leads when that video was not among them. Without a clip, the paths as they were.
 */
export function withPostClip(paths, clip) {
  const listed = (paths ?? []).filter((path) => typeof path === 'string' && path);
  const cut = typeof clip?.path === 'string' && clip.path ? clip.path : null;
  if (!cut) return listed;
  const swapped = listed.map((path) => (path === clip.video ? cut : path));
  return [...new Set(swapped.includes(cut) ? swapped : [cut, ...swapped])];
}

/** A legacy toggle template (pre-token) rebuilt as a body, for one-time migration. */
function bodyFromLegacy(data) {
  const t = data?.toggles;
  if (!t) return DEFAULT_TWEET_BODY;
  const parts = [];
  if (t.showHeader) parts.push('#place - #pluscode');
  if (t.showDescription) parts.push('#description');
  if (t.showCoords) parts.push('#coordinates');
  if (t.showMention) parts.push('#mention');
  if (t.showSource) parts.push('Source: #source');
  return parts.join('\n\n') || DEFAULT_TWEET_BODY;
}

/**
 * A thread template's data blob from the composer's live settings. Content-free:
 * the mention, the token body, whether a media tweet is scaffolded, and any
 * boilerplate extra tweets (their text, no ids).
 */
export function templateFromPost({
  mention = '@GeoConfirmed', body = DEFAULT_TWEET_BODY, mediaEnabled = true, extraTweets = [], kind, reply, order, posts,
} = {}) {
  return {
    mention: mention ?? '',
    body: typeof body === 'string' && body.trim() ? body : DEFAULT_TWEET_BODY,
    mediaEnabled: mediaEnabled !== false,
    extraTweets: (extraTweets ?? []).map((e) => ({ text: e.text ?? '' })),
    ...stated(kind, reply),
    ...threadParts(kind, order, posts),
  };
}

/**
 * A video thread's order and the texts of its other posts, each only when it says
 * something, and for a video thread only (`api/templates.py`): the first text of a role
 * is the one a thread reads.
 */
function threadParts(kind, order, posts) {
  if (normalizePostKind(kind) !== 'video') return {};
  const texts = [];
  for (const one of Array.isArray(posts) ? posts : []) {
    if (!THREAD_ROLES.includes(one?.role) || texts.some((t) => t.role === one.role)) continue;
    texts.push({ role: one.role, body: typeof one.body === 'string' ? one.body.slice(0, 4_000) : '' });
  }
  return {
    ...(VIDEO_ORDERS.includes(order) ? { order } : {}),
    ...(texts.length ? { posts: texts } : {}),
  };
}

/** The kind and the reply default, each only when it says something (`api/templates.py`). */
function stated(kind, reply) {
  const known = statedPostKind(kind);
  return {
    ...(known ? { kind: known } : {}),
    ...(reply === true ? { reply: true } : {}),
  };
}

/** The kind a template is for: Geolocation when it says nothing. */
export function postTemplateKind(data) {
  return normalizePostKind(data?.kind);
}

/**
 * Normalise a stored template blob back into the composer's settings, filling
 * shipped defaults (and migrating a legacy toggle template to a body).
 */
export function normPostTemplate(data = {}) {
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return {
    mention: typeof source.mention === 'string' ? source.mention.slice(0, 280) : '@GeoConfirmed',
    body: typeof source.body === 'string' && source.body.trim()
      ? source.body.slice(0, 16_000)
      : bodyFromLegacy(source),
    mediaEnabled: typeof source.mediaEnabled === 'boolean' ? source.mediaEnabled : true,
    extraTweets: Array.isArray(source.extraTweets)
      ? source.extraTweets.slice(0, 20).map((e) => ({
        text: typeof e?.text === 'string' ? e.text.slice(0, 4_000) : '',
      }))
      : [],
    ...stated(source.kind, source.reply),
    ...threadParts(source.kind, source.order, source.posts),
  };
}

/**
 * The template a new post of this kind starts with: the one Settings marks as that
 * kind's default, while it still exists and is still of that kind. Geolocation's is
 * `post_template`, the setting it always was; the others are `post_kind_templates`.
 */
export function defaultPostTemplate(templates, kind, { geolocation = '', byKind = {} } = {}) {
  const known = normalizePostKind(kind);
  const id = known === 'geolocation' ? geolocation : byKind?.[known];
  if (!id) return null;
  return (templates ?? []).find((t) => t.id === id && postTemplateKind(t.data) === known) ?? null;
}

/** The templates a post of this kind can apply, in their stored order. */
export function templatesOfKind(templates, kind) {
  const known = normalizePostKind(kind);
  return (templates ?? []).filter((t) => postTemplateKind(t.data) === known);
}

/** Apply a post-template skeleton while dropping all current attachments. */
export function applyPostTemplateStructure(current = {}, data = {}) {
  const normalized = normPostTemplate(data);
  return {
    ...current,
    ...normalized,
    extraTweets: normalized.extraTweets.map((tweet) => ({
      text: tweet.text,
      mediaPaths: [],
      mediaType: 'none',
      isMediaTweet: false,
      mediaTextIncludesPrefix: false,
    })),
  };
}
