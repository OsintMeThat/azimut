import { describe, expect, it } from 'vitest';
import { buildFolderTree, keyForFolder, UNFILED } from './folderView.js';

const row = (id, folder, extra = {}) => ({
  id,
  kind: 'place',
  title: id,
  folder,
  fetched_at: '2026-07-20T09:00:00Z',
  geo: { state: 'ok', country: 'Ukraine', country_code: 'ua', region: 'Kyiv' },
  ...extra,
});

const rows = [
  row('a', 'Recon'),
  row('b', 'Recon/North'),
  row('c', ''),
  row('d', 'Recon/North', { kind: 'capture', title: 'crop', fetched_at: '2026-07-21T09:00:00Z' }),
];

const find = (nodes, name) => nodes.find((node) => node.name === name);

describe('buildFolderTree', () => {
  it('nests folders and attaches items to the exact folder they are filed in', () => {
    const { nodes } = buildFolderTree(rows, []);
    const recon = find(nodes, 'Recon');
    expect(recon.items.map((i) => i.id)).toEqual(['a']);
    expect(find(recon.children, 'North').items.map((i) => i.id)).toEqual(['d', 'b']); // newest first
  });

  it('counts the whole subtree, not only what is filed directly in the node', () => {
    const { nodes } = buildFolderTree(rows, []);
    expect(find(nodes, 'Recon').count).toBe(3);
    expect(find(find(nodes, 'Recon').children, 'North').count).toBe(2);
  });

  it('collects unfiled items in their own trailing node', () => {
    const { nodes, unfiled } = buildFolderTree(rows, []);
    expect(unfiled.key).toBe(UNFILED);
    expect(unfiled.count).toBe(1);
    expect(unfiled.items.map((i) => i.id)).toEqual(['c']);
    expect(nodes.some((node) => node.name === UNFILED)).toBe(false);
  });

  it("shows the case's own folders, so an empty or media-only one can be dropped into", () => {
    const { nodes } = buildFolderTree(rows, ['Recon', 'Recon/North', 'Imagery', 'Imagery/Raw']);
    expect(nodes.map((n) => n.name)).toEqual(['Imagery', 'Recon']);
    const imagery = find(nodes, 'Imagery');
    expect(imagery.count).toBe(0);
    expect(imagery.children.map((c) => c.name)).toEqual(['Raw']);
  });

  it('keeps a folder named only by a row, even when the case never declared it', () => {
    const { nodes } = buildFolderTree([row('x', 'Stray/Deep')], []);
    expect(find(find(nodes, 'Stray').children, 'Deep').items.map((i) => i.id)).toEqual(['x']);
  });

  it('filters by kind and by query before grouping, so the counts match the screen', () => {
    const captures = buildFolderTree(rows, [], { kind: 'captures' });
    expect(find(captures.nodes, 'Recon').count).toBe(1);
    expect(captures.unfiled.count).toBe(0);

    const searched = buildFolderTree(rows, [], { query: 'crop' });
    expect(find(searched.nodes, 'Recon').count).toBe(1);
  });

  it('gives every node its folder path as key, so a branch can be expanded', () => {
    const { nodes } = buildFolderTree(rows, []);
    expect(find(nodes, 'Recon').key).toBe('Recon');
    expect(find(find(nodes, 'Recon').children, 'North').key).toBe('Recon/North');
  });

  it('reads no folders at all as one Unfiled bucket', () => {
    const { nodes, unfiled } = buildFolderTree([row('a', ''), row('b', '')], []);
    expect(nodes).toEqual([]);
    expect(unfiled.count).toBe(2);
  });
});

describe('keyForFolder', () => {
  it('addresses a filed row by its folder and an unfiled one by the bucket', () => {
    expect(keyForFolder(row('a', 'Recon/North'))).toBe('Recon/North');
    expect(keyForFolder(row('a', ''))).toBe(UNFILED);
  });
});
