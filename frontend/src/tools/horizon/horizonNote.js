/**
 * What Horizon puts in a pinned note: an area of the photo above the terrain it was
 * matched on, dragged over the view and filed once in the case under the saved view,
 * and the viewpoint as text, the conclusion of a skyline match. Find's score and ranking are never put anywhere: Find
 * leads to a view, and the proof is the matched pair after a person checked it.
 */
import { windOf } from '../../lib/horizon/geometry.js';
import { pointText, picturePut } from '../../lib/notes/syntax.js';

/** A number as a line says it: one decimal at most, no trailing zero. */
const trimmed = (value) => String(Number(Number(value).toFixed(1)));

/** The ground a view's relief was read from, as the saved view recorded it: the credits' labels, each once. */
export function reliefSources(panorama) {
  const labels = (panorama?.credits ?? []).map((credit) => String(credit?.label ?? '').trim()).filter(Boolean);
  return [...new Set(labels)];
}

/**
 * The viewpoint as the note writes it: the eye (coordinates, how it stands, how high),
 * where it looks and through what lens, and where the relief came from, each on its own line.
 */
export function viewpointText({ observer, camera = null, panorama = null } = {}) {
  const at = observer ? pointText(observer.lat, observer.lon) : '';
  if (!at) return '';
  const who = { ground: 'on foot', drone: 'drone', aircraft: 'aircraft' }[observer.mode] ?? observer.mode;
  const aircraft = observer.mode === 'aircraft';
  const height = Number.isFinite(Number(observer.height))
    ? `, ${aircraft ? `${Math.round(observer.height)} m above the sea` : `${trimmed(observer.height)} m above the ground`}` : '';
  const altitude = Number(panorama?.observer?.altitude);
  const sea = !aircraft && Number.isFinite(altitude) ? ` (${Math.round(altitude)} m above the sea)` : '';
  const lines = [`Eye: ${at}, ${who}${height}${sea}`];
  if (camera && Number.isFinite(Number(camera.heading))) {
    const turn = ((Math.round(camera.heading) % 360) + 360) % 360;
    const lens = Number.isFinite(Number(camera.fov))
      ? camera.projection === 'panorama' ? `, ${Math.round(camera.fov)}° across` : `, field of view ${trimmed(camera.fov)}°` : '';
    lines.push(`Looking: ${turn}° ${windOf(turn)}${lens}`);
  }
  const relief = reliefSources(panorama);
  if (relief.length) {
    const ground = Number(panorama?.resolution) > 0 ? `, read at ${trimmed(panorama.resolution)} m` : '';
    lines.push(`Relief: ${relief.join(', ')}${ground}`);
  }
  return lines.map((line) => `- ${line}`).join('\n');
}

/** The viewpoint offered to a pinned note. `read()` answers what `viewpointText` reads. */
export function viewpointOffer({ read }) {
  return {
    id: 'viewpoint',
    label: 'This viewpoint',
    hint: 'The eye, where it looks and the relief it was read on, as text',
    icon: 'horizon',
    put: async () => {
      const text = viewpointText(read() ?? {});
      if (!text) throw new Error('Stand an eye on the map first');
      return { text };
    },
  };
}

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
 * An area of the photo above the terrain it was matched on, offered to a pinned note.
 * `keep({ signal })` has the area dragged, saves the view when it is not saved, draws the
 * pair and files it under the view (or finds it filed in this very state), answering
 * `{ entity, label, fresh }`; `unsaved()` says whether the view will be saved first.
 */
export function pairOffer({ keep, unsaved = () => false }) {
  return {
    id: 'pair',
    label: 'An area of the photo above the terrain',
    get hint() {
      return unsaved()
        ? 'Drag over the view: the view is saved, then both pictures of the area filed one above the other'
        : 'Drag over the view: both pictures of the area one above the other, the ridge lines on both';
    },
    icon: 'horizon',
    picture: true,
    busy: 'Drag over the view for the area to put in. Esc cancels',
    put: async ({ signal } = {}) => {
      const { entity, label, fresh } = await keep({ signal });
      if (!entity?.id) throw new Error('The pair could not be kept in the case');
      return { text: picturePut(entity, { label, width: '100%' }), filed: fresh ? [entity.id] : [] };
    },
  };
}
