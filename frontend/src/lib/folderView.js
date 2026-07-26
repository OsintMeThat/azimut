/**
 * The Saved panel's other tree: My-work folders instead of geography.
 *
 * Same index, same filters, same node shape as `buildGeoTree` — the panel
 * renders whichever tree it is handed through one snippet. Structure comes from
 * `folderTree.js`, which the case sidebar and Files already build on, so a
 * folder means the same thing everywhere in the app.
 *
 * Pure and synchronous: the index and the case's folder list are both already
 * in memory.
 */

import { buildTree } from './folderTree.js';
import { filterSaved } from './geoTree.js';

/** Where an item that was never filed goes, and what that bucket is called. */
export const UNFILED = 'Unfiled';

const newestFirst = (rows) =>
  [...rows].sort((a, b) => String(b.fetched_at ?? '').localeCompare(String(a.fetched_at ?? '')));

/** Turn one `folderTree.js` node into the shape the panel renders. A folder can
 *  hold subfolders *and* items, which a geography node never does. */
function toNode(node) {
  const children = node.children.map(toNode);
  const items = newestFirst(node.entities);
  return {
    level: 'folder',
    name: node.name,
    label: node.name,
    key: node.path,
    // what is filed below, not only what is filed directly here — a collapsed
    // folder must still say how much work is inside it
    count: items.length + children.reduce((sum, child) => sum + child.count, 0),
    children,
    items,
  };
}

/**
 * The folder tree for one kind + query.
 *
 * `folders` is the case's own folder list: passing it is what makes an empty
 * folder — or one holding only media — appear, and therefore reachable as a
 * drop target. Folders named only by the rows are merged in, so an item filed
 * into a path that was never an explicit folder still has a node.
 *
 * Returns `{ nodes, unfiled }`. `unfiled` is a node like any other and always
 * renders last; its count is 0 when everything is filed.
 */
export function buildFolderTree(rows, folders = [], { kind = 'all', query = '' } = {}) {
  const shown = filterSaved(rows, { kind, query });
  const filed = [];
  const stray = [];
  for (const row of shown) (row.folder ? filed : stray).push(row);

  const paths = [...new Set([...(folders ?? []).filter(Boolean), ...filed.map((row) => row.folder)])];
  // folderTree.js reads the folder off `attrs`, the catalog entity shape
  const entities = filed.map((row) => ({ ...row, attrs: { folder: row.folder } }));

  return {
    nodes: buildTree(paths, entities).map(toNode),
    unfiled: {
      level: 'unfiled',
      name: UNFILED,
      label: UNFILED,
      key: UNFILED,
      count: stray.length,
      children: [],
      items: newestFirst(stray),
    },
  };
}

/** The node key holding `row` — the address the panel expands to when something
 *  elsewhere asks to reveal one saved item. */
export function keyForFolder(row) {
  return row?.folder || UNFILED;
}
