/** Build the bounded media-page request path. Only the filters that are set
 *  appear; an empty `folder` string is kept (it means "the unfiled bucket"),
 *  distinct from an unset folder. Mirrors `buildCatalogQuery` in catalog.js. */
export function buildMediaQuery(
  caseId,
  { q, kind, category, folder, gps, collectedOnly, sort, direction, limit, cursor } = {}
) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (kind) params.set('kind', kind);
  if (category) params.set('category', category);
  if (folder != null) params.set('folder', folder);
  if (gps) params.set('gps', 'true');
  if (collectedOnly) params.set('collected_only', 'true');
  if (sort) params.set('sort', sort);
  if (direction) params.set('direction', direction);
  if (limit != null) params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return `/api/cases/${caseId}/media/page${qs ? `?${qs}` : ''}`;
}
