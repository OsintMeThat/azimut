/**
 * A Graph or a Timeline reading as a picture for a note: its plate (what the reading
 * looks like with its lens, window, clock and legend) filed as a PNG in the case, with the
 * snapshot that freezes it. The picture names the snapshot, so the note can open the exact
 * reading; the same reading and size are one picture (`POST /analysis-views/figure`).
 *
 * Only the picture's plate goes in, as a raster at print scale: an SVG is for a file, and
 * a PDF reads a PNG.
 */
import { api } from '../api.js';
import { plateToPng } from '../plateExport.js';
import { sizeWidth } from './pictureSize.js';
import { picturePut } from './syntax.js';

/** The longest a snapshot made for a note is named: the views' own limit, less room for a suffix. */
const NAME_MAX = 76;

/** What a snapshot made to be cited is called: the tool, then what the reading holds. */
export function readingName(tool, said = '') {
  const words = String(said ?? '').replace(/\s+/g, ' ').trim();
  return (words ? `${tool}, ${words}` : tool).slice(0, NAME_MAX).trim();
}

/**
 * File the plate on screen. `spec` is the reading's recipe (`captureAnalysisView`), frozen
 * by the server into a snapshot unless `viewId` names one already open. Answers
 * `{ entity, view, fresh }`.
 */
export async function fileReading({ caseId, surface, name, spec, plate, viewId = null, signal = undefined, post = api.post, toPng = plateToPng }) {
  const png = await toPng(plate.svg, { width: plate.width, height: plate.height });
  const filed = await post(`/api/cases/${caseId}/analysis-views/figure`, {
    name, surface, spec, png, filename: plate.filename, ...(viewId ? { view_id: viewId } : {}),
  }, signal ? { signal } : undefined);
  return { entity: { id: filed.entity }, view: filed.view, fresh: !filed.reused };
}

/**
 * The reading on screen offered to a pinned note as a picture. `keep({ signal })` files it
 * and answers `{ entity, label, fresh, width, height }`.
 */
export function readingOffer({ label, hint, keep }) {
  return {
    id: 'figure',
    label,
    hint,
    icon: 'camera',
    picture: true,
    busy: 'Drawing the reading…',
    put: async ({ signal } = {}) => {
      const { entity, label: named, fresh, width, height } = await keep({ signal });
      if (!entity?.id) throw new Error('The picture could not be filed in the case');
      const ratio = width > 0 && height > 0 ? height / width : 0;
      return { text: picturePut(entity, { label: named, width: sizeWidth(1, ratio) }), filed: fresh ? [entity.id] : [] };
    },
  };
}
