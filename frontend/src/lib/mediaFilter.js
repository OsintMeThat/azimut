/**
 * Free-text search + sorting for the Media Library grid. Pure functions so a
 * case with hundreds of items stays navigable and the behavior stays testable.
 */

/** Case-insensitive match against everything the analyst might remember:
 *  filename, title, notes, folder, and the download's title/uploader/URL. */
export function matchesQuery(item, query) {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    item.filename,
    item.title,
    item.notes,
    item.folder,
    item.source?.title,
    item.source?.uploader,
    item.source?.webpage_url ?? item.source?.url,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}

/** True for native satellite captures and extension screenshots whose URL
 * explicitly identified satellite imagery. */
export function isSatelliteMedia(item) {
  const source = item?.source ?? {};
  return source.type === 'satellite' ||
    (source.type === 'screenshot' && source.imagery_mode === 'satellite');
}

/** Images that are not already classified as satellite captures. */
export function isGenericImage(item) {
  return item?.kind === 'image' && !isSatelliteMedia(item);
}

/** User-facing kind label for the Media Library card. */
export function mediaDisplayKind(item) {
  return isSatelliteMedia(item) ? 'satellite' : item?.kind;
}

export const SORTS = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'name', label: 'Name A–Z' },
  { id: 'size', label: 'Largest first' },
];

/**
 * The media rows the grid should render: filtered by category/folder/query and
 * sorted. Returns nothing when no case is open — the cards read
 * `caseState.current.id` for their file URLs, so rendering a stale list while
 * the case is being closed (a brief window where `current` is null but `items`
 * hasn't been cleared yet) would throw and abort the whole reactive flush,
 * leaving *other* tools un-reset. Gating on `hasCase` makes that impossible
 * regardless of effect ordering.
 */
export function visibleMedia(
  items,
  {
    hasCase = true,
    catMatch = null,
    folderFilter = null,
    gpsOnly = false,
    query = '',
    sort = 'newest',
    direction,
  } = {}
) {
  if (!hasCase) return [];
  return sortItems(
    items.filter(
      (i) =>
        (!catMatch || catMatch(i)) &&
        (!folderFilter || i.folder === folderFilter) &&
        (!gpsOnly || hasPosition(i)) &&
        matchesQuery(i, query)
    ),
    sort,
    direction
  );
}

/** The position a file's own metadata states, or null. Enrichment writes it from
 *  image EXIF or a video's container tags; both land on the same field. */
export function mediaPoint(item) {
  const lat = Number(item?.gps?.lat);
  const lon = Number(item?.gps?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

export function hasPosition(item) {
  return mediaPoint(item) !== null;
}

/** Whether a folder and category can produce at least one media item.
 *  Deliberately ignores the text query: choosing a compatible folder/type
 *  combination should not reset either filter just because a search is active.
 */
export function hasMediaForFilters(items, { catMatch = null, folderFilter = null } = {}) {
  return items.some(
    (i) => (!catMatch || catMatch(i)) && (!folderFilter || i.folder === folderFilter)
  );
}

const displayName = (i) => (i.title ?? i.filename ?? '').toLowerCase();

/** Stable-sorted copy of `items` (the API's order is newest-first on disk scan,
 *  but sorting explicitly keeps the toggle honest whatever the backend does). */
export function sortItems(items, sort, direction) {
  const out = [...items];
  let descending = false;
  switch (sort) {
    case 'oldest':
      out.sort((a, b) => (a.added_at ?? '').localeCompare(b.added_at ?? ''));
      break;
    case 'name':
      out.sort((a, b) => displayName(a).localeCompare(displayName(b)));
      break;
    case 'type':
      out.sort((a, b) => (mediaDisplayKind(a) ?? '').localeCompare(mediaDisplayKind(b) ?? ''));
      break;
    case 'folder':
      out.sort((a, b) => (a.folder ?? '').localeCompare(b.folder ?? ''));
      break;
    case 'size':
      out.sort((a, b) => (a.size ?? 0) - (b.size ?? 0));
      descending = true;
      break;
    case 'newest':
    default:
      out.sort((a, b) => (a.added_at ?? '').localeCompare(b.added_at ?? ''));
      descending = true;
      break;
  }
  if (direction === 'asc') descending = false;
  if (direction === 'desc') descending = true;
  if (descending) out.reverse();
  return out;
}
