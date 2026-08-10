/** Bounded catalog helpers shared by the case tools and sidebar. */
import { api } from './api.js';

/** Apply a summary response only while its request still belongs to the active case. */
export function settleCatalogSummary(current, next, isCurrent) {
  return isCurrent ? next : current;
}

/** Build the catalog request path. Only the filters that are set appear.
 *  `unfiled` (no folder) wins over an exact `folder` path when both are given.
 *
 *  `attr` with `value` narrows on one stored field, `linked` on having a neighbour of
 *  that type and `unlinked` on having none at all; `since`, `until` and `by` ask how
 *  the row got here rather than what it says. A field with no value chosen is **not**
 *  sent: it is the analyst having picked what they are about to ask about, and asked
 *  as a term it would empty the table between two clicks of one act.
 *
 *  `order` sorts the whole filtered set rather than the page — the difference between
 *  *the newest in this case* and *the newest of the rows already loaded*. */
export function buildCatalogQuery(
  caseId,
  {
    cursor,
    limit,
    types,
    status,
    query,
    folder,
    unfiled,
    recursive,
    attr,
    value,
    linked,
    unlinked,
    since,
    until,
    by,
    order,
    view,
  } = {}
) {
  const params = new URLSearchParams();
  if (limit != null) params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);
  if (types && types.length) params.set('type', types.join(','));
  if (status) params.set('status', status);
  if (query) params.set('q', query);
  if (unfiled) params.set('unfiled', 'true');
  else if (folder != null) params.set('folder', folder);
  if (recursive) params.set('recursive', 'true');
  if (attr && value) {
    params.set('attr', attr);
    params.set('value', value);
  }
  if (linked) params.set('linked', linked);
  if (unlinked) params.set('unlinked', 'true');
  if (since) params.set('since', since);
  if (until) params.set('until', until);
  if (by && by.length) params.set('by', by.join(','));
  if (order) params.set('order', order);
  if (view) params.set('view', view);
  const qs = params.toString();
  return `/api/cases/${caseId}/catalog/entities${qs ? `?${qs}` : ''}`;
}

/** Which stored fields these types hold, and which values, as the menus a field
 *  filter is chosen from. Bounded server-side: a field with too many distinct values
 *  comes back with none of them and says it was cut. */
export async function fetchAttrFacets(caseId, types, { get = api.get } = {}) {
  if (!caseId) return [];
  const params = new URLSearchParams();
  if (types && types.length) params.set('type', types.join(','));
  const qs = params.toString();
  const body = await get(`/api/cases/${caseId}/catalog/attributes${qs ? `?${qs}` : ''}`);
  return body?.attrs ?? [];
}

/**
 * Walk every page of the catalog and return the whole filtered list.
 *
 * The bounded read for a tool that genuinely needs a full slice — the Files
 * finder tree, the Notebook mention list, the map's saved places — off the
 * catalog endpoint instead of the case-open payload. It pages server-side
 * (largest page the API allows) so the graph never ships in one response, and a
 * caller can still window the returned rows. `signal` cancels a case switch.
 */
export async function fetchAllEntities(
  caseId,
  { types, status, query, folder, unfiled, recursive, get = api.get, signal, pageSize = 500 } = {}
) {
  if (!caseId) return [];
  const out = [];
  let cursor = null;
  do {
    const path = buildCatalogQuery(caseId, {
      cursor, limit: pageSize, types, status, query, folder, unfiled, recursive,
    });
    const page = await get(path, signal ? { signal } : undefined);
    out.push(...(page.items ?? []));
    cursor = page.next_cursor ?? null;
  } while (cursor);
  return out;
}

/** Resolve one entity by an `attrs` value (`path`, `spec`, `draft`), or null.
 *  The bounded replacement for scanning the whole graph for a single file. */
export async function lookupEntity(caseId, attr, value, { get = api.get } = {}) {
  if (!caseId) return null;
  const params = new URLSearchParams({ attr, value });
  const res = await get(`/api/cases/${caseId}/entities/lookup?${params}`);
  return res?.entity ?? null;
}

/** The transitive `derived-from` closure rooted at an entity, as
 *  `{ entities, links }` — the Post composer's proof-to-source-media trace. */
export async function fetchDerivation(caseId, entityId, { get = api.get } = {}) {
  if (!caseId || !entityId) return { entities: [], links: [] };
  return get(`/api/cases/${caseId}/entities/${entityId}/derivation`);
}
