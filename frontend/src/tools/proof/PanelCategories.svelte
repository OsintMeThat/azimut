<script>
  // The All / Satellite captures / Other images chips shared by the two panel
  // pickers (Create proof and Add a panel). Counts are of the whole set, so a
  // chip says how much it would bring back before it is pressed.
  let { items, category, onpick } = $props();

  const CATEGORIES = [
    { id: 'all', label: 'All' },
    { id: 'satellite', label: 'Satellite captures' },
    { id: 'media', label: 'Other images' },
  ];

  const count = (id) => (id === 'all' ? items.length : items.filter((item) => item.kind === id).length);
</script>

<div class="panel-categories" aria-label="Panel categories">
  {#each CATEGORIES as chip (chip.id)}
    <button
      type="button"
      class:active={category === chip.id}
      aria-pressed={category === chip.id}
      onclick={() => onpick(chip.id)}
    >
      {chip.label} <span>{count(chip.id)}</span>
    </button>
  {/each}
</div>

<style>
  .panel-categories { display: flex; gap: 5px; overflow-x: auto; max-width: 100%; }
  .panel-categories button {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .panel-categories button:hover { border-color: var(--border-strong); color: var(--text-1); }
  .panel-categories button.active { border-color: var(--accent); color: var(--text-1); }
  .panel-categories span { color: var(--text-3); }
</style>
