/**
 * My-work folder tree: nested nodes built from flat '/'-separated folder
 * paths plus the entities filed into them (entity.attrs.folder). Entities
 * with no folder are not in the tree — they live in their tool's own list.
 */

export const folderOf = (e) => e.attrs?.folder || null;

/** True when an entity belongs to `folder` or one of its descendants. */
export function isInFolderSubtree(entity, folder) {
  const entityFolder = folderOf(entity);
  return entityFolder === folder || entityFolder?.startsWith(`${folder}/`) || false;
}

/** Build the nested tree. Folders exist even when empty; entities attach
 *  to their exact folder node. Children are sorted case-insensitively. */
export function buildTree(folders, items) {
  const root = { name: '', path: '', children: new Map(), entities: [] };
  const ensure = (path) => {
    let node = root,
      acc = '';
    for (const seg of path.split('/')) {
      acc = acc ? `${acc}/${seg}` : seg;
      if (!node.children.has(seg))
        node.children.set(seg, { name: seg, path: acc, children: new Map(), entities: [] });
      node = node.children.get(seg);
    }
    return node;
  };
  for (const f of folders) if (f) ensure(f);
  for (const e of items) {
    const f = folderOf(e);
    if (f) ensure(f).entities.push(e);
  }
  const sortNodes = (map) =>
    [...map.values()]
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      .map((n) => ({ ...n, children: sortNodes(n.children) }));
  return sortNodes(root.children);
}

/** Entities in a node's whole subtree (folder badge count). */
export function subtreeCount(node) {
  return node.entities.length + node.children.reduce((s, c) => s + subtreeCount(c), 0);
}

/**
 * A node's subtree count from a `{ path: count }` map (the catalog summary's
 * `by_folder`), for a tree whose nodes carry no entities — the bounded sidebar
 * builds structure from folders alone and counts from the summary.
 */
export function subtreeCountFrom(node, byFolder) {
  const own = byFolder[node.path] ?? 0;
  return own + node.children.reduce((s, c) => s + subtreeCountFrom(c, byFolder), 0);
}

/** Every folder path in the tree, depth-first (folder pickers). */
export function flattenPaths(nodes) {
  return nodes.flatMap((n) => [n.path, ...flattenPaths(n.children)]);
}
