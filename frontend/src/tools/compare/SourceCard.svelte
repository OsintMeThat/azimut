<script>
  /**
   * What one side is showing, over its own picture: the side's letter, its
   * provider and date pickers, the acquisition date under the crosshair, and
   * the two acts that belong to one side only (its layers, taking it away).
   */
  import Icon from '../../components/Icon.svelte';
  import ImageryChip from '../satellite/ImageryChip.svelte';

  let {
    letter,
    imagery,
    providerId = $bindable(),
    s2,
    wayback,
    s1 = null,
    shown,
    dated = null,
    layerCount = 0,
    layersOpen = false,
    align = 'left',
    onlayers = () => {},
    onremove = () => {},
  } = $props();

  const lower = $derived(letter.toLowerCase());
  // A Sentinel chip already names the day it was taken. A Wayback chip names
  // when Esri published the mosaic, so the day under it still needs saying.
  const showsDate = $derived(
    dated?.date && !['sentinel2', 'sentinel1'].includes(shown.provider?.id)
  );
</script>

<div class="source-card cmp-glass" class:right={align === 'right'} aria-label={`Imagery ${letter}`}>
  <span class="cmp-letter {lower}">{letter}</span>
  <div class="chips">
    <ImageryChip {imagery} bind:providerId s2={s2} {wayback} {s1} {shown} dateChip />
  </div>
  {#if showsDate}
    <span class="dated cmp-mono" title={dated.source ? `Acquired around this date (${dated.source})` : 'Acquired around this date'}>
      <Icon name="clock" size={11} />{dated.date}
    </span>
  {/if}
  <span class="rule" aria-hidden="true"></span>
  <button
    class="cmp-icon layers"
    class:active={layersOpen}
    onclick={onlayers}
    aria-label={`Layers on imagery ${letter}`}
    aria-expanded={layersOpen}
    title="Layers"
  >
    <Icon name="layers" size={15} />
    {#if layerCount}<span class="count">{layerCount}</span>{/if}
  </button>
  <button class="cmp-icon" onclick={onremove} aria-label={`Remove imagery ${letter}`} title="Remove this side">
    <Icon name="x" size={14} />
  </button>
</div>

<style>
  .source-card {
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: 100%;
    padding: 4px 4px 4px 6px;
  }
  .chips {
    min-width: 0;
  }
  /* The shared chips were made for a map corner; inside a card they lose their
     own box and open their menus towards the middle of the stage. */
  .chips :global(.chip-row) {
    flex-wrap: nowrap;
    justify-content: flex-start;
    gap: 2px;
  }
  .chips :global(.chip) {
    height: 28px;
    border-radius: 7px;
    color: var(--glass-ink);
    background: transparent;
    box-shadow: none;
    backdrop-filter: none;
    font-weight: 600;
  }
  .chips :global(.chip:hover),
  .chips :global(.chip.on) {
    color: var(--glass-ink);
    background: var(--glass-hover);
  }
  .chips :global(.chip .name) {
    max-width: 190px;
  }
  .chips :global(.pill) {
    background: rgba(255, 255, 255, 0.06);
    box-shadow: none;
    backdrop-filter: none;
  }
  .source-card:not(.right) :global(.menu),
  .source-card:not(.right) :global(.wb-menu),
  .source-card:not(.right) :global(.s2-menu) {
    left: 0;
    right: auto;
  }
  .dated {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 6px;
    color: var(--glass-muted);
    font-size: 11px;
    white-space: nowrap;
  }
  .rule {
    width: 1px;
    height: 18px;
    background: var(--glass-line);
  }
  .layers {
    position: relative;
    width: auto;
    min-width: 30px;
    gap: 4px;
    padding: 0 6px;
    display: inline-flex;
  }
  .layers.active {
    color: var(--glass-ink);
    background: var(--glass-press);
  }
  .count {
    min-width: 16px;
    padding: 1px 4px;
    border-radius: 99px;
    color: #111317;
    background: var(--glass-ink);
    font-size: 10px;
    font-weight: 700;
    line-height: 14px;
  }
</style>
