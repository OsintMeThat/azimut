/**
 * What a native drag carries, read the same way by every drop zone.
 *
 * Chromium lists `Files` among the types of an <img> dragged out of the page
 * itself, so a thumbnail pulled toward a folder used to read as a file from the
 * desktop: the import overlay came up and, dropped, imported the thumbnail a
 * second time. Every drag that starts in this document is marked at its
 * `dragstart`; one from the desktop never fires there, so it stays unmarked.
 */

export const PAGE_DRAG = 'application/x-azimut-page';
export const MEDIA_DRAG = 'application/x-azimut-media';

const typesOf = (event) => [...(event.dataTransfer?.types ?? [])];

/**
 * Mark the drags that start in the page, and keep a desktop file let go
 * outside any drop zone from replacing the app with the file. Returns the
 * cleanup.
 */
export function watchDrags(target = window) {
  const mark = (event) => event.dataTransfer?.setData(PAGE_DRAG, '1');
  // Bubbling, so a zone that took the file has already said so.
  const refuse = (event) => {
    if (event.defaultPrevented || !carriesOutsideFiles(event)) return;
    event.preventDefault();
    if (event.type === 'dragover') event.dataTransfer.dropEffect = 'none';
  };
  target.addEventListener('dragstart', mark, true);
  target.addEventListener('dragover', refuse);
  target.addEventListener('drop', refuse);
  return () => {
    target.removeEventListener('dragstart', mark, true);
    target.removeEventListener('dragover', refuse);
    target.removeEventListener('drop', refuse);
  };
}

/** Files coming in from outside the page: the only drag an import zone takes. */
export function carriesOutsideFiles(event) {
  const types = typesOf(event);
  return types.includes('Files') && !types.includes(PAGE_DRAG);
}

/**
 * The pointer left the zone the handler sits on. A leave fires for every child
 * the pointer crosses, an overlay included, so only a move to somewhere outside
 * counts. Nowhere at all (out of the window, or Escape) counts too.
 */
export function leftZone(event) {
  return !event.currentTarget?.contains(event.relatedTarget ?? null);
}

/** A file of the Media library on its way to a folder of the case sidebar. */
export function startMediaDrag(event, item) {
  const transfer = event.dataTransfer;
  if (!transfer) return;
  transfer.effectAllowed = 'move';
  transfer.setData(
    MEDIA_DRAG,
    JSON.stringify([{ path: item.path, title: item.title ?? item.filename, folder: item.folder ?? '' }])
  );
}

export const carriesMedia = (event) => typesOf(event).includes(MEDIA_DRAG);

/**
 * The files a drop carries, shaped as the entities `assignFolder` files. Every
 * library item is a file with its sidecar, so the path is all it needs.
 */
export function droppedMedia(event) {
  let list;
  try {
    list = JSON.parse(event.dataTransfer?.getData(MEDIA_DRAG) || '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => typeof item?.path === 'string' && item.path)
    .map((item) => ({
      type: 'media',
      label: String(item.title ?? item.path),
      attrs: { path: item.path, folder: String(item.folder ?? '') },
    }));
}
