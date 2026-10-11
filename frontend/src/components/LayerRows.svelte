<script>
  /**
   * Layers as rows: an eye, the name, what it shows, and under a layer that is on
   * its own settings. The Map's Layers panel and the other maps' Layers menu draw
   * the same rows, so a layer reads the same wherever it is switched.
   */
  import Icon from './Icon.svelte';
  import LayerControls from './LayerControls.svelte';

  let {
    /**
     * `{ id, label, on, disabled, title, detail, toggle }`, plus three that
     * only some layers carry: `actions` (buttons under the row), `controls`
     * (its own settings, for a layer that is a question) and `note` (why it is
     * on but drawing nothing yet).
     */
    rows,
  } = $props();
</script>

<ul class="layers">
  {#each rows as row (row.id)}
    <li>
      <div class="row">
        <button
          type="button"
          class="eye"
          class:on={row.on}
          disabled={row.disabled}
          aria-pressed={Boolean(row.on)}
          aria-label={row.label}
          title={row.title ?? row.label}
          onclick={row.toggle}
        >
          <Icon name="eye" size={13} />
        </button>
        <!-- the name repeats the tooltip, so the reason a switch is greyed is on a word, not only on its icon -->
        <span class="name" class:off={!row.on || row.disabled} title={row.title ?? row.label}>{row.label}</span>
        {#if row.detail}<span class="detail">{row.detail}</span>{/if}
        {#if row.edit}<button class="eye" aria-label={`Edit ${row.label}`} title="Edit layer" onclick={row.edit}><Icon name="edit" size={12} /></button>{/if}
        {#if row.download}<button class="eye" aria-label={`Download ${row.label}`} title="Download layer" onclick={row.download}><Icon name="download" size={12} /></button>{/if}
      </div>
      <!-- A layer that is a question answers it here, under its own switch:
           a card floating over the map is what the whole rework took away,
           and a layer's settings are not a mode's panel. -->
      {#if row.controls?.length}
        <div class="settings"><LayerControls controls={row.controls} /></div>
      {/if}
      {#if row.note}
        <p class="note">{row.note}</p>
      {/if}
      {#if row.actions?.length}
        <nav class="acts" aria-label={row.label}>
          {#each row.actions as act (act.label)}
            <button class="btn btn-sm" class:quiet={act.quiet} onclick={act.run}>{act.label}</button>
          {/each}
        </nav>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .layers {
    margin: 0 0 10px;
    padding: 0 4px;
    list-style: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 26px;
  }
  .eye {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-1);
    color: var(--text-3);
    cursor: pointer;
  }
  .eye:hover:not(:disabled) {
    color: var(--text-1);
    background: var(--bg-3);
  }
  .eye.on {
    color: var(--accent);
  }
  .eye:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .name {
    flex: 1;
    font-size: var(--fs-sm);
    color: var(--text-1);
  }
  .name.off {
    color: var(--text-3);
  }
  .detail {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 2px 0 6px 30px;
  }
  /* indented under the switch they belong to, so the list still reads as a
     list of layers rather than as a stack of panels */
  .settings {
    padding: 2px 0 6px 30px;
  }
  .note {
    margin: 0;
    padding: 0 0 6px 30px;
    font-size: 10px;
    color: var(--text-3);
  }
</style>
