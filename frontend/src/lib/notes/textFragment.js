/**
 * A link to a passage of a web page, as a text fragment (WICG Text Fragments):
 * `https://site/article#:~:text=start,end`. Chrome and Firefox open the page scrolled
 * to the passage and highlight it; a browser that does not know the syntax opens the
 * page.
 *
 * Built from the words alone, since the app never reads the page. A short passage on
 * one line is matched whole. A longer one, or one across paragraphs, is matched by its
 * first and last few words (`textStart,textEnd`), each taken from one line, since a
 * term never matches across a paragraph.
 */

/** Up to this many words on one line, a passage is matched whole. */
export const WHOLE_WORDS = 10;
/** How many words a longer passage is matched by, at each end. */
export const END_WORDS = 5;

const DIRECTIVE = ':~:';

/**
 * A term as a directive writes it. Percent-encoded, with `-`, `,` and `&` included,
 * which the syntax reads as its own marks. Parentheses are encoded too, so a
 * Markdown link never ends inside it.
 */
export function encodeTerm(words) {
  return encodeURIComponent(String(words)).replace(/[-!'()*]/g, (mark) => `%${mark.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** The passage's lines, each with its spaces collapsed, the empty ones left out. */
function linesOf(text) {
  return String(text ?? '')
    .split(/\r\n?|\n|\u2028|\u2029/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** `text=…` for a passage, or '' when it holds no words. */
export function textDirective(text) {
  const lines = linesOf(text);
  if (!lines.length) return '';
  const first = lines[0].split(' ');
  if (lines.length === 1 && first.length <= WHOLE_WORDS) return `text=${encodeTerm(lines[0])}`;
  const last = lines[lines.length - 1].split(' ');
  return `text=${encodeTerm(first.slice(0, END_WORDS).join(' '))},${encodeTerm(last.slice(-END_WORDS).join(' '))}`;
}

/**
 * The address of `url` that opens on `text`. A fragment the address already has keeps
 * its place before `:~:`, and a directive it carried is replaced. '' when `url` is not
 * a web address; the address itself when the passage holds no words.
 */
export function passageLink(url, text) {
  let parsed;
  try {
    parsed = new URL(String(url ?? ''));
  } catch {
    return '';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  const hash = parsed.hash.replace(/^#/, '');
  const at = hash.indexOf(DIRECTIVE);
  const own = at < 0 ? hash : hash.slice(0, at);
  parsed.hash = '';
  const base = parsed.href.replace(/#$/, '');
  const directive = textDirective(text);
  if (!directive) return own ? `${base}#${own}` : base;
  return `${base}#${own}${DIRECTIVE}${directive}`;
}
