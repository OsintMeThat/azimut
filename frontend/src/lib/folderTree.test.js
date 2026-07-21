import { describe, it, expect } from 'vitest';
import {
  buildTree, subtreeCount, subtreeCountFrom, flattenPaths, folderOf, isInFolderSubtree,
} from './folderTree.js';

const ent = (id, folder) => ({ id, attrs: folder ? { folder } : {} });

describe('folderOf', () => {
  it('reads attrs.folder, empty/missing → null', () => {
    expect(folderOf(ent('a', 'x/y'))).toBe('x/y');
    expect(folderOf(ent('b'))).toBeNull();
    expect(folderOf({ id: 'c', attrs: { folder: '' } })).toBeNull();
  });
});

describe('isInFolderSubtree', () => {
  it('includes a folder and its descendants, but not sibling or similarly named folders', () => {
    expect(isInFolderSubtree(ent('a', 'Sources'), 'Sources')).toBe(true);
    expect(isInFolderSubtree(ent('b', 'Sources/Telegram'), 'Sources')).toBe(true);
    expect(isInFolderSubtree(ent('c', 'SourcesElse'), 'Sources')).toBe(false);
    expect(isInFolderSubtree(ent('d', 'Timeline'), 'Sources')).toBe(false);
    expect(isInFolderSubtree(ent('e'), 'Sources')).toBe(false);
  });
});

describe('buildTree', () => {
  it('nests /-separated paths and keeps empty folders', () => {
    const tree = buildTree(['Sources/Telegram', 'Timeline'], []);
    expect(tree.map((n) => n.name)).toEqual(['Sources', 'Timeline']);
    expect(tree[0].children[0].path).toBe('Sources/Telegram');
    expect(subtreeCount(tree[0])).toBe(0);
  });

  it('attaches entities to their exact node and counts subtrees', () => {
    const items = [ent('a', 'Sources'), ent('b', 'Sources/Telegram'), ent('c', null)];
    const tree = buildTree(['Sources/Telegram'], items);
    const sources = tree[0];
    expect(sources.entities.map((e) => e.id)).toEqual(['a']);
    expect(sources.children[0].entities.map((e) => e.id)).toEqual(['b']);
    expect(subtreeCount(sources)).toBe(2); // unfiled 'c' is nowhere in the tree
  });

  it('creates missing intermediate folders from an entity path', () => {
    const tree = buildTree([], [ent('a', 'x/y/z')]);
    expect(flattenPaths(tree)).toEqual(['x', 'x/y', 'x/y/z']);
  });

  it('sorts case-insensitively at every level', () => {
    const tree = buildTree(['b', 'A', 'a/c', 'a/B'], []);
    expect(tree.map((n) => n.name)).toEqual(['A', 'a', 'b']);
    // 'A' and 'a' are distinct folders; 'a' keeps its sorted children
    const a = tree.find((n) => n.name === 'a');
    expect(a.children.map((n) => n.name)).toEqual(['B', 'c']);
  });
});

describe('subtreeCountFrom', () => {
  it('sums a folder and its descendants from a by_folder count map', () => {
    const tree = buildTree(['Sources/Telegram', 'Sources/Signal', 'Timeline'], []);
    const byFolder = { Sources: 1, 'Sources/Telegram': 3, Timeline: 2 };
    const sources = tree.find((n) => n.name === 'Sources');
    expect(subtreeCountFrom(sources, byFolder)).toBe(4); // 1 own + 3 Telegram + 0 Signal
    expect(subtreeCountFrom(tree.find((n) => n.name === 'Timeline'), byFolder)).toBe(2);
  });
});
