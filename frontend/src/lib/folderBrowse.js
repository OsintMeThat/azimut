/**
 * The read-only folder browser behind the modal pickers (Inspect sources and
 * sessions, Reverse Search media, Proof panels and saved proofs). A picker
 * lists a flat, searchable set by default and drops into this view when the
 * analyst presses "…": crumbs, folder rows, then the entries filed there.
 *
 * `buildTree` (folderTree.js) turns the folder strings into the node tree;
 * these helpers walk it. Entries carry their folder on `attrs.folder`, matching
 * the catalog entity shape.
 */

/** Sentinel path for entries with no folder. Not a real folder name — the empty
 *  string already means "browser root". */
export const UNFILED = '\u0000unfiled';

/** The node to render for `path`: its child folders and the entries filed in
 *  it. The root lists Unfiled first, then the tree; an unknown path is empty. */
export function browserView(tree, entries, path) {
  if (path === UNFILED) return { children: [], entities: entries.filter((entry) => !entry.attrs?.folder) };
  if (!path) return { children: [{ name: 'Unfiled', path: UNFILED, children: [], entities: [] }, ...tree], entities: [] };
  let children = tree;
  let node = null;
  for (const segment of path.split('/')) {
    node = children.find((child) => child.name === segment) ?? null;
    if (!node) return { children: [], entities: [] };
    children = node.children;
  }
  return node;
}

/** The crumb trail for `path`, root excluded (the pickers label the root). */
export function browseCrumbs(path) {
  if (!path) return [];
  if (path === UNFILED) return [{ name: 'Unfiled', path: UNFILED }];
  return path.split('/').map((name, i, parts) => ({ name, path: parts.slice(0, i + 1).join('/') }));
}

/** Every whitespace-separated term of `query` appears in `text`. An empty
 *  query matches everything. */
export function matchesTerms(text, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return true;
  const haystack = String(text ?? '').toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
}
