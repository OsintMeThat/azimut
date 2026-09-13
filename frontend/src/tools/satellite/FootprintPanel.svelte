<script>
  /**
   * Tracing a footprint, in the rail's one panel slot.
   *
   * It names the place the whole time it is open: the shape on the map belongs
   * to a point somewhere else on the screen, and without the name this is a
   * polygon being drawn for nobody.
   */
  import Icon from '../../components/Icon.svelte';

  let { place, points, complete, covers, saving, undo, save, cancel } = $props();

  /** What this tracing takes the place of. A place states how tightly it is pinned
   *  once, so saving a shape drops the circle it had. */
  const replaces = $derived.by(() => {
    if (place?.footprint) return 'replaces its current shape';
    const m = Number(place?.radius_m);
    if (!(m > 0)) return '';
    return `replaces its ${m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`} circle`;
  });
</script>

<div class="footprint-panel card">
  <p class="who">
    Tracing <strong>{place?.title}</strong>
    {#if replaces}<span class="over">{replaces}</span>{/if}
  </p>
  <p class="hint" class:warn={complete && !covers}>
    {#if complete && !covers}
      The shape has to contain the pin it belongs to.
    {:else if complete}
      {points} corners. Save closes the shape.
    {:else}
      Click the corners. {3 - points} more to make an area.
    {/if}
  </p>
  <div class="acts">
    <button class="btn btn-sm" onclick={undo} disabled={!points || saving}>
      <Icon name="reset" size={13} /> Undo
    </button>
    <button class="btn btn-sm btn-primary" onclick={save} disabled={!complete || !covers || saving}>
      {saving ? 'Saving…' : 'Save'}
    </button>
    <button class="btn btn-ghost btn-sm" onclick={cancel} disabled={saving}>Cancel</button>
  </div>
</div>

<style>
  .footprint-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: max-content;
    max-width: 260px;
    padding: 10px;
    background: rgba(24, 24, 24, 0.92);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-2);
  }
  .who {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .over {
    display: block;
    color: var(--text-3);
  }
  .hint {
    margin: -4px 0 0;
    font-size: 10px;
    color: var(--text-3);
  }
  .hint.warn {
    color: var(--warn);
  }
  .acts {
    display: flex;
    gap: 4px;
  }
</style>
