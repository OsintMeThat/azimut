/**
 * Inspect's frame and Collage's picture as they go into a note.
 *
 * Both are case files once saved, so a note cites the file itself: the frame
 * saved by Save to case, labelled with the instant it was cut at, the collage
 * by its own name. What was done to the pixels (cropped, brightened,
 * straightened) is credited from the file's record, never written here.
 */
import { picturePut } from '../../lib/notes/syntax.js';
import { sizeWidth } from '../../lib/notes/pictureSize.js';

/** `00:12.480`, or `1:02:03.456` past the hour: the instant a frame was cut at. */
export function frameClock(seconds) {
  const ms = Math.round(Math.max(0, Number(seconds) || 0) * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = `${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${String(m).padStart(2, '0')}:${rest}`;
}

/** What a frame is called in the note: the instant of a video's, the saved name of an edited image. */
export function frameLabel(frame, name = '') {
  return frame?.time != null ? `Frame at ${frameClock(frame.time)}` : String(name || 'Frame');
}

/** Half the page across, or less for a tall frame, so a phone video's frame is not a page high. */
export function frameWidth(frame) {
  const ratio = frame?.w > 0 && frame?.h > 0 ? frame.h / frame.w : 0;
  return sizeWidth(1 / 2, ratio);
}

/**
 * The frame open in Inspect, offered to a pinned note. `file()` answers the
 * frame's record and whether it was filed just now for the note (`{ entity,
 * fresh }`): a frame already saved and unchanged is cited as it is.
 */
export function frameOffer({ frame, name = () => '', file }) {
  return {
    id: 'frame',
    label: 'This frame',
    hint: 'Saved to the case first, if it is not',
    icon: 'camera',
    picture: true,
    put: async ({ signal } = {}) => {
      // Read before the save: the frame on screen may change while it runs.
      const shown = frame();
      if (!shown) throw new Error('No frame is open');
      const label = frameLabel(shown, name(shown));
      const width = frameWidth(shown);
      const { entity, fresh } = await file(shown, { signal });
      if (!entity?.id) throw new Error('The frame could not be saved');
      return { text: picturePut(entity, { label, width }), filed: fresh ? [entity.id] : [] };
    },
  };
}

/** The collage on screen, offered to a pinned note: saved to the case first, as Save to case does. */
export function collageOffer({ title, file }) {
  return {
    id: 'collage',
    label: 'This collage',
    hint: 'Saved to the case first, if it is not',
    icon: 'grid',
    picture: true,
    put: async ({ signal } = {}) => {
      const label = String(title() || 'Collage');
      const { entity, fresh } = await file({ signal });
      if (!entity?.id) throw new Error('The collage could not be saved');
      return { text: picturePut(entity, { label, width: '100%' }), filed: fresh ? [entity.id] : [] };
    },
  };
}
