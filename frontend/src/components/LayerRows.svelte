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
     * `{ id, label, on, disabled, title, detail, toggle }`, plus five that
     * only some layers carry: `actions` (buttons under the row), `controls`
     * (its own settings, for a layer that is a question), `note` (why it is
     * on but drawing nothing yet) and `of` (the layer this one is a switch of,
     * drawn as a small toggle on that layer's own line).
     */
    rows,
  } = $props();

  // A switch of a layer (Places' Names) sits on that layer's line, discreetly,
  // rather than as a row of its own under it.
  const layers = $derived(rows.filter((row) => !row.of));
  const switchesOf = (id) => rows.filter((row) => row.of === id);
  /** The small glyph a switch of a layer wears. */
  const SWITCH_ICON = { 'places-names': 'text' };
</script>

<ul class="layers">
  {#each layers as row (row.id)}
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
        {#each switchesOf(row.id) as sub (sub.id)}
          <button
            type="button"
            class="eye switch"
            class:on={sub.on}
            disabled={sub.disabled}
            aria-pressed={Boolean(sub.on)}
            aria-label={sub.label}
            title={sub.title ?? sub.label}
            onclick={sub.toggle}
          >
            <Icon name={SWITCH_ICON[sub.id] ?? 'check'} size={12} />
          </button>
        {/each}
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
  /* a switch of the layer, on its line: smaller and quiet until it is on */
  .eye.switch {
    width: 20px;
    height: 20px;
    opacity: 0.75;
  }
  .eye.switch.on {
    opacity: 1;
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
