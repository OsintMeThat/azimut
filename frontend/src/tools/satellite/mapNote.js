/**
 * What the Map puts in a pinned note: the view as a filed capture, a point as
 * coordinates, and the measure in hand as the text its Copy gives.
 *
 * A view is a capture like any other, filed through the capture path and
 * credited from what it recorded (provider, imagery date, centre, zoom). The
 * same view put in twice is the same capture, found by its state rather than
 * filed again. A point and a measure are text: nothing is filed for them.
 */
import { entityReference } from '../../lib/markdown.js';
import { picturePut, pointText } from '../../lib/notes/syntax.js';
import { sizeWidth } from '../../lib/notes/pictureSize.js';

/** Half the page across, or less for a tall frame. */
export function viewWidth(width, height) {
  return sizeWidth(1 / 2, width > 0 && height > 0 ? height / width : 0);
}

/**
 * The map view offered to a pinned note. `take()` files the view (or finds it
 * filed in this very state) and answers `{ entity, fresh, width, height }`;
 * `label()` names it in the note: the saved place it shows, else its record's own.
 */
export function viewOffer({ take, label = () => '' }) {
  return {
    id: 'view',
    label: 'This view',
    hint: 'Captured and filed in the case, once for the same view',
    icon: 'camera',
    picture: true,
    busy: 'Capturing the view…',
    put: async () => {
      const named = label();
      const { entity, fresh, width, height } = await take();
      if (!entity?.id) throw new Error('The view could not be captured');
      return { text: picturePut(entity, { label: named, width: viewWidth(width, height) }), filed: fresh ? [entity.id] : [] };
    },
  };
}

/**
 * A point as the note writes it: the saved place's chip and its coordinates when
 * one is open, else the coordinates alone, to five places.
 */
export function pointNoteText({ place = null, lat, lon } = {}) {
  if (place?.id) {
    const at = pointText(place.attrs?.lat ?? place.lat, place.attrs?.lon ?? place.lon);
    return [entityReference(place), at].filter(Boolean).join(' ');
  }
  return pointText(lat, lon);
}

/** A point offered to a pinned note. `point()` answers `{ place?, lat, lon }`. */
export function pointOffer({ point, id = 'point', label = 'This point' }) {
  return {
    id,
    label,
    hint: 'Its coordinates, which the note opens on the map',
    icon: 'pin',
    put: async () => {
      const text = pointNoteText(point() ?? {});
      if (!text) throw new Error('No point to put in');
      return { text, inline: true };
    },
  };
}

/** What a measure reads on, said once beside it, from what the Measure panel says. */
const ASSUMES = {
  shadow: 'Assumes level ground seen from overhead.',
  viewshed: 'Bare ground: buildings and trees are not in the heights.',
  ground: 'Bare ground: buildings and trees are not in the heights.',
};

/**
 * A measure as the note writes it: the lines its Copy gives, then what it
 * assumes, and for a shadow the day it was read for, each on its own line.
 */
export function measureNoteText({ text = '', use = '', ground = false, shadowDate = '' } = {}) {
  const lines = String(text ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return '';
  if (use === 'shadow' && shadowDate) lines.push(`Sun read for ${shadowDate}.`);
  const assumes = ASSUMES[use] ?? (ground ? ASSUMES.ground : '');
  if (assumes) lines.push(assumes);
  return lines.map((line) => `- ${line}`).join('\n');
}

/** The measure in hand offered to a pinned note. `measure()` answers what `measureNoteText` reads, or null. */
export function measureOffer({ measure }) {
  return {
    id: 'measure',
    label: 'This measure',
    hint: 'What it reads, with its points and what it assumes',
    icon: 'ruler',
    put: async () => {
      const text = measureNoteText(measure() ?? {});
      if (!text) throw new Error('Draw a measure first');
      return { text };
    },
  };
}
