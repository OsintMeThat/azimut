import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./Files.svelte', import.meta.url), 'utf8');

describe('Files bounded loading', () => {
  it('loads a bounded first page, not the whole catalog on open', () => {
    expect(source).toContain('createPagedList');
    expect(source).toContain("status: 'confirmed'");
    expect(source).toContain('limit: PAGE');
    // the complete-folder fetch is opt-in to List view, not part of case open
    expect(source).toContain("view === 'list'");
  });

  it('offers Show more with an honest filtered total', () => {
    expect(source).toContain('{#if !showTrash && pl.hasMore}');
    expect(source).toContain('pl.loadMore()');
    expect(source).toContain('Showing {confirmed.length} of {total}');
    expect(source).toContain('/catalog/summary');
    expect(source).toContain('searching && pl.serverMode ? pl.total');
  });

  it('clears the previous case before loading the next', () => {
    expect(source).toContain('pl.clear()');
  });

  it('searches every page and descendant folder through the catalog endpoint', () => {
    expect(source).toContain('pl.setQuery(query)');
    expect(source).toContain('query: serverQuery');
    expect(source).toContain('recursive: Boolean(serverQuery && cwd)');
  });

  it('loads metadata only for paths the view can render', () => {
    expect(source).toContain('/media/metadata');
    expect(source).toContain('unique.slice(i, i + 500)');
    expect(source).not.toContain(`/satellite\``);
    expect(source).not.toContain(`/media\``);
    expect(source).toContain('if (caseState.current?.id !== id) return');
  });
});

describe('Files desktop affordances', () => {
  it('uses the shared SearchInput and a sort control', () => {
    expect(source).toContain("import SearchInput from '../components/SearchInput.svelte'");
    expect(source).toContain('onSortSelect');
    expect(source).toContain('sortEntities(');
  });

  it('search also matches notes, not just label/type/folder', () => {
    expect(source).toContain('e.attrs?.notes');
  });

  it('keeps the sort control compact instead of stretching to full width', () => {
    // the global .select is width:100%; the header control must override it or
    // it balloons across the toolbar (reported "the sort bar is enormous")
    const block = source.slice(
      source.indexOf('.sort-select {'),
      source.indexOf('}', source.indexOf('.sort-select {'))
    );
    expect(block).toContain('width: auto');
    expect(block).toContain('flex-shrink: 0');
  });

  it('offers three view modes: small, large, and a details list', () => {
    expect(source).toContain("let view = $state('small')");
    expect(source).toContain("{ id: 'small', label: 'Small'");
    expect(source).toContain("{ id: 'large', label: 'Large'");
    expect(source).toContain("{ id: 'list', label: 'List'");
    expect(source).toContain('const dense = $derived(');
  });

  it('renders the list view with Name/Type/Size/Added columns', () => {
    expect(source).toContain("{:else if view === 'list'}");
    expect(source).toContain("{ id: 'name', label: 'Name' }");
    expect(source).toContain("{ id: 'type', label: 'Type' }");
    expect(source).toContain("{ id: 'size', label: 'Size' }");
    expect(source).toContain("{ id: 'recent', label: 'Added' }");
    // size comes from the media shelf, added from provenance
    expect(source).toContain('fmtSize(tileSize(e))');
    expect(source).toContain('fmtAdded(e)');
  });

  it('sorts from clickable headers and loads the complete open folder', () => {
    expect(source).toContain('setHeaderSort(column.id)');
    expect(source).toContain('sortDirection');
    expect(source).toContain('fetchAllEntities(id');
    expect(source).toContain("{ folder }");
    expect(source).toContain('{ unfiled: true }');
    expect(source).toContain('Loading all files in this folder');
  });

  it('carries the same selection/drag wiring onto list rows', () => {
    // list rows must be selectable, draggable and openable like the tiles
    expect(source).toContain('class="lrow entity"');
    expect(source).toContain('onclick={(ev) => onTileClick(ev, e.id)}');
    expect(source).toContain('ondragstart={(ev) => onTileDragStart(ev, e.id)}');
  });

  it('previews rendered proof PNGs in both tiles and list rows', () => {
    expect(source).toContain("e.type === 'proof' && typeof path === 'string' && /\\.png$/i.test(path)");
    expect(source).toContain('class="lrow-thumb"');
    expect(source).toContain('src={`/files/${caseState.current.id}/${tileThumb(e)}`}');
    expect(source).toContain('{#if tileThumb(e)}');
  });
});

describe('Files trash', () => {
  it('shows the trash as a first-class Files location', () => {
    expect(source).toContain('onclick={openTrash}');
    expect(source).toContain('<span class="tname">Trash</span>');
    expect(source).toContain('{#if showTrash}');
    expect(source).toContain('{formatSize(trashData.size_bytes)}');
  });

  it('offers the same restore and permanent actions as the sidebar', () => {
    expect(source).toContain('restoreGroup(caseState.current.id, group.id)');
    expect(source).toContain('purgeGroup(caseState.current.id, group.id)');
    expect(source).toContain('emptyTrash(caseState.current.id)');
    expect(source).toContain('onclick={() => restoreTrashItem(group)}');
    expect(source).toContain('onclick={() => askPurgeTrashItem(group)}');
    expect(source).toContain('onclick={askEmptyFilesTrash}');
  });

  it('keeps permanent deletion behind the danger confirmation', () => {
    expect(source).toContain("title: 'Delete permanently?'");
    expect(source).toContain("title: 'Empty the trash?'");
    expect(source).toContain("detail: 'The files will be deleted from disk.'");
    expect(source).toContain("tone: 'danger'");
  });
});

describe('Files delete shortcut', () => {
  it('routes Delete through the existing grouped confirmation', () => {
    expect(source).toContain('<svelte:window onkeydown={onFilesKeydown} />');
    expect(source).toContain("event.key !== 'Delete'");
    expect(source).toContain('askDeleteEntities([...selected])');
    expect(source).toContain('event.preventDefault()');
  });

  it('does nothing in fields, Trash, or outside Files', () => {
    expect(source).toContain("uiState.tool !== 'files'");
    expect(source).toContain('showTrash');
    expect(source).toContain("target.matches('input, textarea, select')");
    expect(source).toContain('target.isContentEditable');
  });
});
