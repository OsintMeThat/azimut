/**
 * A plate's type and its ready blocks: what makes a page read as designed rather than
 * typed.
 *
 * **Text styles** are the few voices a published map speaks in: a kicker over the
 * title, the title, the standfirst under it, the body, a caption, the source line, a
 * date badge, a key figure. Picking one sets a text's size, weight, capitals, spacing
 * and colour at once, in the page's own colours: the accent, the ink, the paper, and a
 * muted ink between the ink and the paper (`mutedOf`). The words stay the analyst's.
 *
 * **Blocks** are elements laid out together for a job (a title with its kicker and
 * standfirst, a date badge, a classification band, a source line, a key figure), put
 * where such a thing usually stands on the page and sized to it.
 */
import { mix } from './plainBasemap.js';

/** The ink a page writes its quieter words in: the ink drawn toward the paper. */
export const mutedOf = (theme) => mix(theme.ink, theme.paper, 0.42);

/**
 * The text styles, in the order the inspector offers them. A colour is named by the
 * page colour it takes (`accent`, `muted`, `paper`), so a style reads the page it is on.
 */
export const TEXT_STYLES = {
  kicker: { label: 'Kicker', size: 8, weight: 700, upper: true, tracking: 14, leading: 1.2, colour: 'accent' },
  title: { label: 'Title', size: 20, weight: 700, upper: false, tracking: -1, leading: 1.1 },
  dek: { label: 'Standfirst', size: 10.5, weight: 400, upper: false, tracking: 0, leading: 1.3, colour: 'muted' },
  body: { label: 'Body', size: 9, weight: 400, upper: false, tracking: 0, leading: 1.35 },
  caption: { label: 'Caption', size: 7, weight: 400, upper: false, tracking: 0, leading: 1.3, colour: 'muted' },
  source: { label: 'Source line', size: 6, weight: 400, upper: false, tracking: 2, leading: 1.25, colour: 'muted' },
  badge: { label: 'Date badge', size: 7.5, weight: 700, upper: true, tracking: 10, leading: 1.1, colour: 'paper', fill: 'accent', align: 'center', valign: 'middle' },
  figure: { label: 'Key figure', size: 28, weight: 700, upper: false, tracking: -2, leading: 1, colour: 'accent' },
};

/** A colour a style names, on this page. */
function tone(name, theme) {
  if (name === 'accent') return theme.accent;
  if (name === 'paper') return theme.paper;
  if (name === 'muted') return mutedOf(theme);
  return null;
}

/**
 * A text set in one of the styles: its size, weight, capitals, spacing and colour,
 * the box filled where the style fills it. What the style does not say is left as
 * the text had it, its words above all.
 */
export function styled(element, role, theme) {
  const style = TEXT_STYLES[role];
  if (!style) return { ...element, role: '' };
  // eslint-disable-next-line no-unused-vars
  const { label, colour, fill, ...set } = style;
  return { ...element, ...set, role, italic: false, colour: tone(colour, theme), fill: tone(fill, theme) };
}

const round = (value) => Math.round(value * 10) / 10;
const boxed = (x, y, w, h) => [x, y, w, h].map(round);

/**
 * The blocks the Add panel offers, `[kind, label, icon, words]` as `adds.js` lists
 * them, and each one's elements on a page `width` by `height` millimetres, the main
 * map's box `map`, made with ids from `id(kind)`.
 */
export const BLOCK_ADDS = [
  ['title-block', 'Title block', 'text', 'heading kicker standfirst headline'],
  ['date-badge', 'Date badge', 'clock', 'as of situation day'],
  ['classification', 'Classification band', 'columns', 'osint unverified banner marking'],
  ['source-line', 'Source line', 'info', 'sources caption method'],
  ['key-figure', 'Key figure', 'hash', 'number count statistic total'],
];

export function block(kind, { width, height, map = null, theme, id }) {
  const margin = Math.max(6, round(Math.min(width, height) * 0.04));
  const [mx, my, mw, mh] = map ?? [margin, margin, width - 2 * margin, height - 2 * margin];
  const text = (role, fields) => styled({ id: id('text'), kind: 'text', align: 'left', valign: 'top', ...fields }, role, theme);
  switch (kind) {
    case 'title-block': {
      const w = Math.min(width - 2 * margin, 150);
      const group = id('g');
      return [
        text('kicker', { name: 'Kicker', box: boxed(margin, margin, w, 5), text: 'Situation', group }),
        text('title', { name: 'Title', box: boxed(margin, margin + 5.5, w, 10), text: '{case}', group }),
        text('dek', { name: 'Standfirst', box: boxed(margin, margin + 16.5, w, 10), text: 'What the map shows, in one sentence.', group }),
      ];
    }
    case 'date-badge':
      return [text('badge', { name: 'Date badge', box: boxed(mx + 4, my + 4, 46, 7), text: 'As of {date}' })];
    case 'classification':
      return [styled({ id: id('text'), kind: 'text', name: 'Classification band', box: boxed(0, 0, width, 6), text: 'OSINT · Unverified · {today}',
        align: 'center', valign: 'middle' }, 'badge', { ...theme, accent: theme.ink })];
    case 'source-line':
      return [text('source', { name: 'Source line', box: boxed(mx, Math.min(height - margin, my + mh + 7), mw, 5),
        text: 'Sources: geolocated footage and open imagery. Map: {handle}, {today}.' })];
    case 'key-figure': {
      const group = id('g');
      return [
        text('figure', { name: 'Key figure', box: boxed(margin, height - margin - 24, 50, 13), text: '0', group }),
        text('caption', { name: 'What it counts', box: boxed(margin, height - margin - 10.5, 50, 9), text: 'what the figure counts', group }),
      ];
    }
    default:
      return [];
  }
}
