<script>
  /** How the pair is read, in one row at the top of the stage. */
  import Icon from '../../components/Icon.svelte';
  import { COMPARE_MODES } from '../../lib/map/compare.js';

  let { mode, change, onmode = () => {}, onswap = () => {} } = $props();
</script>

<div class="mode-dock cmp-glass" role="toolbar" aria-label="Comparison view">
  <div class="cmp-seg">
    {#each COMPARE_MODES as entry, index (entry.id)}
      {@const blocked = entry.id === 'change' && !change.ok}
      {#if index > 0 && entry.group !== COMPARE_MODES[index - 1].group}
        <!-- Left of the rule: how the pair is shown. Right of it: what gets
             computed over the pair, which is a different kind of choice. -->
        <span class="group-rule" aria-hidden="true"></span>
      {/if}
      <button
        class="mode-btn"
        class:on={mode === entry.id}
        class:blocked
        class:find={entry.group === 'find'}
        aria-pressed={mode === entry.id}
        title={blocked ? change.reason : `${entry.label} (${entry.key})`}
        onclick={() => onmode(entry.id)}
      >
        <Icon name={entry.icon} size={14} />
        <span>{entry.label}</span>
      </button>
    {/each}
  </div>
  <button class="cmp-icon" onclick={onswap} title="Swap A and B" aria-label="Swap A and B">
    <Icon name="swap" size={15} />
  </button>
</div>

<style>
  .mode-dock {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
  }
  .mode-btn.blocked:not(.on) {
    color: var(--glass-dim);
  }
  .group-rule {
    align-self: center;
    width: 1px;
    height: 18px;
    margin: 0 4px;
    background: var(--glass-line);
  }
  /* A computing mode stays legible as one when it is on: the pair is unchanged
     underneath and something is being laid over it. */
  .mode-btn.find.on {
    color: var(--accent);
  }
  @media (max-width: 1100px) {
    .mode-btn:not(.find) span {
      display: none;
    }
  }
</style>
