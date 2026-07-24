import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./CaseSwitcher.svelte', import.meta.url), 'utf8');

describe('CaseSwitcher search', () => {
  it('offers a shared SearchInput once the list is long enough', () => {
    expect(source).toContain("import SearchInput from './SearchInput.svelte'");
    expect(source).toContain('named.length + scratches.length > 6');
    expect(source).toContain('bind:value={search}');
  });

  it('renders the filtered views but guards duplicate-name against the full list', () => {
    expect(source).toContain('visibleNamed');
    expect(source).toContain('visibleScratches');
    // the unfiltered `named` still backs the duplicate-name check
    expect(source).toContain('named.some(');
  });

  it('debounces a server query so a long list is searchable end to end', () => {
    expect(source).toContain('refreshCaseList({ q })');
  });
});

describe('refreshCaseList', () => {
  it('passes a name query through to the API, or omits it when empty', async () => {
    vi.resetModules();
    const get = vi.fn().mockResolvedValue([]);
    vi.doMock('../lib/api.js', () => ({ api: { get, post: vi.fn(), del: vi.fn() } }));
    const { refreshCaseList } = await import('../lib/state.svelte.js');

    await refreshCaseList();
    expect(get).toHaveBeenLastCalledWith('/api/cases');

    await refreshCaseList({ q: 'kharkiv strike' });
    expect(get).toHaveBeenLastCalledWith('/api/cases?q=kharkiv%20strike');

    await refreshCaseList({ q: '   ' });
    expect(get).toHaveBeenLastCalledWith('/api/cases');
    vi.doUnmock('../lib/api.js');
  });
});
