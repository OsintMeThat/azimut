<script>
  /**
   * Cloud and the shadow it casts, as one thing to click.
   *
   * It sits at the top of both computing panels rather than inside a settings
   * tab, because cloud is the first thing that goes wrong in a reading and
   * hunting for the switch that fixes it is the wrong first minute. The split
   * between cloud and shadow, and the margin, stay in the panel's own detail
   * area: this is the one decision, and the rest is tuning.
   *
   * `kind` comes from the method catalogue, never from a list kept here — a
   * method that cannot separate cloud from what it looks for offers nothing.
   */
  import Icon from '../../components/Icon.svelte';

  let { kind = '', clouds = false, shadows = false, split = true, ontoggle } = $props();

  const on = $derived(split ? clouds || shadows : clouds);
  const name = $derived(
    !split || !on || (clouds && shadows)
      ? 'Clouds & shadows'
      : clouds
        ? 'Clouds only'
        : 'Shadows only'
  );
  // Said every time it is on, because the two answers are not equally good and
  // the panel must not let a guess pass for a measurement.
  const how = $derived(
    kind === 'classes'
      ? "Sentinel-2's own scene classification."
      : 'A guess from the picture: bright and colourless, or near-black.'
  );
</script>

{#if kind}
  <div class="cloud-filter">
    <button
      type="button"
      class="chip"
      class:on
      aria-pressed={on}
      onclick={() => ontoggle(!on)}
      title={on ? 'Stop excluding cloud and shadow' : 'Exclude cloud and the shadow it casts'}
    >
      <Icon name={on ? 'eyeOff' : 'eye'} size={13} />
      {name}
      <span class="state">{on ? 'on' : 'off'}</span>
    </button>
    <p class="how" class:dim={!on}>{how}</p>
  </div>
{/if}

<style>
  .cloud-filter {
    display: grid;
    gap: 3px;
  }
  .chip {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 7px 9px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
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
  .state {
    margin-left: auto;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 500;
    opacity: 0.8;
  }
  .how {
    margin: 0;
    color: var(--text-3);
    font-size: 10px;
    line-height: 1.35;
  }
  .how.dim {
    opacity: 0.75;
  }
</style>
