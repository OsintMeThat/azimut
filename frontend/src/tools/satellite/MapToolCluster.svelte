<script>
  import Icon from '../../components/Icon.svelte';

  let {
    fullscreen,
    toggleFullscreen,
    osmOverlay = $bindable(),
    baseIsImagery,
    toolsOpen,
    measureMode,
    toggleTools,
    gridMode,
    toggleGridMode,
    savedOverlay = $bindable(),
    savedCount,
    referenceCount,
    openRefPicker,
    setMeasureMode,
    sunMode,
    toggleSunMode,
    measureReadout,
    measureHint,
    clearMeasure,
  } = $props();
</script>

<!-- Tools: things that change what you are *doing* on the map. -->
<div class="tool-cluster card">
  <button
    class="mtbtn"
    class:on={toolsOpen || measureMode}
    onclick={toggleTools}
    title="Measure tools"
    aria-label="Measure tools"
  ><Icon name="ruler" size={16} /></button>
  <button
    class="mtbtn"
    class:on={gridMode}
    onclick={toggleGridMode}
    title="Sweep an area cell by cell"
    aria-label="Grid Search"
  ><Icon name="grid" size={16} /></button>
  <button
    class="mtbtn"
    class:on={sunMode}
    onclick={toggleSunMode}
    title="Sun and moon path for a date"
    aria-label="Sun and moon"
  ><Icon name="sun" size={16} /></button>
  <button
    class="mtbtn"
    class:on={referenceCount}
    onclick={openRefPicker}
    title="Add a reference image or video over the map"
    aria-label="Add reference"
  ><Icon name="image" size={16} /></button>
</div>

<!-- View: what the map *shows you* — the frame, the labels over the imagery,
     the case's own saved work. None of them is a tool, so they continue the
     zoom column instead of sitting among the tools. -->
<div class="view-cluster card">
  <button
    class="mtbtn"
    class:on={fullscreen}
    onclick={toggleFullscreen}
    title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen map'}
    aria-label="Toggle fullscreen"
  ><Icon name={fullscreen ? 'minimize' : 'maximize'} size={16} /></button>
  <button
    class="mtbtn"
    class:on={osmOverlay}
    onclick={() => (osmOverlay = !osmOverlay)}
    disabled={!baseIsImagery}
    title={baseIsImagery
      ? 'Overlay OSM labels (roads, place names) on the imagery'
      : 'Labels overlay is only useful over satellite imagery'}
    aria-label="Toggle OSM labels overlay"
  ><Icon name="layers" size={16} /></button>
  <button
    class="mtbtn"
    class:on={savedOverlay}
    onclick={() => (savedOverlay = !savedOverlay)}
    disabled={!savedCount}
    title={savedCount
      ? 'Show this case\'s saved places and captures on the map'
      : 'Nothing is saved in this case yet'}
    aria-label="Show saved work on the map"
  ><Icon name="pin" size={16} /></button>
</div>

{#if toolsOpen}
  <div class="measure-panel card">
    <div class="measure-btns">
      <button class="btn btn-sm" class:on={measureMode === 'distance'} onclick={() => setMeasureMode('distance')}>
        <Icon name="ruler" size={14} /> Distance
      </button>
      <button class="btn btn-sm" class:on={measureMode === 'area'} onclick={() => setMeasureMode('area')}>
        <Icon name="polygon" size={14} /> Area
      </button>
      <button class="btn btn-sm" class:on={measureMode === 'angle'} onclick={() => setMeasureMode('angle')}>
        <Icon name="angle" size={14} /> Angle
      </button>
    </div>
    {#if measureMode}
      <div class="measure-readout">
        {#if measureReadout}
          <span class="measure-value mono">{measureReadout}</span>
        {:else}
          <span class="measure-hint">{measureHint[measureMode]}</span>
        {/if}
        <button class="btn btn-ghost btn-sm" onclick={clearMeasure} title="Clear points">
          <Icon name="reset" size={13} />
        </button>
      </div>
    {/if}
  </div>
{/if}

<style>
  .tool-cluster {
    display: flex;
    gap: 2px;
    padding: 4px;
    background: rgba(24, 24, 24, 0.88);
    backdrop-filter: blur(6px);
  }
  /* stacked directly under Leaflet's zoom bar (top 58px + 64px tall + its 8px
     margin), same width, so +/- and these read as one column of view controls */
  .view-cluster {
    position: absolute;
    top: 118px;
    left: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 2px;
    background: rgba(24, 24, 24, 0.88);
    backdrop-filter: blur(6px);
  }
  .mtbtn {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-1);
    color: var(--text-2);
    cursor: pointer;
  }
  .mtbtn:hover { color: var(--text-1); background: var(--bg-3); }
  .mtbtn.on { color: var(--accent-text); background: var(--accent); }
  .mtbtn:disabled { opacity: 0.35; cursor: not-allowed; }
  .mtbtn:disabled:hover { color: var(--text-2); background: none; }
  .measure-panel {
    position: absolute;
    top: 0;
    left: calc(100% + 8px);
    width: max-content;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    background: rgba(24, 24, 24, 0.92);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-2);
  }
  .measure-btns { display: flex; gap: 4px; }
  .measure-btns .btn.on { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
  .measure-readout {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
  .measure-value { font-size: var(--fs-md); font-weight: 700; color: var(--accent); }
  .measure-hint { font-size: var(--fs-xs); color: var(--text-3); }
</style>
