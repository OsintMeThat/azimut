<script>
  /**
   * The layers a case item is already in, one line each (a proof's point, a
   * file on the map): open the marker where it is edited, or take it back out.
   */
  import Icon from '../../components/Icon.svelte';
  import MarkerSymbol from './MarkerSymbol.svelte';

  /** `places`: `{ layer, group, marker }` on this point (`placesOf`, `placesAt`). */
  let { places = [], busy = false, onopen, onremove } = $props();
</script>

{#each places as place (`${place.layer.name}|${place.marker.key}`)}
  <div class="in-layer">
    {#if place.group?.mode === 'uniform'}<MarkerSymbol symbol={place.group.symbol} colour={place.group.colour} size={14} />
    {:else}<span class="dot" style={`--swatch:${place.group?.colour ?? '#0072b2'}`}></span>{/if}
    <span class="where">In {place.layer.title}{place.layer.groups.length > 1 && place.group ? ` › ${place.group.name}` : ''}</span>
    <button type="button" class="open" onclick={() => onopen(place)} title="Open it in the layer, on the map">Open</button>
    <button type="button" class="out" aria-label={`Take it out of ${place.layer.title}`} title="Take it out of the layer" disabled={busy}
      onclick={() => onremove(place)}><Icon name="x" size={11} /></button>
  </div>
{/each}

<style>
  .in-layer { display: flex; align-items: center; gap: 6px; margin: 3px 0 0 2px; color: var(--text-3); font-size: 11px; }
  .dot { width: 9px; height: 9px; border-radius: 2px; background: var(--swatch); flex: none; }
  .where { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); }
  .open { color: var(--accent); font-size: 11px; cursor: pointer; }
  .open:hover { text-decoration: underline; }
  .out { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; color: var(--text-3); cursor: pointer; }
  .out:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
</style>
