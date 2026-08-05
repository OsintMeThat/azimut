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

// The tokens an analyst can drop into a thread body. `sample` feeds the editor
// preview so the layout reads before any real draft exists.
export const TWEET_TOKENS = [
  { tag: '#place', label: 'Place', sample: 'Bakhmut, Donetsk, Ukraine' },
  { tag: '#pluscode', label: 'Plus code', sample: '8FPGXXXX+XX' },
  { tag: '#coordinates', label: 'Coordinates', sample: '48.850000, 2.350000' },
  { tag: '#description', label: 'Description', sample: 'Rooftop match against the reference imagery' },
  { tag: '#mention', label: 'Mention', sample: '@GeoConfirmed' },
  { tag: '#source', label: 'Source', sample: 'https://x.com/example/status/1' },
];

export const MAX_POST_MEDIA = 4;

/**
 * Publishing targets share the same prepared thread, but apply their own
 * character rules and handoff URL. Mastodon uses its documented default here;
 * an individual server may advertise a different limit.
 */
export const POST_TARGETS = Object.freeze({
  x: { id: 'x', label: 'X', limit: 280, limitLabel: '280' },
  bluesky: { id: 'bluesky', label: 'Bluesky', limit: 300, limitLabel: '300' },
  mastodon: {
    id: 'mastodon', label: 'Mastodon', limit: 500, limitLabel: '500 default',
    limitHelp: 'Your server may use another limit.',
  },
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

/** X and Mastodon reserve a fixed length for every HTTP(S) URL. */
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
  switch (normalizePostTarget(target)) {
    case 'bluesky':
      return `https://bsky.app/intent/compose?text=${encoded}`;
    case 'mastodon':
      return `https://share.joinmastodon.org/#text=${encoded}`;
    default:
      return `https://x.com/intent/post?text=${encoded}`;
  }
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
  dms,
  mapLinks = {},
  description,
  source,
  attachments = [],
  proofEntity = null,
  mediaEntities = [],
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
  if (clean(description)) sections.push(`## Assessment\n\n${clean(description)}`);
  if (clean(source)) {
    const sourceText = clean(source);
    const sourceValue = /^https?:\/\//i.test(sourceText)
      ? `[Open original source](${sourceText})`
      : sourceText;
    sections.push(`## Source\n\n${sourceValue}`);
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

// token → the field key it pulls its value from (see tweetFields)
const TOKEN_FIELD = {
  '#place': 'place',
  '#pluscode': 'plusCode',
  '#coordinates': 'coordinates',
  '#description': 'description',
  '#mention': 'mention',
  '#source': 'source',
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
};

const TOKEN_RE = /#(?:place|pluscode|coordinates|description|mention|source)/gi;

// The classic GeoConfirmed thread, as a token body. Place + plus code on the
// first line, then description, decimal coordinates, mention, and a labelled
// source — each separated by a blank line.
export const DEFAULT_TWEET_BODY = [
  '#place - #pluscode',
  '',
  '#description',
  '',
  '#coordinates',
  '',
  '#mention',
  '',
  'Source: #source',
].join('\n');

/** Resolve the live draft into the string each token stands for ('' when absent). */
export function tweetFields({ place, plusCode, description, lat, lon, mention, source } = {}) {
  return {
    place: place?.trim() ?? '',
    plusCode: plusCode ?? '',
    coordinates:
      lat != null && lon != null ? `${Number(lat).toFixed(6)}, ${Number(lon).toFixed(6)}` : '',
    description: description?.trim() ?? '',
    mention: mention?.trim() ?? '',
    source: source?.trim() ?? '',
  };
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
  const lowerBody = String(body ?? '').toLowerCase();
  return tokens.some((token) => lowerBody.includes(token));
}

/**
 * Find original downloaded media behind a proof whose source matches the proof
 * source line. Derived PNGs, collages and satellite captures are excluded.
 */
export function proofSourceMediaPaths(caseData, proofPng, proofSource, mediaItems = []) {
  const wantedUrls = new Set(String(proofSource ?? '').match(/https?:\/\/[^\s·]+/gi) ?? []);
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
export function templateFromPost({ mention = '@GeoConfirmed', body = DEFAULT_TWEET_BODY, mediaEnabled = true, extraTweets = [] } = {}) {
  return {
    mention: mention ?? '',
    body: typeof body === 'string' && body.trim() ? body : DEFAULT_TWEET_BODY,
    mediaEnabled: mediaEnabled !== false,
    extraTweets: (extraTweets ?? []).map((e) => ({ text: e.text ?? '' })),
  };
}

/**
 * Normalise a stored template blob back into the composer's settings, filling
 * shipped defaults (and migrating a legacy toggle template to a body).
 */
export function normPostTemplate(data = {}) {
  const source = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return {
    mention: typeof source.mention === 'string' ? source.mention.slice(0, 120) : '@GeoConfirmed',
    body: typeof source.body === 'string' && source.body.trim()
      ? source.body.slice(0, 16_000)
      : bodyFromLegacy(source),
    mediaEnabled: typeof source.mediaEnabled === 'boolean' ? source.mediaEnabled : true,
    extraTweets: Array.isArray(source.extraTweets)
      ? source.extraTweets.slice(0, 20).map((e) => ({
        text: typeof e?.text === 'string' ? e.text.slice(0, 4_000) : '',
      }))
      : [],
  };
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
