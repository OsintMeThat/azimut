<script>
  /**
   * The one control a reading mode needs, at the foot of the stage: B's
   * opacity for a fade, speed and a manual flip for blink, the divider's
   * position for a swipe. The computing modes are not here — they own a panel
   * beside the stage instead, because a detection needs more than one row.
   */
  import Icon from '../../components/Icon.svelte';
  import { BLINK_SPEEDS, percentage } from '../../lib/map/compare.js';

  let {
    mode,
    divider = $bindable(50),
    opacity = $bindable(50),
    blinkB = $bindable(false),
    blinkPaused = $bindable(false),
    blinkInterval = $bindable(800),
  } = $props();
</script>

{#if mode === 'swipe'}
  <div class="mode-control cmp-glass" aria-label="Swipe">
    <span class="cmp-letter a">A</span>
    <input
      class="cmp-range"
      type="range"
      min="0"
      max="100"
      value={divider}
      style:--fill={`${divider}%`}
      oninput={(event) => (divider = percentage(event.currentTarget.value))}
      aria-label="Swipe position"
    />
    <span class="cmp-letter b">B</span>
    <button class="text-btn" onclick={() => (divider = 50)} disabled={divider === 50}>Centre</button>
  </div>
{:else if mode === 'opacity'}
  <div class="mode-control cmp-glass" aria-label="Fade">
    <span class="cmp-letter a">A</span>
    <input
      class="cmp-range"
      type="range"
      min="0"
      max="100"
      value={opacity}
      style:--fill={`${opacity}%`}
      oninput={(event) => (opacity = percentage(event.currentTarget.value))}
      aria-label="B opacity"
    />
    <span class="cmp-letter b">B</span>
    <span class="value cmp-mono">{opacity}%</span>
  </div>
{:else if mode === 'blink'}
  <div class="mode-control cmp-glass" aria-label="Blink">
    <button
      class="cmp-icon"
      onclick={() => (blinkPaused = !blinkPaused)}
      aria-label={blinkPaused ? 'Play blink' : 'Pause blink'}
      title={blinkPaused ? 'Play (Space)' : 'Pause (Space)'}
    >
      <Icon name={blinkPaused ? 'play' : 'pause'} size={15} />
    </button>
    <div class="cmp-seg" aria-label="Side shown">
      <button class:on={!blinkB} onclick={() => { blinkPaused = true; blinkB = false; }}>
        <span class="cmp-letter a small">A</span>
      </button>
      <button class:on={blinkB} onclick={() => { blinkPaused = true; blinkB = true; }}>
        <span class="cmp-letter b small">B</span>
      </button>
    </div>
    <span class="rule" aria-hidden="true"></span>
    <div class="cmp-seg" aria-label="Blink speed">
      {#each BLINK_SPEEDS as speed (speed.id)}
        <button class:on={blinkInterval === speed.id} onclick={() => (blinkInterval = speed.id)}>{speed.label}</button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .mode-control {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 42px;
    padding: 5px 10px;
  }
  .mode-control .cmp-range {
    width: min(320px, 34vw);
  }
  .cmp-letter.small {
    width: 18px;
    height: 18px;
    font-size: 10px;
  }
  .cmp-seg > button:has(.cmp-letter) {
    padding: 0 5px;
  }
  .value {
    min-width: 36px;
    color: var(--glass-muted);
    font-size: 11px;
    text-align: right;
  }
  .text-btn {
    padding: 4px 8px;
    border-radius: 6px;
    color: var(--glass-muted);
    font-size: 11.5px;
    font-weight: 600;
  }
  .text-btn:hover:not(:disabled) {
    color: var(--glass-ink);
    background: var(--glass-hover);
  }
  .text-btn:disabled {
    opacity: 0.4;
  }
  .rule {
    width: 1px;
    height: 18px;
    background: var(--glass-line);
  }
</style>
