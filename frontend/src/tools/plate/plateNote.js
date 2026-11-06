/**
 * What a Map plate puts in a pinned note: its page at print resolution, or the
 * page on each of its days side by side, filed in the case as an ordinary picture
 * (`POST /map-plates/{name}/figure`). The plate's face carries its credits; the
 * picture records which plate, day and step it shows, so the note can open it there.
 *
 * Side by side, never a video: a PDF prints the first frame of a GIF, which is the
 * first day alone, so the days that replace it are one still.
 */
import { momentLabel } from '../../lib/map/layerHistory.js';
import { picturePut } from '../../lib/notes/syntax.js';
import { sizeWidth } from '../../lib/notes/pictureSize.js';

/** The most days one sheet holds: past it the cells are too small to read in a report. */
export const SHEET_DAYS = 12;

/**
 * The most pixels a page filed for a note holds: the server's bound on a page
 * (`engine/mapplates.MAX_PAGE_PIXELS`) less a margin, so a large paper is drawn a little
 * coarser than 300 dpi rather than refused.
 */
export const MAX_FIGURE_PIXELS = 36_000_000;

/** Canvas pixels a millimetre for a page of `widthMm` by `heightMm`: `wanted`, held under what a figure may hold. */
export function figureScale(widthMm, heightMm, wanted) {
  return Math.min(wanted, Math.sqrt(MAX_FIGURE_PIXELS / (widthMm * heightMm)));
}

/** A day as a file name carries it: `2 Mar 2026 10h00`, with no colon. */
const dayWords = (day) => momentLabel(day).replace(' · ', ' ').replace(':', 'h');

/** What a figure is called in the case: the plate, then the day and the step, or what the sheet is. */
export function figureName({ title = '', day = '', step = '', sheet = false } = {}) {
  const parts = [String(title ?? '').trim() || 'Map plate'];
  if (sheet) parts.push('days side by side');
  else {
    if (day) parts.push(dayWords(day));
    if (String(step ?? '').trim()) parts.push(String(step).trim());
  }
  return parts.join(', ');
}

/** The credits the plate's face carries, one line: its credits boxes' words, each said once. */
export function faceCredits(words = {}, fallback = '') {
  const said = [...new Set(Object.values(words ?? {}).map((text) => String(text ?? '').trim()).filter(Boolean))];
  return (said.length ? said.join(' · ') : String(fallback ?? '')).trim();
}

/** Why a sheet cannot be made of these days, or ''. */
export function sheetRefusal(days) {
  if (days < 2) return 'A sheet needs a plate that plays two days or more';
  if (days > SHEET_DAYS) return `A sheet holds ${SHEET_DAYS} days at most and this plate plays ${days}. Skip some days first`;
  return '';
}

/**
 * The plate's page offered to a pinned note. `keep({ signal })` draws it, files it
 * (or finds it filed in this very state) and answers `{ entity, label, fresh, width, height }`.
 */
export function pageOffer({ keep }) {
  return {
    id: 'plate-page',
    label: 'This page',
    hint: 'At print resolution, filed in the case once for the same page',
    icon: 'plate',
    picture: true,
    busy: 'Drawing the page…',
    put: async ({ signal } = {}) => {
      const { entity, label, fresh, width, height } = await keep({ signal });
      if (!entity?.id) throw new Error('The page could not be filed in the case');
      return { text: picturePut(entity, { label, width: sizeWidth(1, width > 0 && height > 0 ? height / width : 0) }), filed: fresh ? [entity.id] : [] };
    },
  };
}

/** The plate's days side by side, offered to a pinned note; `keep` answers what `pageOffer`'s does. */
export function sheetOffer({ keep }) {
  return {
    id: 'plate-sheet',
    label: 'The days side by side',
    hint: 'One still that replaces the video in a PDF',
    icon: 'columns',
    picture: true,
    busy: 'Drawing the days…',
    put: async ({ signal } = {}) => {
      const { entity, label, fresh } = await keep({ signal });
      if (!entity?.id) throw new Error('The sheet could not be filed in the case');
      return { text: picturePut(entity, { label, width: '100%' }), filed: fresh ? [entity.id] : [] };
    },
  };
}
