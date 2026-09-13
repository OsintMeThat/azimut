<script>
  import Icon from '../../components/Icon.svelte';

  let {
    collapsed = $bindable(),
    renaming = $bindable(),
    renameText = $bindable(),
    commitRename,
    startRename,
    grid,
    toggleHidden,
    hidden,
    coverage,
    reviewKey,
    markReview,
    reviewToPlace,
    stopReview,
    startReview,
    editArea,
    toggleEditArea,
    discard,
    deleteGrid,
    gridName,
    cellMetres = $bindable(),
    drawMode,
    startDraw,
    polygonDraft,
    confirmPolygon,
    cancelDraw,
    savedGrids,
    loadGrid,
  } = $props();
</script>

<div class="grid-panel card" class:collapsed>
  <div class="grid-head">
    <button
      class="grid-collapse"
      onclick={() => (collapsed = !collapsed)}
      title={collapsed ? 'Expand' : 'Collapse'}
      aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
    >
      <Icon name={collapsed ? 'chevronDown' : 'chevronUp'} size={14} />
    </button>
    {#if renaming}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="input grid-rename"
        bind:value={renameText}
        autofocus
        onblur={commitRename}
        onkeydown={(event) => {
          if (event.key === 'Enter') commitRename();
          else if (event.key === 'Escape') {
            renameText = grid.title || '';
            renaming = false;
          }
        }}
      />
    {:else}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span
        class="grid-head-title"
        class:renamable={grid}
        ondblclick={startRename}
        title={grid ? 'Double-click to rename' : ''}
      >
        {grid ? grid.title || 'Grid' : 'Grid Search'}
      </span>
    {/if}
    {#if grid}
      <button
        class="grid-eye"
        onclick={toggleHidden}
        title={hidden ? 'Show grid' : 'Hide grid'}
        aria-label={hidden ? 'Show grid' : 'Hide grid'}
      >
        <Icon name={hidden ? 'eyeOff' : 'eye'} size={14} />
      </button>
      {#if coverage}
        <span class="grid-head-pct mono">{coverage.percent}%</span>
      {/if}
    {/if}
  </div>

  {#if !collapsed}
    <div class="grid-body">
      {#if grid}
        <div class="grid-cov">
          <div class="grid-bar">
            <span class="grid-bar-fill" style="width:{coverage.percent}%"></span>
          </div>
          <span class="grid-cov-text mono">
            {coverage.cleared + coverage.flagged}/{coverage.total} · {coverage.percent}%{#if coverage.flagged} · {coverage.flagged} flagged{/if}
          </span>
        </div>

        {#if reviewKey}
          <div class="grid-hint">
            <b>C</b> clear · <b>F</b> flag · <b>S</b> skip · <b>P</b> place · <b>Esc</b> stop
          </div>
          <div class="grid-btns">
            <button class="btn btn-sm" onclick={() => markReview('cleared')}>
              <Icon name="check" size={13} /> Clear
            </button>
            <button class="btn btn-sm" onclick={() => markReview('flagged')}>
              <Icon name="pin" size={13} /> Flag
            </button>
            <button class="btn btn-sm" onclick={reviewToPlace} title="Flag and save as a place">
              <Icon name="plus" size={13} /> Place
            </button>
            <button class="btn btn-ghost btn-sm" onclick={stopReview}>Stop</button>
          </div>
        {:else}
          <div class="grid-btns">
            <button class="btn btn-sm" onclick={startReview} title="Fly through the unchecked cells">
              <Icon name="eye" size={13} /> Review
            </button>
            <button class="btn btn-sm" class:on={editArea} onclick={toggleEditArea} title="Show the area box to resize or reshape it">
              <Icon name="edit" size={13} /> Edit area
            </button>
            <button class="btn btn-sm grid-discard" onclick={discard} title="Close this grid (it stays saved) to draw or open another">
              Discard
            </button>
            <button class="btn btn-ghost btn-sm" onclick={() => deleteGrid(gridName)} title="Delete this grid for good">
              <Icon name="trash" size={13} />
            </button>
          </div>
          {#if editArea}
            <div class="grid-hint">Drag the {grid.aoi.type === 'rect' ? 'corners' : 'points'} to reshape.</div>
          {/if}
        {/if}
      {/if}

      {#if !grid}
        <div class="grid-new">
          <div class="grid-size">
            <span>Cell</span>
            <input
              class="input"
              type="number"
              min="10"
              step="10"
              bind:value={cellMetres}
              title="Cell size in metres for the next grid"
            />
            <span>m</span>
          </div>
          <div class="grid-btns">
            <button class="btn btn-sm" class:on={drawMode === 'rect'} onclick={() => startDraw('rect')}>
              <Icon name="square" size={13} /> Box
            </button>
            <button class="btn btn-sm" class:on={drawMode === 'polygon'} onclick={() => startDraw('polygon')}>
              <Icon name="polygon" size={13} /> Polygon
            </button>
          </div>
          {#if drawMode === 'polygon'}
            <div class="grid-hint">Click to add points{#if polygonDraft.length} · {polygonDraft.length}{/if}. Drag to adjust.</div>
            <div class="grid-btns">
              <button class="btn btn-sm" disabled={polygonDraft.length < 3} onclick={confirmPolygon}>Confirm</button>
              <button class="btn btn-ghost btn-sm" onclick={cancelDraw}>Cancel</button>
            </div>
          {:else if drawMode === 'rect'}
            <div class="grid-hint">Drag a box on the map. Esc to cancel.</div>
          {/if}
        </div>
      {/if}

      {#if !grid && savedGrids.length}
        <div class="grid-saved">
          <div class="grid-saved-label">Saved grids ({savedGrids.length})</div>
          <div class="grid-saved-list">
            {#each savedGrids as saved (saved.name)}
              <div class="grid-saved-row">
                <button class="grid-load" onclick={() => loadGrid(saved.name)} title="Open this grid">
                  {saved.title || saved.name}
                </button>
                <span class="grid-saved-cov mono" title="cleared · flagged">
                  {saved.cleared}{#if saved.flagged}<span class="flagged"> ⚑{saved.flagged}</span>{/if}
                </span>
                <button class="btn btn-ghost btn-sm" onclick={() => deleteGrid(saved.name)} title="Delete">
                  <Icon name="trash" size={12} />
                </button>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .grid-panel {
    /* placed by the rail's panel slot */
    width: 218px;
    display: flex;
    flex-direction: column;
    background: rgba(24, 24, 24, 0.92);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-2);
  }
  .grid-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
  }
  .grid-collapse, .grid-eye {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-1);
    color: var(--text-2);
    cursor: pointer;
    flex-shrink: 0;
  }
  .grid-collapse:hover, .grid-eye:hover {
    color: var(--text-1);
    background: var(--bg-3);
  }
  .grid-head-title {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .grid-head-title.renamable { cursor: text; }
  .grid-rename {
    flex: 1;
    min-width: 0;
    height: 24px;
    padding: 2px 6px;
    font-size: var(--fs-sm);
  }
  .grid-head-pct {
    font-size: var(--fs-xs);
    color: var(--accent);
    flex-shrink: 0;
  }
  .grid-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 0 10px 10px;
  }
  .grid-size {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .grid-size .input { width: 64px; }
  .grid-btns { display: flex; flex-wrap: wrap; gap: 4px; }
  .grid-btns .btn.on {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .grid-discard {
    background: rgba(255, 255, 255, 0.1);
    border-color: rgba(255, 255, 255, 0.18);
    color: var(--text-1);
  }
  .grid-discard:hover { background: rgba(255, 255, 255, 0.16); color: var(--text-1); }
  .grid-hint { font-size: var(--fs-xs); color: var(--text-3); }
  .grid-hint b { color: var(--text-2); }
  .grid-cov { display: flex; flex-direction: column; gap: 4px; }
  .grid-bar {
    height: 6px;
    border-radius: 3px;
    background: rgba(124, 138, 165, 0.25);
    overflow: hidden;
  }
  .grid-bar-fill {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.15s ease;
  }
  .grid-cov-text { font-size: var(--fs-xs); color: var(--text-2); }
  .grid-new, .grid-saved {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }
  .grid-saved { gap: 3px; }
  .grid-saved-label {
    font-size: var(--fs-xs);
    color: var(--text-3);
    margin-bottom: 2px;
  }
  .grid-saved-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-height: 240px;
    overflow-y: auto;
  }
  .grid-saved-row { display: flex; align-items: center; gap: 4px; }
  .grid-load {
    flex: 1;
    min-width: 0;
    text-align: left;
    padding: 3px 6px;
    border-radius: var(--radius-1);
    font-size: var(--fs-xs);
    color: var(--text-2);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .grid-load:hover { color: var(--text-1); background: var(--bg-3); }
  .grid-saved-cov { font-size: var(--fs-xs); color: var(--text-3); flex-shrink: 0; }
  .grid-saved-cov .flagged { color: var(--warn); }
</style>
