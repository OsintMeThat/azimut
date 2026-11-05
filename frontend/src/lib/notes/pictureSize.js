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

/** The braces for a size, a place and a caption: left, the default, is not written. */
export function writeAttrs({ width = '', align = '', caption = '', rest = '' } = {}) {
  const parts = [];
  if (width) parts.push(`width=${width}`);
  if (align && align !== 'left') parts.push(`align=${align}`);
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

/** The line with picture `ref` given `changes` ({ width }, { align }, { caption }), or null when the line does not hold it. */
export function sizedLine(text, ref, changes) {
  const picture = picturesIn(text).find((item) => sameRef(item.ref, ref));
  if (!picture) return null;
  const next = { width: picture.width, align: picture.align, caption: picture.caption, rest: picture.rest, ...changes };
  return `${text.slice(0, picture.attrFrom)}${writeAttrs(next)}${text.slice(picture.to)}`;
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
  button: 'Where it comes from: a link you state, nothing is fetched',
  field: 'Enter states it, Escape leaves it',
  placeholder: 'https://… where this picture comes from',
};

/**
 * The one-line field a picture's source is stated in: an address only the analyst
 * knows, as Details states one. Enter writes it (`write(url)`, a promise refused
 * with what is wrong), Escape or leaving the field drops it. `done(by)` is called once.
 */
export function sourceField({ write, done }) {
  const field = document.createElement('input');
  field.type = 'url';
  field.className = 'picture-source-field';
  field.maxLength = 2000;
  field.placeholder = SOURCE_HELP.placeholder;
  field.title = SOURCE_HELP.field;
  field.setAttribute('aria-label', 'Source');
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
    field.title = SOURCE_HELP.field;
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
    if (!url || writing) return;
    if (!/^https?:\/\/\S+$/i.test(url)) {
      refuse('The source must be an http(s) address');
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
