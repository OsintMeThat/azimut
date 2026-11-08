<script>
  /**
   * Reusable proof styles and report structures, shared across cases.
   *
   * Content-free presets: a template carries house style, never a case's
   * material. Plate and note templates are edited in their own tools. Editing or duplicating one opens the parent's editor modal. One
   * post template can be the one new posts start with (`post_template`), and one
   * proof template the one New proof starts with (`proof_template`). A proof template
   * is shown by a sketch of its page and its layout in words.
   *
   * A Notebook template starts from anything, under one New template menu: blank,
   * a ready one, one of the analyst's own (a copy), or a note of the open case,
   * which keeps what Keep as template keeps. Each opens in the Notebook, as Edit does.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import PageThumb from '../notebook/PageThumb.svelte';
  import NotePicker from '../../components/NotePicker.svelte';
  import ProofTemplateSketch from '../../components/ProofTemplateSketch.svelte';
  import { proofTemplateSummary } from '../../lib/proofTemplates.js';
  import { api } from '../../lib/api.js';
  import { caseState, templatesState, prefs, saveTemplate, toast, uiState } from '../../lib/state.svelte.js';
  import { houseLayout, templateOf } from '../../lib/plate/page.js';
  import { readTemplateFile, templateFile } from '../../lib/plate/templateFile.js';
  import { readLook, styleLabel, templateLook } from '../../lib/notes/look.js';
  import { CASE_NOTES, noteEndpoint, openCopy } from '../../lib/notes/noteDoc.svelte.js';
  import { READY_NOTES } from '../../lib/notes/ready.js';
  import { noteTemplateFile, noteTemplateFileName, readNoteTemplateFile } from '../../lib/notes/templateFile.js';

  let { newTemplate, editTemplate, duplicateTemplate, savePrefs, deleteTpl = $bindable() } = $props();

  // Pressing the template that is already the default clears it, which brings
  // back the classic layout, or no template for a proof.
  function toggleDefault(id) {
    savePrefs({ post_template: prefs.postTemplate === id ? '' : id });
  }
  function toggleProofDefault(id) {
    savePrefs({ proof_template: prefs.proofTemplate === id ? '' : id });
  }

  // Map plate templates are laid out in the plate editor itself, over the Map's ground.
  function editMap(id) {
    uiState.openPlateTemplate = id;
    uiState.tool = 'plate';
  }
  async function newMap() {
    try {
      const record = await saveTemplate('map', { name: 'Map template', data: templateOf(houseLayout()) });
      editMap(record.id);
    } catch (error) { toast(error.message, 'danger'); }
  }
  async function duplicateMap(record) {
    try { await saveTemplate('map', { name: `${record.name} copy`.slice(0, 120), data: record.data }); }
    catch (error) { toast(error.message, 'danger'); }
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function downloadMap(record) {
    download(templateFile(record), `${record.name.replace(/[\\/<>:"|?*\u0000-\u001f]/g, '_')}.azimut-map.json`);
  }
  // Notebook templates are written in the Notebook itself, with its Look and its Page pane.
  function editNote(id) {
    uiState.openNoteTemplate = id;
    uiState.tool = 'notebook';
  }
  async function addNote(name, data) {
    try {
      const record = await saveTemplate('note', { name, data: { body: data.body ?? '', folder: data.folder ?? '', look: templateLook(data.look) } });
      return record;
    } catch (error) { toast(error.message, 'danger', 5000); return null; }
  }
  /** Make a template and open it in the Notebook, as Edit does. */
  async function startNote(name, data) {
    closeNew();
    const record = await addNote(name, data);
    if (record) editNote(record.id);
  }
  // the New template menu: its first level, or the list one of its rows opens
  let newAnchor = $state(null);
  let newStep = $state('');
  // the open case's notes, picked through the note picker
  let notesAnchor = $state(null);
  function closeNew() {
    newAnchor = null;
    newStep = '';
  }
  function toggleNew(button) {
    if (newAnchor) closeNew();
    else newAnchor = button;
  }
  function fromNotes() {
    // read before the menu closes, which forgets where it hung
    const anchor = newAnchor;
    closeNew();
    notesAnchor = anchor;
  }
  /** A note of the open case as a template: its text, folder and look, without a cover picture or day. */
  async function fromNote(caseId, noteId, row) {
    notesAnchor = null;
    try {
      const open = openCopy(caseId, noteId);
      const body = open?.loaded ? open.text : (await api.get(noteEndpoint(caseId, noteId)))?.text ?? '';
      const look = await readLook(caseId, noteId === CASE_NOTES ? null : noteId);
      const name = String(row?.title || (noteId === CASE_NOTES ? 'Case notes' : 'Note template')).slice(0, 120);
      await startNote(name, { body, folder: row?.folder ?? '', look });
    } catch (error) { toast(`The note could not be read: ${error.message}`, 'danger', 5000); }
  }
  async function duplicateNote(record) {
    await addNote(`${record.name} copy`.slice(0, 120), record.data ?? {});
  }
  function downloadNote(record) {
    download(noteTemplateFile(record), noteTemplateFileName(record.name));
  }
  let notePicker = $state();
  async function importNote(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      const { name, data } = readNoteTemplateFile(await file.text());
      if (await addNote(name, data)) toast(`“${name}” added`, 'ok');
    } catch (error) { toast(error.message, 'danger', 5000); }
  }
  let picker = $state();
  async function importMap(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      const { name, data } = readTemplateFile(await file.text());
      await saveTemplate('map', { name, data });
      toast(`“${name}” added`, 'ok');
    } catch (error) { toast(error.message, 'danger', 5000); }
  }
</script>

<section class="group" data-guide="settings.proof-templates">
  <h3>Geo Proof templates</h3>
  <p class="note">
    Reusable proof styles shared across cases. New proof starts with the default one.
  </p>
  <div class="tpl-list">
    {#each templatesState.proof as t (t.id)}
      {@const isDefault = prefs.proofTemplate === t.id}
      <div class="tpl-row proof-row">
        <ProofTemplateSketch data={t.data} />
        <span class="tpl-label stacked">
          <span class="tpl-label">
            <span class="tpl-name">{t.name}</span>
            {#if isDefault}<span class="tpl-tag">Default</span>{/if}
          </span>
          <span class="tpl-said">{proofTemplateSummary(t.data)}</span>
        </span>
        <div class="tpl-actions">
          <button class="btn btn-sm" class:on={isDefault} aria-pressed={isDefault}
            title="Start new proofs with this template" onclick={() => toggleProofDefault(t.id)}>
            <Icon name="bookmark" size={13} />
          </button>
          <button class="btn btn-sm" onclick={() => editTemplate('proof', t)}>
            <Icon name="edit" size={13} /> Edit
          </button>
          <button class="btn btn-sm" onclick={() => duplicateTemplate('proof', t)}>
            <Icon name="copy" size={13} /> Duplicate
          </button>
          <button class="btn btn-sm" title="Delete"
            onclick={() => (deleteTpl = { kind: 'proof', id: t.id, name: t.name })}>
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>
    {/each}
    {#if !templatesState.proof.length}
      <p class="empty">No proof templates yet.</p>
    {/if}
  </div>
  <button class="btn btn-sm" onclick={() => newTemplate('proof')}>
    <Icon name="plus" size={13} /> New proof template
  </button>
</section>

<section class="group" data-guide="settings.report-templates">
  <h3>Geo Report templates</h3>
  <p class="note">
    Reusable thread structures for new Geo Reports.
  </p>
  <div class="tpl-list">
    {#each templatesState.post as t (t.id)}
      {@const isDefault = prefs.postTemplate === t.id}
      <div class="tpl-row">
        <span class="tpl-label">
          <span class="tpl-name">{t.name}</span>
          {#if isDefault}<span class="tpl-tag">Default</span>{/if}
        </span>
        <div class="tpl-actions">
          <button class="btn btn-sm" class:on={isDefault} aria-pressed={isDefault}
            title="Start new posts with this template" onclick={() => toggleDefault(t.id)}>
            <Icon name="bookmark" size={13} />
          </button>
          <button class="btn btn-sm" onclick={() => editTemplate('post', t)}>
            <Icon name="edit" size={13} /> Edit
          </button>
          <button class="btn btn-sm" onclick={() => duplicateTemplate('post', t)}>
            <Icon name="copy" size={13} /> Duplicate
          </button>
          <button class="btn btn-sm" title="Delete"
            onclick={() => (deleteTpl = { kind: 'post', id: t.id, name: t.name })}>
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>
    {/each}
    {#if !templatesState.post.length}
      <p class="empty">No post templates yet.</p>
    {/if}
  </div>
  <button class="btn btn-sm" onclick={() => newTemplate('post')}>
    <Icon name="plus" size={13} /> New post template
  </button>
</section>

<section class="group" data-guide="settings.note-templates">
  <h3>Notebook templates</h3>
  <p class="note">
    A note to start others from, with how it prints, shared across cases. {'{today}'} and {'{now}'} are written in when a note starts; {'{title}'}, {'{date}'}, {'{name}'}, {'{role}'} and {'{organisation}'} when it prints.
  </p>
  <div class="tpl-list">
    {#each templatesState.note as t (t.id)}
      <div class="tpl-row note-row">
        <PageThumb name={t.name} body={t.data?.body ?? ''} look={t.data?.look ?? null} width={38} />
        <span class="tpl-label stacked">
          <span class="tpl-name">{t.name}</span>
          <span class="tpl-said">{styleLabel(t.data?.look?.style ?? 'plain')}</span>
        </span>
        <div class="tpl-actions">
          <button class="btn btn-sm" title="Write it in the Notebook, with its look and its pages" onclick={() => editNote(t.id)}>
            <Icon name="edit" size={13} /> Edit</button>
          <button class="btn btn-sm" onclick={() => duplicateNote(t)}><Icon name="copy" size={13} /> Duplicate</button>
          <button class="btn btn-sm" title="Download as a file" aria-label={`Download ${t.name}`} onclick={() => downloadNote(t)}>
            <Icon name="download" size={13} /></button>
          <button class="btn btn-sm" title="Delete" aria-label={`Delete ${t.name}`}
            onclick={() => (deleteTpl = { kind: 'note', id: t.id, name: t.name })}><Icon name="trash" size={13} /></button>
        </div>
      </div>
    {/each}
    {#if !templatesState.note.length}
      <p class="empty">No Notebook templates yet. Keep one from a note, start one from a ready one, or import a file.</p>
    {/if}
  </div>
  <div class="tpl-actions">
    <button class="btn btn-sm" aria-haspopup="menu" aria-expanded={Boolean(newAnchor)} data-new-template
      title="Start a template blank, from a ready one, from one of yours or from a note"
      onclick={(event) => toggleNew(event.currentTarget)}><Icon name="plus" size={13} /> New template <Icon name="chevronDown" size={12} /></button>
    <button class="btn btn-sm" title="Add a template from an .azimut-note.json file" onclick={() => notePicker.click()}>
      <Icon name="upload" size={13} /> Import a file</button>
    <input type="file" accept=".json,application/json" hidden bind:this={notePicker} onchange={importNote} />
  </div>
</section>

{#if newAnchor}
  <FloatingMenu anchor={newAnchor} width={280} label="New template" onclose={closeNew}>
    {#if newStep === 'ready'}
      <button type="button" class="fm-item back" onclick={() => (newStep = '')}><Icon name="chevronLeft" size={13} /><span class="fm-grow">From a ready one</span></button>
      <div class="fm-sep"></div>
      {#each READY_NOTES.filter((ready) => ready.id !== 'blank') as ready (ready.id)}
        <button type="button" class="fm-item ready-item" onclick={() => startNote(ready.name, ready)}>
          <span class="fm-grow">{ready.name}</span><small>{styleLabel(ready.look?.style ?? 'plain')}</small>
        </button>
      {/each}
    {:else if newStep === 'yours'}
      <button type="button" class="fm-item back" onclick={() => (newStep = '')}><Icon name="chevronLeft" size={13} /><span class="fm-grow">From one of yours</span></button>
      <div class="fm-sep"></div>
      {#each templatesState.note as record (record.id)}
        <button type="button" class="fm-item ready-item" onclick={() => startNote(`${record.name} copy`.slice(0, 120), record.data ?? {})}>
          <span class="fm-grow">{record.name}</span><small>{styleLabel(record.data?.look?.style ?? 'plain')}</small>
        </button>
      {/each}
    {:else}
      <button type="button" class="fm-item" onclick={() => startNote('Note template', { body: '' })}>
        <Icon name="file" size={14} /><span class="fm-grow">Blank</span></button>
      <button type="button" class="fm-item" onclick={() => (newStep = 'ready')}>
        <Icon name="note" size={14} /><span class="fm-grow">From a ready one</span><Icon name="chevronRight" size={13} /></button>
      <button type="button" class="fm-item" disabled={!templatesState.note.length} title={templatesState.note.length ? '' : 'None kept yet'}
        onclick={() => (newStep = 'yours')}><Icon name="copy" size={14} /><span class="fm-grow">From one of yours</span><Icon name="chevronRight" size={13} /></button>
      {#if caseState.current}
        <button type="button" class="fm-item" onclick={fromNotes}>
          <Icon name="layers" size={14} /><span class="fm-grow">From a note of this case</span><Icon name="chevronRight" size={13} /></button>
      {/if}
    {/if}
  </FloatingMenu>
{/if}

{#if notesAnchor && caseState.current}
  {@const caseId = caseState.current.id}
  <NotePicker {caseId} anchor={notesAnchor} intro="Its text, folder and look start the template. Its cover picture and day stay with the case."
    onpick={(id, row) => fromNote(caseId, id ?? CASE_NOTES, row)} onclose={() => (notesAnchor = null)} />
{/if}

<section class="group" data-guide="settings.plate-templates">
  <h3>Map plate templates</h3>
  <p class="note">
    A plate's layout, paper and colours without a case's ground or layers, shared as a file.
  </p>
  <div class="tpl-list">
    {#each templatesState.map as t (t.id)}
      <div class="tpl-row">
        <span class="tpl-name">{t.name}</span>
        <div class="tpl-actions">
          <button class="btn btn-sm" onclick={() => editMap(t.id)}><Icon name="edit" size={13} /> Edit</button>
          <button class="btn btn-sm" onclick={() => duplicateMap(t)}><Icon name="copy" size={13} /> Duplicate</button>
          <button class="btn btn-sm" title="Download as a file" aria-label={`Download ${t.name}`} onclick={() => downloadMap(t)}><Icon name="download" size={13} /></button>
          <button class="btn btn-sm" title="Delete" aria-label={`Delete ${t.name}`}
            onclick={() => (deleteTpl = { kind: 'map', id: t.id, name: t.name })}><Icon name="trash" size={13} /></button>
        </div>
      </div>
    {/each}
    {#if !templatesState.map.length}
      <p class="empty">No map templates yet. Keep one from a plate, or start one here.</p>
    {/if}
  </div>
  <div class="tpl-actions">
    <button class="btn btn-sm" onclick={newMap}><Icon name="plus" size={13} /> New map template</button>
    <button class="btn btn-sm" onclick={() => picker.click()}><Icon name="upload" size={13} /> Import a file</button>
    <input type="file" accept=".json,application/json" hidden bind:this={picker} onchange={importMap} />
  </div>
</section>

<style>

  /* --- templates tab ------------------------------------------------------ */
  .tpl-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 10px 0 12px;
  }

  .tpl-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
  }

  .tpl-label {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .tpl-label.stacked {
    flex: 1;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
  }

  .tpl-said {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }

  .note-row,
  .proof-row {
    justify-content: flex-start;
    padding: 6px 10px 6px 8px;
  }

  .ready-item small {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }

  .back {
    color: var(--text-2);
  }

  .tpl-name {
    font-size: var(--fs-sm);
    color: var(--text-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tpl-tag {
    flex-shrink: 0;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: var(--fs-xs);
    font-weight: 600;
  }

  .btn.on,
  .btn.on:hover:not(:disabled) {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }

  .tpl-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
</style>
