/**
 * The location hash: which tool is open, and what that tool wants remembered.
 *
 * It used to be one word (`#satellite`), written by `App.svelte` on every tool
 * change. A tool that opens in more than one window needs more than that: a
 * second map window is the same tool on a different view, and the view has to
 * be in the address or the window cannot be reopened, duplicated, or even
 * survive a reload.
 *
 * So the hash reads `#<route>?<the tool's own state>`, and the two halves have
 * two owners. The app owns the route and never touches the query; a tool owns
 * its query and never touches the route. Anything written here is a link the
 * analyst could have typed, so a tool reading it back validates it.
 */

/** `#satellite?ll=48.8,2.3` → `{ route: 'satellite', params: URLSearchParams }`. */
export function splitHash(hash = '') {
  const bare = String(hash).replace(/^#/, '');
  const cut = bare.indexOf('?');
  if (cut === -1) return { route: bare, params: new URLSearchParams() };
  return { route: bare.slice(0, cut), params: new URLSearchParams(bare.slice(cut + 1)) };
}

/**
 * Is this tab the tool on its own, with the app taken away from around it?
 *
 * A detached map is opened onto a second screen to *be* a map: the workspace
 * rail, the case bar and the tab strip are how you get somewhere in the first
 * window, and they are chrome in the second. So a tool that opens a peer says
 * so in the address — which also means the tab survives a reload as what it
 * was, and that nothing else has to be stored anywhere.
 *
 * The app is what honours it, since the app owns everything being removed.
 */
export function readSolo(params) {
  const raw = params instanceof URLSearchParams ? params.get('solo') : params?.solo;
  return raw === '1';
}

/** …and back. An empty query leaves the plain `#route` the app has always written. */
export function buildHash(route, params) {
  const query =
    params instanceof URLSearchParams ? params : new URLSearchParams(params ?? {});
  const tail = query.toString();
  return tail ? `#${route}?${tail}` : `#${route}`;
}
