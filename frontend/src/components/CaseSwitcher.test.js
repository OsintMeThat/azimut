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

  it('keeps the search box while a query is active, even if it filters below the threshold', () => {
    // the server query rewrites caseState.list to the filtered result, so a
    // gate reading only the (now-shrunk) list would hide its own box mid-search
    expect(source).toContain('named.length + scratches.length > 6 || search.trim()');
  });
});

describe('Case bundles', () => {
  it('offers import globally and export for the open case', () => {
    expect(source).toContain("openBundle('import')");
    expect(source).toContain('Import case…');
    expect(source).toContain("openBundle('export')");
    expect(source).toContain('Export this case…');
  });

  it('pre-flights an import before it creates the new case', () => {
    expect(source).toContain('type="file"');
    expect(source).toContain('accept=".zip,.enc"');
    expect(source).toContain('bundlePreview = await inspectBundle(bundleFile');
    expect(source).toContain('{#if bundlePreview}');
    expect(source).toContain('Imports as a new case.');
    expect(source).toContain('disabled={bundleBusy || !bundlePreview.space_ok}');
  });

  it('keeps password protection optional and states the recovery limit once', () => {
    expect(source).toContain('bind:checked={protectBundle}');
    expect(source).toContain('protectBundle ? bundlePassword');
    expect(source).toContain('A lost password cannot be recovered.');
  });

  it('waits for durable export and import jobs', () => {
    expect(source).toContain('waitForBundle(current.id, started.job_id, {');
    expect(source).toContain('waitForBundle(started.case_id, started.job_id, {');
    expect(source).toContain('signal: bundleJobController.signal');
    expect(source).toContain('triggerBundleDownload(current.id, started.job_id)');
    expect(source).toContain("toast(error.message || 'Could not export the case'");
    expect(source).toContain("toast(error.message || 'Could not import the case'");
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
