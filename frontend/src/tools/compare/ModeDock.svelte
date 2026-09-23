<script>
  /** How the pair is read, in one row at the top of the stage. */
  import Icon from '../../components/Icon.svelte';
  import { COMPARE_MODES, DIFFERENCE_KEY } from '../../lib/map/compare.js';

  let {
    mode,
    difference = false,
    differenceable = false,
    onmode = () => {},
    ondifference = () => {},
    onswap = () => {},
  } = $props();
</script>

<div class="mode-dock cmp-glass" role="toolbar" aria-label="Comparison view">
  <div class="cmp-seg" role="group" aria-label="View">
    {#each COMPARE_MODES as entry (entry.id)}
      <button
        class="mode-btn"
        class:on={mode === entry.id}
        aria-pressed={mode === entry.id}
        title={`${entry.label} (${entry.key})`}
        onclick={() => onmode(entry.id)}
      >
        <Icon name={entry.icon} size={14} />
        <span>{entry.label}</span>
      </button>
    {/each}
  </div>
  <!-- Offered only on a pair a pixel reading can be fair to. It lays its
       highlights over the view above rather than replacing it. -->
  {#if differenceable}
    <div class="cmp-seg">
      <button
        class="mode-btn difference"
        class:on={difference}
        aria-pressed={difference}
        title={`Highlight what differs between A and B (${DIFFERENCE_KEY})`}
        onclick={() => ondifference(!difference)}
      >
        <Icon name="changes" size={14} />
        <span>Difference</span>
      </button>
    </div>
  {/if}
  <button class="cmp-icon" onclick={onswap} title="Swap A and B" aria-label="Swap A and B">
    <Icon name="swap" size={15} />
  </button>
</div>

<style>
  .mode-dock {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
  }
  @media (max-width: 1100px) {
    .mode-btn:not(.difference) span {
      display: none;
    }
  }
</style>
