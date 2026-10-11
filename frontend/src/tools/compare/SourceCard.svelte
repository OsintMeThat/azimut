<script>
  /**
   * What one side is showing, over its own picture: the side's letter, its
   * provider and date pickers, the acquisition date under the crosshair, and
   * taking it away. Its layers are the pair's, in the one Layers menu above
   * both maps.
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
    align = 'left',
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
    <ImageryChip {imagery} bind:providerId {s2} {wayback} {s1} {shown} />
  </div>
  {#if showsDate}
    <span class="dated cmp-mono" title={dated.source ? `Acquired around this date (${dated.source})` : 'Acquired around this date'}>
      <Icon name="clock" size={11} />{dated.date}
    </span>
  {/if}
  <span class="rule" aria-hidden="true"></span>
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
</style>
