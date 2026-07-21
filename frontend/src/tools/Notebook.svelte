<script>
  import { api } from '../lib/api.js';
  import { fetchAllEntities } from '../lib/catalog.js';
  import { caseState, uiState, toast, reloadCase } from '../lib/state.svelte.js';
  import { entityReference, markdownHtml, remoteImageUrls } from '../lib/markdown.js';
  import { createNote, deleteNote, resetCaseNotes } from '../lib/notes.js';
  import {
    clampNotebookHelpPosition, clampNotebookSplit, loadNotebookSplit, loadNotebookText,
    saveNotebookSplit,
  } from '../lib/notebook.js';
  import { downloadNotebookPdf } from '../lib/notebookPdf.js';
  import { insertNotebookText, notebookImageMarkdown, notebookMediaMarkdown } from '../lib/notebookContent.js';
  import { caseTab, closeNotebookTab, openNotebookTab } from '../lib/notebookTabs.js';
  import { openEntity } from '../lib/navigate.js';
  import Icon from '../components/Icon.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import Modal from '../components/Modal.svelte';
  import FolderSelect from '../components/FolderSelect.svelte';

  let tabs = $state([]); // [{ id: 'case' | entity id, noteId }]
  let activeId = $state('case');
  let tabsCaseId = $state(null);
  let menuOpen = $state(false);
  let query = $state('');
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
  let markdownHelpEl = $state(null);
  let markdownHelpPosition = $state(null);
  let imageUploading = $state(false);
  let noteModal = $state(null);
  let noteModalSaving = $state(false);
  let noteAction = $state(null);
  let noteActionBusy = $state(false);

  let text = $state('');
  let loadedKey = $state('');
  let pendingSaves = $state(0);
  let saved = $state(true);
  let editVersion = 0;
  let saveTimer;

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
  const filteredNotes = $derived(noteEntities.filter((entity) => {
    const haystack = `${entity.label} ${entity.attrs?.folder ?? ''}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }));
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

  function resetTabs(caseId) {
    tabsCaseId = caseId;
    tabs = [caseTab()];
    activeId = 'case';
    previewOnly = false;
    menuOpen = false;
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

  function selectTab(tab) {
    activeId = tab.id;
    uiState.openNotebook = { noteId: tab.noteId };
    menuOpen = false;
  }

  function selectNote(noteId = null) {
    openRequestedNote(noteId);
    uiState.openNotebook = { noteId };
    menuOpen = false;
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
        await deleteNote(caseState.current.id, action.noteId);
        closeDeletedNote(action.noteId);
        await reloadCase();
        toast(`Deleted "${action.label}"`, 'info');
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
    saveTimer = setTimeout(() => save(target, targetKey, contents, version), 700);
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

  function downloadPdf() {
    if (!downloadNotebookPdf({ title, content: preview })) {
      toast('Allow popups to save the PDF.', 'warn');
    }
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

{#if !caseState.current}
  <div class="empty"><h2>No case open</h2><p>Open a case to write notes.</p></div>
{:else}
  <section bind:this={notebookEl} class="notebook">
    <header class="notebook-bar">
      <div class="notes-menu-wrap">
        <button class="menu-toggle" class:active={menuOpen} onclick={() => (menuOpen = !menuOpen)} aria-expanded={menuOpen}>
          <Icon name="note" size={15} /> Notes <Icon name="chevronDown" size={13} />
        </button>
        {#if menuOpen}
          <div class="notes-menu">
            <input class="input note-search" bind:value={query} placeholder="Find a note…" />
            <button class="menu-note" class:selected={activeId === 'case'} onclick={() => selectNote()}>
              <Icon name="note" size={14} /><span>Case Notes</span>
            </button>
            {#each filteredNotes as note (note.id)}
              <button class="menu-note" class:selected={activeId === note.id} onclick={() => selectNote(note.id)}>
                <Icon name="note" size={14} />
                <span>{note.label}</span>
                {#if note.attrs?.folder}<small>{note.attrs.folder}</small>{/if}
              </button>
            {/each}
            {#if !filteredNotes.length && query.trim()}<p class="menu-empty">No matching notes.</p>{/if}
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
      <button class="btn btn-ghost btn-sm new-note-button" title="New note" aria-label="New note" onclick={openNewNote}>
        <Icon name="plus" size={15} />
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
        <div class="pane-title"><span>Preview</span><div class="preview-actions"><button class="btn btn-ghost btn-sm" title="Download PDF" aria-label="Download PDF" onclick={downloadPdf}><Icon name="download" size={14} /></button><button class="btn btn-ghost btn-sm preview-toggle" title={previewOnly ? 'Show writer' : 'Preview only'} onclick={() => (previewOnly = !previewOnly)}><Icon name={previewOnly ? 'minimize' : 'maximize'} size={14} /></button></div></div>
        <div class="markdown" aria-label="Markdown preview" use:bindEntityLinks>{@html preview}</div>
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
  {#if noteAction}
    <ConfirmDialog
      title={noteAction.kind === 'delete' ? 'Delete this note?' : 'Reset note content?'}
      message={noteAction.kind === 'delete'
        ? `Are you sure you want to delete “${noteAction.label}”?`
        : 'Are you sure you want to reset the content of this note?'}
      detail={noteAction.kind === 'delete'
        ? 'This permanently removes the note and its content.'
        : 'The case note will remain, but its content will be cleared.'}
      confirmLabel={noteAction.kind === 'delete' ? 'Delete' : 'Reset'}
      tone={noteAction.kind === 'delete' ? 'danger' : 'default'}
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
  .note-search { width: 100%; margin-bottom: 5px; font-size: var(--fs-sm); }
  .menu-note { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 7px; width: 100%; padding: 7px; border-radius: var(--r-sm); text-align: left; color: var(--text-2); font-size: var(--fs-sm); }
  .menu-note:hover, .menu-note.selected { background: var(--bg-2); color: var(--text-1); }
  .menu-note span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .menu-note small { grid-column: 2; color: var(--text-3); font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .menu-empty { margin: 8px; color: var(--text-3); font-size: var(--fs-sm); }
  .tabs { flex: 1; min-width: 0; display: flex; align-items: stretch; overflow-x: auto; scrollbar-width: none; }
  .tabs::-webkit-scrollbar { display: none; }
  .new-note-button { flex-shrink: 0; align-self: center; color: var(--text-2); }
  .new-note-button:hover { color: var(--accent); }
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
  .markdown { margin-top: 10px; color: var(--text-1); line-height: 1.65; overflow-wrap: anywhere; }
  .markdown :global(h1), .markdown :global(h2), .markdown :global(h3) { margin: 0 0 12px; line-height: 1.25; }
  .markdown :global(p), .markdown :global(ul), .markdown :global(ol), .markdown :global(blockquote) { margin: 0 0 12px; }
  .markdown :global(blockquote) { padding-left: 12px; border-left: 2px solid var(--border); color: var(--text-2); }
  .markdown :global(code) { padding: 1px 4px; border-radius: 3px; background: var(--bg-2); font-family: var(--mono); }
  .markdown :global(pre) { margin: 0 0 12px; padding: 12px; overflow: auto; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-1); }
  .markdown :global(pre code) { padding: 0; background: transparent; }
  .markdown :global(table) { width: 100%; margin: 0 0 12px; border-collapse: collapse; font-size: var(--fs-sm); }
  .markdown :global(th), .markdown :global(td) { padding: 7px 9px; border: 1px solid var(--border); text-align: left; vertical-align: top; }
  .markdown :global(th) { background: var(--bg-2); }
  .markdown :global(input[type='checkbox']) { margin-right: 6px; accent-color: var(--accent); }
  .markdown :global(.entity-ref) { color: var(--accent); font-weight: 600; }
  .markdown :global(.broken-ref) { color: var(--text-3); font-style: italic; text-decoration: line-through; }
  .markdown :global(img), .markdown :global(video) { display: block; max-width: 100%; height: auto; margin: 0 0 12px; border-radius: var(--r-sm); border: 1px solid var(--border); }
  .markdown :global(video) { background: #000; }
  .markdown :global(.markdown-image.align-center) { margin-right: auto; margin-left: auto; }
  .markdown :global(.markdown-image.align-right) { margin-right: 0; margin-left: auto; }
  .markdown :global(.markdown-align.align-center) { text-align: center; }
  .markdown :global(.markdown-align.align-right) { text-align: right; }
  .markdown :global(a) { color: var(--accent); }
  .preview-only { grid-template-columns: 1fr !important; }
  .preview-only .writer, .preview-only .splitter { display: none; }
  .empty { padding: 28px; color: var(--text-2); }
  .empty h2 { color: var(--text-1); }
  @media (max-width: 800px) { .panes { grid-template-columns: 1fr !important; } .splitter { display: none; } .writer { min-height: 52%; border-bottom: 1px solid var(--border); } .preview-only .writer { display: none; } }
</style>
