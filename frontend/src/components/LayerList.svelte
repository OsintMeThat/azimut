<script>
  /**
   * Every layer a map offers, as the Map's own Layers panel lists them: one row
   * each with its eye, grouped under headings that fold.
   *
   * The Map works the case's own layers in sections of their own (a legend, a
   * search, a time strip). Other maps share compact rows: My layers opens the
   * common editor and offers creation, while Added layers links to source
   * management in Map. A layer that asks a
   * question shows its settings under its row once it is on; a layer that needs a
   * key stays listed, greyed, with the way to get one.
   */
  import { LAYER_GROUPS } from '../lib/map/layerCatalog.js';
  import Icon from './Icon.svelte';
  import LayerRows from './LayerRows.svelte';

  let {
    /** The rows `LayerRows` draws, each with the `group` it is listed under. */
    rows = [],
    /** The case's own layers, drawn or imported, as the store lists them for this map. */
    added = [],
    ontoggleadded = () => {},
    /** Where layers are added and worked. Absent hides the way there. */
    onmanage = null,
    oneditadded = null,
    onnewpersonal = null,
    ondownloadadded = null,
    onmaps = null,
    /** group id → folded. Held by the caller, so a menu closed and opened again
     *  keeps the headings as they were left. */
    folded = $bindable({}),
  } = $props();

  const caseRows = (list) =>
    list.map((layer) => ({
      id: layer.name,
      label: layer.title,
      title: layer.title,
      on: Boolean(layer.enabled),
      toggle: () => ontoggleadded(layer),
      ...(layer.editable && oneditadded ? { edit: () => oneditadded(layer) } : {}),
      ...(layer.editable && ondownloadadded ? { download: () => ondownloadadded(layer) } : {}),
    }));
  const groups = $derived([
    ...LAYER_GROUPS.map((group) => ({ ...group, rows: rows.filter((row) => row.group === group.id) })),
    { id: 'mine', label: 'My layers', rows: caseRows(added.filter((layer) => layer.editable)) },
    { id: 'added', label: 'Added layers', rows: caseRows(added.filter((layer) => !layer.editable)) },
  ].filter((group) => group.rows.length || group.id === 'added' || (group.id === 'mine' && onnewpersonal)));
  const live = (list) => list.filter((row) => row.on && !row.disabled).length;
  const fold = (id) => (folded = { ...folded, [id]: !folded[id] });
</script>

<div class="layer-list">
  {#each groups as group (group.id)}
    <section aria-label={group.label}>
      <button type="button" class="sub-head" aria-expanded={!folded[group.id]} onclick={() => fold(group.id)}>
        <Icon name={folded[group.id] ? 'chevronRight' : 'chevronDown'} size={12} />
        <span>{group.label}</span>
        <span class="count">{live(group.rows)}</span>
      </button>
      {#if !folded[group.id]}
        {#if group.rows.length}
          <LayerRows rows={group.rows} />
        {:else if group.id === 'added'}
          <p class="empty-note">Nothing added yet.</p>
        {/if}
        {#if group.id === 'added' && onmanage}
          <button type="button" class="manage" onclick={onmanage}>
            <Icon name="plus" size={12} />
            {added.length ? 'Add or manage in Satellite' : 'Add a layer in Satellite'}
          </button>
        {/if}
        {#if group.id === 'mine' && onnewpersonal}
          <button type="button" class="manage" onclick={onnewpersonal}><Icon name="plus" size={12} /> New layer</button>
        {/if}
        {#if group.id === 'mine' && onmaps}<button class="manage" onclick={onmaps}><Icon name="compass" size={12} /> Saved maps</button>{/if}
      {/if}
    </section>
  {/each}
</div>

<style>
  .layer-list {
    display: flex;
    flex-direction: column;
  }
  /* the first heading sits at the top of the menu, not a section's gap below it */
  section:first-child .sub-head {
    padding-top: 2px;
  }
  .empty-note {
    margin: 0 0 8px;
    font-size: var(--fs-xs);
    color: var(--text-3);
    text-align: center;
  }
  .manage {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    min-height: 28px;
    margin: 0 0 4px;
    border: 1px dashed var(--border);
    border-radius: var(--r-sm);
    background: none;
    color: var(--text-2);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .manage:hover {
    border-color: var(--border-strong);
    color: var(--accent);
  }
</style>
