/**
 * The card a feature of an added layer opens.
 *
 * Read-only by construction: it is built from the strings the source stated,
 * and its controls copy the feature's point or open the case item one of the
 * analyst's own markers follows. Nothing in an added layer enters the case.
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
 * - **A line states its length, an area its size.** Read off the geometry the
 *   source wrote, in the analyst's units, at the foot of the card.
 */
import { paths } from '../../components/Icon.svelte';
import { formatCoords } from '../coords.js';
import { formatArea, formatDistance, pathLength, polygonArea } from '../measure.js';
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

/**
 * How long a feature's lines run and how much ground its areas cover, in metres.
 *
 * Multi-part geometries add up their parts, and a hole is taken out of its area.
 * Null for a point, or for anything that has neither.
 *
 * @param {object | null} geometry GeoJSON
 * @returns {{ length: number, area: number, perimeter: number } | null}
 */
export function featureSize(geometry) {
  const size = { length: 0, area: 0, perimeter: 0 };
  const points = (line) => (Array.isArray(line) ? line : [])
    .filter((at) => Number.isFinite(at?.[0]) && Number.isFinite(at?.[1]))
    .map(([lon, lat]) => ({ lat, lon }));
  const polygon = (rings) => {
    const [outer, ...holes] = (Array.isArray(rings) ? rings : []).map(points);
    if (!outer || outer.length < 3) return;
    size.area += Math.max(0, polygonArea(outer) - holes.reduce((sum, hole) => sum + polygonArea(hole), 0));
    size.perimeter += pathLength(outer);
  };
  const walk = (shape) => {
    switch (shape?.type) {
      case 'LineString': size.length += pathLength(points(shape.coordinates)); break;
      case 'MultiLineString': for (const line of shape.coordinates ?? []) size.length += pathLength(points(line)); break;
      case 'Polygon': polygon(shape.coordinates); break;
      case 'MultiPolygon': for (const rings of shape.coordinates ?? []) polygon(rings); break;
      case 'GeometryCollection': for (const part of shape.geometries ?? []) walk(part); break;
    }
  };
  walk(geometry);
  return size.length > 0 || size.area > 0 ? size : null;
}

/** A feature's size as the card writes it, or '' when it has none. */
export function sizeLine(geometry, units = 'metric') {
  const size = featureSize(geometry);
  if (!size) return '';
  const parts = [];
  if (size.area > 0) parts.push(`Area ${formatArea(size.area, units)}`, `Perimeter ${formatDistance(size.perimeter, units)}`);
  if (size.length > 0) parts.push(`Length ${formatDistance(size.length, units)}`);
  return parts.join(' · ');
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
 * @param {() => string} [opts.units] the analyst's units, read when the card
 *   opens like the coordinates' format
 * @returns {(properties: Record<string, any>, point?: { lat: number, lon: number } | null, geometry?: object | null) => HTMLElement}
 */
export function layerCard(title, { coords = formatCoords, copy = null, pictures = null, units = () => 'metric' } = {}) {
  return (properties = {}, point = null, geometry = null) => {
    const element = document.createElement('div');
    element.className = 'layer-card';

    const heading = document.createElement('h4');
    heading.textContent = properties.name || UNNAMED;
    element.append(heading);

    // What a personal marker follows, each shown and opened from its picture: the
    // footage first, then the proof that geolocates it. `pictures` answers a list of
    // `{ src, caption, title, open }`.
    const shown = (pictures?.(properties) ?? []).filter((one) => one.src);
    if (shown.length) {
      const row = document.createElement('div');
      row.className = 'layer-card-pictures';
      for (const one of shown) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'layer-card-picture';
        button.title = one.title;
        const image = document.createElement('img');
        image.src = one.src;
        image.alt = one.title;
        image.loading = 'lazy';
        // a thumbnail the cache let go: the card reads on without it
        image.addEventListener('error', () => button.remove());
        const caption = document.createElement('span');
        caption.textContent = one.caption;
        button.append(image, caption);
        button.addEventListener('click', (event) => { event.stopPropagation(); one.open(); });
        row.append(button);
      }
      element.append(row);
    }

    const named = [properties.category, properties.colour_name, properties.icon_meaning].filter(Boolean).join(' · ');
    if (named) {
      const group = document.createElement('p');
      group.className = 'layer-card-group';
      group.textContent = named;
      element.append(group);
    }

    // What the feature says beyond its name: its day, its state, whose point it is.
    const day = properties.date ? (properties.date_end ? `${properties.date} – ${properties.date_end}` : properties.date) : '';
    const facts = [day, { damaged: 'Damaged', destroyed: 'Destroyed' }[properties.status] ?? '',
      properties.provenance === 'external' ? 'Geolocated by someone else' : ''].filter(Boolean);
    if (facts.length) {
      const line = document.createElement('p');
      line.className = 'layer-card-facts';
      line.textContent = facts.join(' · ');
      element.append(line);
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

    // The addresses a personal feature rests on, each opened in a tab of its own.
    const links = (properties.links ?? []).filter((link) => /^https?:\/\//i.test(String(link)));
    for (const link of links) {
      const anchor = document.createElement('a');
      anchor.className = 'layer-card-link';
      anchor.href = link;
      anchor.target = '_blank';
      anchor.rel = 'noreferrer noopener';
      anchor.textContent = link;
      element.append(anchor);
    }

    const size = point ? '' : sizeLine(geometry, units());
    if (size) {
      const line = document.createElement('p');
      line.className = 'layer-card-size';
      line.textContent = size;
      element.append(line);
    }

    const from = document.createElement('p');
    from.className = 'layer-card-from';
    from.textContent = title;
    element.append(from);
    return element;
  };
}
