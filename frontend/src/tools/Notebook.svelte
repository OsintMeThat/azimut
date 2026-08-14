<script>
  import { api } from '../lib/api.js';
  import { fetchAllEntities } from '../lib/catalog.js';
  import { caseState, uiState, toast, reloadCase } from '../lib/state.svelte.js';
  import { entityReference, markdownHtml, remoteImageUrls } from '../lib/markdown.js';
  import { drawMermaidDiagrams } from '../lib/mermaid.js';
  import { createNote, deleteNote, resetCaseNotes } from '../lib/notes.js';
  import {
    clampNotebookHelpPosition, clampNotebookSplit, loadNotebookSplit, loadNotebookText,
    saveNotebookSplit,
  } from '../lib/notebook.js';
  import { exportNotes, revealExports } from '../lib/notesExport.js';
  import { destinationLabel, readDestinations } from '../lib/exportDest.js';
  import { insertNotebookText, notebookImageMarkdown, notebookMediaMarkdown } from '../lib/notebookContent.js';
  import { caseTab, closeNotebookTab, openNotebookTab } from '../lib/notebookTabs.js';
  import { openEntity } from '../lib/navigate.js';
  import { deletedToast, RESTORABLE } from '../lib/trash.js';
  import { matchesTerms } from '../lib/folderBrowse.js';
  import Icon from '../components/Icon.svelte';
  import SearchInput from '../components/SearchInput.svelte';
  import FolderBrowser from '../components/FolderBrowser.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import ExportFolderPicker from '../components/ExportFolderPicker.svelte';
  import Modal from '../components/Modal.svelte';
  import FolderSelect from '../components/FolderSelect.svelte';

  let tabs = $state([]); // [{ id: 'case' | entity id, noteId }]
  let activeId = $state('case');
  let tabsCaseId = $state(null);
  let menuOpen = $state(false);
  let query = $state('');
  // Past a handful of notes the flat list stops being a way to find one: the
  // menu then offers a search box and a "…" that browses the note folders, the
  // same pair the media and proof pickers use.
  const NOTE_SEARCH_MIN = 6;
  let notesBrowserOpen = $state(false);
  let notesBrowsePath = $state('');
  let previewOnly = $state(false);
  let split = $state(loadNotebookSplit());
  let panesEl = $state(null);
  let resizing = $state(false);
  let writerEl = $state(null);
  let referenceOpen = $state(false);
  let referenceQuery = $state('');
  let mediaOpen = $state(false);
  let mediaQuery = $state('');
  let markdownHelpOpen = $state(false);
  let markdownHelpCollapsed = $state(false);
  let notebookEl = $state(null);
  let previewEl = $state(null);
  let markdownHelpEl = $state(null);
  let markdownHelpPosition = $state(null);
  let imageUploading = $state(false);
  let noteModal = $state(null);
  let noteModalSaving = $state(false);
  let noteAction = $state(null);
  let noteActionBusy = $state(false);
  let exportOpen = $state(false);
  let singleExportOpen = $state(false);
  let singleExportId = $state('case');
  let exportBusy = $state(false);
  let exportQuery = $state('');
  let exportSelection = $state(new Set());
  // Where the PDFs land, app-wide and remembered. Empty = the case's own
  // exports folder, so a fresh install exports without being asked anything.
  let exportDir = $state('');
  let exportPicker = $state(false);

  let text = $state('');
  let loadedKey = $state('');
  let pendingSaves = $state(0);
  let saved = $state(true);
  let editVersion = 0;
  let saveTimer;
  let pendingSave = null; // the debounced write, callable before its timer fires

  // The whole entity set — notes to list, references and media to insert, and the
  // targets `[[mentions]]` resolve to — read off the bounded catalog rather than
  // the case-open payload. Mention autocomplete inherently spans every entity, so
  // it fetches the whole slice, but server-side and re-read on any change.
  let graphEntities = $state([]);
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev;
    if (!id) {
      graphEntities = [];
      return;
    }
    let live = true;
    fetchAllEntities(id)
      .then((list) => { if (live) graphEntities = list; })
      .catch(() => { if (live) graphEntities = []; });
    return () => { live = false; };
  });

  const noteEntities = $derived(graphEntities
    .filter((entity) => entity.type === 'note')
    .sort((a, b) => a.label.localeCompare(b.label)));
  const filteredNotes = $derived(noteEntities.filter((entity) => matchesNote(entity, query)));
  // What the export dialog ticks: the case's own scratchpad first, then every
  // filed note. The scratchpad has no entity, so it carries the same id the
  // export route reads it under.
  const exportChoices = $derived([
    { id: 'case', label: 'Case notes', folder: '' },
    ...noteEntities.map((entity) => ({
      id: entity.id,
      label: entity.label,
      folder: entity.attrs?.folder ?? '',
    })),
  ].filter((choice) => matchesTerms(`${choice.label} ${choice.folder}`, exportQuery)));
  const referenceEntities = $derived(graphEntities
    .filter((entity) => entity.provenance?.status !== 'suggested')
    .filter((entity) => `${entity.label} ${entity.type}`.toLowerCase().includes(referenceQuery.trim().toLowerCase()))
    .sort((a, b) => a.label.localeCompare(b.label)));
  const caseMedia = $derived(graphEntities
    .filter((entity) => (entity.type === 'media' || entity.type === 'capture') && entity.attrs?.path)
    .filter((entity) => `${entity.label} ${entity.attrs?.kind ?? ''}`.toLowerCase().includes(mediaQuery.trim().toLowerCase()))
    .sort((a, b) => a.label.localeCompare(b.label)));
  const activeTab = $derived(tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? null);
  const noteId = $derived(activeTab?.noteId ?? null);
  const title = $derived(noteId
    ? noteEntities.find((entity) => entity.id === noteId)?.label ?? 'Note'
    : 'Case Notes');
  const endpoint = $derived(noteId
    ? `/api/cases/${caseState.current?.id}/notes/${noteId}`
    : `/api/cases/${caseState.current?.id}/notes`);
  const key = $derived(caseState.current?.id ? `${caseState.current.id}:${noteId ?? 'case'}` : '');
  const preview = $derived(markdownHtml(text, {
    entities: graphEntities, caseId: caseState.current?.id ?? '',
  }));
  const remoteImages = $derived(remoteImageUrls(text));
  const saving = $derived(pendingSaves > 0);

  // Svelte has swapped the preview HTML by the time this runs, so any Mermaid
  // fence in it is back to undrawn text.
  $effect(() => {
    preview;
    if (previewEl) drawMermaidDiagrams(previewEl);
  });

  function resetTabs(caseId) {
    tabsCaseId = caseId;
    tabs = [caseTab()];
    activeId = 'case';
    previewOnly = false;
    menuOpen = false;
    notesBrowserOpen = false;
    notesBrowsePath = '';
    query = '';
    referenceOpen = false;
    referenceQuery = '';
    mediaOpen = false;
    mediaQuery = '';
    markdownHelpOpen = false;
    markdownHelpCollapsed = false;
    markdownHelpPosition = null;
    noteAction = null;
    noteActionBusy = false;
  }

  function openRequestedNote(noteId = null) {
    ({ tabs, activeId } = openNotebookTab(tabs, noteId));
  }

  $effect(() => {
    const caseId = caseState.current?.id ?? null;
    if (caseId !== tabsCaseId) {
      if (caseId) resetTabs(caseId);
      else {
        tabsCaseId = null;
        tabs = [];
      }
    }
    if (caseId) openRequestedNote(uiState.openNotebook?.noteId ?? null);
  });

  $effect(() => {
    if (!key || key === loadedKey) return;
    const requestedKey = key;
    const requestedEndpoint = endpoint;
    loadedKey = requestedKey;
    text = '';
    saved = true;
    editVersion += 1;
    loadNotebookText(requestedKey, requestedEndpoint, { get: api.get, currentKey: () => key })
      .then((result) => {
        if (result.accepted && loadedKey === requestedKey) text = result.text;
      })
      .catch((error) => {
        if (key === requestedKey) toast(`Could not open note: ${error.message}`, 'danger');
      });
  });

  $effect(() => {
    const clampToPanes = () => {
      if (panesEl) split = clampNotebookSplit(split, panesEl.clientWidth);
      const bounds = helpBounds();
      if (markdownHelpPosition && bounds) {
        const clamped = clampNotebookHelpPosition(
          markdownHelpPosition.x,
          markdownHelpPosition.y,
          bounds.panelWidth,
          bounds.panelHeight,
          bounds.containerWidth,
          bounds.containerHeight,
        );
        if (clamped.x !== markdownHelpPosition.x || clamped.y !== markdownHelpPosition.y) {
          markdownHelpPosition = clamped;
        }
      }
    };
    window.addEventListener('resize', clampToPanes);
    clampToPanes();
    return () => window.removeEventListener('resize', clampToPanes);
  });

  function onWindowKeydown(event) {
    if (event.key === 'Escape' && menuOpen) closeNotesMenu();
  }

  function matchesNote(entity, search) {
    return matchesTerms(`${entity.label} ${entity.attrs?.folder ?? ''}`, search);
  }

  function toggleNotesMenu() {
    menuOpen = !menuOpen;
    if (menuOpen) return;
    closeNotesMenu();
  }

  function closeNotesMenu() {
    menuOpen = false;
    notesBrowserOpen = false;
    notesBrowsePath = '';
  }

  function toggleNotesBrowser() {
    notesBrowserOpen = !notesBrowserOpen;
    notesBrowsePath = '';
  }

  function selectTab(tab) {
    activeId = tab.id;
    uiState.openNotebook = { noteId: tab.noteId };
    closeNotesMenu();
  }

  function selectNote(noteId = null) {
    openRequestedNote(noteId);
    uiState.openNotebook = { noteId };
    closeNotesMenu();
  }

  function openNewNote() {
    noteModal = { title: '', folder: '' };
  }

  async function saveNote() {
    if (!noteModal) return;
    const { title: noteTitle, folder } = noteModal;
    if (!noteTitle.trim()) {
      toast('Title required', 'warn');
      return;
    }
    noteModalSaving = true;
    try {
      const note = await createNote(caseState.current.id, { title: noteTitle, folder });
      await reloadCase();
      noteModal = null;
      openRequestedNote(note.id);
      uiState.openNotebook = { noteId: note.id };
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      noteModalSaving = false;
    }
  }

  function askNoteAction() {
    if (!caseState.current) return;
    if (noteId) {
      const note = noteEntities.find((entity) => entity.id === noteId);
      if (!note) return;
      noteAction = { kind: 'delete', noteId, label: note.label };
      return;
    }
    noteAction = { kind: 'reset' };
  }

  function cancelPendingSave() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    pendingSave = null; // deliberately dropped: the note is being deleted or reset
    editVersion += 1;
  }

  function closeDeletedNote(deletedNoteId) {
    const next = closeNotebookTab(tabs, activeId, deletedNoteId);
    tabs = next.tabs;
    activeId = next.activeId;
    const active = tabs.find((tab) => tab.id === activeId);
    uiState.openNotebook = { noteId: active?.noteId ?? null };
  }

  async function confirmNoteAction() {
    const action = noteAction;
    if (!action || !caseState.current) return;
    noteActionBusy = true;
    cancelPendingSave();
    try {
      if (action.kind === 'delete') {
        const caseId = caseState.current.id;
        const result = await deleteNote(caseId, action.noteId);
        closeDeletedNote(action.noteId);
        await reloadCase();
        deletedToast(caseId, result, action.label);
      } else {
        await resetCaseNotes(caseState.current.id);
        text = '';
        saved = true;
        toast('Note content reset', 'ok', 1800);
      }
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      noteActionBusy = false;
      noteAction = null;
    }
  }

  function closeTab(event, tab) {
    event.stopPropagation();
    if (tab.id === 'case') return;
    const next = closeNotebookTab(tabs, activeId, tab.id);
    tabs = next.tabs;
    activeId = next.activeId;
    if (activeId === tab.id) return;
    const active = tabs.find((item) => item.id === activeId);
    if (active) uiState.openNotebook = { noteId: active.noteId };
  }

  function saveSoon() {
    saved = false;
    clearTimeout(saveTimer);
    const target = endpoint;
    const targetKey = key;
    const contents = text;
    const version = ++editVersion;
    // Kept beside the timer so the edit can be written *now* by anything that
    // has to get it onto disk before it acts (see runExport). The arguments are
    // the ones captured here, not the live fields: by the time this is flushed
    // the analyst may be on another note.
    pendingSave = () => save(target, targetKey, contents, version);
    saveTimer = setTimeout(() => {
      pendingSave = null;
      save(target, targetKey, contents, version);
    }, 700);
  }

  /** Write a debounced edit immediately, if one is still waiting. */
  async function flushPendingSave() {
    const write = pendingSave;
    clearTimeout(saveTimer);
    saveTimer = undefined;
    pendingSave = null;
    if (write) await write();
  }

  async function save(target, targetKey, contents, version) {
    if (!targetKey) return;
    pendingSaves += 1;
    try {
      await api.put(target, { text: contents });
      if (key === targetKey && editVersion === version) saved = true;
    } catch (error) {
      toast(`Note not saved: ${error.message}`, 'danger');
    } finally {
      pendingSaves -= 1;
    }
  }

  function setSplitFromClientX(clientX) {
    const rect = panesEl?.getBoundingClientRect();
    if (!rect) return;
    split = clampNotebookSplit(((clientX - rect.left) / rect.width) * 100, rect.width);
  }

  function startResize(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    resizing = true;
    setSplitFromClientX(event.clientX);
    const move = (moveEvent) => setSplitFromClientX(moveEvent.clientX);
    const stop = () => {
      resizing = false;
      saveNotebookSplit(split);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  function onSplitterKey(event) {
    const direction = { ArrowLeft: -2, ArrowRight: 2 }[event.key];
    if (direction === undefined) return;
    event.preventDefault();
    split = clampNotebookSplit(split + direction, panesEl?.clientWidth);
    saveNotebookSplit(split);
  }

  function resetSplit() {
    split = 50;
    saveNotebookSplit(split);
  }

  /**
   * Export a selection of notes, one PDF each, into the notes export folder.
   *
   * The backend renders from what is on disk, so a pending edit is flushed
   * first — otherwise the analyst exports the note as it was 700 ms ago.
   *
   * The debounced save is flushed, never merely cancelled: the timer may hold
   * the only copy of an edit made in *another* tab, since switching tabs resets
   * `saved` without touching it. Dropping it lost that edit while the header
   * still read "Saved".
   */
  async function runExport(noteIds) {
    if (!caseState.current || exportBusy) return;
    const caseId = caseState.current.id;
    exportBusy = true;
    try {
      await flushPendingSave();
      if (!saved) await save(endpoint, key, text, editVersion);
      const result = await exportNotes(caseId, noteIds);
      exportOpen = false;
      singleExportOpen = false;
      const count = result.written.length;
      toast(
        `${count} PDF${count > 1 ? 's' : ''} written to ${destinationLabel(result.path)}`,
        'ok',
        5200,
        {
          label: 'Show',
          onClick: () => revealExports(caseId).catch((error) => toast(error.message, 'warn')),
        },
      );
      for (const warning of result.warnings) toast(warning, 'warn', 6500);
    } catch (error) {
      toast(`Export failed: ${error.message}`, 'danger');
    } finally {
      exportBusy = false;
    }
  }

  function readExportDestination() {
    readDestinations()
      .then((dirs) => (exportDir = dirs.notes))
      .catch(() => {});
  }

  function openCurrentExportDialog() {
    singleExportId = noteId ?? 'case';
    singleExportOpen = true;
    readExportDestination();
  }

  function openExportDialog() {
    exportSelection = new Set([noteId ?? 'case']);
    exportQuery = '';
    exportOpen = true;
    closeNotesMenu();
    // Read it here rather than on mount: the destination only matters once the
    // analyst is looking at the dialog that shows it.
    readExportDestination();
  }

  function toggleExportNote(id) {
    const next = new Set(exportSelection);
    if (!next.delete(id)) next.add(id);
    exportSelection = next;
  }

  function toggleExportAll() {
    const all = exportChoices.map((choice) => choice.id);
    exportSelection = new Set(exportSelection.size === all.length ? [] : all);
  }

  function toggleMarkdownHelp() {
    markdownHelpOpen = !markdownHelpOpen;
    if (markdownHelpOpen) {
      markdownHelpCollapsed = false;
      markdownHelpPosition = null;
    }
  }

  function toggleMarkdownHelpCollapsed() {
    markdownHelpCollapsed = !markdownHelpCollapsed;
    requestAnimationFrame(() => {
      const bounds = helpBounds();
      if (!markdownHelpPosition || !bounds) return;
      markdownHelpPosition = clampNotebookHelpPosition(
        markdownHelpPosition.x,
        markdownHelpPosition.y,
        bounds.panelWidth,
        bounds.panelHeight,
        bounds.containerWidth,
        bounds.containerHeight,
      );
    });
  }

  function helpBounds() {
    if (!notebookEl || !markdownHelpEl) return null;
    return {
      panelWidth: markdownHelpEl.offsetWidth,
      panelHeight: markdownHelpEl.offsetHeight,
      containerWidth: notebookEl.clientWidth,
      containerHeight: notebookEl.clientHeight,
    };
  }

  function startMarkdownHelpDrag(event) {
    if (event.button !== 0 || event.target.closest('button')) return;
    const bounds = helpBounds();
    if (!bounds) return;
    event.preventDefault();
    const parentRect = notebookEl.getBoundingClientRect();
    const panelRect = markdownHelpEl.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = panelRect.left - parentRect.left;
    const originY = panelRect.top - parentRect.top;
    const move = (moveEvent) => {
      markdownHelpPosition = clampNotebookHelpPosition(
        originX + moveEvent.clientX - startX,
        originY + moveEvent.clientY - startY,
        bounds.panelWidth,
        bounds.panelHeight,
        bounds.containerWidth,
        bounds.containerHeight,
      );
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  function insertAtCursor(value) {
    const input = writerEl;
    const start = input?.selectionStart ?? text.length;
    const end = input?.selectionEnd ?? text.length;
    const inserted = insertNotebookText(text, value, start, end);
    text = inserted.text;
    saveSoon();
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(inserted.cursor, inserted.cursor);
    });
  }

  function insertReference(entity) {
    insertAtCursor(entityReference(entity));
    referenceOpen = false;
    referenceQuery = '';
  }

  function insertCaseMedia(entity) {
    insertAtCursor(notebookMediaMarkdown(caseState.current.id, entity));
    mediaOpen = false;
    mediaQuery = '';
  }

  async function importImage(file) {
    if (!file || !file.type.startsWith('image/') || imageUploading) return;
    imageUploading = true;
    try {
      const form = new FormData();
      form.append('file', file, file.name || 'pasted-image.png');
      const result = await api.post(`/api/cases/${caseState.current.id}/media/upload`, form);
      await reloadCase();
      insertAtCursor(notebookImageMarkdown(caseState.current.id, result.item, result.entity));
      toast(result.duplicate ? 'Image linked from case media' : 'Image added to case media', 'ok', 1800);
    } catch (error) {
      toast(`Image not added: ${error.message}`, 'danger');
    } finally {
      imageUploading = false;
    }
  }

  function onWriterPaste(event) {
    const image = [...(event.clipboardData?.items ?? [])].find((item) => item.type.startsWith('image/'));
    if (!image) return;
    event.preventDefault();
    importImage(image.getAsFile());
  }

  function onWriterDrop(event) {
    event.preventDefault();
    const image = [...(event.dataTransfer?.files ?? [])].find((file) => file.type.startsWith('image/'));
    if (image) importImage(image);
  }

  function bindEntityLinks(node) {
    const onClick = (event) => {
      const link = event.target.closest('[data-entity-id]');
      if (!link) return;
      event.preventDefault();
      const entity = graphEntities.find((item) => item.id === link.dataset.entityId);
      if (entity) openEntity(entity);
    };
    node.addEventListener('click', onClick);
    return { destroy: () => node.removeEventListener('click', onClick) };
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if !caseState.current}
  <div class="empty"><h2>No case open</h2><p>Open a case to write notes.</p></div>
{:else}
  <section bind:this={notebookEl} class="notebook">
    <header class="notebook-bar">
      <div class="notes-menu-wrap">
        <button class="menu-toggle" class:active={menuOpen} onclick={toggleNotesMenu} aria-expanded={menuOpen}>
          <Icon name="note" size={15} /> Notes <Icon name="chevronDown" size={13} />
        </button>
        {#if menuOpen}
          <button class="menu-backdrop" onclick={closeNotesMenu} aria-label="Close the notes menu"></button>
          <div class="notes-menu">
            {#if notesBrowserOpen || noteEntities.length > NOTE_SEARCH_MIN}
              <div class="note-search">
                <SearchInput bind:value={query} placeholder="Find a note…" width="100%" />
                <button
                  class="btn btn-ghost btn-sm browse-btn"
                  title={notesBrowserOpen ? 'Show every note' : 'Browse folders'}
                  onclick={toggleNotesBrowser}
                >…</button>
              </div>
            {/if}
            <button class="menu-note" class:selected={activeId === 'case'} onclick={() => selectNote()}>
              <Icon name="note" size={14} /><span>Case Notes</span>
            </button>
            {#if notesBrowserOpen}
              <FolderBrowser
                entries={noteEntities}
                path={notesBrowsePath}
                rootLabel="Notes"
                selectedId={activeId}
                matches={(note) => matchesNote(note, query)}
                emptyText="This folder has no matching notes."
                icon={() => 'note'}
                label={(note) => note.label}
                onnavigate={(path) => (notesBrowsePath = path)}
                onselect={(note) => selectNote(note.id)}
              />
            {:else}
              {#each filteredNotes as note (note.id)}
                <button class="menu-note" class:selected={activeId === note.id} onclick={() => selectNote(note.id)}>
                  <Icon name="note" size={14} />
                  <span>{note.label}</span>
                  {#if note.attrs?.folder}<small>{note.attrs.folder}</small>{/if}
                </button>
              {/each}
              {#if !filteredNotes.length && query.trim()}<p class="menu-empty">No matching notes.</p>{/if}
            {/if}
          </div>
        {/if}
      </div>

      <div class="tabs" aria-label="Open notes">
        {#each tabs as tab (tab.id)}
          {@const tabTitle = tab.noteId ? noteEntities.find((entity) => entity.id === tab.noteId)?.label ?? 'Note' : 'Case Notes'}
          <div class="tab" class:active={tab.id === activeId}>
            <button class="tab-main" onclick={() => selectTab(tab)} title={tabTitle}>
              <Icon name="note" size={13} /><span>{tabTitle}</span>
            </button>
            {#if tab.id !== 'case'}<button class="tab-close" aria-label={`Close ${tabTitle}`} onclick={(event) => closeTab(event, tab)}><Icon name="x" size={12} /></button>{/if}
          </div>
        {/each}
      </div>
      <button class="btn btn-ghost btn-sm bar-button" title="New note" aria-label="New note" onclick={openNewNote}>
        <Icon name="plus" size={15} />
      </button>
      <button class="btn btn-ghost btn-sm bar-button" title="Export several notes as PDF" aria-label="Export several notes as PDF" onclick={openExportDialog}>
        <Icon name="layers" size={15} />
      </button>

      <div class="bar-actions">
        <span class:pending={!saved} class="save-state">{saved ? 'Saved' : saving ? 'Saving…' : 'Unsaved'}</span>
        <button class="btn btn-ghost btn-sm help-toggle" class:active={markdownHelpOpen} title="Markdown help" aria-label="Markdown help" aria-expanded={markdownHelpOpen} onclick={toggleMarkdownHelp}><Icon name="info" size={15} /></button>
        {#if markdownHelpOpen}
          <aside
            bind:this={markdownHelpEl}
            class="markdown-help"
            class:collapsed={markdownHelpCollapsed}
            aria-label="Markdown help"
            style:left={markdownHelpPosition ? `${markdownHelpPosition.x}px` : undefined}
            style:top={markdownHelpPosition ? `${markdownHelpPosition.y}px` : undefined}
          >
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="help-heading" onpointerdown={startMarkdownHelpDrag} title="Drag to move">
              <Icon name="grip" size={15} />
              <div><strong>Markdown reference</strong><span>Drag this header to move the reference.</span></div>
              <button
                class="btn btn-ghost btn-sm"
                title={markdownHelpCollapsed ? 'Expand' : 'Collapse'}
                aria-label={markdownHelpCollapsed ? 'Expand Markdown help' : 'Collapse Markdown help'}
                aria-expanded={!markdownHelpCollapsed}
                onclick={toggleMarkdownHelpCollapsed}
              ><Icon name={markdownHelpCollapsed ? 'chevronDown' : 'chevronUp'} size={14} /></button>
              <button class="btn btn-ghost btn-sm" aria-label="Close Markdown help" onclick={() => (markdownHelpOpen = false)}><Icon name="x" size={14} /></button>
            </div>
            {#if !markdownHelpCollapsed}
            <div class="help-body">
              <div class="help-section">
              <span class="help-label">Everyday formatting</span>
              <div class="example-grid">
                <div class="example-card">
                  <span class="example-name">Headings and text</span>
                  <pre><code># Field notes

**Confirmed** and *unverified*

~~Discarded lead~~</code></pre>
                  <div class="example-result prose-demo"><h3>Field notes</h3><p><strong>Confirmed</strong> and <em>unverified</em></p><p><s>Discarded lead</s></p></div>
                </div>
                <div class="example-card">
                  <span class="example-name">Lists and tasks</span>
                  <pre><code>- First observation
- Second observation

- [x] Archive source
- [ ] Verify date</code></pre>
                  <div class="example-result list-demo"><ul><li>First observation</li><li>Second observation</li></ul><label><input type="checkbox" checked disabled> Archive source</label><label><input type="checkbox" disabled> Verify date</label></div>
                </div>
                <div class="example-card">
                  <span class="example-name">Code block</span>
                  <pre><code>```js
const status = 'verified';
console.log(status);
```</code></pre>
                  <div class="example-result"><pre class="rendered-code"><code>const status = 'verified';
console.log(status);</code></pre></div>
                </div>
                <div class="example-card">
                  <span class="example-name">Table</span>
                  <pre><code>| Source | Status |
| --- | --- |
| Photo | Verified |
| Post | Pending |</code></pre>
                  <div class="example-result table-demo"><table><thead><tr><th>Source</th><th>Status</th></tr></thead><tbody><tr><td>Photo</td><td>Verified</td></tr><tr><td>Post</td><td>Pending</td></tr></tbody></table></div>
                </div>
                <div class="example-card">
                  <span class="example-name">Diagram</span>
                  <pre><code>```mermaid
flowchart LR
  A[Tip] --&gt; B[Check]
  B --&gt; C[Confirmed]
```</code></pre>
                  <div class="example-result diagram-demo"><i>Tip</i><b></b><i>Check</i><b></b><i>Confirmed</i></div>
                  <p class="example-note">
                    <code>LR</code> runs left to right; <code>TD</code>, <code>RL</code> and <code>BT</code> are the
                    other directions. Sequence, state, pie, Gantt and mindmap diagrams work too.
                  </p>
                </div>
              </div>
              </div>
              <div class="help-section">
              <span class="help-label">Case content</span>
              <div class="case-help">
                <div><Icon name="link" size={14} /><span><strong>Link button</strong> inserts a clickable Case item.</span></div>
                <div><Icon name="media" size={14} /><span><strong>Media button</strong> inserts a Case image or video.</span></div>
                <div><Icon name="image" size={14} /><span><strong>Paste or drop</strong> adds an image to the Case.</span></div>
              </div>
              </div>
              <div class="help-section layout-help">
              <span class="help-label">Image and text layout</span>
              <div class="example-grid">
                <div class="layout-row"><pre><code>![Map](image.png)&#123;width=50% align=center&#125;</code></pre><div class="image-demo center"><i></i></div></div>
                <div class="layout-row"><pre><code>::: center
**Centred finding**
:::</code></pre><div class="text-demo center"><strong>Centred finding</strong></div></div>
              </div>
              <p>Use <code>align=left</code>, <code>align=center</code>, or <code>align=right</code>. Width accepts percentages or pixels.</p>
              </div>
            </div>
            {/if}
          </aside>
        {/if}
      </div>
    </header>

    <div bind:this={panesEl} class="panes" class:preview-only={previewOnly} class:resizing style={`grid-template-columns: calc(${split}% - 4px) 8px calc(${100 - split}% - 4px);`}>
      <section class="pane writer">
        <div class="pane-title">
          <span>Write</span>
          <div class="writer-actions">
            <button class="btn btn-ghost btn-sm" class:active={referenceOpen} title="Insert case reference" onclick={() => (referenceOpen = !referenceOpen)}><Icon name="link" size={14} /></button>
            <button class="btn btn-ghost btn-sm" class:active={mediaOpen} title="Insert case media" onclick={() => (mediaOpen = !mediaOpen)}><Icon name="media" size={14} /></button>
            <button
              class="btn btn-ghost btn-sm"
              title={noteId ? 'Delete note' : 'Reset note content'}
              aria-label={noteId ? 'Delete note' : 'Reset note content'}
              onclick={askNoteAction}
            ><Icon name={noteId ? 'trash' : 'reset'} size={14} /></button>
            {#if referenceOpen}
              <div class="reference-menu">
                <input class="input" bind:value={referenceQuery} placeholder="Find an entity…" />
                {#each referenceEntities as entity (entity.id)}
                  <button class="reference-row" onclick={() => insertReference(entity)}><Icon name={entity.type === 'note' ? 'note' : entity.type === 'place' ? 'pin' : 'link'} size={13} /><span>{entity.label}</span><small>{entity.type}</small></button>
                {/each}
                {#if !referenceEntities.length}<p>No matching entities.</p>{/if}
              </div>
            {/if}
            {#if mediaOpen}
              <div class="reference-menu media-menu">
                <input class="input" bind:value={mediaQuery} placeholder="Find case media…" />
                {#each caseMedia as entity (entity.id)}
                  <button class="reference-row" onclick={() => insertCaseMedia(entity)}><Icon name={entity.attrs?.kind === 'video' ? 'video' : 'image'} size={13} /><span>{entity.label}</span><small>{entity.attrs?.kind ?? entity.type}</small></button>
                {/each}
                {#if !caseMedia.length}<p>No matching media.</p>{/if}
              </div>
            {/if}
          </div>
        </div>
        <textarea bind:this={writerEl} bind:value={text} oninput={saveSoon} onpaste={onWriterPaste} ondragover={(event) => event.preventDefault()} ondrop={onWriterDrop} placeholder={imageUploading ? 'Adding image…' : 'Write in Markdown…'}></textarea>
        {#if remoteImages.length}
          <p class="remote-image-note">
            Remote images contact their host every time this note opens. Add them to the case to keep the note local.
          </p>
        {/if}
      </section>
      <button class="splitter" aria-label="Resize writer and preview" title="Drag to resize · double-click to reset" onpointerdown={startResize} ondblclick={resetSplit} onkeydown={onSplitterKey}></button>
      <article class="pane reader">
        <div class="pane-title"><span>Preview</span><div class="preview-actions"><button class="btn btn-ghost btn-sm" title="Export this note as PDF" aria-label="Export this note as PDF" disabled={exportBusy} onclick={openCurrentExportDialog}><Icon name="download" size={14} /></button><button class="btn btn-ghost btn-sm preview-toggle" title={previewOnly ? 'Show writer' : 'Preview only'} onclick={() => (previewOnly = !previewOnly)}><Icon name={previewOnly ? 'minimize' : 'maximize'} size={14} /></button></div></div>
        <div bind:this={previewEl} class="markdown" aria-label="Markdown preview" use:bindEntityLinks>{@html preview}</div>
      </article>
    </div>
  </section>
  {#if noteModal}
    <Modal title="New note" onclose={() => (noteModal = null)} width="580px">
      <label class="modal-label" for="notebook-note-title">Title</label>
      <input id="notebook-note-title" class="input" placeholder="Note title…" bind:value={noteModal.title} />

      <span class="modal-label" style="margin-top:10px">Folder (in My work)</span>
      <FolderSelect bind:value={noteModal.folder} folders={caseState.current?.folders ?? []} emptyLabel="My work (root)" />

      <div class="modal-row">
        <div style="flex:1"></div>
        <button class="btn" onclick={() => (noteModal = null)}>Cancel</button>
        <button class="btn btn-primary" onclick={saveNote} disabled={noteModalSaving}>
          {noteModalSaving ? 'Creating…' : 'Create'}
        </button>
      </div>
    </Modal>
  {/if}
  {#if singleExportOpen}
    <Modal title="Export note as PDF" onclose={() => (singleExportOpen = false)} width="560px">
      <div class="export-dest">
        <span class="dest-label">Destination</span>
        <span class="dest-path mono" title={exportDir || "The case's own exports folder"}>
          {exportDir || "the case's exports folder"}
        </span>
        <button class="btn btn-ghost btn-sm" onclick={() => (exportPicker = true)}>Change</button>
      </div>
      <p class="export-note">
        One PDF will be written.
        {#if exportDir}Files already there are kept.{:else}An existing file with the same name is replaced.{/if}
      </p>
      <div class="modal-row">
        <div style="flex:1"></div>
        <button class="btn" onclick={() => (singleExportOpen = false)}>Cancel</button>
        <button class="btn btn-primary" disabled={exportBusy} onclick={() => runExport([singleExportId])}>
          {exportBusy ? 'Exporting…' : 'Export PDF'}
        </button>
      </div>
    </Modal>
  {/if}
  {#if exportOpen}
    <Modal title="Export notes as PDF" onclose={() => (exportOpen = false)} width="560px">
      {#if exportChoices.length > NOTE_SEARCH_MIN}
        <SearchInput bind:value={exportQuery} placeholder="Find a note…" />
      {/if}
      <div class="export-list">
        {#each exportChoices as choice (choice.id)}
          <label class="export-row">
            <input
              type="checkbox"
              checked={exportSelection.has(choice.id)}
              onchange={() => toggleExportNote(choice.id)}
            />
            <span class="export-name">{choice.label}</span>
            {#if choice.folder}<small>{choice.folder}</small>{/if}
          </label>
        {/each}
        {#if !exportChoices.length}<p class="export-empty">No matching notes.</p>{/if}
      </div>
      <div class="export-dest">
        <span class="dest-label">Destination</span>
        <span class="dest-path mono" title={exportDir || "The case's own exports folder"}>
          {exportDir || "the case's exports folder"}
        </span>
        <button class="btn btn-ghost btn-sm" onclick={() => (exportPicker = true)}>Change</button>
      </div>
      <p class="export-note">
        One PDF per note.
        {#if exportDir}Files already there are kept.{:else}Existing files are replaced.{/if}
      </p>
      <div class="modal-row">
        <button class="btn btn-ghost btn-sm" onclick={toggleExportAll}>
          {exportSelection.size === exportChoices.length ? 'Clear' : 'Select all'}
        </button>
        <div style="flex:1"></div>
        <button class="btn" onclick={() => (exportOpen = false)}>Cancel</button>
        <button
          class="btn btn-primary"
          disabled={exportBusy || !exportSelection.size}
          onclick={() => runExport([...exportSelection])}
        >
          {exportBusy ? 'Exporting…' : `Export ${exportSelection.size || ''}`}
        </button>
      </div>
    </Modal>
  {/if}
  {#if exportPicker}
    <ExportFolderPicker
      kind="notes"
      current={exportDir}
      onclose={() => (exportPicker = false)}
      onchosen={(path) => (exportDir = path)}
    />
  {/if}
  {#if noteAction}
    <ConfirmDialog
      title={noteAction.kind === 'delete' ? 'Delete this note?' : 'Reset note content?'}
      message={noteAction.kind === 'delete'
        ? `Are you sure you want to delete “${noteAction.label}”?`
        : 'Are you sure you want to reset the content of this note?'}
      detail={noteAction.kind === 'delete'
        ? 'Moves the note and its contents to the case trash.'
        : 'The case note will remain, but its content will be cleared.'}
      restorable={noteAction.kind === 'delete' ? RESTORABLE : ''}
      confirmLabel={noteAction.kind === 'delete' ? 'Delete' : 'Reset'}
      tone="default"
      icon={noteAction.kind === 'delete' ? 'trash' : 'reset'}
      busy={noteActionBusy}
      onconfirm={confirmNoteAction}
      oncancel={() => (noteAction = null)}
    />
  {/if}
{/if}

<style>
  .notebook { position: relative; height: 100%; display: flex; flex-direction: column; }
  .notebook-bar { height: 42px; flex: 0 0 42px; display: flex; align-items: stretch; gap: 8px; padding: 0 10px; border-bottom: 1px solid var(--border); background: var(--bg-1); }
  .notes-menu-wrap { position: relative; display: flex; align-items: center; flex-shrink: 0; }
  .menu-toggle { display: flex; align-items: center; gap: 5px; padding: 5px 7px; border-radius: var(--r-sm); color: var(--text-2); font-size: var(--fs-sm); }
  .menu-toggle:hover, .menu-toggle.active { background: var(--bg-2); color: var(--text-1); }
  .notes-menu { position: absolute; z-index: 8; top: calc(100% + 5px); left: 0; width: 270px; max-height: min(440px, calc(100vh - 115px)); overflow: auto; padding: 6px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-1); box-shadow: 0 12px 30px #0004; }
  .menu-backdrop { position: fixed; inset: 0; z-index: 7; cursor: default; }
  .note-search { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
  .note-search :global(.search-box) { flex: 1; }
  .browse-btn { min-width: 30px; font-size: var(--fs-lg); line-height: 1; }
  .menu-note { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 7px; width: 100%; padding: 7px; border-radius: var(--r-sm); text-align: left; color: var(--text-2); font-size: var(--fs-sm); }
  .menu-note:hover, .menu-note.selected { background: var(--bg-2); color: var(--text-1); }
  .menu-note span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .menu-note small { grid-column: 2; color: var(--text-3); font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .menu-empty { margin: 8px; color: var(--text-3); font-size: var(--fs-sm); }
  .tabs { flex: 1; min-width: 0; display: flex; align-items: stretch; overflow-x: auto; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .bar-button { flex-shrink: 0; align-self: center; color: var(--text-2); }
  .bar-button:hover { color: var(--accent); }
  .tab { display: flex; align-items: center; max-width: 180px; color: var(--text-3); border-bottom: 2px solid transparent; font-size: var(--fs-sm); white-space: nowrap; }
  .tab:hover { color: var(--text-1); background: var(--bg-2); }
  .tab.active { color: var(--text-1); border-bottom-color: var(--accent); }
  .tab-main { min-width: 0; display: flex; align-items: center; gap: 5px; padding: 0 6px 0 8px; color: inherit; }
  .tab-main > span { overflow: hidden; text-overflow: ellipsis; }
  .tab-close { display: flex; padding: 2px; color: var(--text-3); border-radius: 3px; }
  .tab-close:hover { color: var(--text-1); background: var(--bg-3); }
  .bar-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
  .save-state { color: var(--text-3); font-size: var(--fs-xs); }
  .save-state.pending { color: var(--accent); }
  .help-toggle.active { color: var(--accent); background: var(--accent-soft); }
  .markdown-help { position: absolute; z-index: 10; top: 54px; right: 12px; width: min(760px, calc(100% - 24px)); max-height: calc(100% - 66px); overflow: auto; padding: 0 16px 16px; border: 1px solid var(--border); border-radius: var(--r-md); background: color-mix(in srgb, var(--bg-1) 96%, transparent); box-shadow: 0 20px 50px #0007; backdrop-filter: blur(8px); }
  .markdown-help.collapsed { width: min(380px, calc(100% - 24px)); overflow: hidden; padding-bottom: 0; }
  .help-heading { position: sticky; z-index: 1; top: 0; display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 9px; padding: 13px 0 11px; border-bottom: 1px solid var(--border); background: var(--bg-1); cursor: grab; touch-action: none; }
  .markdown-help.collapsed .help-heading { padding-bottom: 13px; border-bottom: 0; }
  .help-heading:active { cursor: grabbing; }
  .help-heading strong { display: block; color: var(--text-1); font-size: var(--fs-sm); }
  .help-heading span { display: block; margin-top: 2px; color: var(--text-3); font-size: var(--fs-xs); }
  .help-section { padding-top: 15px; }
  .help-label { display: block; margin-bottom: 8px; color: var(--text-3); font-size: var(--fs-xs); font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
  .markdown-help code { padding: 2px 4px; border-radius: 3px; background: var(--bg-2); color: var(--text-1); font-family: var(--mono); font-size: 11px; }
  .example-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .example-card { min-width: 0; overflow: hidden; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-0); }
  .example-name { display: block; padding: 7px 9px; border-bottom: 1px solid var(--border); color: var(--text-2); font-size: var(--fs-xs); font-weight: 600; }
  .example-card > pre, .layout-row > pre { min-height: 72px; margin: 0; padding: 9px; overflow: auto; border-bottom: 1px solid var(--border); background: var(--bg-2); line-height: 1.45; white-space: pre-wrap; }
  .example-card > pre code, .layout-row > pre code, .rendered-code code { padding: 0; background: transparent; }
  .example-result { min-height: 88px; padding: 10px; color: var(--text-1); font-size: var(--fs-xs); }
  .prose-demo h3 { margin: 0 0 8px; font-size: 15px; }
  .prose-demo p { margin: 5px 0; }
  .list-demo ul { margin: 0 0 7px; padding-left: 18px; }
  .list-demo label { display: block; margin-top: 4px; }
  .list-demo input { margin-right: 5px; accent-color: var(--accent); }
  .rendered-code { margin: 0; padding: 9px; overflow: auto; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-2); line-height: 1.5; }
  .diagram-demo { min-height: 0; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 7px; }
  .diagram-demo i { padding: 5px 9px; border: 1px solid var(--accent); border-radius: 4px; background: var(--accent-soft); font-style: normal; }
  .diagram-demo b { position: relative; width: 22px; height: 1px; background: var(--text-3); }
  .diagram-demo b::after { content: ''; position: absolute; top: -3px; right: -1px; border: 3.5px solid transparent; border-right: 0; border-left-color: var(--text-3); }
  .example-note { margin: 0; padding: 0 10px 10px; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.45; }
  .table-demo table { width: 100%; border-collapse: collapse; }
  .table-demo th, .table-demo td { padding: 6px 7px; border: 1px solid var(--border); text-align: left; }
  .table-demo th { background: var(--bg-2); }
  .case-help { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
  .case-help > div { display: flex; align-items: flex-start; gap: 7px; padding: 9px; border: 1px solid var(--border); border-radius: var(--r-sm); color: var(--text-2); font-size: var(--fs-xs); line-height: 1.45; }
  .case-help :global(svg) { flex: 0 0 auto; margin-top: 1px; color: var(--accent); }
  .case-help strong { color: var(--text-1); }
  .layout-help { padding-bottom: 2px; }
  .layout-row { min-width: 0; overflow: hidden; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-0); }
  .image-demo { height: 68px; margin: 10px; padding: 6px; border: 1px solid var(--border); border-radius: 4px; background: var(--bg-1); }
  .image-demo i { display: block; width: 50%; height: 100%; border-radius: 2px; background: linear-gradient(135deg, var(--accent-soft), var(--accent)); opacity: .85; }
  .image-demo.center i { margin: 0 auto; }
  .text-demo { margin: 10px; padding: 22px 8px; border: 1px solid var(--border); border-radius: 4px; color: var(--text-2); font-size: var(--fs-xs); }
  .text-demo.center { text-align: center; }
  .layout-help p { margin: 9px 0 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.45; }
  @media (max-width: 720px) {
    .example-grid, .case-help { grid-template-columns: 1fr; }
    .markdown-help { top: 12px; max-height: calc(100% - 24px); }
  }
  .panes { flex: 1; min-height: 0; display: grid; }
  .remote-image-note { margin: 0; padding: 7px 10px; border-top: 1px solid var(--border); color: var(--warn); background: var(--bg-1); font-size: var(--fs-xs); }
  .pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; padding: 14px 18px; }
  .pane-title > span { color: var(--text-3); font-size: var(--fs-xs); font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
  .writer { background: var(--bg-1); }
  textarea { flex: 1; min-height: 0; resize: none; margin-top: 10px; padding: 0; border: 0; border-radius: 0; background: transparent; color: var(--text-1); font: 14px/1.65 var(--mono); outline: none; }
  .splitter { cursor: col-resize; background: var(--border); transition: background .12s; }
  .splitter:hover, .splitter:focus-visible, .panes.resizing .splitter { background: var(--accent); outline: none; }
  .reader { overflow: auto; background: var(--bg-0); }
  .pane-title { position: relative; display: flex; align-items: center; justify-content: space-between; }
  .writer-actions { position: relative; display: flex; align-items: center; }
  .writer-actions .active { color: var(--accent); background: var(--accent-soft); }
  .reference-menu { position: absolute; z-index: 6; top: calc(100% + 6px); right: 0; width: 260px; max-height: min(380px, calc(100vh - 180px)); overflow: auto; padding: 6px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-1); box-shadow: 0 12px 30px #0004; }
  .reference-menu .input { width: 100%; margin-bottom: 5px; font-size: var(--fs-sm); }
  .reference-menu p { margin: 8px; color: var(--text-3); font-size: var(--fs-sm); }
  .reference-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 7px; width: 100%; padding: 7px; border-radius: var(--r-sm); color: var(--text-2); text-align: left; font-size: var(--fs-sm); }
  .reference-row:hover { background: var(--bg-2); color: var(--text-1); }
  .reference-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .reference-row small { color: var(--text-3); font-size: var(--fs-xs); }
  .preview-toggle { margin: -6px -7px -6px 0; }
  .preview-actions { display: flex; align-items: center; gap: 2px; }
  .export-list { max-height: 46vh; margin: 10px 0 0; overflow-y: auto; }
  .export-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 7px; border-radius: var(--r-sm); color: var(--text-2); font-size: var(--fs-sm); cursor: pointer; }
  .export-row:hover { background: var(--bg-2); color: var(--text-1); }
  .export-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .export-row small { color: var(--text-3); font-size: var(--fs-xs); }
  .export-empty { padding: 14px 7px; color: var(--text-3); font-size: var(--fs-sm); }
  .export-note { margin: 6px 0 0; color: var(--text-3); font-size: var(--fs-xs); }
  .export-dest { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
  .dest-label { color: var(--text-3); font-size: var(--fs-xs); }
  .dest-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-xs); }
  /* The shared rendered-Markdown rules live in app.css; what follows is what
     only the Notebook preview shows. */
  .markdown { margin-top: 10px; }
  .markdown :global(.entity-ref) { color: var(--accent); font-weight: 600; }
  .markdown :global(.broken-ref) { color: var(--text-3); font-style: italic; text-decoration: line-through; }
  .markdown :global(video) { background: #000; }
  .markdown :global(.markdown-image.align-center) { margin-right: auto; margin-left: auto; }
  .markdown :global(.markdown-image.align-right) { margin-right: 0; margin-left: auto; }
  .markdown :global(.markdown-align.align-center) { text-align: center; }
  .markdown :global(.markdown-align.align-right) { text-align: right; }
  /* Diagrams are drawn light so they stay readable in the PDF export. */
  .markdown :global(.mermaid-diagram) { margin: 0 0 12px; padding: 12px; border: 1px solid var(--border); border-radius: var(--r-sm); background: #fff; text-align: center; overflow-x: auto; }
  .markdown :global(.mermaid-diagram svg) { max-width: 100%; height: auto; }
  .markdown :global(.mermaid-diagram .mermaid-source) { margin: 0; padding: 0; border: 0; background: transparent; color: #202124; text-align: left; }
  .markdown :global(.mermaid-diagram.mermaid-failed) { border-color: var(--warn); }
  .markdown :global(.mermaid-error) { margin: 0 0 8px; color: var(--warn); font-size: var(--fs-xs); text-align: left; }
  .preview-only { grid-template-columns: 1fr !important; }
  .preview-only .writer, .preview-only .splitter { display: none; }
  .empty { padding: 28px; color: var(--text-2); }
  .empty h2 { color: var(--text-1); }
  @media (max-width: 800px) { .panes { grid-template-columns: 1fr !important; } .splitter { display: none; } .writer { min-height: 52%; border-bottom: 1px solid var(--border); } .preview-only .writer { display: none; } }
</style>
