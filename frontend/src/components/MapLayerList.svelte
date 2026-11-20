<script>
  /**
   * The case's layers to tick, what a map shows: the Interactive map picker's list and
   * Notebook › New › Web map's, one list. `layers` are `/notes/maps/sources` rows.
   */
  let { layers = [], chosen = $bindable([]), label = 'Layers' } = $props();

  function toggle(name) {
    chosen = chosen.includes(name) ? chosen.filter((one) => one !== name) : [...chosen, name];
  }
</script>

<div class="list" role="group" aria-label={label}>
  {#each layers as layer (layer.name)}
    <label class="row">
      <input type="checkbox" checked={chosen.includes(layer.name)} onchange={() => toggle(layer.name)} />
      <span class="name">{layer.title}</span>
      {#if layer.tracked}<small class="tag" title="Its dated edits play on the map's timeline">Over time</small>{/if}
      <small>{layer.features}</small>
    </label>
  {:else}
    <p class="said">This case has no layer yet.</p>
  {/each}
</div>

<style>
  .list { display: flex; flex-direction: column; max-height: 220px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; }
  .row { display: flex; align-items: center; gap: 8px; padding: 7px 10px; font-size: 13px; cursor: pointer; }
  .row + .row { border-top: 1px solid var(--border); }
  .row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row small { color: var(--text-3); font-variant-numeric: tabular-nums; }
  .row .tag { padding: 1px 6px; border-radius: 999px; background: var(--surface-2); color: var(--text-2); }
  .said { margin: 0; padding: 10px; font-size: 12px; color: var(--text-3); }
</style>
