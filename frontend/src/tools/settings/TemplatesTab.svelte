<script>
  /**
   * Reusable proof styles and report structures, shared across cases.
   *
   * Content-free presets: a template carries house style, never a case's
   * material. Editing one opens the parent's editor modal.
   */
  import Icon from '../../components/Icon.svelte';
  import { templatesState } from '../../lib/state.svelte.js';

  let { newTemplate, editTemplate, deleteTpl = $bindable() } = $props();
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
      <div class="tpl-row">
        <span class="tpl-name">{t.name}</span>
        <div class="tpl-actions">
          <button class="btn btn-sm" onclick={() => editTemplate('post', t)}>
            <Icon name="edit" size={13} /> Edit
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

  .tpl-name {
    font-size: var(--fs-sm);
    color: var(--text-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tpl-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
</style>
