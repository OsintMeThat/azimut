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
    JSON.stringify([
      { path: item.path, title: item.title ?? item.filename, folder: item.folder ?? '', id: item.entity_id ?? '' },
    ])
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

/** An entity id as the case sidebar and Files hand it over, as text. */
const ENTITY_ID = /^[a-z]+_[A-Za-z0-9]{4,40}$/;

/** A drag from inside the page that may carry the case's entities: a Media library file,
 *  or rows of the case sidebar or of Files, which hand their ids over as text. Read off
 *  the types alone, the only part of a drag a `dragover` may look at. */
export const carriesEntities = (event) => {
  const types = typesOf(event);
  return types.includes(PAGE_DRAG) && (types.includes(MEDIA_DRAG) || types.includes('text/plain'));
};

/**
 * The entities a drop from inside the page carries, as `{ ids, paths }`: the ids the
 * sidebar and Files write as text, and the Media library's files by their entity when the
 * library knew it, by their path otherwise. Nothing for a drag from outside the page.
 */
export function droppedEntities(event) {
  const types = typesOf(event);
  const out = { ids: [], paths: [] };
  if (!types.includes(PAGE_DRAG)) return out;
  if (types.includes(MEDIA_DRAG)) {
    let list;
    try {
      list = JSON.parse(event.dataTransfer?.getData(MEDIA_DRAG) || '[]');
    } catch {
      list = [];
    }
    for (const item of Array.isArray(list) ? list : []) {
      if (typeof item?.id === 'string' && item.id) out.ids.push(item.id);
      else if (typeof item?.path === 'string' && item.path) out.paths.push(item.path);
    }
    return out;
  }
  const text = String(event.dataTransfer?.getData('text/plain') ?? '');
  out.ids = [...new Set(text.split(/[\s,]+/).filter((word) => ENTITY_ID.test(word)))];
  return out;
}
