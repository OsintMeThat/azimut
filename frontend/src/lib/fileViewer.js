/**
 * What the full-screen viewer (components/MediaViewer.svelte) can show of a case
 * file, and which file Space opens in Files.
 */
import { mediaKindOf } from './entityIcon.js';

/** The kinds the viewer draws: a picture, a video, a sound. */
export const VIEWABLE_KINDS = new Set(['image', 'video', 'audio']);

/** What the viewer would draw of an entity, or null when it has nothing to show. */
export function viewerKind(entity) {
  if (typeof entity?.attrs?.path !== 'string' || !entity.attrs.path) return null;
  if (entity.type === 'capture') return 'image';
  if (entity.type !== 'media') return null;
  const kind = mediaKindOf(entity);
  return VIEWABLE_KINDS.has(kind) ? kind : null;
}

/** The viewer's row for an entity it can show, keyed by the entity's id. */
export function viewerItem(entity, poster = null) {
  const kind = viewerKind(entity);
  if (!kind) return null;
  return { key: entity.id, path: entity.attrs.path, kind, name: entity.label || entity.attrs.path, poster };
}

/**
 * The file Space opens out of a selection: the one pressed last while it is still
 * picked, else the last one picked. Null when nothing is.
 */
export function spaceTarget(selected, anchor) {
  if (!selected?.length) return null;
  return anchor != null && selected.includes(anchor) ? anchor : selected.at(-1);
}
