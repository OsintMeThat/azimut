import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./Files.svelte', import.meta.url), 'utf8');

describe('Files bounded loading', () => {
  it('loads a bounded first page, not the whole catalog on open', () => {
    expect(source).toContain('createPagedList');
    expect(source).toContain("status: 'confirmed', limit: PAGE");
    // no longer walks every page into memory on mount
    expect(source).not.toContain('fetchAllEntities');
  });

  it('offers Show more with an honest total from the summary', () => {
    expect(source).toContain('{#if pl.hasMore}');
    expect(source).toContain('pl.loadMore()');
    expect(source).toContain('Showing {confirmed.length} of {total}');
    expect(source).toContain('/catalog/summary');
  });

  it('clears the previous case before loading the next', () => {
    expect(source).toContain('pl.clear()');
  });
});

describe('Files desktop affordances', () => {
  it('uses the shared SearchInput and a sort control', () => {
    expect(source).toContain("import SearchInput from '../components/SearchInput.svelte'");
    expect(source).toContain('bind:value={sort}');
    expect(source).toContain('sortEntities(');
  });

  it('search also matches notes, not just label/type/folder', () => {
    expect(source).toContain('e.attrs?.notes');
  });
});
