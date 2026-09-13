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
  import DayPicker from '../../components/DayPicker.svelte';
  import Icon from '../../components/Icon.svelte';

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
          <span class="name" class:off={!row.on || row.disabled}>{row.label}</span>
          {#if row.detail}<span class="detail">{row.detail}</span>{/if}
        </div>
        <!-- A layer that is a question answers it here, under its own switch:
             a card floating over the map is what the whole rework took away,
             and a layer's settings are not a mode's panel. -->
        {#if row.controls?.length}
          <div class="settings">
            {#each row.controls as control (control.label)}
              <div class="setting">
                <span class="setting-label">{control.label}</span>
                <!-- A fixed handful of short answers reads as chips; an
                     open-ended list the analyst named themselves does not, and
                     wrapped one folder per line it stopped reading as a
                     control at all. -->
                {#if control.list}
                  <select
                    class="select pick"
                    aria-label={control.label}
                    value={control.value}
                    onchange={(event) => control.pick(event.currentTarget.value)}
                  >
                    {#each control.options as option (option.id)}
                      <option value={option.id} title={option.title ?? option.label}
                        >{option.label}</option
                      >
                    {/each}
                  </select>
                {:else}
                  <div class="chips">
                    {#each control.options as option (option.id)}
                      <button
                        class="chip"
                        class:on={control.value === option.id}
                        title={option.title ?? option.label}
                        onclick={() => control.pick(option.id)}
                      >{option.label}</button>
                    {/each}
                  </div>
                {/if}
              </div>
              <!-- Stacked, not side by side: two date fields do not fit the
                   width of this panel. The calendar is ours and opens in flow,
                   because the browser's own opened over the map and half
                   outside the window in a panel docked to this edge. -->
              {#if control.day}
                <div class="date">
                  <span>{control.day.label}</span>
                  <DayPicker
                    value={control.day.value}
                    min={control.day.min}
                    max={control.day.max}
                    label={control.day.title}
                    placeholder="Pick a day"
                    onpick={(day) => control.day.set(day)}
                  />
                </div>
              {/if}
              {#if control.dates}
                <div class="date">
                  <span>From</span>
                  <DayPicker
                    value={control.dates.first}
                    max={control.dates.today}
                    label="First day of detections to draw"
                    placeholder="Pick a day"
                    onpick={(day) => control.dates.setFirst(day)}
                  />
                </div>
                <div class="date">
                  <span>To</span>
                  <DayPicker
                    value={control.dates.last}
                    min={control.dates.first}
                    max={control.dates.max}
                    label="Last day; blank draws the first day alone"
                    placeholder="That day alone"
                    clearable
                    onpick={(day) => control.dates.setLast(day)}
                  />
                </div>
              {/if}
            {/each}
          </div>
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
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 2px 0 6px 30px;
  }
  .setting {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .setting-label {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  /* the global .select is sized for a form, not for a panel docked over a map,
     and left to itself it draws in the platform's font beside our own chips */
  .pick {
    padding: 4px 7px;
    font-family: inherit;
    font-size: 11px;
  }
  .chip {
    padding: 3px 7px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: 10px;
    white-space: nowrap;
    cursor: pointer;
  }
  .chip:hover {
    border-color: var(--border-strong);
    color: var(--text-1);
  }
  .chip.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .date {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .date span {
    width: 34px;
    padding-top: 4px;
  }
  .note {
    margin: 0;
    padding: 0 0 6px 30px;
    font-size: 10px;
    color: var(--text-3);
  }
</style>
