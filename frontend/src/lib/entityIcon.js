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

/** What one media entity actually holds: `image`, `video`, `audio` or `file`.
 *
 *  The importer stamps `attrs.kind` from the MIME type, which is the answer when
 *  it is there. The extension is the fallback for entities filed before that attr
 *  existed, and **anything unrecognised is a `file`** rather than an image: a PDF,
 *  a scan bundle or a spreadsheet drawn as a photo is the list telling the analyst
 *  something untrue about what it holds. */
export function mediaKindOf(e) {
  const stated = e?.attrs?.kind;
  if (stated === 'image' || stated === 'video' || stated === 'audio' || stated === 'file') {
    return stated;
  }
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

/** The icon for one entity. */
export const entityIcon = (e) =>
  e?.type === 'media' ? MEDIA_ICONS[mediaKindOf(e)] : (typeIcon(e?.type) ?? 'note');
