<script>
  /**
   * The time of day beside a calendar of a layer dated to the minute, on the
   * layer's clock, its zone named after it. `value` is `HH:MM` or '' for none.
   */
  let { value = '', zone = 'UTC', label = 'Time of day', onchange } = $props();
</script>

<label class="clock">
  <span>Time</span>
  <input type="time" aria-label={label} {value} onchange={(event) => onchange?.(event.currentTarget.value)} />
  <span class="zone">{zone === 'UTC' ? 'UTC' : zone.split('/').at(-1).replaceAll('_', ' ')}</span>
</label>

<style>
  .clock { display: flex; align-items: center; gap: 6px; padding: 2px 0 2px 2px; color: var(--text-3); font-size: 10px; }
  .clock input { height: 22px; padding: 1px 4px; font-size: 11px; }
</style>
