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

  it('searches through the one predicate the server index is mirrored in', () => {
    // Notes, folder and the declared fields all ride on that shared helper, so this
    // tool cannot drift from the board or from `search_text`.
    expect(source).toContain("import { matchesEntity } from '../lib/entitySearch.js'");
    expect(source).toContain('matchesEntity(e, query)');
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
    expect(source).toContain('src={fileUrl(caseState.current.id, tileThumb(e))}');
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

describe('Ctrl+V on the desktop', () => {
  it('gives Files the only way it has ever had to take a file', () => {
    // its drag and drop moves items between folders, so an image had to go through
    // the Media grid and be filed afterwards
    expect(source).toContain("import { listenForPaste, pasteImage, resolvePaste } from '../lib/clipboardPaste.js'");
    expect(source).toContain("import PasteDialog from '../components/PasteDialog.svelte'");
    expect(source).toContain("resolvePaste('files', payload,");
  });

  it('only answers while it is the tool on screen', () => {
    expect(source).toMatch(/uiState\.tool !== 'files'\) return;\s*return listenForPaste/);
  });

  it('opens on the folder being looked at, like the New bookmark button does', () => {
    expect(source).toContain("{ folder: showUnfiled ? '' : cwd }");
  });

  it('files the image where the dialog said, and takes a link as a bookmark', () => {
    expect(source).toContain('await assignFolder(caseId, result.entity, values.folder)');
    expect(source).toContain('await createBookmark(caseId, { ...values, url: payload.url })');
  });

  it('shows the folder it landed in, so nothing is filed out of sight', () => {
    expect(source).toContain('function revealFiled(folder)');
    expect(source).toContain('if (folder) openFolder(folder);');
    expect(source).toContain('else openUnfiled();');
  });

  it('leaves a duplicate where it already sits', () => {
    // refiling it under this paste's folder would move an item filed on purpose
    expect(source).toContain('if (!result.duplicate && values.folder)');
  });

  it('offers the folder picker the same tree every other dialog here gets', () => {
    expect(source).toMatch(/<PasteDialog[^>]*folders=\{allFolders\}/s);
  });
});

describe('Files — acting on what the view actually shows', () => {
  it('resolves a selection against the complete folder, not the first page', () => {
    // List view renders `completeFolderEntities` (the whole open folder) while
    // move and delete filtered `confirmed` (the first 200 rows case-wide), so
    // any row past page one silently no-opped.
    expect(source).toContain('const selectable = $derived(');
    expect(source).toContain('const ents = selectable.filter((e) => ids.includes(e.id));');
    expect(source).not.toContain('const ents = confirmed.filter((e) => ids.includes(e.id));');
  });
});
