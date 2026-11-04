/**
 * A picture's size and place on the page, as its line writes them:
 * `[[media:id|Label]]{width=50% align=center}` or `![Alt](address){width=…}`.
 *
 * The editor's size bar and the Page pane change a picture through here, so the
 * line they write is the one the PDF reads (`engine/notes_pdf.py`). A picture is
 * known by what it shows (`media:<id>`, or the address an image is read from),
 * the name the server gives each one it places (`X-Note-Pictures`).
 */

/**
 * The sizes offered. Each keeps the picture inside a share of the page's text,
 * across and down, so a phone screenshot is as small as a landscape capture is:
 * a width alone would leave it a page tall. What is written is still a width.
 */
export const PICTURE_SIZES = [
  { id: 'small', label: 'S', share: 1 / 3, title: 'Small: within a third of the page' },
  { id: 'medium', label: 'M', share: 1 / 2, title: 'Medium: within half the page' },
  { id: 'large', label: 'L', share: 3 / 4, title: 'Large: within three quarters of the page' },
  { id: 'full', label: 'Full', share: 1, title: 'Full: the width of the page, or its height' },
];
export const PICTURE_ALIGNS = ['left', 'center', 'right'];

/** The text of an A4 or Letter page, height over width: near enough to size a picture. */
export const PAGE_TALL = 1.42;

/**
 * The width a size writes for a picture `ratio` times as tall as it is wide
 * (0 when it is not known yet, which sizes it as if it were wide).
 */
export function sizeWidth(share, ratio = 0) {
  const byHeight = ratio > 0 ? (share * PAGE_TALL) / ratio : Infinity;
  const percent = Math.floor(Math.min(share, byHeight) * 100);
  return `${Math.max(5, Math.min(100, percent))}%`;
}

const MEDIA = /\[\[media:([A-Za-z0-9_-]+)\|[^\]\n]+\]\](?:\{([^}\n]*)\})?/g;
const IMAGE = /!\[[^\]\n]*\]\((\S+?)(?:\s+["'][^"'\n]*["'])?\)(?:\{([^}\n]*)\})?/g;
const ATTR = /\b(width|align)\s*=\s*([\w.%+-]+)/g;

/** `width=…` and `align=…` out of the braces after a picture. */
export function readAttrs(attrs) {
  const values = {};
  for (const match of String(attrs ?? '').matchAll(ATTR)) values[match[1]] = match[2];
  return { width: values.width ?? '', align: values.align ?? '' };
}

/** The braces for a size and a place: left, the default, is not written. */
export function writeAttrs({ width = '', align = '' } = {}) {
  const parts = [];
  if (width) parts.push(`width=${width}`);
  if (align && align !== 'left') parts.push(`align=${align}`);
  return parts.length ? `{${parts.join(' ')}}` : '';
}

/** Every picture on a line, in order: what it shows, where it ends, and its size and place. */
export function picturesIn(text) {
  const line = String(text ?? '');
  const found = [];
  for (const [pattern, media] of [[MEDIA, true], [IMAGE, false]]) {
    for (const match of line.matchAll(pattern)) {
      const attrs = match[2];
      const to = match.index + match[0].length;
      found.push({
        ref: media ? `media:${match[1]}` : match[1],
        from: match.index,
        // where the braces start, or would
        attrFrom: attrs === undefined ? to : to - attrs.length - 2,
        to,
        ...readAttrs(attrs),
      });
    }
  }
  return found.sort((a, b) => a.from - b.from);
}

function decoded(value) {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

/** Whether two names are one picture: the server writes an address the way the parser normalised it. */
export function sameRef(a, b) {
  return a === b || decoded(String(a)) === decoded(String(b));
}

/** The line with picture `ref` given `changes` ({ width, align }), or null when the line does not hold it. */
export function sizedLine(text, ref, changes) {
  const picture = picturesIn(text).find((item) => sameRef(item.ref, ref));
  if (!picture) return null;
  const next = { width: picture.width, align: picture.align, ...changes };
  return `${text.slice(0, picture.attrFrom)}${writeAttrs(next)}${text.slice(picture.to)}`;
}

/** The line (0-based) holding picture `ref` nearest to `line`, or -1: the server's line is a best effort. */
export function pictureLine(lines, line, ref) {
  let best = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes('[[media:') && !lines[index].includes('![')) continue;
    if (!picturesIn(lines[index]).some((item) => sameRef(item.ref, ref))) continue;
    if (best < 0 || Math.abs(index - line) < Math.abs(best - line)) best = index;
  }
  return best;
}
