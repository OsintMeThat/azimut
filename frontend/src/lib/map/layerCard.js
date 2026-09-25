/**
 * The card a feature of an added layer opens.
 *
 * Read-only by construction: it is built from the strings the source stated,
 * and its one control copies the feature's point. Nothing in an added layer
 * enters the case.
 *
 * Three things it does beyond printing the description:
 *
 * - **A labelled line is drawn as a labelled line.** A My Maps carries its
 *   columns as `label: value`, and the backend now keeps one row per line
 *   (`engine/maplayers.py`). Run together in a paragraph they read as prose;
 *   split into a label and its value they read as the table the source wrote.
 *   The split is per line rather than all-or-nothing, so a description that is
 *   half prose and half columns keeps both.
 * - **An address is a link.** The analyst's next move on a feature sourced from
 *   a tweet is to open the tweet, and selecting a URL out of a popup to paste it
 *   in a bar is a step nothing is gained by. Built as DOM here rather than as
 *   HTML anywhere: the text belongs to whoever made the file, so it only ever
 *   reaches the page as `textContent`, and a link's address is checked to be
 *   http(s) before it becomes one.
 * - **A point states where it is.** The source's own coordinates, in the
 *   analyst's format, copied in one click. A right-click on the pin used to be
 *   the only way to them, and it read the ground under the pin's head rather
 *   than the point the pin names.
 */
import { paths } from '../../components/Icon.svelte';
import { formatCoords } from '../coords.js';
import { UNNAMED } from './addedLayers.js';

/** Where a URL starts, and how far it runs: to the first space or quote. */
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;
/** …minus what is punctuation rather than address. A sentence ending on a link
 *  would otherwise swallow its full stop, and a parenthesised one its bracket. */
const TRAILING = /[.,;:!?)\]}>'"]+$/;

/** How long a label may be before the line is prose with a colon in it. */
const MAX_LABEL = 48;
/** A line the source wrote as `label: value`. The space after the colon is what
 *  keeps `https://x` and `10:30` out of it. */
const FIELD = /^([^\s:][^:]{0,46}?)\s*:[ \t]+(\S.*)$/;

/**
 * A description as the blocks it should be drawn in, in the order written.
 *
 * @param {string} text
 * @returns {Array<{ label: string, value: string } | { text: string }>}
 */
export function readBlocks(text) {
  const blocks = [];
  let prose = [];
  const flush = () => {
    const joined = prose.join('\n').trim();
    if (joined) blocks.push({ text: joined });
    prose = [];
  };
  for (const line of String(text ?? '').split('\n')) {
    const match = line.trim().match(FIELD);
    if (match && match[1].length <= MAX_LABEL) {
      flush();
      blocks.push({ label: match[1].trim(), value: match[2].trim() });
    } else {
      prose.push(line);
    }
  }
  flush();
  return blocks;
}

/**
 * The pieces of one string: its words, and the addresses among them.
 *
 * @param {string} text
 * @returns {Array<{ text: string, href?: string }>}
 */
export function readLinks(text) {
  const out = [];
  const source = String(text ?? '');
  let at = 0;
  for (const match of source.matchAll(URL_PATTERN)) {
    const url = match[0].replace(TRAILING, '');
    if (!url) continue;
    if (match.index > at) out.push({ text: source.slice(at, match.index) });
    out.push({ text: url, href: url });
    at = match.index + url.length;
  }
  if (at < source.length) out.push({ text: source.slice(at) });
  return out;
}

/** Write a string into an element, its addresses as links. */
export function fillText(element, text) {
  for (const piece of readLinks(text)) {
    if (!piece.href) {
      element.append(document.createTextNode(piece.text));
      continue;
    }
    const link = document.createElement('a');
    link.href = piece.href;
    link.textContent = piece.text;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    element.append(link);
  }
  return element;
}

/** The copy glyph, built as DOM for the same reason the text is. */
function copyGlyph() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '11');
  svg.setAttribute('height', '11');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', paths.copy);
  svg.append(path);
  return svg;
}

/**
 * The card builder for one layer, which is why the layer's title is bound here:
 * with three maps over the imagery at once, a card stating a name and a group
 * says nothing about *whose* map said it. The layer signs the bottom of it.
 *
 * @param {string} title
 * @param {object} [opts]
 * @param {(lat: number, lon: number) => string} [opts.coords] the point as the
 *   analyst writes coordinates; read when the card opens, so a format changed
 *   in Settings is the one the next card uses
 * @param {(text: string) => void} [opts.copy] what pressing the coordinates
 *   does. Absent, they are text.
 * @returns {(properties: Record<string, any>, point?: { lat: number, lon: number } | null) => HTMLElement}
 */
export function layerCard(title, { coords = formatCoords, copy = null } = {}) {
  return (properties = {}, point = null) => {
    const element = document.createElement('div');
    element.className = 'layer-card';

    const heading = document.createElement('h4');
    heading.textContent = properties.name || UNNAMED;
    element.append(heading);

    if (properties.category) {
      const group = document.createElement('p');
      group.className = 'layer-card-group';
      group.textContent = properties.category;
      element.append(group);
    }

    // A line or an area has no one point, so it states none.
    const text = point ? coords(point.lat, point.lon) : '';
    if (text) {
      const where = document.createElement(copy ? 'button' : 'p');
      where.className = 'layer-card-where mono';
      const value = document.createElement('span');
      value.textContent = text;
      where.append(value);
      if (copy) {
        where.type = 'button';
        where.title = 'Copy coordinates';
        where.append(copyGlyph());
        where.addEventListener('click', () => copy(text));
      }
      element.append(where);
    }

    const blocks = readBlocks(properties.description);
    if (blocks.length) {
      const body = document.createElement('div');
      body.className = 'layer-card-body';
      for (const block of blocks) {
        if (block.text !== undefined) {
          const paragraph = document.createElement('p');
          paragraph.className = 'layer-card-text';
          fillText(paragraph, block.text);
          body.append(paragraph);
          continue;
        }
        const field = document.createElement('div');
        field.className = 'layer-card-field';
        const label = document.createElement('span');
        label.className = 'layer-card-label';
        label.textContent = block.label;
        const value = document.createElement('span');
        value.className = 'layer-card-value';
        fillText(value, block.value);
        field.append(label, value);
        body.append(field);
      }
      element.append(body);
    }

    const from = document.createElement('p');
    from.className = 'layer-card-from';
    from.textContent = title;
    element.append(from);
    return element;
  };
}
