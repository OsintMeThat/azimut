<script>
  /**
   * Every layer a map offers, as switches small enough for a menu.
   *
   * The Map works its layers in a panel: a legend, a search, a time strip. The
   * other maps only need them on or off, so they list them as chips, grouped the
   * way the catalogue groups them, with the analyst's own layers last. A layer
   * that asks a question (which day, which sensor) says its answer in one line
   * once it is on, and opens its settings only when asked; a layer that needs a
   * key stays listed, greyed, with the way to get one.
   */
  import { LAYER_GROUPS } from '../lib/map/layerCatalog.js';
  import LayerControls from './LayerControls.svelte';

  let {
    /** `{ id, label, group, on, disabled?, title?, toggle, count?, summary?,
     *  controls?, note?, lock?: { text, action, run } }` each. */
    rows = [],
    /** The case's added layers, as the store lists them for this map. */
    added = [],
    ontoggleadded = () => {},
    /** Where layers are added and worked. Absent hides the way there. */
    onmanage = null,
  } = $props();

  /** The settings opened with Change, by layer id. Closed again with it. */
  let opened = $state({});

  const groups = $derived(
    LAYER_GROUPS.map((group) => ({ ...group, rows: rows.filter((row) => row.group === group.id) })).filter(
      (group) => group.rows.length
    )
  );
  const live = (row) => row.on && !row.disabled;
</script>

<div class="layer-chips">
  {#each groups as group (group.id)}
    <section aria-label={group.label}>
      <h4>{group.label}</h4>
      <div class="chips">
        {#each group.rows as row (row.id)}
          <button
            type="button"
            class="chip"
            class:on={live(row)}
            aria-pressed={live(row)}
            disabled={row.disabled}
            title={row.title ?? row.label}
            onclick={row.toggle}
          >
            {row.label}{#if row.count}<span class="count">{row.count}</span>{/if}
          </button>
        {/each}
      </div>
      {#each group.rows as row (row.id)}
        {#if row.lock}
          <p class="line">
            <span>{row.label}: {row.lock.text}.</span>
            <button type="button" class="link" onclick={row.lock.run}>{row.lock.action}</button>
          </p>
        {:else if live(row) && (row.summary || row.controls?.length)}
          <p class="line">
            <span>{row.label}: {row.summary}</span>
            {#if row.controls?.length}
              <button
                type="button"
                class="link"
                aria-expanded={Boolean(opened[row.id])}
                onclick={() => (opened = { ...opened, [row.id]: !opened[row.id] })}
                >{opened[row.id] ? 'Done' : 'Change'}</button
              >
            {/if}
          </p>
          {#if opened[row.id] && row.controls?.length}
            <div class="settings" aria-label={`${row.label} settings`}><LayerControls controls={row.controls} /></div>
          {/if}
          {#if row.note}<p class="note">{row.note}</p>{/if}
        {/if}
      {/each}
    </section>
  {/each}

  {#if added.length}
    <section aria-label="Added layers">
      <h4>Added layers</h4>
      <div class="chips">
        {#each added as layer (layer.name)}
          <button
            type="button"
            class="chip"
            class:on={layer.enabled}
            aria-pressed={Boolean(layer.enabled)}
            title={layer.title}
            onclick={() => ontoggleadded(layer)}>{layer.title}</button
          >
        {/each}
      </div>
    </section>
  {/if}

  {#if onmanage}
    <button type="button" class="link manage" onclick={onmanage}>
      {added.length ? 'Add or manage layers in Satellite' : 'Add your own layers in Satellite'}
    </button>
  {/if}
</div>

<style>
  .layer-chips {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  h4 {
    margin: 0;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    padding: 4px 9px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .chip:hover:not(:disabled) {
    border-color: var(--border-strong);
    color: var(--text-1);
  }
  .chip.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .chip:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .count {
    font-size: 10px;
    color: var(--text-3);
  }
  .chip.on .count {
    color: inherit;
  }
  .line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 6px;
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .settings {
    padding: 4px 0 2px 8px;
    border-left: 2px solid var(--border);
  }
  .note {
    margin: 0;
    font-size: 10px;
    color: var(--text-3);
  }
  .manage {
    align-self: flex-start;
  }
</style>
