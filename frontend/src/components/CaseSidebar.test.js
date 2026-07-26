import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const shell = read('./CaseSidebar.svelte');
const header = read('./sidebar/SidebarHeader.svelte');
const tree = read('./sidebar/SidebarTree.svelte');
const results = read('./sidebar/SidebarResults.svelte');
const row = read('./sidebar/EntityRow.svelte');
const drawer = read('./sidebar/DetailsDrawer.svelte');

describe('sidebar shell', () => {
  it('is three zones over five units, not one component', () => {
    for (const unit of [
      'SidebarHeader',
      'SidebarTree',
      'SidebarResults',
      'DetailsDrawer',
    ]) {
      expect(shell).toContain(`import ${unit} from './sidebar/${unit}.svelte'`);
    }
    // the header never scrolls; the body is the one scroll region
    expect(shell).toContain('.body { flex: 1; min-height: 0; overflow-y: auto;');
  });

  it('builds the tree from folders plus summary keys, with no entities attached', () => {
    expect(shell).toContain(
      'buildTree([...new Set([...caseFolders, ...Object.keys(byFolder)])], [])'
    );
  });

  it('keeps bounded per-section loading and the stale-response guard', () => {
    expect(shell).toContain('const CATALOG_PAGE = 200');
    expect(shell).toContain('if (mySeq !== seq) return;');
    expect(shell).toContain("loadSection(folderData[path], { status: 'confirmed', folder: path }");
  });

  it('resets every section, the filter and the drawer on a case change', () => {
    const reset = shell.slice(shell.indexOf('if (id !== loadedCaseId)'), shell.indexOf('if (!id) {'));
    for (const line of [
      'summary = null',
      'expanded = {}',
      'folderData = {}',
      'infoEntity = null',
      "query = ''",
      'typeFilter = null',
      'suggestedData = emptySection()',
      'unfiledData = emptySection()',
    ]) {
      expect(reset).toContain(line);
    }
  });
});

describe('browse vs. results', () => {
  it('shows the tree until something is filtered, then a flat list', () => {
    expect(shell).toContain('const filtering = $derived(isFiltering({ query, type: typeFilter }))');
    expect(shell).toContain('{#if filtering}');
    expect(shell).toContain('<SidebarResults');
    expect(shell).toContain('{:else}');
    expect(shell).toContain('<SidebarTree');
  });

  it('reuses the shared paged list rather than a second search primitive', () => {
    expect(shell).toContain("import { createPagedList } from '../lib/pagedList.svelte.js'");
    expect(shell).toContain('buildCatalogQuery(caseState.current?.id, {');
    expect(shell).toContain('types: typeFilter ? [typeFilter] : null');
    expect(shell).toContain('results.setQuery(query)');
    expect(shell).toContain('results.loadMore()');
  });

  it('fetches the result page only while a filter is active', () => {
    expect(shell).toContain('const key = filtering && id ? `${id}|${typeFilter ?? \'\'}|${rev}` : null');
    expect(shell).toContain('if (!key) results.clear();');
    expect(shell).toContain('else results.reload();');
  });

  it('filters in memory in client mode and trusts the server otherwise', () => {
    expect(shell).toContain(
      'results.serverMode ? results.items : filterEntities(results.items, { query, type: typeFilter })'
    );
  });

  it('never collapses what the analyst opened: `expanded` is untouched by a search', () => {
    // the only writes are the declaration, the case reset, a toggle and a create
    const writes = shell.match(/expanded(\[[^\]]+\])? =/g) ?? [];
    expect(writes).toHaveLength(4);
  });

  it('says so plainly when nothing matches', () => {
    expect(results).toContain('No match in this case.');
  });
});

describe('header', () => {
  it('demotes the case id to a tooltip and gives search the full width', () => {
    expect(header).toContain('<h3 title={caseId}>{caseName}</h3>');
    expect(header).toContain('width="100%"');
    expect(header).toContain("import SearchInput from '../SearchInput.svelte'");
  });

  it('filters from the type chips, and All clears the filter', () => {
    expect(header).toContain('onclick={() => onselecttype(null)}');
    expect(header).toContain('onselecttype(type === chip.type ? null : chip.type)');
  });

  it('wraps the chips and hides the tail behind +N rather than off the edge', () => {
    expect(header).toContain('flex-wrap: wrap');
    expect(header).toContain('const VISIBLE_CHIPS = 5');
    expect(header).toContain('{#each shownChips as chip (chip.type)}');
    expect(header).toContain('+{hiddenChips}');
    // the active chip stays visible even when it sits past the cut
    expect(header).toContain('active && !head.includes(active) ? [...head, active] : head');
  });
});

describe('tree', () => {
  it('renders Suggestions as a node in one grammar, only when it has rows', () => {
    expect(tree).toContain('{#if suggestedCount > 0}');
    const node = tree.slice(tree.indexOf('{#if suggestedCount > 0}'), tree.indexOf('{#each tree as node'));
    expect(node).toContain('class="frow"');
    expect(node).toContain('<span class="fname">Suggestions</span>');
  });

  it('files the dragged rows into the folder they were dropped on', () => {
    expect(tree).toContain('ondrop={(e) => onDropFolder(e, node.path)}');
    expect(tree).toContain('onfile(rows, folder);');
    // dropping on Unfiled clears the filing instead
    expect(tree).toContain("ondrop={(e) => onDropFolder(e, '')}");
    expect(shell).toContain('assignFolderBatch(caseState.current.id, entities, folder)');
  });

  it('multi-selects entity rows only, and drags the whole selection', () => {
    expect(tree).toContain("import { dragPayload, rangeSelected, toggleSelected } from '../../lib/rowSelect.js'");
    expect(tree).toContain('if (ev?.shiftKey)');
    expect(tree).toContain('if (ev?.ctrlKey || ev?.metaKey)');
    expect(tree).toContain('dragRows = dragPayload(visibleRows, selected, entity)');
    // folder rows carry no selection state — they are drop targets
    expect(tree).not.toContain('selectedFolder');
  });

  it('drops a selection that scrolled out of the tree', () => {
    expect(tree).toContain('const live = new Set(visibleRows.map((r) => r.id))');
  });

  it('scrolls the tree while a drag is in flight', () => {
    // Chromium withholds the wheel during a native drag, so the edges scroll
    expect(shell).toContain('function onBodyDragOver(ev)');
    expect(shell).toContain('setEdgeScroll(-1)');
    expect(shell).toContain('setEdgeScroll(1)');
    expect(shell).toContain('requestAnimationFrame(stepEdgeScroll)');
    expect(shell).toContain('cancelAnimationFrame(edgeRaf)');
    // and the wheel is used where it is delivered
    expect(shell).toContain('function onBodyWheel(ev)');
    expect(shell).toContain('if (!dragActive || !bodyEl) return;');
  });

  it('pages a folder in on expand instead of listing it whole', () => {
    expect(tree).toContain('onclick={() => onmorefolder(node.path)}');
    expect(tree).toContain('{#if !sec.done}');
  });
});

describe('entity row', () => {
  it('is one component shared by both bodies', () => {
    expect(tree).toContain("import EntityRow from './EntityRow.svelte'");
    expect(results).toContain("import EntityRow from './EntityRow.svelte'");
    expect(results).toContain('meta={resultMeta(e)}');
  });

  it('keeps the tool actions, and swaps them for triage on a suggestion', () => {
    expect(row).toContain('title="Go to these coordinates on the map"');
    expect(row).toContain('title="Open in new tab"');
    expect(row).toContain('title="Unfile from this folder"');
    expect(row).toContain('title="Confirm"');
    expect(row).toContain('title="Dismiss"');
  });
});

describe('details drawer', () => {
  it('covers the sidebar instead of growing under the tree', () => {
    expect(drawer).toContain('position: absolute;');
    expect(drawer).toContain('inset: 0;');
    expect(shell).not.toContain('scrollIntoView');
    expect(shell).not.toContain('detailsEl');
  });

  it('closes on Escape, on the back arrow and on delete', () => {
    expect(drawer).toContain("onkeydown={(e) => e.key === 'Escape' && onclose()}");
    expect(drawer).toContain('title="Back to the case"');
    expect(shell).toContain('<DetailsDrawer entity={infoEntity} onclose={closeInfo} ondeleted={closeInfo} />');
  });

  it('hands focus back to the row it was opened from', () => {
    expect(shell).toContain('returnFocusEl = document.activeElement');
    expect(shell).toContain('returnFocusEl?.focus?.()');
  });

  it('shares the editor body with the Media Library modal', () => {
    expect(drawer).toContain("import EntityDetails from '../EntityDetails.svelte'");
  });
});
