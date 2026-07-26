/**
 * Case sidebar browse-vs-results rule (docs/UI.md §Case sidebar).
 *
 * The sidebar shows its folder tree while nothing is filtered, and a flat
 * result list as soon as a text query or a type chip is active. A filtered tree
 * would have to badge each folder with a per-type count the catalog summary
 * cannot give, so the two modes are exclusive rather than combined.
 */

/** True when the body should show results instead of the tree. */
export const isFiltering = ({ query = '', type = null } = {}) => !!query.trim() || !!type;

/** Header chips: one per type present in the case, biggest first, ties by name.
 *  Counts come from the already-loaded catalog summary — no extra request. */
export function typeChips(summary) {
  return Object.entries(summary?.by_type ?? {})
    .filter(([, count]) => count > 0)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

/**
 * Client-side filter for a case that fits one page (`createPagedList` client
 * mode). It matches folder and type as well as the label, so typing a folder
 * name reveals its contents; the server `q` behind a large case matches the
 * label alone.
 */
export function filterEntities(items, { query = '', type = null } = {}) {
  const q = query.trim().toLowerCase();
  return items.filter((e) => {
    if (type && e.type !== type) return false;
    if (!q) return true;
    return [e.label, e.type, e.attrs?.folder]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q);
  });
}

/** Row meta in the result list: the type, plus where the row is filed. */
export const resultMeta = (e) => (e.attrs?.folder ? `${e.type} · ${e.attrs.folder}` : e.type);
