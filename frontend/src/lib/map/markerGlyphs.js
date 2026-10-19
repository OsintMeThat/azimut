/**
 * The pictograms a personal layer's points wear, and the one drawing of a
 * marker that the map, the icon picker and the KMZ export all share.
 *
 * A badge is read at about 25 pixels over imagery, so its glyph is a filled
 * white silhouette rather than the interface's line icons: a 1.8-unit stroke
 * shrinks to a pixel there and turns to noise over a busy roof. Each glyph sits
 * on a 24-unit square, scaled so it fills most of the disc, and is a list of
 * layers drawn in order:
 *
 * - `fill` paints the silhouette.
 * - `cut` paints the disc's own colour back, for windows, lenses and holes.
 * - `line` is a thick white stroke, for masts, rotors and arcs.
 * - `cutline` is a stroke in the disc's colour, which carves the gap that keeps
 *   a wheel apart from the body it overlaps.
 *
 * A layer's options give a stroke `width` other than the default and a
 * `rotate` in degrees about the square's centre.
 *
 * Two marks ride on top of any marker, after GeoConfirmed's: a stroke across it
 * for something damaged, a cross for something destroyed. A point somebody else
 * geolocated wears a dashed rim instead of a solid one.
 *
 * A marker can also wear one of the analyst's own icons (`drawOwnMarker`). In a
 * disc, its silhouette is the glyph, inked as a badge's is; as it is, the
 * picture keeps its colours and the size the source layers draw theirs at, and
 * the marks ride on it all the same.
 */
import { paths } from '../../components/Icon.svelte';
import { glyphInk } from '../proofIcons.js';

/** Side of the square image every marker is drawn into. */
export const MARKER_PIXELS = 64;

const CENTRE = MARKER_PIXELS / 2;
const DISC = 28;
/** Glyph units to image pixels: the 24-unit square spans 44 of the disc's 56. */
const GLYPH_BOX = { scale: 1.85, offset: CENTRE - 12 * 1.85 };
/** A plain marker's painted outline stands as tall as a badge's disc. */
const PLAIN_BOX = { scale: 2.7, offset: -0.4 };
const IMAGE_BOX = { scale: 1, offset: 0 };
const PLAIN = new Set(['pin', 'circle', 'star', 'flag']);
const LINE = 2.2;
const CUT = 1.3;
/** A thin dark rim outside the white one, so a pale disc holds over snow or sand. */
const HALO = 'rgba(0, 0, 0, 0.35)';

/** Where the status strokes run, in image pixels: across the disc, or across a
 *  pin's head, which sits above the middle of its image. */
const ACROSS = { badge: [32, 32, 15], plain: [32, 26.6, 13] };
const DASH = [6, 4];

const round = (value) => Math.round(value * 100) / 100;
const ring = (x, y, r) => `M${x} ${round(y - r)}a${r} ${r} 0 1 1 0 ${round(2 * r)} ${r} ${r} 0 0 1 0-${round(2 * r)}Z`;

export const BADGE_GLYPHS = {
  // Markers
  'badge-flag': [
    ['fill', 'M5.4 2.8h2.1v18.4H5.4Z'],
    ['fill', 'M8.5 3.8h11.3l-2.9 4.3 2.9 4.4H8.5Z'],
  ],
  'badge-crosshair': [
    ['line', ring(12, 12, 6.8)],
    ['line', 'M12 2.6v4.2M12 17.2v4.2M2.6 12h4.2M17.2 12h4.2'],
    ['fill', ring(12, 12, 1.9)],
  ],
  'badge-compass': [
    ['fill', 'M12 2.6 19.4 20.4 12 16.3 4.6 20.4Z'],
  ],
  'badge-alert': [
    ['fill', 'M10.6 4.1c.6-1.1 2.2-1.1 2.8 0l7.7 13.4c.6 1.1-.2 2.4-1.4 2.4H4.3c-1.2 0-2-1.3-1.4-2.4Z'],
    ['cut', 'M10.9 8.6h2.2l-.4 5.9h-1.4Z'],
    ['cut', ring(12, 16.9, 1.25)],
  ],
  // Sources
  'badge-image': [
    ['fill', 'M5 7h2.4l1.5-2.2c.2-.3.6-.5 1-.5h4.2c.4 0 .8.2 1 .5L16.6 7H19a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z'],
    ['cut', ring(12, 13.1, 4.3)],
    ['fill', ring(12, 13.1, 2.3)],
  ],
  'badge-video': [
    ['fill', 'M4.5 7h9.5a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H4.5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z'],
    ['fill', 'M17 10.4 21.5 7.6v8.8L17 13.6Z'],
  ],
  'badge-audio': [
    ['fill', 'M12 2.8a3.2 3.2 0 0 1 3.2 3.2v5.2a3.2 3.2 0 0 1-6.4 0V6A3.2 3.2 0 0 1 12 2.8Z'],
    ['line', 'M6.2 11a5.8 5.8 0 0 0 11.6 0M12 17v3.6M8.6 20.8h6.8'],
  ],
  'badge-note': [
    ['fill', 'M6.5 2.3H14v5.6h5.5V20a1.5 1.5 0 0 1-1.5 1.5H6.5A1.5 1.5 0 0 1 5 20V3.8a1.5 1.5 0 0 1 1.5-1.5Z'],
    ['fill', 'M15.5 2.6 19.2 6.4h-3.7Z'],
    ['cut', 'M7.8 11h8.4v1.8H7.8ZM7.8 14.6h8.4v1.8H7.8ZM7.8 18.2h5.2V20H7.8Z'],
  ],
  'badge-bookmark': [
    ['fill', 'M6.8 2.6h10.4c.7 0 1.3.6 1.3 1.3v17.3L12 16.8l-6.5 4.4V3.9c0-.7.6-1.3 1.3-1.3Z'],
  ],
  'badge-globe': [
    ['line', ring(12, 12, 8.6)],
    ['line', 'M3.6 12h16.8M12 3.4c-2.5 2.4-3.7 5.3-3.7 8.6s1.2 6.2 3.7 8.6c2.5-2.4 3.7-5.3 3.7-8.6S14.5 5.8 12 3.4Z', { width: 1.8 }],
  ],
  'badge-phone': [
    ['fill', 'M5.4 2.9 8.5 2.7c.6 0 1.1.3 1.3.9l1.3 3.6c.2.6 0 1.2-.5 1.5L8.8 9.9a12.4 12.4 0 0 0 5.3 5.3l1.2-1.8c.3-.5.9-.7 1.5-.5l3.6 1.3c.6.2.9.7.9 1.3l-.2 3.1c-.1 1.1-1 2-2.2 1.9C9.9 20.1 3.9 14.1 3.5 5.1c-.1-1.2.8-2.1 1.9-2.2Z'],
  ],
  'badge-mail': [
    ['fill', 'M4.2 5h15.6c.9 0 1.7.8 1.7 1.7v10.6c0 .9-.8 1.7-1.7 1.7H4.2c-.9 0-1.7-.8-1.7-1.7V6.7C2.5 5.8 3.3 5 4.2 5Z'],
    ['cutline', 'M3.8 6.8 12 12.6l8.2-5.8', { width: 1.8 }],
  ],
  'badge-user': [
    ['fill', ring(12, 7.6, 4.1)],
    ['fill', 'M4.3 20.8c.3-4.6 3.6-7.6 7.7-7.6s7.4 3 7.7 7.6Z'],
  ],
  'badge-clock': [
    ['fill', ring(12, 12, 9.2)],
    ['cutline', 'M12 6.6V12l3.6 2.4', { width: 2.1 }],
  ],
  // Events
  'badge-explosion': [
    ['fill', 'M12 2.4 13.4 7.3 17.4 3.6 15.9 8.9 20.7 8.2 17.1 11.6 22.2 13.9 16.7 14.5 19.4 18.8 14.8 16.7 14.9 22.1 12 17.6 9.3 21.6 9.2 16.7 4.4 19 7.3 14.5 1.8 13.8 6.9 11.6 3.1 8.4 8 8.9 6.5 3.7 10.6 7.3Z'],
    ['cut', 'M12.6 8.6 13 11 15.1 9.7 14 11.9 16.6 11.9 14.5 13.2 16.6 14.6 14 14.6 15.1 16.8 13 15.5 12.6 17.9 11.6 15.7 10 17.6 10.3 15.1 7.9 15.8 9.5 13.9 7.1 13.2 9.5 12.5 7.9 10.6 10.3 11.3 10 8.9 11.6 10.8Z'],
  ],
  'badge-flame': [
    ['fill', 'M12 2.3c.6 3.3 2.6 4.9 4.3 6.9 1.5 1.8 2.6 3.7 2.6 6.1 0 3.6-3 6.4-6.9 6.4s-6.9-2.8-6.9-6.4c0-2.6 1.3-4.6 3-6.2.2 1.6.9 2.8 2 3.5-.3-3.7.4-7.1 1.9-10.3Z'],
    ['cut', 'M12 13.4c1.3 1.4 2.5 2.6 2.5 4.2a2.5 2.5 0 0 1-5 0c0-1.6 1.2-2.8 2.5-4.2Z'],
  ],
  'badge-crater': [
    ['fill', 'M12.2 4.8c4 .1 7.2 3.2 7 7.4-.1 4.1-3.4 7.1-7.5 7-4-.1-7.1-3.3-6.9-7.4.1-4 3.4-7.1 7.4-7Z'],
    ['cut', 'M14 8.4c2.1.1 3.8 1.9 3.7 4.1-.1 2.3-2 4.1-4.3 4-2.3-.1-4.1-2-4-4.3.2-2.2 2.3-3.9 4.6-3.8Z'],
    ['fill', `${ring(10.8, 2.4, 1.1)}${ring(20.6, 5.8, 0.9)}${ring(21.2, 15.6, 1.1)}${ring(4.2, 19.4, 1)}${ring(2.8, 9.8, 0.8)}`],
  ],
  'badge-clash': [
    ['fill', 'M12 2.2l1.3 2.1v10.4h-2.6V4.3ZM7.8 14.7h8.4v1.8H7.8ZM11.1 16.5h1.8v3.1h-1.8Z', { rotate: 45 }],
    ['fill', ring(12, 20.7, 1.3), { rotate: 45 }],
    ['fill', 'M12 2.2l1.3 2.1v10.4h-2.6V4.3ZM7.8 14.7h8.4v1.8H7.8ZM11.1 16.5h1.8v3.1h-1.8Z', { rotate: -45 }],
    ['fill', ring(12, 20.7, 1.3), { rotate: -45 }],
  ],
  'badge-casualty': [
    ['fill', 'M9.8 2.4h4.4l3.1 4.8-2.2 14.4H8.9L6.7 7.2Z'],
    ['cutline', 'M9.6 6.6 12 4.4l2.4 2.2-1.6 11.6h-1.6Z', { width: 1.1 }]
  ],
  'badge-chemical': [
    ['fill', 'M9.2 2.6h5.6v1.8h-.9v4.7l5.6 9.5c.7 1.2-.2 2.8-1.6 2.8H6.1c-1.4 0-2.3-1.6-1.6-2.8l5.6-9.5V4.4h-.9Z'],
    ['cut', 'M9.6 11.6h4.8l1.2 2H8.4Z'],
    ['cut', `${ring(10.2, 17.2, 1.2)}${ring(13.9, 15.9, 0.9)}`]
  ],
  'badge-nuclear': [
    ['fill', 'M13.6 14.77 16.6 19.97A9.2 9.2 0 0 1 7.4 19.97L10.4 14.77A3.2 3.2 0 0 0 13.6 14.77Z'],
    ['fill', 'M8.8 12 2.8 12A9.2 9.2 0 0 1 7.4 4.03L10.4 9.23A3.2 3.2 0 0 0 8.8 12Z'],
    ['fill', 'M13.6 9.23 16.6 4.03A9.2 9.2 0 0 1 21.2 12L15.2 12A3.2 3.2 0 0 0 13.6 9.23Z'],
    ['fill', ring(12, 12, 1.9)],
  ],
  // Forces
  'badge-soldier': [
    ['fill', 'M5.6 9.6C5.8 5.6 8.6 3 12 3s6.2 2.6 6.4 6.6l1.3.4V12H4.3V10Z'],
    ['fill', 'M8.1 12.7h7.8c-.2 2.4-1.8 3.9-3.9 3.9s-3.7-1.5-3.9-3.9Z'],
    ['fill', 'M3.8 21.2c.3-3.2 2.4-5 4.8-5.5l3.4 2.9 3.4-2.9c2.4.5 4.5 2.3 4.8 5.5Z'],
  ],
  'badge-shield': [
    ['fill', 'M12 2.4 19.6 5.2v5.9c0 5-3.2 8.7-7.6 10.4-4.4-1.7-7.6-5.4-7.6-10.4V5.2Z'],
    ['cut', 'M12 5.1 6.9 7v4.1c0 3.6 2 6.4 5.1 7.9Z'],
  ],
  'badge-tank': [
    ['fill', 'M4.4 13.9h15.2a2.8 2.8 0 0 1 0 5.6H4.4a2.8 2.8 0 0 1 0-5.6Z'],
    ['fill', 'M2.9 12.8 4.6 10.3h14.7l1.8 2.5Z'],
    ['fill', 'M7.2 10.3l1.1-3.1c.2-.5.6-.8 1.1-.8h4.4c.5 0 .9.3 1.1.7l1.4 3.2Z'],
    ['fill', 'M14.6 7.3h7.4v1.6h-7.4Z'],
    ['cut', `${ring(5.1, 16.7, 1.25)}${ring(8.7, 16.7, 1.25)}${ring(12.3, 16.7, 1.25)}${ring(15.9, 16.7, 1.25)}${ring(19.3, 16.7, 1.25)}`],
  ],
  'badge-armoured-vehicle': [
    ['fill', 'M2.4 16.3v-4.6l2.4-3h11.9l4.4 3.3c.5.4.8.9.8 1.5v2.8Z'],
    ['fill', 'M7.6 8.7l.7-2.2h4.6l.8 2.2Z'],
    ['fill', 'M12.8 6.9h6.6v1.4h-6.6Z'],
    ...[5.1, 9.5, 14.5, 18.9].flatMap((x) => [['cutline', ring(x, 16.6, 2.75), { width: 1.2 }], ['fill', ring(x, 16.6, 1.95)]]),
  ],
  'badge-artillery': [
    ['line', 'M8.4 13.6 20.4 5.2', { width: 2.6 }],
    ['fill', 'M5.4 12.4l4.3-2.8 1.6 2.4-4.3 2.8Z'],
    ['line', 'M8.2 15.8 2.8 20.6', { width: 2.1 }],
    ['fill', ring(10.4, 16.6, 3.8)],
    ['cut', ring(10.4, 16.6, 1.4)],
  ],
  'badge-rocket-launcher': [
    ['fill', 'M2.4 16.2v-2.4h19.2v2.4Z'],
    ['fill', 'M16.4 13.2V9.6c0-.5.4-.9.9-.9h2.3c.3 0 .6.2.8.4l1.2 2.2v1.9Z'],
    ['fill', 'M2.6 12.2 12.4 5.4l2.4 3.5L5 15.7Z'],
    ['cut', `${ring(12.6, 6.6, 0.8)}${ring(13.7, 8.2, 0.8)}`],
    ...[5.4, 10, 18.6].flatMap((x) => [['cutline', ring(x, 17.2, 2.6), { width: 1.1 }], ['fill', ring(x, 17.2, 1.9)]])
  ],
  'badge-air-defence': [
    ['fill', 'M5 16.4h14a2.1 2.1 0 0 1 0 4.2H5a2.1 2.1 0 0 1 0-4.2Z'],
    ['fill', 'M3.6 15.4 5 13h14l1.4 2.4Z'],
    ['fill', 'M8 11.6 6.4 10l6.8-6.8c1-.9 2.7-1.6 3.6-1.6 0 .9-.7 2.6-1.6 3.6Z'],
    ['fill', 'M12.2 12.4l-1.6-1.6 6.8-6.8c1-.9 2.7-1.6 3.6-1.6 0 .9-.7 2.6-1.6 3.6Z'],
    ['fill', 'M6 12.4h8v.6H6Z'],
    ['cut', `${ring(6.4, 18.5, 0.9)}${ring(9.6, 18.5, 0.9)}${ring(12.8, 18.5, 0.9)}${ring(16, 18.5, 0.9)}`]
  ],
  'badge-missile': [
    ['fill', 'M4.6 10.5h10.9c1.7 0 3.8.6 5.5 1.5-1.7.9-3.8 1.5-5.5 1.5H4.6Z', { rotate: -40 }],
    ['fill', 'M4.6 10.5 2.6 7.2h2.6l3 3.3ZM4.6 13.5l-2 3.3h2.6l3-3.3Z', { rotate: -40 }],
    ['fill', 'M11.4 10.5l1.2-1.7h1.8l-.4 1.7ZM11.4 13.5l1.2 1.7h1.8l-.4-1.7Z', { rotate: -40 }],
  ],
  'badge-bomb': [
    ['fill', 'M12 6.8c2.7 0 4.4 2.3 4.4 5.8 0 3.8-2 7.2-4.4 9-2.4-1.8-4.4-5.2-4.4-9 0-3.5 1.7-5.8 4.4-5.8Z', { rotate: 25 }],
    ['fill', 'M10.4 7.2 9.6 4.4l-1.4-2h7.6l-1.4 2-.8 2.8Z', { rotate: 25 }],
    ['cutline', 'M12 2.6v4.4', { width: 1.1, rotate: 25 }],
  ],
  'badge-drone': [
    ['line', 'M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6', { width: 2.2 }],
    ['fill', 'M9.6 8.8h4.8c.4 0 .8.4.8.8v4.8c0 .4-.4.8-.8.8H9.6c-.4 0-.8-.4-.8-.8V9.6c0-.4.4-.8.8-.8Z'],
    ...[[5.6, 5.6], [18.4, 5.6], [5.6, 18.4], [18.4, 18.4]].flatMap(([x, y]) => [['fill', ring(x, y, 3.3)], ['cut', ring(x, y, 1.5)]]),
  ],
  'badge-fpv-drone': [
    ['line', 'M6 6l12 12M18 6 6 18', { width: 2 }],
    ['fill', `${ring(5.4, 5.4, 3)}${ring(18.6, 5.4, 3)}${ring(5.4, 18.6, 3)}${ring(18.6, 18.6, 3)}`],
    ['cutline', 'M12 2.6 15 7.6v9.8H9V7.6Z', { width: 1.4 }],
    ['fill', 'M12 2.6 15 7.6v9.8H9V7.6Z'],
    ['cut', 'M10.6 15.4h2.8v1.2h-2.8Z']
  ],
  'badge-attack-drone': [
    ['fill', 'M12 2.4c.8 0 1.4.8 1.6 2l.6 3.6 7.3 9.4v2.2l-7.3-1.6-.7 2.9h-3l-.7-2.9-7.3 1.6v-2.2L9.8 8l.6-3.6c.2-1.2.8-2 1.6-2Z'],
    ['fill', 'M2.5 15.4h1.3v4.4H2.5ZM20.2 15.4h1.3v4.4h-1.3Z'],
  ],
  'badge-helicopter': [
    ['line', 'M4 5.2h16.6', { width: 1.8 }],
    ['line', 'M14 5.2v3', { width: 1.8 }],
    ['fill', 'M10.6 8.4h4.4c2.9 0 5.2 2.3 5.2 5.2v.4c0 1.2-1 2.1-2.1 2.1h-7c-1.8 0-3-1-3.6-2.6L7 12.4 2.5 11.6V9.8l5.2.6c.6-1.2 1.6-2 2.9-2Z'],
    ['fill', 'M2 7.4h1.8v5.2H2Z'],
    ['cut', 'M16.2 9.8c1.5.4 2.4 1.4 2.8 2.8h-2.8Z'],
    ['line', 'M9.6 19h11M12 16.2V19M17.6 16.2V19', { width: 1.5 }],
  ],
  'badge-fighter': [
    ['fill', 'M12 2.2c.7 0 1.2 1.2 1.4 2.8l.4 4.3 7.7 6.2v2.1l-7.6-2.2-.3 2.3 2.8 2v1.6l-4.4-.8-4.4.8v-1.6l2.8-2-.3-2.3-7.6 2.2v-2.1l7.7-6.2.4-4.3C10.8 3.4 11.3 2.2 12 2.2Z'],
  ],
  'badge-plane': [
    ['fill', 'M12 2.4c.9 0 1.5 1 1.5 2.3v4.5l7.6 4.4v2.2l-7.6-2.3v4.1l2.3 1.8v1.7L12 20.2l-3.8.9v-1.7l2.3-1.8v-4.1l-7.6 2.3v-2.2l7.6-4.4V4.7c0-1.3.6-2.3 1.5-2.3Z'],
  ],
  'badge-warship': [
    ['fill', 'M1.8 14.2h20.4l-2.6 4.5c-.3.5-.8.8-1.3.8H5.4c-.6 0-1.1-.3-1.4-.8Z'],
    ['fill', 'M6.2 13.4v-2.9h2V7.8h3V5.4h1.7v2.4h1.6v2.7h2.4v2.9Z'],
    ['fill', 'M17.8 13.4v-1.6h1.8v1.6Z'],
    ['line', 'M19 12.2 21.6 11', { width: 1.2 }],
    ['line', 'M12 5.4V2.8', { width: 1.3 }],
  ],
  // Vehicles
  'badge-car': [
    ['fill', 'M2.5 16v-3.4c0-.8.5-1.5 1.3-1.7l2.8-.8 2.4-3.3c.4-.5 1-.8 1.6-.8h4.3c.6 0 1.2.3 1.6.8l2.6 3.3 2.2.6c.8.2 1.4 1 1.4 1.8V16Z'],
    ['cut', 'M10.4 7.7h1.9v2.9H8.4ZM13.8 7.7h.9c.3 0 .6.2.8.4l1.8 2.5h-3.5Z'],
    ['cutline', ring(6.8, 16.2, 3.1), { width: 1.4 }],
    ['cutline', ring(17.2, 16.2, 3.1), { width: 1.4 }],
    ['fill', ring(6.8, 16.2, 2.3)],
    ['fill', ring(17.2, 16.2, 2.3)],
  ],
  'badge-pickup': [
    ['fill', 'M2.4 16V11.6h8.2V7.9c0-.6.4-1 1-1h3.6c.4 0 .8.2 1 .5l2.6 3.6 2.1.5c.8.2 1.3.9 1.3 1.7V16Z'],
    ['cut', 'M12.3 8.5h2.6l2 2.8h-4.6Z'],
    ['cutline', ring(6.6, 16.2, 3.1), { width: 1.4 }],
    ['cutline', ring(17.4, 16.2, 3.1), { width: 1.4 }],
    ['fill', ring(6.6, 16.2, 2.3)],
    ['fill', ring(17.4, 16.2, 2.3)],
  ],
  'badge-truck': [
    ['fill', 'M2.6 5.6h11.2v10.8H2.6Z'],
    ['fill', 'M14.8 8.4h3.5c.5 0 .9.2 1.2.6l2 2.9c.2.3.3.6.3 1v3.5h-7Z'],
    ['cut', 'M16 9.7h2.1l1.6 2.4H16Z'],
    ...[6.2, 17.6].flatMap((x) => [['cutline', ring(x, 16.8, 3), { width: 1.4 }], ['fill', ring(x, 16.8, 2.2)]]),
  ],
  'badge-ambulance': [
    ['fill', 'M2.4 16V7.4c0-.8.7-1.5 1.5-1.5h10.6c.5 0 1 .3 1.3.7l3.3 4.5 1.8.5c.8.2 1.3.9 1.3 1.7V16Z'],
    ['cut', 'M15.2 7.6h.4l2.6 3.5h-3Z'],
    ['cut', 'M7.3 7.6h2.4v2.2h2.2v2.4H9.7v2.2H7.3v-2.2H5.1V9.8h2.2Z'],
    ...[6.6, 17.4].flatMap((x) => [['cutline', ring(x, 16.2, 3.1), { width: 1.4 }], ['fill', ring(x, 16.2, 2.3)]]),
  ],
  'badge-ship': [
    ['fill', 'M2.3 13.4h19.4l-2.4 5.1c-.3.6-.8.9-1.4.9H6.1c-.6 0-1.1-.3-1.4-.9Z'],
    ['fill', 'M4.4 12.4V8.6c0-.5.4-.9.9-.9h.9V5.1h2.2v2.6h.7c.5 0 .9.4.9.9v3.8Z'],
    ['fill', 'M10.8 12.4V9.2h3.6v3.2ZM15.6 12.4V9.2h3.6v3.2Z'],
  ],
  // Places
  'badge-house': [
    ['fill', 'M15.6 4.4h2.4v4.2l-2.4-2.1Z'],
    ['fill', 'M12 3.1 21.6 11.4h-2.8v8.8H5.2v-8.8H2.4Z'],
    ['cut', 'M10.3 14.6h3.4v5.6h-3.4Z'],
  ],
  'badge-building': [
    ['fill', 'M4.5 21V4.6c0-.6.4-1 1-1h8c.6 0 1 .4 1 1V8h4.5c.6 0 1 .4 1 1v12Z'],
    ['cut', 'M7 6.4h2.2v2.2H7ZM10.8 6.4H13v2.2h-2.2ZM7 10.2h2.2v2.2H7ZM10.8 10.2H13v2.2h-2.2ZM7 14h2.2v2.2H7ZM10.8 14H13v2.2h-2.2ZM16 11h2.2v2.2H16ZM16 14.8h2.2V17H16ZM8.6 18.2h2.8V21H8.6Z'],
  ],
  'badge-high-rise': [
    ['fill', 'M6.6 2.6h10.8v18.6H6.6Z'],
    ['cut', [8.3, 11.1, 13.9].flatMap((x) => [4.6, 7.8, 11, 14.2].map((y) => `M${x} ${y}h1.8v1.8h-1.8Z`)).join('') + 'M10.8 18h2.4v3.2h-2.4Z'],
  ],
  'badge-factory': [
    ['fill', 'M3.4 20.2V10.8l4.6 3v-3l4.6 3v-3l3.2 2.1V3.4h3.2v16.8Z'],
    ['cut', 'M5.4 16.2h2v2h-2ZM9.2 16.2h2v2h-2ZM13 16.2h2v2h-2Z'],
  ],
  'badge-hospital': [
    ['fill', 'M6 4.4h12c.9 0 1.6.7 1.6 1.6v12c0 .9-.7 1.6-1.6 1.6H6c-.9 0-1.6-.7-1.6-1.6V6c0-.9.7-1.6 1.6-1.6Z'],
    ['cut', 'M10.3 7.3h3.4v3h3v3.4h-3v3h-3.4v-3h-3v-3.4h3Z'],
  ],
  'badge-camp': [
    ['fill', 'M12 4 20.8 19.8H3.2Z'],
    ['cut', 'M12 11.6 15.4 19.8H8.6Z'],
    ['line', 'M10.2 3 12 5.4 13.8 3', { width: 1.4 }],
    ['line', 'M2.4 20.6h19.2', { width: 1.5 }],
  ],
  'badge-airfield': [
    ['fill', 'M8 2.6h8v1.8H8Z'],
    ['fill', 'M5.8 4.4h12.4l-1.8 5.6H7.6Z'],
    ['cut', 'M7.6 5.8h8.8l-.8 2.6H8.4Z'],
    ['fill', 'M10 10h4v10.2h-4Z'],
    ['fill', 'M6.4 20.2h11.2v1.4H6.4Z'],
  ],
  'badge-harbour': [
    ['line', ring(12, 4.8, 1.9), { width: 1.9 }],
    ['line', 'M12 6.9v13.6M8 10.2h8', { width: 2.2 }],
    ['line', 'M4.8 13.6c.6 4 3.5 6.9 7.2 6.9s6.6-2.9 7.2-6.9', { width: 2.2 }],
    ['fill', 'M2.6 14.8l2.1-3.6 2.4 3.2ZM21.4 14.8l-2.1-3.6-2.4 3.2Z'],
  ],
  'badge-railway': [
    ['fill', 'M7.6 2.6h8.8c1.9 0 3.5 1.6 3.5 3.5v9.2c0 1.4-1.1 2.5-2.5 2.5H6.6c-1.4 0-2.5-1.1-2.5-2.5V6.1c0-1.9 1.6-3.5 3.5-3.5Z'],
    ['cut', 'M6.6 5.4h10.8v4.8H6.6Z'],
    ['cut', `${ring(8, 14.2, 1.3)}${ring(16, 14.2, 1.3)}`],
    ['fill', 'M7.6 18.4h2.4l-1.8 3.2H5.8ZM14 18.4h2.4l1.8 3.2h-2.4Z'],
  ],
  'badge-bridge': [
    ['fill', 'M2 9.6h20v2.2H2Z'],
    ['fill', 'M3 12.6h18v7.4h-2.6c0-3.6-2.9-6.5-6.4-6.5S5.6 16.4 5.6 20H3Z'],
    ['line', 'M3.4 9.6V6.8M8.4 9.6V6.8M13.4 9.6V6.8M18.4 9.6V6.8M2.4 6.6h19.2', { width: 1.4 }],
  ],
  'badge-fuel-depot': [
    ['fill', 'M3.2 9.4c0-1.3 2.6-2.2 5.6-2.2s5.6.9 5.6 2.2v10c0 .5-2.6 1.1-5.6 1.1s-5.6-.6-5.6-1.1Z'],
    ['fill', 'M15.6 12c0-.9 1.5-1.5 2.6-1.5s2.6.6 2.6 1.5v7.4c0 .5-1.5.9-2.6.9s-2.6-.4-2.6-.9Z'],
    ['cut', 'M8.8 10.8c1.4 1.8 2.3 3 2.3 4.4a2.3 2.3 0 0 1-4.6 0c0-1.4.9-2.6 2.3-4.4Z'],
  ],
  'badge-power-station': [
    ['fill', 'M3.8 7.4h6.6c-.5 2.3-.6 4.5-.1 6.6.4 1.8 1 3.7 1.2 6.2H2.8c.2-2.5.8-4.4 1.2-6.2.5-2.1.4-4.3-.2-6.6Z'],
    ['fill', 'M12.2 11.2h8.6v9H12.2Z'],
    ['cut', 'M17.5 12.6l-3 3.9h2.1l-1.2 2.6 3.3-3.9h-2.1Z'],
    ['fill', `${ring(6.2, 4.6, 1.3)}${ring(8.8, 3.6, 1)}`],
  ],
  'badge-power-pylon': [
    ['fill', 'M10.7 2.4h2.6l5.2 19.2h-2.6l-1.1-4.3h-5.6l-1.1 4.3H5.5Z'],
    ['fill', 'M4.3 6.2h15.4V8H4.3ZM2.8 10.4h18.4v1.8H2.8Z'],
    ['cut', 'M12 12.9l1.5 3h-3Z'],
    ['line', 'M4.6 8.6v1.4M19.4 8.6v1.4M3.4 12.8v1.4M20.6 12.8v1.4', { width: 1.4 }],
  ],
  'badge-telecom-antenna': [
    ['fill', 'M11 9.4h2l4.3 12.2h-2.4l-1.4-4.2h-3l-1.4 4.2H6.7Z'],
    ['fill', ring(12, 7, 2)],
    ['line', 'M8 3.6a5 5 0 0 0 0 6.8M16 3.6a5 5 0 0 1 0 6.8', { width: 1.9 }],
  ],
  'badge-radar': [
    ['line', ring(12, 12, 8.4)],
    ['fill', 'M12 12V5.1a6.9 6.9 0 0 1 6 3.5Z'],
    ['fill', ring(12, 12, 1.8)],
    ['fill', ring(8.3, 15.2, 1.4)],
    ['fill', ring(15.6, 15.8, 1.1)],
  ],
  'badge-radar-antenna': [
    ['fill', 'M3.4 9.2A9.2 9.2 0 0 0 14.8 20.6L16.4 18.4A6.6 6.6 0 0 1 5.6 7.6Z'],
    ['line', 'M10 14 16.2 7.8', { width: 1.8 }],
    ['fill', ring(17.2, 6.8, 1.9)],
    ['fill', 'M9.8 16.4h2.4l1.6 2.8h3v2.2H6.4v-2.2h3.4Z']
  ],
  'badge-checkpoint': [
    ['fill', 'M3.2 6.2h6.6v1.6H3.2ZM3.8 7.8h5.4v13H3.8Z'],
    ['cut', 'M5 9.6h3v2.6H5Z'],
    ['fill', 'M9.8 12.2h11.6v2.6H9.8Z'],
    ['cut', 'M12.4 12.2h1.9l-1.3 2.6h-1.9ZM16.2 12.2h1.9l-1.3 2.6h-1.9ZM20 12.2h1.4v.4l-1.1 2.2h-1.6Z'],
  ],
  'badge-roadblock': [
    ['fill', 'M5.4 13h2.2l-1.5 8.2H3.9ZM16.4 13h2.2l1.5 8.2h-2.2Z'],
    ['fill', 'M2.6 7.4h18.8v5.6H2.6Z'],
    ['cut', 'M4.6 13 8.2 7.4h2.6L7.2 13ZM10 13l3.6-5.6h2.6L12.6 13ZM15.4 13 19 7.4h2.4v.4L18 13Z'],
    ['fill', ring(12, 4.4, 1.6)],
  ],
  'badge-trench': [
    ['line', 'M2.2 10.2h3.6v5.6h4.2v-5.6h4v5.6h4.2v-5.6h3.6', { width: 2.9 }]
  ],
  'badge-bunker': [
    ['fill', 'M3.2 19.4v-4c0-5.1 3.9-8.8 8.8-8.8s8.8 3.7 8.8 8.8v4Z'],
    ['cut', 'M7.4 12.6h9.2v2.2H7.4Z'],
    ['line', 'M2.2 20.6h19.6', { width: 1.6 }],
  ],
};

export function isBadge(symbol) {
  return Object.hasOwn(BADGE_GLYPHS, symbol);
}

/**
 * Every shape a marker is made of, in drawing order, each with the box it is
 * drawn in. A symbol that is not a badge is a plain marker, and an unknown one
 * falls back to the pin.
 */
export function markerParts(symbol, colour, { status = '', external = false } = {}) {
  const layers = BADGE_GLYPHS[symbol];
  const dash = external ? DASH : null;
  if (!layers) {
    const shape = paths[PLAIN.has(symbol) ? symbol : 'pin'];
    return [
      { d: shape, stroke: '#fff', width: 4, dash: external ? [2.2, 1.5] : null, ...PLAIN_BOX },
      { d: shape, fill: PLAIN.has(symbol) && symbol !== 'pin' ? colour : null, stroke: colour, width: 2.4, ...PLAIN_BOX },
      ...statusParts(status, ACROSS.plain),
    ];
  }
  // White on a strong disc, dark on a pale one, as the proof stamps do.
  const ink = glyphInk(colour, 1);
  return [
    ...discGround(colour, dash),
    ...layers.map(([mode, d, { width, rotate = 0 } = {}]) => {
      const paint = mode === 'fill' || mode === 'line' ? ink : colour;
      const solid = mode === 'fill' || mode === 'cut';
      return { d, fill: solid ? paint : null, stroke: solid ? null : paint,
        width: width ?? (mode === 'line' ? LINE : CUT), rotate, ...GLYPH_BOX };
    }),
    ...statusParts(status, ACROSS.badge),
  ];
}

/** The coloured disc a badge's glyph sits on, ringed white, haloed dark. */
function discGround(colour, dash = null) {
  return [
    { d: ring(CENTRE, CENTRE, DISC + 1.6), fill: HALO, ...IMAGE_BOX },
    { d: ring(CENTRE, CENTRE, DISC), fill: colour, stroke: '#fff', width: 2.5, dash, ...IMAGE_BOX },
  ];
}

/**
 * An own icon's marker without its picture, for an SVG preview to slot the image
 * into: `under` it the disc (none drawn as it is), `over` it the status strokes,
 * and the dashed ring an external point drawn as it is wears instead of a rim.
 */
export function ownParts(colour, { mode = 'image', status = '', external = false } = {}) {
  const disc = mode === 'disc';
  return {
    under: disc ? discGround(colour, external ? DASH : null) : [],
    over: [
      ...(!disc && external ? [{ d: ring(CENTRE, CENTRE, DISC), stroke: '#fff', width: 2.5, dash: DASH, ...IMAGE_BOX }] : []),
      ...statusParts(status, ACROSS.badge),
    ],
  };
}

/** Where an own icon's glyph sits in a disc: its painted part fitted to this square, centred. */
export const OWN_GLYPH = 36;
/** A picture drawn as it is, at the share of a badge's scale the source layers' icons are drawn at. */
export const OWN_IMAGE_RATIO = 0.7;

/** The side of the image an own icon is drawn into, in marker pixels before `scale`. */
export function ownMarkerSide(image, mode) {
  if (mode === 'disc') return MARKER_PIXELS;
  const side = Math.max(image?.width || 0, image?.height || 0) * OWN_IMAGE_RATIO;
  return Math.max(MARKER_PIXELS, Math.ceil(side / 2) * 2);
}

/**
 * Draws a marker wearing an own icon into a context `ownMarkerSide` × `scale`
 * wide. `box` is the part of `image` that is painted (`inkBox`); `make(w, h)`
 * gives the scratch canvas a disc's glyph is inked on.
 */
export function drawOwnMarker(context, image, colour, { mode = 'image', status = '', external = false, box = null } = {},
  scale = 1, make = scratchCanvas) {
  const side = ownMarkerSide(image, mode);
  const offset = (side - MARKER_PIXELS) / 2;
  const ink = box ?? { x: 0, y: 0, w: image.width, h: image.height };
  context.clearRect(0, 0, side * scale, side * scale);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  const { under, over } = ownParts(colour, { mode, status, external });
  for (const part of under) paintPart(context, part, scale, offset);
  if (mode === 'disc') {
    // the silhouette, fitted and centred, then painted over in the glyph's ink
    const fit = (OWN_GLYPH / Math.max(ink.w, ink.h, 1)) * scale;
    const width = Math.ceil(MARKER_PIXELS * scale);
    const glyph = make(width, width);
    const inked = glyph?.getContext?.('2d');
    if (inked) {
      inked.drawImage(image, ink.x, ink.y, ink.w, ink.h,
        (width - ink.w * fit) / 2, (width - ink.h * fit) / 2, ink.w * fit, ink.h * fit);
      inked.globalCompositeOperation = 'source-in';
      inked.fillStyle = glyphInk(colour, 1);
      inked.fillRect(0, 0, width, width);
      context.drawImage(glyph, 0, 0);
    }
  } else {
    // as it is, centred as the source laid it out, so a pin's tip stays on its point
    const fit = OWN_IMAGE_RATIO * scale;
    const middle = (side * scale) / 2;
    context.drawImage(image, middle - (image.width * fit) / 2, middle - (image.height * fit) / 2,
      image.width * fit, image.height * fit);
  }
  for (const part of over) paintPart(context, part, scale, offset);
  context.setTransform(1, 0, 0, 1, 0, 0);
}

function scratchCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}

/**
 * The box `image` paints in, `{ x, y, w, h }` in its own pixels: what a disc
 * fits, so a layer icon padded to centre its tip is not shrunk by its padding.
 * The whole image when its pixels cannot be read.
 */
export function inkBox(image, make = scratchCanvas) {
  const whole = { x: 0, y: 0, w: image?.width || 1, h: image?.height || 1 };
  const canvas = make(whole.w, whole.h);
  const context = canvas?.getContext?.('2d', { willReadFrequently: true });
  if (!context?.getImageData) return whole;
  try {
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, whole.w, whole.h);
    let left = whole.w, top = whole.h, right = -1, bottom = -1;
    for (let y = 0; y < whole.h; y++) {
      for (let x = 0; x < whole.w; x++) {
        if (data[(y * whole.w + x) * 4 + 3] <= 8) continue;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    return right < 0 ? whole : { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
  } catch {
    return whole;
  }
}

/** The stroke a damaged marker wears, two for a destroyed one, each on a dark bed. */
function statusParts(status, [x, y, reach]) {
  const strokes = status === 'destroyed'
    ? [`M${x - reach} ${y + reach}L${x + reach} ${y - reach}`, `M${x - reach} ${y - reach}L${x + reach} ${y + reach}`]
    : status === 'damaged' ? [`M${x - reach} ${y + reach}L${x + reach} ${y - reach}`] : [];
  return strokes.flatMap((d) => [
    { d, stroke: 'rgba(0, 0, 0, 0.55)', width: 7.5, ...IMAGE_BOX },
    { d, stroke: '#fff', width: 4.2, ...IMAGE_BOX },
  ]);
}

/** The SVG transform that places a part, for the picker's previews. */
export function partTransform(part) {
  const turn = part.rotate ? ` rotate(${part.rotate} 12 12)` : '';
  return `translate(${part.offset} ${part.offset}) scale(${part.scale})${turn}`;
}

/** Draws a marker into a 2D context the size of `MARKER_PIXELS`, or `scale` times it for a larger print. */
export function drawMarker(context, symbol, colour, marks = {}, scale = 1) {
  context.clearRect(0, 0, MARKER_PIXELS * scale, MARKER_PIXELS * scale);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  for (const part of markerParts(symbol, colour, marks)) paintPart(context, part, scale);
  context.setTransform(1, 0, 0, 1, 0, 0);
}

/** One part of a marker, `shift` marker pixels in from the top left of a larger image. */
function paintPart(context, part, scale, shift = 0) {
  context.setTransform(part.scale * scale, 0, 0, part.scale * scale, (part.offset + shift) * scale, (part.offset + shift) * scale);
  if (part.rotate) {
    context.translate(12, 12);
    context.rotate((part.rotate * Math.PI) / 180);
    context.translate(-12, -12);
  }
  const path = new Path2D(part.d);
  if (part.fill) { context.fillStyle = part.fill; context.fill(path); }
  if (part.stroke) {
    context.strokeStyle = part.stroke; context.lineWidth = part.width;
    context.setLineDash?.(part.dash ?? []);
    context.stroke(path);
    context.setLineDash?.([]);
  }
}
