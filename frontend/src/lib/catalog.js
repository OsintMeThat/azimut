/** Bounded catalog helpers shared by the case tools and sidebar. */
import { api } from './api.js';

/** Apply a summary response only while its request still belongs to the active case. */
export function settleCatalogSummary(current, next, isCurrent) {
  return isCurrent ? next : current;
}

/** Build the catalog request path. Only the filters that are set appear.
 *  `unfiled` (no folder) wins over an exact `folder` path when both are given. */
export function buildCatalogQuery(
  caseId,
  { cursor, limit, types, status, query, folder, unfiled } = {}
) {
  const params = new URLSearchParams();
  if (limit != null) params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);
  if (types && types.length) params.set('type', types.join(','));
  if (status) params.set('status', status);
  if (query) params.set('q', query);
  if (unfiled) params.set('unfiled', 'true');
  else if (folder != null) params.set('folder', folder);
  const qs = params.toString();
  return `/api/cases/${caseId}/catalog/entities${qs ? `?${qs}` : ''}`;
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
  { types, status, query, get = api.get, signal, pageSize = 500 } = {}
) {
  if (!caseId) return [];
  const out = [];
  let cursor = null;
  do {
    const path = buildCatalogQuery(caseId, { cursor, limit: pageSize, types, status, query });
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
