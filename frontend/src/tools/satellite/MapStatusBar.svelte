<script>
  /**
   * The instrument's status line: where you are, what the armed tool is
   * reading, and the two acts that take something away from the map.
   *
   * It gathers what used to be three separate boxes — a coordinate HUD floating
   * at the top, a measure reading inside the measure panel, and a bottom bar
   * that mixed the imagery provider (a property of the picture, now a chip on
   * the surface itself) with Save place and Capture (acts). One rule sorts
   * them: a number the map is telling you reads on the left, an act that files
   * something reads on the right.
   *
   * There is no band across the map. Two groups sit on one line with nothing
   * painted between them, so the strip costs the map two corners rather than a
   * full-width stripe.
   */
  import Icon from '../../components/Icon.svelte';

  let {
    /** Formatted coordinates, already in the analyst's own unit. */
    coords,
    zoom,
    /** The marker is off the centre and draggable, so the coordinates are its. */
    pinned = false,
    copy,
    /** What the armed tool is reading right now, and its prompt when it has none. */
    reading = '',
    hint = '',
    /** The acts: the host owns them, because it owns what they file. */
    children,
  } = $props();
</script>

<div class="status">
  <div class="readouts card">
    <button class="hud-coords mono" onclick={copy} title="Copy coordinates">
      <Icon name="crosshair" size={13} />
      {coords}
      <span class="z">z{zoom}</span>
      {#if pinned}<span class="pin-tag">pin</span>{/if}
      <Icon name="copy" size={12} />
    </button>
    {#if reading || hint}
      <span class="rule" aria-hidden="true"></span>
      {#if reading}
        <span class="measure-value mono">{reading}</span>
      {:else}
        <span class="hint">{hint}</span>
      {/if}
    {/if}
  </div>
  <div class="acts">
    {@render children?.()}
  </div>
</div>

<style>
  .status {
    position: absolute;
    /* clear of the engine's own bottom line: the scale bracket under the
       coordinates on one side, the tile credits on the other */
    bottom: 34px;
    left: 12px;
    right: 12px;
    z-index: 600;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 10px;
    /* only reached on a genuinely narrow map — a second row beats controls that
       are off-screen */
    flex-wrap: wrap;
    pointer-events: none;
  }
  .status > * {
    pointer-events: auto;
  }
  .readouts {
    display: flex;
    align-items: center;
    background: rgba(24, 24, 24, 0.88);
    backdrop-filter: blur(6px);
  }
  .hud-coords {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 13px;
    font-size: var(--fs-sm);
    color: var(--text-1);
    cursor: pointer;
  }
  .hud-coords:hover {
    color: var(--accent);
  }
  .z {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .pin-tag {
    padding: 1px 4px;
    border-radius: 3px;
    font-family: var(--font-sans);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--accent-text);
    background: var(--accent);
  }
  .rule {
    align-self: stretch;
    width: 1px;
    margin: 5px 0;
    background: var(--border);
  }
  .measure-value {
    padding: 0 13px;
    font-size: var(--fs-sm);
    font-weight: 700;
    color: var(--accent);
  }
  .hint {
    padding: 0 13px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .acts {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 10px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-lg, 6px);
    background: rgba(24, 24, 24, 0.88);
    backdrop-filter: blur(6px);
  }
</style>
