<script>
  /**
   * A number and its unit in one box, with two small arrows beside it for the
   * fine settings a wheel notch overshoots: a press is one step, Shift ten,
   * and a held press keeps stepping. Typing still works, and the arrow keys
   * step it too. The value goes out as a number, on change.
   */
  import { onDestroy } from 'svelte';
  import { repeatPress, stepped } from '../../lib/repeatPress.js';

  let {
    value,
    unit = '',
    /** One press of an arrow; Shift makes it ten. */
    step = 1,
    min = -Infinity,
    max = Infinity,
    /** The new value, a number, or null when the field was emptied. */
    onchange = () => {},
    /** What the field is, for a screen reader and the arrows' names. */
    label = '',
    id = undefined,
    title = undefined,
    disabled = false,
  } = $props();

  function typed(event) {
    const raw = event.currentTarget.value;
    const number = Number(raw);
    onchange(raw !== '' && Number.isFinite(number) ? number : null);
  }

  const nudge = (direction) => (shift) => {
    if (!disabled) onchange(stepped(value, direction, step, { shift, min, max }));
  };
  const up = repeatPress(nudge(1));
  const down = repeatPress(nudge(-1));
  onDestroy(() => {
    up.stop();
    down.stop();
  });
</script>

<span class="num" class:disabled {title}>
  <input
    class="mono"
    type="number"
    {id}
    {value}
    {step}
    min={Number.isFinite(min) ? min : undefined}
    max={Number.isFinite(max) ? max : undefined}
    {disabled}
    aria-label={label || undefined}
    onchange={typed}
  />
  {#if unit}<span class="suffix">{unit}</span>{/if}
  <span class="steps">
    {#each [[up, 'up', 'M1.5 5.5 4.5 2.5 7.5 5.5'], [down, 'down', 'M1.5 2.5 4.5 5.5 7.5 2.5']] as [press, way, path] (way)}
      <button
        type="button"
        tabindex="-1"
        {disabled}
        aria-label="{label || 'Value'} {way}"
        title="{way === 'up' ? 'Up' : 'Down'} by {step}{unit ? ` ${unit}` : ''}; Shift for ten times that"
        onpointerdown={press.start}
        onpointerup={press.stop}
        onpointerleave={press.stop}
        onpointercancel={press.stop}
      >
        <svg width="9" height="8" viewBox="0 0 9 8" aria-hidden="true"><path d={path} /></svg>
      </button>
    {/each}
  </span>
</span>

<style>
  .num {
    display: inline-flex;
    align-items: stretch;
    height: 26px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .num:focus-within {
    border-color: var(--accent);
  }
  .num.disabled {
    opacity: 0.55;
  }
  input {
    width: 48px;
    padding: 0 2px 0 8px;
    border: none;
    background: transparent;
    color: var(--text-1);
    font-size: var(--fs-xs);
    outline: none;
    appearance: textfield;
    -moz-appearance: textfield;
  }
  input::-webkit-inner-spin-button,
  input::-webkit-outer-spin-button {
    appearance: none;
    margin: 0;
  }
  .suffix {
    display: inline-flex;
    align-items: center;
    padding-right: 6px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .steps {
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--border);
  }
  .steps button {
    display: grid;
    flex: 1;
    place-items: center;
    width: 16px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }
  .steps button + button {
    border-top: 1px solid var(--border);
  }
  .steps button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--text-1) 8%, transparent);
    color: var(--text-1);
  }
  .steps button:active:not(:disabled) {
    color: var(--accent);
  }
  .steps button:disabled {
    cursor: default;
  }
  .steps svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
