<script>
  /**
   * The Notebook: the case's notes on a home of cards, and one note open at a time,
   * written in place (`components/NoteEditor.svelte`).
   *
   * A note opened here is the same copy the panel beside the tools and a tab of its
   * own show (`lib/notes/noteDoc.svelte.js`), so it can be put beside a map, sent
   * to another screen, and come back without two copies writing over each other.
   * A note template from Settings is edited here too, as a plate template is in
   * the Map plate.
   */
  import { onDestroy, untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import { fetchAllEntities } from '../lib/catalog.js';
  import { offerNote, withdrawNote } from '../lib/noteHere.svelte.js';
  import { onBackForward, settlePlace } from '../lib/backButton.js';
  import { buildHash, readSolo, splitHash } from '../lib/hash.js';
  import {
    caseState, uiState, toast, reloadCase, templatesState, saveTemplate, loadTemplates,
  } from '../lib/state.svelte.js';
  import { createNote, deleteNote, resetCaseNotes } from '../lib/notes.js';
  import { exportNotes, revealExports } from '../lib/notesExport.js';
  import { destinationLabel, readDestinations } from '../lib/exportDest.js';
  import { assignFolder, renameEntity } from '../lib/filing.js';
  import { openEntity } from '../lib/navigate.js';
  import { deletedToast, RESTORABLE } from '../lib/trash.js';
  import { matchesTerms } from '../lib/folderBrowse.js';
  import { CASE_NOTES, flush, noteReady, openNote, releaseNote, retrySave } from '../lib/notes/noteDoc.svelte.js';
  import { openInDock } from '../lib/notes/noteDock.svelte.js';
  import { READY_NOTES, filledBody, freeTitle } from '../lib/notes/ready.js';
  import Icon from '../components/Icon.svelte';
  import BackButton from '../components/BackButton.svelte';
  import NoteEditor from '../components/NoteEditor.svelte';
  import NotesHome from './notebook/NotesHome.svelte';
  import SearchInput from '../components/SearchInput.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import ExportFolderPicker from '../components/ExportFolderPicker.svelte';
  import FloatingMenu from '../components/FloatingMenu.svelte';
  import Modal from '../components/Modal.svelte';
  import FolderSelect from '../components/FolderSelect.svelte';
  import NoCase from '../components/NoCase.svelte';

  const NOTE_SEARCH_MIN = 6;

  /** The note on screen: `{ noteId }`, null for the case notes; or null for the home. */
  let opened = $state(null);
  let doc = $state(null);
  let editor = $state(null);
  let pendingLine = $state(null);
  let rows = $state([]);
  let rowsLoading = $state(false);
  let titleField = $state('');
  let titleInput = $state(null);
  let folderField = $state('');
  let menu = $state(null); // { row, anchor } for a card's ⋯, or { anchor } for the open note's
  let noteModal = $state(null);
  let noteModalSaving = $state(false);
  let noteAction = $state(null);
  let noteActionBusy = $state(false);
  let naming = $state(null); // keep as template: { value }
  let exportOpen = $state(false);
  let singleExportOpen = $state(false);
  let singleExportId = $state(CASE_NOTES);
  let exportBusy = $state(false);
  let exportQuery = $state('');
  let exportSelection = $state(new Set());
  let exportDir = $state('');
  let exportPicker = $state(false);
  // a template from Settings, edited in place of a note
  let template = $state(null);
  let templateDoc = $state(null);
  let templateTimer;

  const caseId = $derived(caseState.current?.id ?? '');

  // Every record of the case: what `@` offers, what a chip is drawn from.
  let graphEntities = $state([]);
  let referenceRedirects = $state({});
  $effect(() => {
    const id = caseId;
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
  // a record merged into another since a note cited it is drawn as the one it became
  $effect(() => {
    const id = caseId;
    const text = doc?.text ?? '';
    caseState.rev;
    const ids = [...new Set([...text.matchAll(/\[\[entity:([A-Za-z0-9_-]+)\|/g)].map((match) => match[1]))];
    if (!id || !ids.length) {
      referenceRedirects = {};
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api.post(`/api/cases/${id}/entities/redirects`, { ids: ids.slice(0, 2000) })
        .then((result) => { if (live) referenceRedirects = result.redirects ?? {}; })
        .catch(() => {});
    }, 400);
    return () => { live = false; clearTimeout(timer); };
  });

  const noteEntities = $derived(graphEntities.filter((entity) => entity.type === 'note'));
  const noteEntity = $derived(opened?.noteId ? noteEntities.find((entity) => entity.id === opened.noteId) ?? null : null);
  const exportChoices = $derived([
    { id: CASE_NOTES, label: 'Case notes', folder: '' },
    ...noteEntities.map((entity) => ({ id: entity.id, label: entity.label, folder: entity.attrs?.folder ?? '' }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ].filter((choice) => matchesTerms(`${choice.label} ${choice.folder}`, exportQuery)));

  // the filed note open here is what the topbar's Add event seats; the case notes offer nothing
  $effect(() => { offerNote('notebook', noteEntity); });
  onDestroy(() => withdrawNote('notebook'));

  // -- the home ----------------------------------------------------------------

  async function refreshRows() {
    const id = caseId;
    if (!id) return;
    rowsLoading = true;
    try {
      const result = await api.get(`/api/cases/${id}/notes/index`);
      if (id === caseId) rows = result.items ?? [];
    } catch (error) {
      toast(`Could not list the notes: ${error.message}`, 'warn');
    } finally {
      rowsLoading = false;
    }
  }
  $effect(() => {
    caseState.rev;
    if (caseId && !opened) untrack(refreshRows);
  });

  // -- one note ------------------------------------------------------------------

  /** Show a note (`case` or null for the case notes), at a line if one is given. */
  function show(noteId, { line = null, navigate = true } = {}) {
    if (!caseId) return;
    const id = noteId && noteId !== CASE_NOTES ? noteId : null;
    leaveTemplate({ quiet: true });
    if (!opened || opened.noteId !== id || doc?.caseId !== caseId) {
      const previous = doc;
      doc = openNote(caseId, id);
      if (previous) void releaseNote(previous);
      opened = { noteId: id };
      editor = null;
    }
    pendingLine = Number.isInteger(line) ? line : null;
    uiState.openNotebook = { noteId: id };
    settlePlace('notebook', place(), { navigate });
  }

  function home({ navigate = true } = {}) {
    const previous = doc;
    doc = null;
    opened = null;
    editor = null;
    if (previous) void releaseNote(previous);
    uiState.openNotebook = { home: true };
    settlePlace('notebook', place(), { navigate });
  }

  $effect(() => {
    titleField = noteEntity?.label ?? '';
    folderField = noteEntity?.attrs?.folder ?? '';
  });

  // a line asked for (a search hit, a citation) is gone to once the note is read
  $effect(() => {
    const ready = editor && doc?.loaded;
    if (!ready || pendingLine === null) return;
    const line = pendingLine;
    pendingLine = null;
    queueMicrotask(() => editor?.jump(line));
  });

  // a note asked for from elsewhere: a sidebar row, Details, a search, a citation
  let requestedCase = null;
  $effect(() => {
    const request = uiState.openNotebook;
    const id = caseId;
    if (!id) {
      untrack(() => { if (doc) home({ navigate: false }); });
      requestedCase = null;
      return;
    }
    const caseChanged = requestedCase !== id;
    requestedCase = id;
    untrack(() => {
      if (caseChanged && doc && doc.caseId !== id) home({ navigate: false });
      if (!request || request.home) return;
      const wanted = request.noteId ?? null;
      if (!opened || opened.noteId !== wanted || Number.isInteger(request.line)) show(wanted, { line: request.line ?? null, navigate: !caseChanged });
    });
  });

  // Where the tab is, in the address. Choosing a note is a step Back retraces; a tab
  // of its own also names its case, so a reload opens the same note again.
  const opening = splitHash(location.hash);
  const solo = readSolo(opening.params);
  const place = () => {
    const note = template ? '' : opened ? opened.noteId ?? CASE_NOTES : '';
    return solo ? { case: caseId, note, solo: '1' } : { note };
  };
  $effect(() => {
    if (uiState.tool !== 'notebook' || !caseId) return;
    place();
    untrack(() => settlePlace('notebook', place()));
  });
  onDestroy(onBackForward('notebook', (to) => {
    const id = to.note ?? '';
    if (!id) home({ navigate: false });
    else if (id === CASE_NOTES) show(null, { navigate: false });
    else if (!graphEntities.length || noteEntities.some((entity) => entity.id === id)) show(id, { navigate: false });
    return true;
  }));

  // -- a tab of its own ----------------------------------------------------------

  let soloWaiting = solo && opening.route === 'notebook' && opening.params.get('note')
    ? { caseId: opening.params.get('case'), note: opening.params.get('note') } : null;
  $effect(() => {
    if (!soloWaiting || !caseId) return;
    const { caseId: owner, note } = soloWaiting;
    soloWaiting = null;
    if (!owner || owner === caseId) untrack(() => show(note, { navigate: false }));
  });

  /** The note in a tab of its own, for another screen. This tab goes back to the notes. */
  async function detach(noteId = opened?.noteId ?? null) {
    const tab = window.open('', '_blank');
    if (!tab) { toast('The browser refused a new tab. Allow pop-ups for this page', 'warn', 8000); return; }
    if (doc && (doc.noteId ?? null) === (noteId ?? null)) await flush(doc);
    tab.location.href = `${location.pathname}${location.search}${buildHash('notebook', { case: caseId, note: noteId ?? CASE_NOTES, solo: '1' })}`;
    if (opened && (opened.noteId ?? null) === (noteId ?? null)) home();
    toast('The note is open in its own tab', 'info', 3000);
  }

  function beside(noteId = opened?.noteId ?? null) {
    openInDock(caseId, noteId);
    toast('Kept beside the tools', 'info', 2600);
  }

  // -- naming and filing ---------------------------------------------------------

  async function commitTitle() {
    const name = titleField.trim();
    if (!noteEntity || !name || name === noteEntity.label) {
      titleField = noteEntity?.label ?? '';
      return;
    }
    try {
      await flush(doc);
      await renameEntity(caseId, noteEntity, name);
      await reloadCase();
    } catch (error) {
      toast(error.message, 'danger');
      titleField = noteEntity.label;
    }
  }

  $effect(() => {
    const wanted = folderField;
    const entity = untrack(() => noteEntity);
    if (!entity || wanted === (entity.attrs?.folder ?? '')) return;
    untrack(async () => {
      try {
        await flush(doc);
        await assignFolder(caseId, entity, wanted);
        await reloadCase();
      } catch (error) {
        toast(error.message, 'danger');
      }
    });
  });

  // -- making notes --------------------------------------------------------------

  function newNote() {
    noteModal = { title: '', folder: '', start: 'blank' };
  }

  const starts = $derived([
    ...READY_NOTES.map((ready) => ({ id: ready.id, name: ready.name, body: ready.body, folder: '' })),
    ...templatesState.note.map((record) => ({
      id: `t:${record.id}`, name: record.name, body: record.data?.body ?? '', folder: record.data?.folder ?? '',
    })),
  ]);

  async function make({ title, folder = '', body = '' }) {
    const note = await createNote(caseId, { title, folder, content: filledBody(body) });
    await reloadCase();
    show(note.id);
    return note;
  }

  async function saveNewNote() {
    if (!noteModal) return;
    const title = noteModal.title.trim();
    if (!title) {
      toast('Title required', 'warn');
      return;
    }
    const start = starts.find((item) => item.id === noteModal.start);
    noteModalSaving = true;
    try {
      await make({ title, folder: noteModal.folder || start?.folder || '', body: start?.body ?? '' });
      noteModal = null;
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      noteModalSaving = false;
    }
  }

  /** A ready note or a template, started at once under a free name that is selected to retype. */
  async function startFrom({ name, body, folder }) {
    try {
      const note = await make({ title: freeTitle(name, noteEntities.map((entity) => entity.label)), folder, body });
      retitle = note.id;
    } catch (error) {
      toast(error.message, 'danger');
    }
  }

  // the name of a note just started is selected once it is there, to be typed over
  let retitle = $state(null);
  $effect(() => {
    if (!retitle || noteEntity?.id !== retitle || !titleInput || titleField !== noteEntity.label) return;
    retitle = null;
    titleInput.focus();
    titleInput.select();
  });

  async function keepAsTemplate() {
    const name = naming?.value.trim();
    if (!name || !doc) return;
    try {
      await saveTemplate('note', { name, data: { body: doc.text, folder: noteEntity?.attrs?.folder ?? '' } });
      naming = null;
      toast(`“${name}” kept as a note template`, 'ok', 2600);
    } catch (error) {
      toast(error.message, 'danger');
    }
  }

  // -- deleting --------------------------------------------------------------------

  function askRemove(row) {
    if (row.id === CASE_NOTES) noteAction = { kind: 'reset' };
    else noteAction = { kind: 'delete', noteId: row.id, label: row.title };
  }

  async function confirmNoteAction() {
    const action = noteAction;
    if (!action || !caseId) return;
    noteActionBusy = true;
    try {
      if (action.kind === 'delete') {
        const id = caseId;
        if (opened?.noteId === action.noteId) home({ navigate: false });
        const result = await deleteNote(id, action.noteId);
        await reloadCase();
        deletedToast(id, result, action.label);
      } else {
        if (doc && !doc.noteId) await flush(doc);
        await resetCaseNotes(caseId);
        if (opened && !opened.noteId) {
          const previous = doc;
          doc = openNote(caseId, null);
          void releaseNote(previous);
        }
        toast('Note content reset', 'ok', 1800);
        void refreshRows();
      }
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      noteActionBusy = false;
      noteAction = null;
    }
  }

  // -- export ----------------------------------------------------------------------

  async function runExport(noteIds) {
    if (!caseId || exportBusy) return;
    const id = caseId;
    exportBusy = true;
    try {
      // the PDF is drawn from the file, so what is still waiting is written first
      if (doc) await flush(doc);
      const result = await exportNotes(id, noteIds);
      exportOpen = false;
      singleExportOpen = false;
      const count = result.written.length;
      toast(`${count} PDF${count > 1 ? 's' : ''} written to ${destinationLabel(result.path)}`, 'ok', 5200, {
        label: 'Show',
        onClick: () => revealExports(id).catch((error) => toast(error.message, 'warn')),
      });
      for (const warning of result.warnings) toast(warning, 'warn', 6500);
    } catch (error) {
      toast(`Export failed: ${error.message}`, 'danger');
    } finally {
      exportBusy = false;
    }
  }

  function readExportDestination() {
    readDestinations().then((dirs) => (exportDir = dirs.notes)).catch(() => {});
  }

  function exportOne(noteId) {
    singleExportId = noteId ?? CASE_NOTES;
    singleExportOpen = true;
    readExportDestination();
  }

  function exportSeveral() {
    exportSelection = new Set([opened ? opened.noteId ?? CASE_NOTES : CASE_NOTES]);
    exportQuery = '';
    exportOpen = true;
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

  // -- a template from Settings ------------------------------------------------------

  $effect(() => {
    const id = uiState.openNoteTemplate;
    if (!id) return;
    untrack(async () => {
      if (!templatesState.note.length) await loadTemplates();
      const record = templatesState.note.find((item) => item.id === id);
      uiState.openNoteTemplate = null;
      if (!record) { toast('That template is no longer there', 'warn'); return; }
      if (doc) home({ navigate: false });
      template = { id: record.id, name: record.name, folder: record.data?.folder ?? '' };
      templateDoc = { text: record.data?.body ?? '', loaded: true, revision: 1, elsewhere: false, error: '' };
    });
  });

  function templateChanged(text) {
    if (!template || !templateDoc) return;
    templateDoc.text = text;
    clearTimeout(templateTimer);
    templateTimer = setTimeout(saveTemplateNow, 600);
  }

  async function saveTemplateNow() {
    clearTimeout(templateTimer);
    if (!template || !templateDoc) return;
    const name = template.name.trim() || 'Note template';
    try {
      await saveTemplate('note', { id: template.id, name, data: { body: templateDoc.text, folder: template.folder } });
    } catch (error) {
      toast(`Template not saved: ${error.message}`, 'danger');
    }
  }

  async function leaveTemplate({ quiet = false } = {}) {
    if (!template) return;
    await saveTemplateNow();
    template = null;
    templateDoc = null;
    if (!quiet) {
      uiState.settingsTab = 'templates';
      uiState.tool = 'settings';
    }
  }

  const saveSaid = $derived(!doc ? '' : doc.saveError ? 'Not saved' : doc.saving || !doc.saved ? 'Saving…' : 'Saved');
</script>

{#if !caseState.current}
  <NoCase icon="note" what="write notes" />
{:else}
  <section class="notebook">
    {#if template && templateDoc}
      <header class="tool-header">
        <BackButton label="Settings" title="Back to the templates in Settings" onclick={() => leaveTemplate()} />
        <span class="kind">Template</span>
        <input class="input title-input" bind:value={template.name} onblur={saveTemplateNow} maxlength="120" aria-label="Template name"
          onkeydown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        <span class="hint">{'{today}'} and {'{now}'} are written in when a note starts from it.</span>
        <div class="spacer"></div>
        <button class="btn btn-primary btn-sm" onclick={() => leaveTemplate()}><Icon name="check" size={14} /> Done</button>
      </header>
      <div class="body">
        {#key template.id}
          <NoteEditor doc={templateDoc} {caseId} entities={graphEntities} onchange={templateChanged} onopen={openEntity}
            placeholder="What a note made from this template starts with." />
        {/key}
      </div>
    {:else if opened && doc}
      <header class="tool-header">
        <BackButton label="Notes" title="Back to the notes" onclick={() => home()} guide="notebook.home" />
        {#if opened.noteId}
          <input class="input title-input" bind:this={titleInput} bind:value={titleField} onblur={commitTitle} maxlength="300"
            aria-label="Note name" onkeydown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
          <div class="folder-pick" title="The folder this note is filed in">
            <FolderSelect bind:value={folderField} folders={caseState.current?.folders ?? []} emptyLabel="Unfiled" />
          </div>
        {:else}
          <span class="case-title"><Icon name="note" size={14} /> Case notes</span>
        {/if}
        <span class="status" class:error={doc.saveError}>
          {#if doc.saveError}<Icon name="alert" size={12} /> Not saved: {doc.saveError}
            <button class="btn btn-ghost btn-xs" onclick={() => retrySave(doc)}>Retry</button>
          {:else if doc.loaded}{#if saveSaid === 'Saved'}<Icon name="check" size={12} />{/if} {saveSaid}{/if}
        </span>
        <div class="spacer"></div>
        <button class="btn btn-ghost btn-sm" title="Keep it beside the tools, open as you work on the Map or a video" aria-label="Beside the tools"
          data-guide="notebook.dock" onclick={() => beside()}><Icon name="panelRight" size={15} /> Beside the tools</button>
        {#if !solo}
          <button class="btn btn-ghost btn-sm" title="Open in its own tab, for another screen" aria-label="Open in its own tab"
            data-guide="notebook.tab" onclick={() => detach()}><Icon name="external" size={15} /></button>
        {/if}
        <button class="btn btn-sm" title="Export this note as PDF" data-guide="notebook.pdf" onclick={() => exportOne(opened.noteId)}>
          <Icon name="download" size={14} /> PDF</button>
        <button class="btn btn-ghost btn-sm" aria-label="More" title="More" onclick={(event) => (menu = { anchor: event.currentTarget })}>
          <Icon name="more" size={15} /></button>
      </header>
      <div class="body">
        {#key doc}
          <NoteEditor {doc} {caseId} entities={graphEntities} redirects={referenceRedirects} where="notebook"
            onopen={openEntity} onready={(handle) => (editor = handle)} />
        {/key}
      </div>
    {:else}
      <NotesHome {caseId} {rows} loading={rowsLoading} templates={templatesState.note}
        onopen={(id, options) => show(id, options)} onnew={newNote} onstart={startFrom}
        onmenu={(row, anchor) => (menu = { row, anchor })} />
    {/if}
  </section>

  {#if menu}
    {@const row = menu.row ?? (opened ? { id: opened.noteId ?? CASE_NOTES, title: noteEntity?.label ?? 'Case notes' } : null)}
    <FloatingMenu anchor={menu.anchor} align="end" width={230} label="Note actions" onclose={() => (menu = null)}>
      {#if menu.row}
        <button type="button" class="fm-item" onclick={() => { menu = null; show(row.id); }}><Icon name="edit" size={14} /><span class="fm-grow">Open</span></button>
        <button type="button" class="fm-item" onclick={() => { menu = null; beside(row.id === CASE_NOTES ? null : row.id); }}>
          <Icon name="panelRight" size={14} /><span class="fm-grow">Beside the tools</span></button>
        <button type="button" class="fm-item" onclick={() => { menu = null; detach(row.id === CASE_NOTES ? null : row.id); }}>
          <Icon name="external" size={14} /><span class="fm-grow">In its own tab</span></button>
        <button type="button" class="fm-item" onclick={() => { menu = null; exportOne(row.id === CASE_NOTES ? null : row.id); }}>
          <Icon name="download" size={14} /><span class="fm-grow">Export as PDF</span></button>
      {:else}
        <button type="button" class="fm-item" onclick={() => { menu = null; naming = { value: noteEntity?.label ?? 'Case notes' }; }}
          title="Keep this note as it is, to start others from"><Icon name="save" size={14} /><span class="fm-grow">Keep as template</span></button>
      {/if}
      <button type="button" class="fm-item" onclick={() => { menu = null; exportSeveral(); }}>
        <Icon name="layers" size={14} /><span class="fm-grow">Export several as PDF</span></button>
      {#if row}
        <div class="fm-sep"></div>
        <button type="button" class="fm-item danger" onclick={() => { menu = null; askRemove(row); }}>
          <Icon name={row.id === CASE_NOTES ? 'reset' : 'trash'} size={14} />
          <span class="fm-grow">{row.id === CASE_NOTES ? 'Clear the case notes' : 'Delete'}</span></button>
      {/if}
    </FloatingMenu>
  {/if}

  {#if noteModal}
    <Modal title="New note" onclose={() => (noteModal = null)} width="580px">
      <label class="modal-label" for="notebook-note-title">Title</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="notebook-note-title" class="input" placeholder="Note title…" bind:value={noteModal.title} autofocus
        onkeydown={(event) => { if (event.key === 'Enter') saveNewNote(); }} />
      <span class="modal-label" style="margin-top:10px">Folder</span>
      <FolderSelect bind:value={noteModal.folder} folders={caseState.current?.folders ?? []} emptyLabel="Unfiled" fresh />
      <label class="modal-label" style="margin-top:10px" for="notebook-note-start">Start from</label>
      <select id="notebook-note-start" class="input" bind:value={noteModal.start}>
        {#each starts as item (item.id)}<option value={item.id}>{item.name}</option>{/each}
      </select>
      <div class="modal-row">
        <div style="flex:1"></div>
        <button class="btn" onclick={() => (noteModal = null)}>Cancel</button>
        <button class="btn btn-primary" onclick={saveNewNote} disabled={noteModalSaving}>{noteModalSaving ? 'Creating…' : 'Create'}</button>
      </div>
    </Modal>
  {/if}

  {#if naming}
    <Modal title="Keep as a note template" onclose={() => (naming = null)} width="460px">
      <label class="modal-label" for="notebook-template-name">Name</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="notebook-template-name" class="input" bind:value={naming.value} maxlength="120" autofocus
        onkeydown={(event) => { if (event.key === 'Enter') keepAsTemplate(); }} />
      <p class="export-note">New notes can start from it. Settings › Templates edits or deletes it.</p>
      <div class="modal-row">
        <div style="flex:1"></div>
        <button class="btn" onclick={() => (naming = null)}>Cancel</button>
        <button class="btn btn-primary" onclick={keepAsTemplate} disabled={!naming.value.trim()}>Keep</button>
      </div>
    </Modal>
  {/if}

  {#if singleExportOpen}
    <Modal title="Export note as PDF" onclose={() => (singleExportOpen = false)} width="560px">
      <div class="export-dest">
        <span class="dest-label">Destination</span>
        <span class="dest-path mono" title={exportDir || "The case's own exports folder"}>{exportDir || "the case's exports folder"}</span>
        <button class="btn btn-ghost btn-sm" onclick={() => (exportPicker = true)}>Change</button>
      </div>
      <p class="export-note">
        One PDF will be written.
        {#if exportDir}Files already there are kept.{:else}An existing file with the same name is replaced.{/if}
      </p>
      <div class="modal-row">
        <div style="flex:1"></div>
        <button class="btn" onclick={() => (singleExportOpen = false)}>Cancel</button>
        <button class="btn btn-primary" disabled={exportBusy} onclick={() => runExport([singleExportId])}>{exportBusy ? 'Exporting…' : 'Export PDF'}</button>
      </div>
    </Modal>
  {/if}

  {#if exportOpen}
    <Modal title="Export notes as PDF" onclose={() => (exportOpen = false)} width="560px">
      {#if exportChoices.length > NOTE_SEARCH_MIN}<SearchInput bind:value={exportQuery} placeholder="Find a note…" />{/if}
      <div class="export-list">
        {#each exportChoices as choice (choice.id)}
          <label class="export-row">
            <input type="checkbox" checked={exportSelection.has(choice.id)} onchange={() => toggleExportNote(choice.id)} />
            <span class="export-name">{choice.label}</span>
            {#if choice.folder}<small>{choice.folder}</small>{/if}
          </label>
        {/each}
        {#if !exportChoices.length}<p class="export-empty">No matching notes.</p>{/if}
      </div>
      <div class="export-dest">
        <span class="dest-label">Destination</span>
        <span class="dest-path mono" title={exportDir || "The case's own exports folder"}>{exportDir || "the case's exports folder"}</span>
        <button class="btn btn-ghost btn-sm" onclick={() => (exportPicker = true)}>Change</button>
      </div>
      <p class="export-note">One PDF per note. {#if exportDir}Files already there are kept.{:else}Existing files are replaced.{/if}</p>
      <div class="modal-row">
        <button class="btn btn-ghost btn-sm" onclick={toggleExportAll}>{exportSelection.size === exportChoices.length ? 'Clear' : 'Select all'}</button>
        <div style="flex:1"></div>
        <button class="btn" onclick={() => (exportOpen = false)}>Cancel</button>
        <button class="btn btn-primary" disabled={exportBusy || !exportSelection.size} onclick={() => runExport([...exportSelection])}>
          {exportBusy ? 'Exporting…' : `Export ${exportSelection.size || ''}`}
        </button>
      </div>
    </Modal>
  {/if}

  {#if exportPicker}
    <ExportFolderPicker kind="notes" current={exportDir} onclose={() => (exportPicker = false)} onchosen={(path) => (exportDir = path)} />
  {/if}

  {#if noteAction}
    <ConfirmDialog
      title={noteAction.kind === 'delete' ? 'Delete this note?' : 'Clear the case notes?'}
      message={noteAction.kind === 'delete' ? `Are you sure you want to delete “${noteAction.label}”?` : 'Are you sure you want to clear the case notes?'}
      detail={noteAction.kind === 'delete' ? 'Moves the note and its contents to the case trash.' : 'The page stays, empty.'}
      restorable={noteAction.kind === 'delete' ? RESTORABLE : ''}
      confirmLabel={noteAction.kind === 'delete' ? 'Delete' : 'Clear'}
      tone="default"
      icon={noteAction.kind === 'delete' ? 'trash' : 'reset'}
      busy={noteActionBusy}
      onconfirm={confirmNoteAction}
      oncancel={() => (noteAction = null)}
    />
  {/if}
{/if}

<style>
  .notebook { position: relative; height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .tool-header { flex-wrap: nowrap; }
  .title-input { flex: 0 1 320px; min-width: 120px; font-weight: 600; }
  .case-title { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: var(--text-1); }
  .folder-pick { flex: 0 1 200px; min-width: 120px; }
  .kind { color: var(--accent); font-size: var(--fs-xs); font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .hint { color: var(--text-3); font-size: var(--fs-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .status { color: var(--text-3); font-size: var(--fs-xs); display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
  .status.error { color: var(--danger); }
  .spacer { flex: 1; }
  .body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .body > :global(.note-editor) { flex: 1; }
  .fm-item.danger { color: var(--danger); }
  .export-list { display: flex; flex-direction: column; max-height: 280px; overflow: auto; margin: 8px 0; }
  .export-row { display: flex; align-items: center; gap: 8px; padding: 5px 4px; font-size: var(--fs-sm); }
  .export-row small, .export-empty { color: var(--text-3); font-size: var(--fs-xs); }
  .export-name { flex: 1; }
  .export-dest { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: var(--fs-sm); }
  .dest-label { color: var(--text-3); }
  .dest-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .export-note { color: var(--text-3); font-size: var(--fs-xs); margin: 6px 0 0; }
  .modal-label { display: block; color: var(--text-2); font-size: var(--fs-sm); margin-bottom: 4px; }
  .modal-row { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
  .mono { font-family: var(--font-mono); }
</style>
