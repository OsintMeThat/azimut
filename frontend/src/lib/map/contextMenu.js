/**
 * What a right-click on the ground offers, and where the menu opens.
 *
 * The menu answers for the point under the cursor rather than the map centre,
 * which is the whole reason for it: every act here already exists somewhere
 * (the status line copies the centre, the Saved panel links out from it, the
 * rail arms the measure), but each one first asks the analyst to pan the point
 * to the middle. Here the point is wherever they clicked.
 *
 * Only the list and the placement are here, so both are read off a test
 * (`contextMenu.test.js`); the acts themselves are the tool's.
 */
import { COORD_FORMATS, formatCoords } from '../coords.js';
import { mapLinks } from '../maplinks.js';

const FORMAT_LABELS = { dd: 'DD', dms: 'DMS', mgrs: 'MGRS' };

/**
 * The coordinates of a point in every format the app writes, the analyst's own
 * first. A format that cannot state the point (MGRS past the poles) is left out
 * rather than offered as a copy of something else.
 */
export function copyRows(lat, lon, preferred = 'dd') {
  const order = [preferred, ...COORD_FORMATS.filter((format) => format !== preferred)];
  const rows = [];
  for (const format of order) {
    if (!COORD_FORMATS.includes(format)) continue;
    const text = formatCoords(lat, lon, format);
    if (!text || rows.some((row) => row.text === text)) continue;
    rows.push({ id: `copy-${format}`, format: FORMAT_LABELS[format], text });
  }
  return rows;
}

/** The acts on the point, in the order an analyst reaches for them. */
export const ACTIONS = [
  { id: 'lookup', label: 'What is here?', icon: 'search' },
  { id: 'place', label: 'Save place here…', icon: 'pin' },
  { id: 'measure', label: 'Measure from here', icon: 'ruler' },
  { id: 'sky', label: 'Sun and moon from here', icon: 'sun' },
  { id: 'history', label: 'Imagery history here', icon: 'clock' },
  { id: 'centre', label: 'Centre the map here', icon: 'crosshair' },
];

/**
 * The acts a tool can actually perform, in the order above.
 *
 * Satellite offers all of them; Compare has no sun panel and no measure rail,
 * so it asks for the subset it can honour rather than showing rows that do
 * nothing. The order stays the list's, not the caller's, so the menu reads the
 * same wherever it opens.
 */
export function actionsFor(ids) {
  return ACTIONS.filter((action) => ids.includes(action.id));
}

/** The external maps, opened on the clicked point at the current zoom. */
export function openRows(lat, lon, zoom) {
  const round = (value) => Number(value.toFixed(6));
  return mapLinks(round(lat), round(lon), zoom);
}

/**
 * Where the menu's top-left corner goes, inside the map.
 *
 * It opens down and to the right of the cursor, and flips to the other side of
 * the cursor on whichever axis would run past the map's edge, then clamps, so a
 * right-click in a corner still shows every row.
 */
export function placeMenu(point, menu, frame, margin = 8) {
  let left = point.x;
  let top = point.y;
  if (left + menu.width + margin > frame.width) left = point.x - menu.width;
  if (top + menu.height + margin > frame.height) top = point.y - menu.height;
  left = Math.max(margin, Math.min(left, frame.width - menu.width - margin));
  top = Math.max(margin, Math.min(top, frame.height - menu.height - margin));
  return { left: Math.round(left), top: Math.round(top) };
}

/**
 * The row focus moves to with an arrow key, wrapping at either end, skipping
 * rows that are disabled.
 */
export function nextFocus(count, current, direction, disabled = () => false) {
  if (!count) return -1;
  for (let step = 1; step <= count; step += 1) {
    const index = (((current + direction * step) % count) + count) % count;
    if (!disabled(index)) return index;
  }
  return -1;
}
