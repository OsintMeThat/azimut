<script>
  /**
   * The questions a layer asks once it is on: which sensor, which day, which
   * folder. Drawn the same under the Map's layer rows and in the other maps'
   * Layers menu, from the shape `lib/map/eventControls.js` builds.
   */
  import DayPicker from './DayPicker.svelte';

  let {
    /** `{ label, options, value, pick, list?, day?, days?, dates? }` each: `day`
     *  is one date field, `days` several side by side in name (A and B). */
    controls,
  } = $props();
</script>

<div class="layer-controls">
  {#each controls as control (control.label)}
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
              aria-pressed={control.value === option.id}
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
    {#each control.days ?? [] as day (day.label)}
      <div class="date">
        <span>{day.label}</span>
        <DayPicker
          value={day.value}
          min={day.min}
          max={day.max}
          label={day.title}
          placeholder="Pick a day"
          onpick={(value) => day.set(value)}
        />
      </div>
    {/each}
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

<style>
  .layer-controls {
    display: flex;
    flex-direction: column;
    gap: 5px;
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
</style>
