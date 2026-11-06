/**
 * What Horizon puts in a pinned note: an area dragged over the view, filed once in the
 * case under the saved view. With a photo laid it is the photo above the terrain it was
 * matched on; without one it is the view alone, with its names, ruler and credits. Find's
 * score and ranking are never put anywhere: Find leads to a view, and the proof is the
 * picture after a person checked it.
 */
import { picturePut } from '../../lib/notes/syntax.js';

/** What the view's hint says while an area is dragged for a note. */
export const NOTE_AREA_HINT = 'Drag a box over the view to put it in the note · Esc to cancel';

/** A number kept to two places, so the same area read twice gives the same key. */
const settled = (value) => (Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) / 100 : null);

/**
 * What tells one area of a view from another for the server's once-per-state rule: the
 * box dragged (CSS pixels) and where it faced, the loupe included. Two areas of the same
 * size elsewhere on the screen are two pictures.
 */
export function areaKey(area, lens = {}) {
  return JSON.stringify({
    x: Math.round(area.x), y: Math.round(area.y), width: Math.round(area.width), height: Math.round(area.height),
    heading: settled(lens?.heading), tilt: settled(lens?.tilt), fov: settled(lens?.fov),
  });
}

/**
 * An area of the view, offered to a pinned note whenever an eye stands. `keep({ signal })`
 * has the area dragged, saves the view when it is not saved, draws the area and files it
 * under the view (or finds it filed in this very state), answering `{ entity, label, fresh }`.
 * `photo()` says whether a photo is laid, which makes the area a pair; `unsaved()` whether
 * the view will be saved first.
 */
export function areaOffer({ keep, photo = () => false, unsaved = () => false }) {
  return {
    id: 'area',
    get label() {
      return photo() ? 'An area of the photo above the terrain' : 'An area of the view';
    },
    get hint() {
      const saving = unsaved() ? 'the view is saved, then ' : '';
      return photo()
        ? `Drag over the view: ${saving}both pictures of the area one above the other, the ridge lines on both`
        : `Drag over the view: ${saving}the area with its names, ruler and credits`;
    },
    icon: 'horizon',
    picture: true,
    busy: 'Drag over the view for the area to put in. Esc cancels',
    put: async ({ signal } = {}) => {
      const { entity, label, fresh } = await keep({ signal });
      if (!entity?.id) throw new Error('The area could not be kept in the case');
      return { text: picturePut(entity, { label, width: '100%' }), filed: fresh ? [entity.id] : [] };
    },
  };
}
