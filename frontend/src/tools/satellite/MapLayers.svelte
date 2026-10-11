<script>
  /**
   * What is drawn over the imagery, listed in one place.
   *
   * Before, a layer was wherever it had been added: OSM labels and the case's
   * saved pins were buttons in the toolbox, a sheet's points and a Timeline
   * window were cards floating over the map with their own close buttons, and
   * nothing said they were the same kind of thing. They are: each is something
   * laid over the picture, on or off, and none of them changes what the pointer
   * does.
   *
   * A handoff layer — points another tool sent here — appears in the list when
   * it arrives and leaves when it is closed, so the panel never shows a switch
   * for something that is not there.
   */
  import Icon from '../../components/Icon.svelte';
  import LayerControls from '../../components/LayerControls.svelte';

  let {
    /**
     * `{ id, label, on, disabled, title, detail, toggle }`, plus three that
     * only some layers carry: `actions` (buttons under the row), `controls`
     * (its own settings, for a layer that is a question) and `note` (why it is
     * on but drawing nothing yet).
     */
    rows,
    open = $bindable(true),
  } = $props();

  const live = $derived(rows.filter((row) => row.on && !row.disabled).length);
</script>

<button type="button" class="sub-head" onclick={() => (open = !open)}>
  <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
  <Icon name="stack" size={13} />
  <span>Layers</span>
  <span class="count">{live}</span>
</button>

{#if open}
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
{/if}

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
