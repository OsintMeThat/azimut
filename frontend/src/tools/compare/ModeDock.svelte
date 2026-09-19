<script>
  /** How the pair is read, in one row at the top of the stage. */
  import Icon from '../../components/Icon.svelte';
  import { COMPARE_MODES } from '../../lib/map/compare.js';

  let { mode, change, detect = { ok: true }, onmode = () => {}, onswap = () => {} } = $props();

  // Two kinds of choice, named: how the pair is shown, and what gets computed
  // over it. A computing mode says what it needs before it is pressed.
  const GROUPS = [
    { id: 'read', label: 'View' },
    { id: 'find', label: 'Analysis' },
  ];
  const needs = $derived({ change, analysis: detect });
</script>

<div class="mode-dock cmp-glass" role="toolbar" aria-label="Comparison view">
  {#each GROUPS as group (group.id)}
    <div class="group" role="group" aria-label={group.label}>
      <span class="group-name">{group.label}</span>
      <div class="cmp-seg">
        {#each COMPARE_MODES.filter((entry) => entry.group === group.id) as entry (entry.id)}
          {@const missing = needs[entry.id] && !needs[entry.id].ok ? needs[entry.id].reason : ''}
          <button
            class="mode-btn"
            class:on={mode === entry.id}
            class:blocked={Boolean(missing)}
            class:find={entry.group === 'find'}
            aria-pressed={mode === entry.id}
            title={missing || `${entry.label} (${entry.key})`}
            onclick={() => onmode(entry.id)}
          >
            <Icon name={entry.icon} size={14} />
            <span>{entry.label}</span>
            {#if missing}<Icon name="alert" size={11} />{/if}
          </button>
        {/each}
      </div>
    </div>
  {/each}
  <button class="cmp-icon" onclick={onswap} title="Swap A and B" aria-label="Swap A and B">
    <Icon name="swap" size={15} />
  </button>
</div>

<style>
  .mode-dock {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 6px;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .group-name {
    font-size: var(--fs-xs);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--glass-dim);
  }
  .mode-btn.blocked:not(.on) {
    color: var(--glass-dim);
  }
  .mode-btn.blocked :global(svg:last-child) {
    color: var(--warn);
  }
  /* A computing mode stays legible as one when it is on: the pair is unchanged
     underneath and something is being laid over it. */
  .mode-btn.find.on {
    color: var(--accent);
  }
  @media (max-width: 1100px) {
    .mode-btn:not(.find) span,
    .group-name {
      display: none;
    }
  }
</style>
