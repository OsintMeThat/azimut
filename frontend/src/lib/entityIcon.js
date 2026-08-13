/**
 * Icon name for a case entity, shared by every surface that lists one.
 *
 * The list itself is the backend registry's (`engine/entities.py`, served with
 * `GET /api/cases/entity-types`), not a copy kept here: adding a type stays one
 * entry there. A hand-kept map is how this drifted before — it still named `alias`
 * and `event`, retired when the vocabulary was designed, and had never heard of a
 * bookmark or a claim.
 *
 * `note` is the fallback, which covers a free-string type the vocabulary has never
 * heard of and the moment before the registry lands. `App.svelte` asks for it at
 * startup so that moment is over before a case is on screen.
 */
import { typeIcon } from './entityTypes.svelte.js';

const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'ogg', 'oga', 'opus', 'flac', 'aac']);
const IMAGE_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'svg',
]);

const KINDS = new Set(['image', 'video', 'audio', 'file']);

/** What one media entity actually holds: `image`, `video`, `audio` or `file`.
 *
 *  The importer stamps `attrs.kind` from the MIME type, which is the answer when
 *  it is there. The extension is the fallback for entities filed before that attr
 *  existed, and **anything unrecognised is a `file`** rather than an image: a PDF,
 *  a scan bundle or a spreadsheet drawn as a photo is the list telling the analyst
 *  something untrue about what it holds.
 *
 *  Two shapes reach this. A catalog row carries its `attrs`; a **graph node** carries
 *  the kind flat and no attrs at all, because a case draws a few hundred nodes and
 *  each one shipping its own attribute bag to be drawn would be the payload paying
 *  for what the picture never reads. */
export function mediaKindOf(e) {
  if (KINDS.has(e?.kind)) return e.kind;
  const stated = e?.attrs?.kind;
  if (KINDS.has(stated)) return stated;
  const ext = e?.attrs?.path?.split('.').pop()?.toLowerCase();
  if (!ext) return 'file';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return 'file';
}

/** Media entities normally carry the same `kind` the Media Library uses to tell
 *  video from image; fall back to the file extension for entities filed before
 *  that attr existed. */
export function isVideoEntity(e) {
  return mediaKindOf(e) === 'video';
}

/** The icon a media kind is drawn with. The registry cannot make this call: a
 *  `media` is one type, and what the bytes are is a property of the file. */
const MEDIA_ICONS = { image: 'image', video: 'video', audio: 'audio', file: 'file' };

/** The same four in words, for a surface that names a row rather than drawing one.
 *
 *  Here rather than in the entity registry for the same reason the icons are: the
 *  vocabulary has one `media` type, and "this is a video" is a fact about the bytes.
 *  Every surface that says it reads this one map, so no two of them can disagree. */
const MEDIA_LABELS = { image: 'Image', video: 'Video', audio: 'Audio', file: 'File' };

/** What to call one entity: the media kind when that is the real answer, and the
 *  registry's own label for everything else. `label` is the registry lookup, passed
 *  in rather than imported so this stays a pure function of what it is given. */
export function entityKindLabel(e, label) {
  return e?.type === 'media' ? MEDIA_LABELS[mediaKindOf(e)] : label;
}

/** The icon for one entity. */
export const entityIcon = (e) =>
  e?.type === 'media' ? MEDIA_ICONS[mediaKindOf(e)] : (typeIcon(e?.type) ?? 'note');

/** The tools that make material out of what the case already holds, in words.
 *  Their output is filed as ordinary media, so without this a frame and a
 *  photograph somebody handed over read as the same thing. */
const MADE_BY = { inspect: 'Inspect' };

/** The act, in the word an analyst would use for it. `enhance-video` is the one
 *  that needs saying twice over — it is a video, and it is not the original. */
const MADE_AS = {
  frame: 'Frame',
  adjust: 'Adjusted image',
  collage: 'Collage',
  'enhance-video': 'Enhanced video',
};

/** What one node was **made here** as, or null for material the case collected.
 *
 *  Only graph nodes carry `origin`, and only for the tools in `MADE_HERE`
 *  (`engine/graph.py`) — the backend leaves it off an upload rather than sending
 *  "upload" for every surface to filter out, so a value here is already the answer.
 *  A route with no act (an older file, filed before the producer stamped one) still
 *  says it was made here; a caller falls back to the plain kind for the word. */
export function madeHereLabel(e) {
  if (!e?.origin) return null;
  return MADE_AS[e.op] ?? null;
}

/** The same act mid-sentence, for an edge that stands for steps rather than for one
 *  node — *derived from 2 frames*. The backend sends the act itself on a folded edge
 *  precisely so the words stay here: a step it has no word for reads as whatever it
 *  was sent, which is the entity type and is still true. */
export function madeAsWord(op) {
  return MADE_AS[op]?.toLowerCase() ?? op;
}

/** Who made it, for the one line a panel gives it. Null for collected material. */
export function madeHereBy(e) {
  return e?.origin ? (MADE_BY[e.origin] ?? e.origin) : null;
}
