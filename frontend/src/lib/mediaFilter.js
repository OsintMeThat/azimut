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
  { hasCase = true, catMatch = null, folderFilter = null, query = '', sort = 'newest' } = {}
) {
  if (!hasCase) return [];
  return sortItems(
    items.filter(
      (i) =>
        (!catMatch || catMatch(i)) &&
        (!folderFilter || i.folder === folderFilter) &&
        matchesQuery(i, query)
    ),
    sort
  );
}

const displayName = (i) => (i.title ?? i.filename ?? '').toLowerCase();

/** Stable-sorted copy of `items` (the API's order is newest-first on disk scan,
 *  but sorting explicitly keeps the toggle honest whatever the backend does). */
export function sortItems(items, sort) {
  const out = [...items];
  switch (sort) {
    case 'oldest':
      out.sort((a, b) => (a.added_at ?? '').localeCompare(b.added_at ?? ''));
      break;
    case 'name':
      out.sort((a, b) => displayName(a).localeCompare(displayName(b)));
      break;
    case 'size':
      out.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
      break;
    case 'newest':
    default:
      out.sort((a, b) => (b.added_at ?? '').localeCompare(a.added_at ?? ''));
      break;
  }
  return out;
}
