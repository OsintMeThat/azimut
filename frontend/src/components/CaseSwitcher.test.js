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

describe('menu layout', () => {
  it('puts the case list first and the verbs in a footer', () => {
    const list = source.indexOf('<div class="list">');
    const foot = source.indexOf('<div class="foot">');
    expect(list).toBeGreaterThan(-1);
    expect(list).toBeLessThan(foot);
    // the two global verbs live in the footer, below the list
    expect(source.indexOf('New case')).toBeGreaterThan(foot);
    expect(source.indexOf('Import case…')).toBeGreaterThan(foot);
  });

  it('scrolls the list alone, so search and actions stay reachable', () => {
    const style = source.slice(source.indexOf('<style>'));
    expect(style).toMatch(/\.menu \{[^}]*overflow: hidden/);
    expect(style).toMatch(/\.list \{[^}]*overflow: auto/);
  });

  it('puts every case action in the footer, icon-only past New case', () => {
    const icons = source.indexOf('<div class="foot-icons">');
    expect(icons).toBeGreaterThan(-1);
    for (const label of [
      'Import case…',
      'Check this case',
      'Open case folder',
      'Export this case…',
      'Close case (one-shot mode)',
    ]) {
      expect(source.indexOf(label)).toBeGreaterThan(icons);
    }
    // New case keeps its label; it anchors the row
    expect(source).toContain('New case\n');
  });

  it('names every icon-only button twice, for the tooltip and for a reader', () => {
    const foot = source.slice(source.indexOf('<div class="foot-icons">'), source.indexOf('</div>\n      </div>'));
    const titles = foot.match(/title="/g) ?? [];
    const labels = foot.match(/aria-label="/g) ?? [];
    expect(titles.length).toBe(5);
    expect(labels.length).toBe(titles.length);
  });

  it('shows scratch sessions inline with a badge instead of their own section', () => {
    expect(source).not.toContain('Scratch sessions');
    const scratchRow = source.indexOf('{#each visibleScratches');
    expect(source.indexOf('badge accent', scratchRow)).toBeGreaterThan(scratchRow);
  });
});

describe('Case Doctor', () => {
  it('keeps a damaged case actionable even when opening it would fail', () => {
    expect(source).toContain("c.health === 'needs-attention'");
    expect(source).toContain('Needs attention');
    expect(source).toContain('onclick={() => openDoctor(c)}');
  });

  it('diagnoses before offering explicit repairs', () => {
    expect(source).toContain('doctorReport = await checkCase(c.id)');
    expect(source).toContain('Checks “{doctorTarget.name}” without changing it.');
    expect(source).toContain('Cannot be recovered:');
    expect(source).toContain('repairCase(doctorTarget.id, repair)');
  });

  it('requires a replacement for relink and a second click for record removal', () => {
    expect(source).toContain("action.id === 'relink' && !doctorReplacements[issue.id]");
    expect(source).toContain("action.id === 'drop' && doctorConfirm !== issue.id");
    expect(source).toContain('Remove record?');
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

    get.mockClear();
    await refreshCaseList();
    expect(get).toHaveBeenNthCalledWith(1, '/api/cases');

    get.mockClear();
    await refreshCaseList({ q: 'kharkiv strike' });
    expect(get).toHaveBeenNthCalledWith(1, '/api/cases?q=kharkiv%20strike');

    get.mockClear();
    await refreshCaseList({ q: '   ' });
    expect(get).toHaveBeenNthCalledWith(1, '/api/cases');
    vi.doUnmock('../lib/api.js');
  });

  it('loads the workspace folders alongside the cases, unfiltered', async () => {
    vi.resetModules();
    const get = vi.fn().mockResolvedValue([]);
    vi.doMock('../lib/api.js', () => ({ api: { get, post: vi.fn(), del: vi.fn() } }));
    const { refreshCaseList } = await import('../lib/state.svelte.js');

    get.mockClear();
    await refreshCaseList({ q: 'kharkiv strike' });

    // the folder list is not a case list: the name query does not apply to it
    expect(get).toHaveBeenNthCalledWith(2, '/api/workspace/folders');
    vi.doUnmock('../lib/api.js');
  });

  it('still lists the cases when the folder scan fails', async () => {
    vi.resetModules();
    const get = vi.fn(async (url) => {
      if (url === '/api/workspace/folders') throw new Error('nope');
      return [{ id: 'coast', name: 'Coast' }];
    });
    vi.doMock('../lib/api.js', () => ({ api: { get, post: vi.fn(), del: vi.fn() } }));
    const { refreshCaseList, caseState } = await import('../lib/state.svelte.js');

    await refreshCaseList();

    expect(caseState.list).toHaveLength(1);
    expect(caseState.folders).toEqual([]);
    vi.doUnmock('../lib/api.js');
  });
});

describe('workspace folders', () => {
  it('offers a folder the analyst made, and says it is not a case yet', () => {
    expect(source).toContain('visibleFolders');
    expect(source).toContain("'Not a case yet'");
    expect(source).toContain("'Make this folder a case'");
    // listed after the cases, since it is not one
    expect(source.indexOf('visibleFolders as f')).toBeGreaterThan(
      source.indexOf('visibleScratches as c')
    );
  });

  it('recovers a folder whose case lost its manifest, then hands it to the Doctor', () => {
    expect(source).toContain('recoverFolder(folder.name)');
    expect(source).toContain('openDoctor({ id: recovered.id, name: recovered.name })');
  });

  it('asks for a rename instead of offering a name a case folder cannot carry', () => {
    expect(source).toContain("'Rename this folder to use it'");
    expect(source).toContain("f.state === 'unusable-name'");
    expect(source).toMatch(/disabled=\{folderBusy \|\| f\.state === 'unusable-name'\}/);
  });

  it('adopts in place through the API, without touching what is in the folder', async () => {
    vi.resetModules();
    const post = vi.fn().mockResolvedValue({ id: 'Oceanside match', name: 'Oceanside match' });
    const get = vi.fn().mockResolvedValue([]);
    vi.doMock('../lib/api.js', () => ({ api: { get, post, del: vi.fn() } }));
    const { adoptFolder, caseState } = await import('../lib/state.svelte.js');

    await adoptFolder('Oceanside match');

    expect(post).toHaveBeenCalledWith('/api/workspace/folders/adopt', { name: 'Oceanside match' });
    expect(get).toHaveBeenLastCalledWith('/api/cases/Oceanside match');
    expect(caseState.current).toBeTruthy();
    vi.doUnmock('../lib/api.js');
  });
});

describe('open case folder', () => {
  it('sits with the other case-level actions and only when a case is open', () => {
    expect(source).toContain("import { revealCaseFolder } from '../lib/reveal.js'");
    expect(source).toContain('Open case folder');
    // inside the {#if caseState.current} block, above Export this case…
    const guard = source.indexOf('{#if caseState.current}');
    const reveal = source.indexOf('Open case folder');
    const exportItem = source.indexOf('Export this case…');
    expect(guard).toBeLessThan(reveal);
    expect(reveal).toBeLessThan(exportItem);
  });

  it('says something either way, since nothing opens in the tab', () => {
    expect(source).toContain("toast('Opened the case folder'");
    expect(source).toContain("toast(error.message || 'Could not open the folder'");
  });
});
