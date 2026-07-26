import { describe, expect, it } from 'vitest';
import { buildTree } from './folderTree.js';
import { UNFILED, browseCrumbs, browserView, matchesTerms } from './folderBrowse.js';

const entries = [
  { id: 'a', attrs: { folder: '' } },
  { id: 'b', attrs: { folder: 'field' } },
  { id: 'c', attrs: { folder: 'field/day-1' } },
];
const tree = () => buildTree(['field', 'field/day-1'], entries);

describe('browserView', () => {
  it('lists Unfiled first at the root, and no entries there', () => {
    const view = browserView(tree(), entries, '');

    expect(view.children[0]).toMatchObject({ name: 'Unfiled', path: UNFILED });
    expect(view.children.map((c) => c.name)).toContain('field');
    expect(view.entities).toEqual([]);
  });

  it('collects the folderless entries under Unfiled', () => {
    const view = browserView(tree(), entries, UNFILED);

    expect(view.entities.map((e) => e.id)).toEqual(['a']);
    expect(view.children).toEqual([]);
  });

  it('walks a nested path down to the entries filed there', () => {
    const view = browserView(tree(), entries, 'field/day-1');

    expect(view.entities.map((e) => e.id)).toEqual(['c']);
  });

  it('returns an empty view for a folder that does not exist', () => {
    expect(browserView(tree(), entries, 'field/day-9')).toEqual({ children: [], entities: [] });
  });
});

describe('browseCrumbs', () => {
  it('has no crumbs at the root', () => {
    expect(browseCrumbs('')).toEqual([]);
  });

  it('names the Unfiled bucket', () => {
    expect(browseCrumbs(UNFILED)).toEqual([{ name: 'Unfiled', path: UNFILED }]);
  });

  it('builds one crumb per segment, each with its own path', () => {
    expect(browseCrumbs('field/day-1')).toEqual([
      { name: 'field', path: 'field' },
      { name: 'day-1', path: 'field/day-1' },
    ]);
  });
});

describe('matchesTerms', () => {
  it('matches everything on an empty query', () => {
    expect(matchesTerms('anything', '  ')).toBe(true);
    expect(matchesTerms('', '')).toBe(true);
  });

  it('requires every term, in any order and any case', () => {
    expect(matchesTerms('Bridge north bank', 'north BRIDGE')).toBe(true);
    expect(matchesTerms('Bridge north bank', 'north river')).toBe(false);
  });

  it('tolerates missing text', () => {
    expect(matchesTerms(undefined, 'north')).toBe(false);
  });
});
