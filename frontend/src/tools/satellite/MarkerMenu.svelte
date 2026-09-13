<script>
  /**
   * The point the map is reading, as one small menu.
   *
   * It was three controls lying across the bottom bar — a full-width select of
   * marker styles, a Move-pin toggle and a separator — which pushed Save place
   * and Capture onto a second row and left the bar sitting on the engine's own
   * scale bracket. They are two questions, both about the same thing, and both
   * asked once a session: what marks the point, and whether that point is the
   * centre of the map or one dropped somewhere.
   *
   * So the bar keeps a single square wearing the current mark, and the answers
   * live behind it. What it costs to reach is right: the acts beside it are
   * pressed all day, this is set and forgotten.
   */
  import Icon from '../../components/Icon.svelte';

  let {
    /** 'crosshair' | 'pin' | 'none' — what is drawn at the point, captures included. */
    style = $bindable(),
    /** Whether the point is a dropped pin rather than the centre of the map. */
    free = false,
    /** Take the pin off the centre, or put the point back on it. */
    toggleFree,
  } = $props();

  const STYLES = [
    { id: 'crosshair', label: 'Crosshair', icon: 'crosshair' },
    { id: 'pin', label: 'Pin', icon: 'pin' },
    { id: 'none', label: 'None', icon: 'noMark' },
  ];

  let open = $state(false);
  let wrap = $state();

  const current = $derived(STYLES.find((entry) => entry.id === style) ?? STYLES[2]);

  // Anywhere else closes it — the same rule as the capture menu next to it.
  $effect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrap && !wrap.contains(e.target)) open = false;
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  });
</script>

<div class="marker-menu" bind:this={wrap}>
  <button
    class="btn btn-icon marker-button"
    class:on={open || free}
    onclick={() => (open = !open)}
    title="What marks the point, and where it sits"
    aria-label="Marker"
    aria-expanded={open}
  >
    <Icon name={current.icon} size={14} />
    <Icon name="chevronDown" size={11} />
  </button>

  {#if open}
    <div class="menu card">
      <div class="menu-row">
        <span class="menu-label">Marker</span>
        <div class="tiles" role="radiogroup" aria-label="Marker">
          {#each STYLES as entry (entry.id)}
            <button
              class="tile"
              class:on={style === entry.id}
              role="radio"
              aria-checked={style === entry.id}
              onclick={() => (style = entry.id)}
            >
              <Icon name={entry.icon} size={18} />
              <span>{entry.label}</span>
            </button>
          {/each}
        </div>
      </div>
      <div class="menu-row">
        <span class="menu-label">Point</span>
        <div class="tiles" role="radiogroup" aria-label="Point">
          <button
            class="tile"
            class:on={!free}
            role="radio"
            aria-checked={!free}
            onclick={() => free && toggleFree()}
          >
            <Icon name="centre" size={18} />
            <span>Centre</span>
          </button>
          <button
            class="tile"
            class:on={free}
            role="radio"
            aria-checked={free}
            disabled={style === 'none'}
            title={style === 'none' ? 'Pick a marker first' : 'Drag the pin anywhere'}
            onclick={() => !free && toggleFree()}
          >
            <Icon name="move" size={18} />
            <span>Dropped</span>
          </button>
        </div>
      </div>
      <div class="menu-hint">
        {free ? 'The coordinates follow the pin.' : 'The coordinates are the map centre.'}
      </div>
    </div>
  {/if}
</div>

<style>
  .marker-menu {
    position: relative;
    display: flex;
  }
  .marker-button {
    gap: 2px;
    padding: 6px 6px 6px 8px;
    color: var(--text-2);
  }
  .marker-button.on {
    border-color: var(--accent);
    color: var(--accent);
  }
  .menu {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    width: max-content;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    background: rgba(24, 24, 24, 0.96);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-2);
    z-index: 700;
  }
  .menu-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .menu-label {
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-3);
  }
  .tiles {
    display: flex;
    gap: 4px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    width: 64px;
    padding: 7px 4px 5px;
    border-radius: var(--r-sm);
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: 10px;
    white-space: nowrap;
    cursor: pointer;
  }
  .tile:hover:not(:disabled) {
    border-color: var(--border-strong);
    color: var(--text-1);
  }
  .tile.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .tile:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .menu-hint {
    margin-top: 1px;
    font-size: 10px;
    color: var(--text-3);
  }
</style>
