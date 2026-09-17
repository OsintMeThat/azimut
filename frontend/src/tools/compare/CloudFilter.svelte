<script>
  /**
   * Cloud and the shadow it casts, as one thing to click.
   *
   * It sits at the top of Detect's third step and of Difference's column rather
   * than inside the thresholds, because cloud is the first thing that goes
   * wrong in a reading and hunting for the switch that fixes it is the wrong
   * first minute. The split between cloud and shadow, and the margin, stay with
   * the thresholds: this is the one decision, and the rest is tuning.
   *
   * Both modes read one sky, from Sentinel-2's own classification, so a caller
   * only shows this where that classification exists: the fire test rejects
   * cloud by its own band ratios, and a Wayback picture carries no classes.
   */
  import Icon from '../../components/Icon.svelte';

  let { clouds = false, shadows = false, ontoggle } = $props();

  const on = $derived(clouds || shadows);
  const name = $derived(
    !on || (clouds && shadows) ? 'Clouds & shadows' : clouds ? 'Clouds only' : 'Shadows only'
  );
</script>

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
  <p class="how" class:dim={!on}>Sentinel-2's scene classification, with shadows traced from the sun.</p>
</div>

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
