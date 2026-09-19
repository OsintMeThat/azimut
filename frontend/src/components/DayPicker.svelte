<script>
  /**
   * A day, picked from a calendar drawn inside the panel it belongs to.
   *
   * The field is the whole control here: the day it holds is all it says, and
   * pressing it opens the month under it. The grid itself is `MonthGrid.svelte`,
   * which `DateField` opens from an icon beside a date that can also be typed.
   */
  import Icon from './Icon.svelte';
  import MonthGrid from './MonthGrid.svelte';

  let {
    /** The day being shown, `YYYY-MM-DD`, or '' for none. */
    value = '',
    /** What the field says when there is no day yet. */
    placeholder = 'Any day',
    /** Bounds, either of which may be empty for "no bound". */
    min = '',
    max = '',
    /** Names the field for a reader that cannot see the label beside it. */
    label = 'Date',
    /** Whether the day can be taken back out, for a field that means "and no
     *  further" as much as it means a date. */
    clearable = false,
    /** Called with the chosen day, or '' when it is cleared. */
    onpick,
  } = $props();

  let open = $state(false);

  function pick(iso) {
    onpick?.(iso);
    open = false;
  }
</script>

<div class="day-picker">
  <button
    type="button"
    class="field"
    class:unset={!value}
    aria-expanded={open}
    aria-label={label}
    onclick={() => (open = !open)}
  >
    <span>{value || placeholder}</span>
    <Icon name={open ? 'chevronUp' : 'chevronDown'} size={11} />
  </button>

  {#if open}
    <MonthGrid {value} {min} {max} {label} {clearable} onpick={pick} />
  {/if}
</div>

<style>
  .day-picker {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    gap: 4px;
  }
  .field {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 3px 6px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-1);
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    cursor: pointer;
  }
  .field:hover {
    border-color: var(--border-strong);
  }
  /* Not `.empty`: that is the app-wide empty-state block (app.css), which would
     turn an unset field into a padded column. */
  .field.unset {
    color: var(--text-3);
  }
  .field[aria-expanded='true'] {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
