<script>
  /**
   * Reusable proof styles and report structures, shared across cases.
   *
   * Content-free presets: a template carries house style, never a case's
   * material. Editing or duplicating one opens the parent's editor modal. One
   * post template can be the one new posts start with (`post_template`).
   */
  import Icon from '../../components/Icon.svelte';
  import { templatesState, prefs, saveTemplate, toast, uiState } from '../../lib/state.svelte.js';
  import { houseLayout, templateOf } from '../../lib/plate/page.js';
  import { readTemplateFile, templateFile } from '../../lib/plate/templateFile.js';

  let { newTemplate, editTemplate, duplicateTemplate, savePrefs, deleteTpl = $bindable() } = $props();

  // Pressing the template that is already the default clears it, which brings
  // back the classic layout.
  function toggleDefault(id) {
    savePrefs({ post_template: prefs.postTemplate === id ? '' : id });
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
  function downloadMap(record) {
    const url = URL.createObjectURL(templateFile(record));
    const link = document.createElement('a');
    link.href = url; link.download = `${record.name.replace(/[\\/<>:"|?*\u0000-\u001f]/g, '_')}.azimut-map.json`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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

<section class="group">
  <h3>Geo Proof templates</h3>
  <p class="note">
    Reusable proof styles shared across cases.
  </p>
  <div class="tpl-list">
    {#each templatesState.proof as t (t.id)}
      <div class="tpl-row">
        <span class="tpl-name">{t.name}</span>
        <div class="tpl-actions">
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

<section class="group">
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

<section class="group">
  <h3>Map plate templates</h3>
  <p class="note">
    A plate's layout, paper and colours, without a case's ground or layers. Share one as a file.
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
    margin-bottom: 12px;
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
