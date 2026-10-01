<script>
  /**
   * Reusable proof styles and report structures, shared across cases.
   *
   * Content-free presets: a template carries house style, never a case's
   * material. Editing or duplicating one opens the parent's editor modal. One
   * post template can be the one new posts start with (`post_template`).
   */
  import Icon from '../../components/Icon.svelte';
  import { templatesState, prefs } from '../../lib/state.svelte.js';

  let { newTemplate, editTemplate, duplicateTemplate, savePrefs, deleteTpl = $bindable() } = $props();

  // Pressing the template that is already the default clears it, which brings
  // back the classic layout.
  function toggleDefault(id) {
    savePrefs({ post_template: prefs.postTemplate === id ? '' : id });
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
