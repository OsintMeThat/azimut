/**
 * The hybrid client/server list behind the search surfaces (Media Library,
 * Files, the case switcher). It loads one bounded first page. If that page is
 * the whole dataset (no `next_cursor`), the surface filters/sorts in memory —
 * instant, no network on keystroke, exactly what a 3–4 item case wants. If
 * there is more, it switches to debounced server search and a "Show more".
 *
 * `fetchPage({ query, cursor })` returns `{ items, next_cursor, total, facets }`
 * (facets optional). `serverMode` is sticky once true within a case, so a query
 * that happens to fit one page doesn't strand later, broader queries on a
 * client-only subset — only `reload()` re-establishes the baseline.
 */
export function createPagedList({ fetchPage, debounceMs = 250 }) {
  let items = $state([]);
  let total = $state(0);
  let facets = $state(null);
  let query = $state('');
  let loading = $state(false);
  let nextCursor = $state(null);
  let serverMode = $state(false);
  let timer = null;
  let runId = 0;

  async function load({ query: q, append }) {
    const myRun = ++runId;
    loading = true;
    const cursor = append ? nextCursor : null;
    try {
      const page = await fetchPage({ query: q, cursor });
      if (myRun !== runId) return; // a newer load superseded this one
      const rows = page.items ?? [];
      items = append ? [...items, ...rows] : rows;
      nextCursor = page.next_cursor ?? null;
      total = page.total ?? items.length;
      facets = page.facets ?? null;
      if (!append && nextCursor != null) serverMode = true; // sticky-true
    } finally {
      if (myRun === runId) loading = false;
    }
  }

  return {
    get items() {
      return items;
    },
    get total() {
      return total;
    },
    get facets() {
      return facets;
    },
    get loading() {
      return loading;
    },
    get hasMore() {
      return nextCursor != null;
    },
    get serverMode() {
      return serverMode;
    },
    get query() {
      return query;
    },
    /** Drop everything synchronously — call before switching cases so a stale
     *  list can't render for a beat against the new case's file URLs. */
    clear() {
      clearTimeout(timer);
      runId++; // abandon any in-flight load
      items = [];
      total = 0;
      facets = null;
      nextCursor = null;
      serverMode = false;
      loading = false;
    },
    /** Re-establish the baseline (first page, mode reset). Call on case open. */
    reload() {
      clearTimeout(timer);
      serverMode = false;
      return load({ query, append: false });
    },
    /** In client mode just record the term (the surface filters in memory); in
     *  server mode debounce a fresh first-page fetch carrying the query. */
    setQuery(q) {
      query = q;
      if (!serverMode) return;
      clearTimeout(timer);
      timer = setTimeout(() => load({ query: q, append: false }), debounceMs);
    },
    /** Append the next server page. No-op when there is nothing more or a load
     *  is already in flight. */
    loadMore() {
      if (nextCursor == null || loading) return undefined;
      return load({ query, append: true });
    },
  };
}
