/**
 * A post's block as the note holds it: `::: post` and its `key: value` lines, read and
 * written here and nowhere else in the editor (`engine/socialposts.py` reads them the
 * same way for every document).
 *
 * `post: <id>` names a post the case keeps, a thread when there are several, each
 * followed by the analyst's own lines for it: `highlight:` (the exact passage that
 * matters, one line each) and `translation:`. `link: <address>` is a post not kept yet,
 * held until the press that reads it. `form:`, `avatar: hidden` and `qr: on` are the
 * block's. Every change writes its own lines and leaves the others as they were.
 */

/** The line a post's block opens with. */
export const POST_BLOCK = /^:::[ \t]*post[ \t]*$/;
/** The forms a block draws in, in the order the settings offer them. */
export const POST_FORMS = [
  { id: 'card', label: 'Card', title: 'The whole post, as a card' },
  { id: 'quote', label: 'Quote', title: 'The words alone, large, the name under them' },
  { id: 'compact', label: 'Compact', title: 'One line per post, for annexes and lists of sources' },
];
/** How many posts one block holds, and highlights one post keeps (the engine's own numbers). */
export const MAX_THREAD = 12;
export const MAX_HIGHLIGHTS = 6;

const LINE = /^\s*([A-Za-z]+)\s*:\s?(.*)$/;
const ENTITY_ID = /^[A-Za-z0-9_-]{1,64}$/;
const X_HOSTS = new Set(['x.com', 'twitter.com', 'mobile.twitter.com', 'mobile.x.com', 'vxtwitter.com', 'fxtwitter.com',
  'fixupx.com', 'fixvx.com', 'd.fxtwitter.com']);
const BLUESKY_HOSTS = new Set(['bsky.app', 'staging.bsky.app']);

/**
 * A post's address read as the engine reads it (`socialposts.parse_link`): `{ site,
 * handle, ident, key }`, or null for anything that is not a post on X or Bluesky.
 */
export function postLink(text) {
  let value = String(text ?? '').trim().replace(/^<|>$/g, '');
  if (!value || value.length > 2000 || /\s/.test(value)) return null;
  if (!value.includes('://')) value = `https://${value}`;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  const segs = url.pathname.split('/').filter(Boolean);
  if (X_HOSTS.has(host)) {
    const at = segs.findIndex((seg, i) => (seg === 'status' || seg === 'statuses') && /^\d{1,25}$/.test(segs[i + 1] ?? ''));
    if (at < 0) return null;
    let handle = at >= 1 ? segs[at - 1] : '';
    if (handle === 'web' && at >= 2) handle = segs[at - 2];
    handle = /^[A-Za-z0-9_]{1,15}$/.test(handle) && handle.toLowerCase() !== 'i' ? handle : '';
    const ident = segs[at + 1];
    return { site: 'x', handle, ident, key: `x:${ident}` };
  }
  if (BLUESKY_HOSTS.has(host) && segs.length >= 4 && segs[0] === 'profile' && segs[2] === 'post') {
    const [, handle, , ident] = segs;
    if (!/^[A-Za-z0-9._:%-]{1,253}$/.test(handle) || !/^[A-Za-z0-9._:~-]{1,64}$/.test(ident)) return null;
    return { site: 'bluesky', handle, ident, key: `bluesky:${handle.toLowerCase()}/${ident}` };
  }
  return null;
}

/** The post addresses a paste holds, in order, each post once: what `/post` reads. */
export function pastedLinks(text) {
  const found = [];
  const keys = new Set();
  for (const word of String(text ?? '').split(/[\s,]+/)) {
    const link = postLink(word);
    if (link && !keys.has(link.key)) {
      keys.add(link.key);
      found.push(word.trim().replace(/^<|>$/g, ''));
    }
  }
  return found;
}

/** A block's lines, read: `{ entries: [{ kind, value, highlights, translation }], form, avatar, qr }`. */
export function readPost(source) {
  const block = { entries: [], form: 'card', avatar: true, qr: false };
  for (const raw of String(source ?? '').split('\n')) {
    if (POST_BLOCK.test(raw) || /^:::\s*$/.test(raw)) continue;
    const found = LINE.exec(raw);
    if (!found) continue;
    const key = found[1].toLowerCase();
    const value = found[2].trim();
    const last = block.entries.at(-1);
    if ((key === 'post' || key === 'link') && value && block.entries.length < MAX_THREAD) {
      if (key === 'post' && !ENTITY_ID.test(value)) continue;
      block.entries.push({ kind: key, value, highlights: [], translation: '' });
    } else if (key === 'highlight' && value && last && last.highlights.length < MAX_HIGHLIGHTS) {
      last.highlights.push(value);
    } else if (key === 'translation' && last) {
      last.translation = value.replace(/\\n/g, '\n');
    } else if (key === 'form' && POST_FORMS.some((form) => form.id === value.toLowerCase())) {
      block.form = value.toLowerCase();
    } else if (key === 'avatar') {
      block.avatar = !['hidden', 'hide', 'off', 'no'].includes(value.toLowerCase());
    } else if (key === 'qr') {
      block.qr = ['on', 'yes', 'true', 'shown'].includes(value.toLowerCase());
    }
  }
  return block;
}

/** One line's words, kept on that line: a break inside a translation is written `\n`. */
function oneLine(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').trim().replace(/\n/g, '\\n');
}

/** A block written from what `readPost` reads, its fences around it. */
export function writePost(block) {
  const lines = ['::: post'];
  for (const entry of block.entries ?? []) {
    lines.push(`${entry.kind === 'link' ? 'link' : 'post'}: ${entry.value}`);
    for (const passage of entry.highlights ?? []) if (oneLine(passage)) lines.push(`highlight: ${oneLine(passage)}`);
    if (oneLine(entry.translation)) lines.push(`translation: ${oneLine(entry.translation)}`);
  }
  if (block.form && block.form !== 'card') lines.push(`form: ${block.form}`);
  if (block.avatar === false) lines.push('avatar: hidden');
  if (block.qr) lines.push('qr: on');
  lines.push(':::');
  return lines.join('\n');
}

/** A new block naming these kept posts (`ids`) and these addresses not read yet (`links`). */
export function postBlockText({ ids = [], links = [] } = {}) {
  return writePost({
    entries: [...ids.map((value) => ({ kind: 'post', value })), ...links.map((value) => ({ kind: 'link', value }))],
  });
}

/** `source` changed by `change(block)` (which edits the read block in place), written again. */
function edited(source, change) {
  const block = readPost(source);
  change(block);
  return writePost(block);
}

export function withForm(source, form) {
  return edited(source, (block) => { block.form = form; });
}

export function withAvatar(source, shown) {
  return edited(source, (block) => { block.avatar = Boolean(shown); });
}

export function withQr(source, on) {
  return edited(source, (block) => { block.qr = Boolean(on); });
}

/** The `at`-th post's passage highlighted, as its exact words, once. */
export function withHighlight(source, at, passage) {
  const words = oneLine(passage);
  return edited(source, (block) => {
    const entry = block.entries[at];
    if (!entry || !words || entry.highlights.includes(words) || entry.highlights.length >= MAX_HIGHLIGHTS) return;
    entry.highlights.push(words);
  });
}

export function withoutHighlight(source, at, passage) {
  return edited(source, (block) => {
    const entry = block.entries[at];
    if (entry) entry.highlights = entry.highlights.filter((one) => one !== passage);
  });
}

export function withTranslation(source, at, words) {
  return edited(source, (block) => {
    if (block.entries[at]) block.entries[at].translation = String(words ?? '');
  });
}

/** Each address a read kept, named by its post from now on: `results` are `{ link, id }`. */
export function withKept(source, results) {
  const kept = new Map((results ?? []).filter((one) => one?.id && one?.link).map((one) => [one.link, one.id]));
  return edited(source, (block) => {
    for (const entry of block.entries) {
      if (entry.kind === 'link' && kept.has(entry.value)) {
        entry.kind = 'post';
        entry.value = kept.get(entry.value);
      }
    }
  });
}

/**
 * A post's words as stretches, each highlighted or not: every passage the analyst kept,
 * found where it first stands, overlaps joined (`socialposts.marked`).
 */
export function markedWords(text, highlights = []) {
  const words = String(text ?? '');
  const spans = [];
  for (const passage of highlights) {
    if (!passage) continue;
    const at = words.indexOf(passage);
    if (at >= 0) spans.push([at, at + passage.length]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const joined = [];
  for (const span of spans) {
    const last = joined.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else joined.push([...span]);
  }
  const out = [];
  let position = 0;
  for (const [start, end] of joined) {
    if (start > position) out.push({ text: words.slice(position, start), lit: false });
    out.push({ text: words.slice(start, end), lit: true });
    position = end;
  }
  if (position < words.length || !out.length) out.push({ text: words.slice(position), lit: false });
  return out.filter((one) => one.text);
}

const RTL_LETTER = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const LETTER = /\p{L}/u;

/** Whether words read right to left: their first letter's direction (`socialposts.is_rtl`). */
export function readsRightToLeft(text) {
  for (const char of String(text ?? '')) if (LETTER.test(char)) return RTL_LETTER.test(char);
  return false;
}

/**
 * The words as paragraphs (a blank line parts them), each `{ rtl, stretches }` with its
 * own direction, so an Arabic place name over English words sets each its own way
 * (`socialposts.paragraphs`).
 */
export function postParagraphs(text, highlights = []) {
  const words = String(text ?? '');
  const stretches = markedWords(words, highlights);
  const bounds = [];
  let position = 0;
  for (const found of words.matchAll(/\n[ \t\u00a0]*\n\s*/g)) {
    bounds.push([position, found.index]);
    position = found.index + found[0].length;
  }
  bounds.push([position, words.length]);
  const out = [];
  for (const [start, end] of bounds) {
    const part = [];
    let at = 0;
    for (const one of stretches) {
      const low = Math.max(start, at);
      const high = Math.min(end, at + one.text.length);
      if (low < high) part.push({ text: words.slice(low, high), lit: one.lit });
      at += one.text.length;
    }
    const said = part.map((one) => one.text).join('');
    if (said.trim()) out.push({ rtl: readsRightToLeft(said), stretches: part });
  }
  return out;
}

/** What the quote form says: the passages highlighted, else every word (`notes_posts.quoted_words`). */
export function quotedWords(text, highlights = []) {
  const kept = markedWords(text, highlights).filter((one) => one.lit).map((one) => one.text.split(/\s+/).filter(Boolean).join(' '));
  return kept.length ? kept.join(' … ') : String(text ?? '').trim();
}
