/**
 * A picture's size, place and caption on the page, as its line writes them:
 * `[[media:id|Label]]{width=50% align=center caption="Smoke over the port"}` or
 * `![Alt](address){width=…}`.
 *
 * The editor's picture bar and the Page pane change a picture through here, so the
 * line they write is the one the PDF reads (`engine/notes_pdf.py`). A picture is
 * known by what it shows (`media:<id>`, or the address an image is read from),
 * the name the server gives each one it places (`X-Note-Pictures`). A key in the
 * braces that is none of these is kept as it was written.
 */
import { foldText } from '../textFold.js';

/**
 * The sizes offered. Each keeps the picture inside a share of the page's text,
 * across and down, so a phone screenshot is as small as a landscape capture is:
 * a width alone would leave it a page tall. What is written is still a width.
 */
export const PICTURE_SIZES = [
  { id: 'xxs', label: 'XXS', share: 1 / 10, title: 'Tiny: within a tenth of the page, for a logo or an icon' },
  { id: 'xs', label: 'XS', share: 1 / 5, title: 'Very small: within a fifth of the page' },
  { id: 'small', label: 'S', share: 1 / 3, title: 'Small: within a third of the page' },
  { id: 'medium', label: 'M', share: 1 / 2, title: 'Medium: within half the page' },
  { id: 'large', label: 'L', share: 3 / 4, title: 'Large: within three quarters of the page' },
  { id: 'full', label: 'Full', share: 1, title: 'Full: the width of the page, or its height' },
];
export const PICTURE_ALIGNS = ['left', 'center', 'right'];

/**
 * What a `:::` block can be called. The first three set its text on the line; a
 * corner does so too (to its side), and on the note's own cover pins it to that
 * corner of page 1 (`engine/notes_pdf.py`).
 */
export const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
export const BLOCK_OPEN = /^:::[ \t]*(left|center|right|top-left|top-right|bottom-left|bottom-right)[ \t]*$/;

/** The side of the line a `:::` block sets its text on: a corner gives its horizontal side. */
export function blockSide(name) {
  return name.endsWith('left') ? 'left' : name.endsWith('right') ? 'right' : 'center';
}

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
const IMAGE = /!\[[^\]\n]*\]\((\S+?)(?:\s+["']([^"'\n]*)["'])?\)(?:\{([^}\n]*)\})?/g;
const ATTR = /\b(width|align)\s*=\s*([\w.%+-]+)/g;
/** Read first and taken out, so the words of a caption are never read as a size. */
const CAPTION = /\bcaption\s*=\s*"([^"}\n]*)"/;

/** The longest caption written: one line under the picture. */
export const CAPTION_MAX = 300;

/** A caption as it can be written in the braces: one line, no `"` and no `}`, at most `CAPTION_MAX`. */
export function cleanCaption(text) {
  return String(text ?? '').replace(/["}]/g, '').replace(/\s+/g, ' ').trim().slice(0, CAPTION_MAX).trim();
}

/** `width=…`, `align=…` and `caption="…"` out of the braces after a picture, and what else they hold. */
export function readAttrs(attrs) {
  let rest = String(attrs ?? '');
  const caption = CAPTION.exec(rest);
  if (caption) rest = `${rest.slice(0, caption.index)} ${rest.slice(caption.index + caption[0].length)}`;
  const values = {};
  for (const match of rest.matchAll(ATTR)) values[match[1]] = match[2];
  return {
    width: values.width ?? '',
    align: values.align ?? '',
    caption: caption ? caption[1].trim() : '',
    rest: rest.replace(ATTR, ' ').replace(/\s+/g, ' ').trim(),
  };
}

/**
 * The braces for a size, a place and a caption. The place a picture takes anyway
 * is not written: left, or the place of the `::: center` / `::: right` block it
 * stands in (`fallback`), where left is then written.
 */
export function writeAttrs({ width = '', align = '', caption = '', rest = '' } = {}, { fallback = 'left' } = {}) {
  const parts = [];
  if (width) parts.push(`width=${width}`);
  if (align && align !== (fallback || 'left')) parts.push(`align=${align}`);
  const words = cleanCaption(caption);
  if (words) parts.push(`caption="${words}"`);
  if (rest) parts.push(rest);
  return parts.length ? `{${parts.join(' ')}}` : '';
}

/**
 * Every picture on a line, in order: what it shows, where it ends, its size,
 * place and caption, and an image's title (which prints when it has no caption).
 */
export function picturesIn(text) {
  const line = String(text ?? '');
  const found = [];
  for (const [pattern, media] of [[MEDIA, true], [IMAGE, false]]) {
    for (const match of line.matchAll(pattern)) {
      const attrs = media ? match[2] : match[3];
      const to = match.index + match[0].length;
      found.push({
        ref: media ? `media:${match[1]}` : match[1],
        from: match.index,
        // where the braces start, or would
        attrFrom: attrs === undefined ? to : to - attrs.length - 2,
        to,
        title: media ? '' : match[2] ?? '',
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

/**
 * The line with picture `ref` given `changes` ({ width }, { align }, { caption },
 * { graphic: true | false }, { zoom: { x, y, w, h } | null }), or null when the line
 * does not hold it. What else its braces hold is kept as written.
 */
export function sizedLine(text, ref, changes, { blockAlign = '' } = {}) {
  const picture = picturesIn(text).find((item) => sameRef(item.ref, ref));
  if (!picture) return null;
  const { graphic, zoom, ...rest } = changes;
  let kept = picture.rest;
  if (graphic !== undefined) kept = withGraphic(kept, graphic);
  if (zoom !== undefined) kept = withZoom(kept, zoom);
  const next = { width: picture.width, align: picture.align || blockAlign, caption: picture.caption, ...rest, rest: kept };
  return `${text.slice(0, picture.attrFrom)}${writeAttrs(next, { fallback: blockAlign })}${text.slice(picture.to)}`;
}

// -- a graphic picture and a story's zoom ----------------------------------------

/** `graphic` in a picture's braces: the web page blurs it until it is pressed (`engine/notes_markdown.py`, `GRAPHIC_ATTR`). */
const GRAPHIC = /(?<![\w="-])graphic(?![\w="-])/g;

/** What the picture bar and the veiled picture say. */
export const GRAPHIC_HELP = {
  label: 'Graphic',
  button: 'Graphic: blurred on the web until pressed',
  veil: 'Graphic picture',
  said: 'Blurred on the web until pressed',
};

/** Whether a picture's braces (what `readAttrs` leaves in `rest`) mark it graphic. */
export function isGraphic(rest) {
  return new RegExp(GRAPHIC.source).test(String(rest ?? ''));
}

/** `rest` with `graphic` in it (written last) or out of it, everything else as it was. */
export function withGraphic(rest, on) {
  const kept = String(rest ?? '').replace(GRAPHIC, ' ').replace(/\s+/g, ' ').trim();
  return on ? [kept, 'graphic'].filter(Boolean).join(' ') : kept;
}

/** `zoom=x,y,w,h` in a picture's braces: the part of it a story's step moves in on. */
const ZOOM = /\bzoom\s*=\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+/;

/** `zoom=x,y,w,h` in a picture's braces: the part of it a story moves in on, as fractions, or null. */
export function storyZoom(rest) {
  const match = /\bzoom\s*=\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(String(rest ?? ''));
  if (!match) return null;
  const [x, y, w, h] = match.slice(1).map(Number);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > 1.0001 || y + h > 1.0001) return null;
  return { x, y, w, h };
}

/** A share of a picture written short: `0.25`, `0.1`, `1`. */
function short(value) {
  return String(Math.round(value * 1000) / 1000);
}

/**
 * A zoom as its braces write it, `0.25,0.1,0.5,0.4`: kept inside the picture and
 * written to a thousandth, so it reads back the same (`storyZoom`).
 */
export function zoomText({ x, y, w, h }) {
  const left = Math.min(Math.max(Math.round(x * 1000) / 1000, 0), 0.999);
  const top = Math.min(Math.max(Math.round(y * 1000) / 1000, 0), 0.999);
  const width = Math.max(Math.min(Math.round(w * 1000) / 1000, Math.round((1 - left) * 1000) / 1000), 0.001);
  const height = Math.max(Math.min(Math.round(h * 1000) / 1000, Math.round((1 - top) * 1000) / 1000), 0.001);
  return [left, top, width, height].map(short).join(',');
}

/** `rest` with its zoom set (where it was written, else last) or taken out (`zoom` null). */
export function withZoom(rest, zoom) {
  const now = String(rest ?? '');
  const written = zoom ? `zoom=${zoomText(zoom)}` : '';
  const kept = ZOOM.test(now) ? now.replace(ZOOM, written) : [now, written].filter(Boolean).join(' ');
  return kept.replace(/\s+/g, ' ').trim();
}

// -- another picture in its place ------------------------------------------------

/** The case records a note can show as a picture, found by their name or folder, by name. */
export function casePictures(entities, query = '', { limit = 80 } = {}) {
  const wanted = foldText(String(query ?? '').trim());
  return (entities ?? [])
    .filter((entity) => ['media', 'capture', 'proof'].includes(entity?.type) && entity.attrs?.path && entity.attrs?.kind !== 'video')
    .filter((entity) => !wanted || foldText(`${entity.label} ${entity.attrs?.folder ?? ''}`).includes(wanted))
    .sort((a, b) => String(a.label).localeCompare(String(b.label)))
    .slice(0, limit);
}

/** A line holding nothing but one picture: `![…](…){…}` or `[[media:…]]{…}`. */
export const PICTURE_LINE = /^\s*(?:!\[[^\]]*\]\([^)]*\)(?:\{[^}\n]*\})?|\[\[media:[A-Za-z0-9_-]+\|[^\]\n]+\]\](?:\{[^}\n]*\})?)\s*$/;

/** `[[media:id|Label]]`, the line a case picture is written as. */
export function pictureReference(entity) {
  return `[[media:${entity.id}|${String(entity.label ?? '').replace(/[[\]|\n]/g, '').trim() || 'Picture'}]]`;
}

/**
 * The line with picture `ref` showing case record `entity` in its place, its braces
 * kept: its size, place, caption, veil and zoom stay. An image's title, which printed
 * as its caption, becomes its caption. Null when the line does not hold `ref`.
 */
export function replacedLine(text, ref, entity) {
  const picture = picturesIn(text).find((item) => sameRef(item.ref, ref));
  if (!picture || !entity?.id) return null;
  const braces = picture.title && !picture.caption
    ? writeAttrs({ width: picture.width, align: picture.align, caption: picture.title, rest: picture.rest })
    : text.slice(picture.attrFrom, picture.to);
  return `${text.slice(0, picture.from)}${pictureReference(entity)}${braces}${text.slice(picture.to)}`;
}

// -- a size by its corner ----------------------------------------------------------

/**
 * The size a picture dragged to `fraction` of the page's width snaps to: the one of
 * `PICTURE_SIZES` whose width (`sizeWidth`) is nearest, with that width.
 */
export function nearestSize(fraction, ratio = 0) {
  let best = null;
  for (const size of PICTURE_SIZES) {
    const width = sizeWidth(size.share, ratio);
    const distance = Math.abs(parseFloat(width) / 100 - fraction);
    if (!best || distance < best.distance - 1e-9) best = { size, width, distance };
  }
  return { size: best.size, width: best.width };
}

/**
 * The place of the `::: center` or `::: right` block line `index` (0-based) stands
 * in (a corner block counts as its side), '' outside one or in a left one: what a
 * picture there takes when its line writes none.
 */
export function blockAlignAt(lines, index) {
  for (let at = index - 1; at >= 0; at -= 1) {
    if (/^:::[ \t]*$/.test(lines[at])) return '';
    const open = BLOCK_OPEN.exec(lines[at]);
    if (!open) continue;
    const side = blockSide(open[1]);
    for (let end = index + 1; end < lines.length; end += 1) {
      if (/^:::[ \t]*$/.test(lines[end])) return side === 'left' ? '' : side;
      if (BLOCK_OPEN.test(lines[end])) return '';
    }
    return '';
  }
  return '';
}

/** The picture `ref` on the line (0-based) holding it nearest to `line`, or null. */
export function pictureAt(lines, line, ref) {
  const at = pictureLine(lines, line, ref);
  return at < 0 ? null : picturesIn(lines[at]).find((item) => sameRef(item.ref, ref)) ?? null;
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

// -- the caption field ---------------------------------------------------------

/** What the picture bars say, in the note and on the Page pane alike. */
export const CAPTION_HELP = {
  button: 'Caption: a line printed under the picture',
  field: 'Enter writes it, Escape leaves it as it was',
  placeholder: 'A line under the picture',
};

/**
 * The one-line field a caption is written in, where it prints under the picture.
 * Enter writes it (`write(words)`), as does leaving it; Escape leaves it as it was.
 * `done(by)` is called once either way, `by` being `keyboard` or `blur`.
 */
export function captionField({ caption = '', title = '', write, done }) {
  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'picture-caption-field';
  field.value = caption;
  field.maxLength = CAPTION_MAX;
  field.placeholder = title || CAPTION_HELP.placeholder;
  field.title = CAPTION_HELP.field;
  field.setAttribute('aria-label', 'Caption');
  let over = false;
  const finish = (keep, by) => {
    if (over) return;
    over = true;
    if (keep && cleanCaption(field.value) !== cleanCaption(caption)) write(cleanCaption(field.value));
    done(by);
  };
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish(event.key === 'Enter', 'keyboard');
    }
  });
  field.addEventListener('blur', () => finish(true, 'blur'));
  return field;
}

/** What a picture's Source… says, in the note and on the Page pane alike. */
export const SOURCE_HELP = {
  label: 'Source',
  button: 'Where it comes from: a link you state, nothing is fetched',
  field: 'Enter states it, Escape leaves it',
  placeholder: 'https://… where this picture comes from',
  refused: 'The source must be an http(s) address',
};

/** What a proof's Posted… says on the Page pane: where the analyst published it. */
export const POSTED_HELP = {
  label: 'Posted at',
  button: 'Where you published this proof, on X or elsewhere: reports link the proof there',
  field: 'Enter keeps it, an empty field takes it off, Escape leaves it',
  placeholder: 'https://… where you posted this proof',
  refused: 'The address must be an http(s) one',
};

/**
 * Where proof `entity` was published, as a report links it (`urltitles.own_posts`): the
 * address stated on it, else the latest post Post was told went out with a link, or ''.
 */
export function postedAddress(entity) {
  const web = (value) => (typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim()) ? value.trim() : '');
  const posts = Array.isArray(entity?.attrs?.posted) ? entity.attrs.posted : [];
  return web(entity?.attrs?.posted_url) || posts.map((one) => web(one?.url)).filter(Boolean).at(-1) || '';
}

/**
 * The one-line field a picture's source is stated in: an address only the analyst
 * knows, as Details states one. Enter writes it (`write(url)`, a promise refused
 * with what is wrong), Escape or leaving the field drops it. `done(by)` is called once.
 * `help` words it (`SOURCE_HELP`, `POSTED_HELP`); a field opened on an address
 * already kept (`value`) holds it, and Enter on it emptied writes "" to take it off.
 */
export function sourceField({ write, done, help = SOURCE_HELP, value = '' }) {
  const field = document.createElement('input');
  field.type = 'url';
  field.className = 'picture-source-field';
  field.maxLength = 2000;
  field.value = value;
  field.placeholder = help.placeholder;
  field.title = help.field;
  field.setAttribute('aria-label', help.label);
  let over = false;
  let writing = false;
  const finish = (by) => {
    if (over) return;
    over = true;
    done(by);
  };
  const refuse = (message) => {
    field.setAttribute('aria-invalid', 'true');
    field.title = message;
  };
  field.addEventListener('input', () => {
    field.removeAttribute('aria-invalid');
    field.title = help.field;
  });
  field.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      finish('keyboard');
      return;
    }
    const url = field.value.trim();
    if (writing || (!url && !value)) return;
    if (url && !/^https?:\/\/\S+$/i.test(url)) {
      refuse(help.refused);
      return;
    }
    writing = true;
    try {
      await write(url);
      finish('keyboard');
    } catch (error) {
      refuse(error?.message || 'The source was not kept');
    } finally {
      writing = false;
    }
  });
  field.addEventListener('blur', () => {
    if (!writing) finish('blur');
  });
  return field;
}

/**
 * A picture bar walked with the keyboard as a toolbar: Tab enters it once, on the
 * button last used, and leaves it; the arrows, Home and End move along it. So a
 * note with many pictures is not dozens of Tab presses long. Returns its undoing.
 */
export function rovingToolbar(bar) {
  const buttons = () => [...bar.querySelectorAll('button')];
  const settle = (current) => {
    for (const button of buttons()) button.tabIndex = button === current ? 0 : -1;
  };
  settle(buttons()[0]);
  const keydown = (event) => {
    const list = buttons();
    const at = list.indexOf(event.target.closest?.('button'));
    if (at < 0) return;
    const next = { ArrowRight: list[(at + 1) % list.length], ArrowLeft: list[(at - 1 + list.length) % list.length], Home: list[0], End: list.at(-1) }[event.key];
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    settle(next);
    next.focus();
  };
  const focusin = (event) => {
    const button = event.target.closest?.('button');
    if (button && bar.contains(button)) settle(button);
  };
  bar.addEventListener('keydown', keydown);
  bar.addEventListener('focusin', focusin);
  return () => {
    bar.removeEventListener('keydown', keydown);
    bar.removeEventListener('focusin', focusin);
  };
}
