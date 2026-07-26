<script>
  import Icon from '../../components/Icon.svelte';

  let {
    proof,
    collapsed,
    gonePanels,
    selectedPanelId = $bindable(),
    selectedPasteId = $bindable(),
    selectedId = $bindable(),
    activeColor,
    caseId,
    scaleMin,
    scaleMax,
    scaleStep,
    frameWidthMax,
    frameColor,
    openPicker,
    movePanelZ,
    scalePanel,
    removePanel,
    movePasteZ,
    removePaste,
    setFrame,
    pickImageFile,
    featureList,
    moveLegendColor,
    setColor,
    canMoveShapeUp,
    canMoveShapeDown,
    moveShape,
    kindIcon,
    kindLabel,
    duplicateShape,
    deleteShape,
    markDirty,
  } = $props();
</script>

<!-- Coloured border for a panel or a pasted image. Picking a colour adds one,
     thickness 0 or the cross takes it away. -->
{#snippet frameControl(item)}
  <div class="frame-ctl">
    <label
      class="color-btn color-pick bg-pick"
      class:active={!!item.frame}
      style:background={item.frame?.color ?? 'transparent'}
      title="Border color"
    >
      <Icon name="square" size={11} />
      <input
        type="color"
        value={item.frame?.color ?? frameColor}
        oninput={(event) => setFrame(item, { color: event.target.value })}
        aria-label="border color"
      />
    </label>
    {#if item.frame}
      <input
        class="input frame-width"
        type="number"
        min="0"
        max={frameWidthMax}
        step="1"
        value={item.frame.width}
        oninput={(event) => setFrame(item, { width: +event.target.value })}
        title="Border thickness"
        aria-label="border thickness"
      />
      <button
        class="btn btn-ghost btn-sm"
        title="Remove border"
        onclick={() => setFrame(item, null)}
      ><Icon name="x" size={11} /></button>
    {/if}
  </div>
{/snippet}

<div class="side-title-row" style="margin-top: 14px">
  <button class="side-title collapsible" onclick={() => (collapsed.panels = !collapsed.panels)}>
    <span>
      <Icon name={collapsed.panels ? 'chevronRight' : 'chevronDown'} size={13} />
      Panels <span class="count">{proof.panels.length}</span>
    </span>
  </button>
  <button class="btn btn-sm side-add" title="Add a panel" onclick={openPicker}>
    <Icon name="plus" size={13} /> Add panel
  </button>
</div>
{#if !collapsed.panels}
  {#if gonePanels.length}
    <div class="gone-note">
      <Icon name="alert" size={12} />
      <span>
        {gonePanels.length} panel{gonePanels.length > 1 ? 's' : ''} whose media was deleted.
        The proof still exports; reopening it later will show them blank.
      </span>
    </div>
  {/if}
  {#each proof.panels as panel, index (panel.id)}
    <div
      class="panel-row card"
      class:selected={selectedPanelId === panel.id}
      class:gone={gonePanels.includes(panel)}
    >
      <button
        class="panel-thumb"
        title="Select this panel on the canvas"
        onclick={() => (selectedPanelId = selectedPanelId === panel.id ? null : panel.id)}
      >
        <img src={`/files/${caseId}/${panel.src}`} alt="" />
        {#if proof.layout === 'free'}
          <span class="row-badge" title="Z1 is the foreground">Z{index + 1}</span>
        {:else}
          <span class="row-badge" title="Row (top→bottom)">R{(panel.row ?? 0) + 1}</span>
        {/if}
      </button>
      <input
        class="input cap-input"
        placeholder="Caption…"
        bind:value={panel.caption}
        onchange={markDirty}
      />
      <div class="panel-actions">
        {#if proof.layout === 'free'}
          <button
            class="btn btn-ghost btn-sm"
            disabled={index === 0}
            title="Bring forward (toward Z1)"
            onclick={() => movePanelZ(index, -1)}
          ><Icon name="chevronUp" size={13} /></button>
          <button
            class="btn btn-ghost btn-sm"
            disabled={index === proof.panels.length - 1}
            title="Send backward"
            onclick={() => movePanelZ(index, 1)}
          ><Icon name="chevronDown" size={13} /></button>
        {/if}
        <div class="panel-scale" title="Panel size; elements scale with it">
          <button
            class="btn btn-ghost btn-sm"
            disabled={(panel.scale ?? 1) <= scaleMin}
            title="Shrink panel"
            onclick={() => scalePanel(index, -scaleStep)}
          >−</button>
          <span class="scale-val">{Math.round((panel.scale ?? 1) * 100)}%</span>
          <button
            class="btn btn-ghost btn-sm"
            disabled={(panel.scale ?? 1) >= scaleMax}
            title="Enlarge panel"
            onclick={() => scalePanel(index, scaleStep)}
          >+</button>
        </div>
        {@render frameControl(panel)}
        <button
          class="btn btn-ghost btn-sm remove-panel"
          title="Remove panel"
          onclick={() => removePanel(index)}
        ><Icon name="trash" size={13} /></button>
      </div>
    </div>
  {/each}
{/if}

<!-- Overlays: images this proof owns, laid over the composition. They are not
     panels, so they never join a row, claim no source, and stay out of the case. -->
<div class="side-title-row spaced">
  <button class="side-title collapsible" onclick={() => (collapsed.overlays = !collapsed.overlays)}>
    <span>
      <Icon name={collapsed.overlays ? 'chevronRight' : 'chevronDown'} size={13} />
      Overlays <span class="count">{proof.pastes.length}</span>
    </span>
  </button>
  <button class="btn btn-sm side-add" title="Add an overlay from a file" onclick={pickImageFile}>
    <Icon name="plus" size={13} /> Add overlay
  </button>
</div>
{#if !collapsed.overlays}
  {#if !proof.pastes.length}
    <div class="none">Paste a screenshot with Ctrl+V. It stays in this proof only.</div>
  {/if}
  {#each proof.pastes as paste, index (paste.id)}
    <div class="panel-row paste-row card" class:selected={selectedPasteId === paste.id}>
      <button
        class="panel-thumb"
        title="Select this overlay on the canvas"
        onclick={() => (selectedPasteId = selectedPasteId === paste.id ? null : paste.id)}
      >
        <img src={paste.img?.src} alt="" />
        <span class="row-badge" title="Z1 is the foreground">Z{index + 1}</span>
      </button>
      <div class="panel-actions">
        <button
          class="btn btn-ghost btn-sm"
          disabled={index === 0}
          title="Bring forward (toward Z1)"
          onclick={() => movePasteZ(index, -1)}
        ><Icon name="chevronUp" size={13} /></button>
        <button
          class="btn btn-ghost btn-sm"
          disabled={index === proof.pastes.length - 1}
          title="Send backward"
          onclick={() => movePasteZ(index, 1)}
        ><Icon name="chevronDown" size={13} /></button>
        {@render frameControl(paste)}
        <button
          class="btn btn-ghost btn-sm remove-panel"
          title="Remove overlay"
          onclick={() => removePaste(index)}
        ><Icon name="trash" size={13} /></button>
      </div>
    </div>
  {/each}
{/if}

<button
  class="side-title collapsible spaced"
  onclick={() => (collapsed.annotations = !collapsed.annotations)}
>
  <span>
    <Icon name={collapsed.annotations ? 'chevronRight' : 'chevronDown'} size={13} />
    Annotations <span class="count">{featureList.length}</span>
  </span>
</button>
{#if !collapsed.annotations}
  {#if !featureList.length}
    <div class="none">Draw on a panel. Same color = same feature.</div>
  {/if}
  {#each featureList as entry, index (entry)}
    <div class="anno-row" class:active={activeColor === entry}>
      <div class="reorder">
        <button class="btn btn-ghost reorder-btn" disabled={index === 0} title="Move up" onclick={() => moveLegendColor(index, -1)}>
          <Icon name="chevronUp" size={11} />
        </button>
        <button class="btn btn-ghost reorder-btn" disabled={index === featureList.length - 1} title="Move down" onclick={() => moveLegendColor(index, 1)}>
          <Icon name="chevronDown" size={11} />
        </button>
      </div>
      <button class="chip-num" style:background={entry} title="Select this color" onclick={() => setColor(entry)}>
        {index + 1}
      </button>
      <input
        class="input comment-input"
        placeholder={`Feature ${index + 1} legend…`}
        bind:value={proof.notes[entry]}
        onchange={markDirty}
      />
    </div>
  {/each}
{/if}

<button
  class="side-title collapsible spaced"
  onclick={() => (collapsed.elements = !collapsed.elements)}
>
  <span>
    <Icon name={collapsed.elements ? 'chevronRight' : 'chevronDown'} size={13} />
    Elements <span class="count">{proof.shapes.length}</span>
  </span>
</button>
{#if !collapsed.elements}
  {#each proof.shapes as shape, index (shape.id)}
    <div
      class="shape-row"
      class:selected={selectedId === shape.id}
      onclick={() => (selectedId = shape.id)}
      role="button"
      tabindex="0"
      onkeydown={(event) => event.key === 'Enter' && (selectedId = shape.id)}
    >
      <div class="reorder">
        <button
          class="btn btn-ghost reorder-btn"
          disabled={!canMoveShapeUp(index)}
          title="Move up (z-order within its panel)"
          onclick={(event) => { event.stopPropagation(); moveShape(index, -1); }}
        ><Icon name="chevronUp" size={11} /></button>
        <button
          class="btn btn-ghost reorder-btn"
          disabled={!canMoveShapeDown(index)}
          title="Move down (z-order within its panel)"
          onclick={(event) => { event.stopPropagation(); moveShape(index, 1); }}
        ><Icon name="chevronDown" size={11} /></button>
      </div>
      <span class="chip" style:background={shape.color}></span>
      <Icon name={kindIcon[shape.kind]} size={13} />
      {#if shape.kind === 'text'}
        <input
          class="input comment-input"
          placeholder="Text…"
          bind:value={shape.text}
          onchange={markDirty}
          onclick={(event) => event.stopPropagation()}
        />
        <button
          class="btn btn-ghost btn-sm"
          class:active={shape.frame}
          title="Frame (border in the text's color)"
          onclick={(event) => {
            event.stopPropagation();
            shape.frame = !shape.frame;
            markDirty();
          }}
        ><Icon name="square" size={13} /></button>
        <label
          class="color-btn color-pick bg-pick"
          class:active={!!shape.bg}
          style:background={shape.bg || 'transparent'}
          title="Background color"
        >
          <Icon name="plus" size={11} />
          <input
            type="color"
            value={shape.bg || '#000000'}
            oninput={(event) => { shape.bg = event.target.value; markDirty(); }}
            onclick={(event) => event.stopPropagation()}
            aria-label="text background color"
          />
        </label>
        {#if shape.bg}
          <button
            class="btn btn-ghost btn-sm"
            title="Remove background"
            onclick={(event) => { event.stopPropagation(); shape.bg = null; markDirty(); }}
          ><Icon name="x" size={11} /></button>
        {/if}
      {:else}
        <span class="el-label">{kindLabel[shape.kind]} <span class="el-id">#{index + 1}</span></span>
      {/if}
      <button
        class="btn btn-ghost btn-sm"
        title="Duplicate (Ctrl+D)"
        onclick={(event) => { event.stopPropagation(); duplicateShape(shape.id); }}
      ><Icon name="copy" size={13} /></button>
      <button
        class="btn btn-ghost btn-sm"
        title="Delete"
        onclick={(event) => { event.stopPropagation(); deleteShape(shape.id); }}
      ><Icon name="trash" size={13} /></button>
    </div>
  {/each}
{/if}

<style>
  .side-title {
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-2);
    margin-bottom: 8px;
    display: flex;
    justify-content: space-between;
  }
  .side-title.collapsible {
    width: 100%;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    font-size: var(--fs-xs);
    font-weight: 600;
    line-height: 1.2;
    color: inherit;
  }
  .side-title.collapsible span { display: flex; align-items: center; gap: 4px; }
  .side-title.spaced { margin-top: 14px; }
  .side-title-row { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; }
  .side-title-row.spaced { margin-top: 14px; }
  .side-title-row .side-title { margin-bottom: 0; }
  .side-add {
    margin-left: auto;
    padding: 2px 7px;
    gap: 5px;
    line-height: 1.1;
    background: var(--bg-2);
    border-color: var(--border-strong);
    color: var(--text-1);
    font-weight: 600;
  }
  .side-add:hover:not(:disabled, .disabled) {
    background: var(--bg-3);
    border-color: var(--text-3);
  }
  .count { color: var(--text-3); }
  .gone-note {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin-bottom: 8px;
    padding: 7px 9px;
    border-radius: var(--r-sm);
    font-size: var(--fs-xs);
    line-height: 1.4;
    color: color-mix(in srgb, var(--danger, #e5484d) 80%, var(--text-2));
    background: color-mix(in srgb, var(--danger, #e5484d) 10%, transparent);
  }
  .gone-note :global(svg) { flex-shrink: 0; margin-top: 2px; }
  .panel-row.gone { border-color: color-mix(in srgb, var(--danger, #e5484d) 40%, transparent); }
  .panel-row {
    padding: 8px;
    margin-bottom: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .panel-thumb {
    position: relative;
    display: block;
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
  }
  .panel-row.selected { border-color: var(--accent); }
  .panel-row img {
    width: 100%;
    max-height: 90px;
    object-fit: cover;
    border-radius: var(--r-sm);
    background: var(--bg-2);
    display: block;
  }
  .row-badge {
    position: absolute;
    top: 5px;
    left: 5px;
    padding: 1px 6px;
    border-radius: var(--r-sm);
    font-size: 10px;
    font-weight: 700;
    color: var(--text-1);
    background: rgba(14, 14, 14, 0.72);
  }
  .cap-input { font-size: var(--fs-xs); padding: 5px 8px; }
  .panel-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; row-gap: 4px; }
  .remove-panel { margin-left: auto; }
  .frame-ctl { display: flex; align-items: center; gap: 3px; }
  .frame-width {
    width: 44px;
    padding: 2px 4px;
    font-size: var(--fs-xs);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .panel-scale { display: flex; align-items: center; gap: 4px; margin: 0 auto; }
  .scale-val {
    min-width: 42px;
    text-align: center;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .none { font-size: var(--fs-xs); color: var(--text-3); padding: 2px 2px 8px; }
  .anno-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 4px;
    border-radius: var(--r-sm);
    margin-bottom: 4px;
    border: 1px solid transparent;
  }
  .anno-row.active { border-color: var(--accent); background: var(--accent-soft); }
  .reorder { display: flex; flex-direction: column; gap: 1px; flex-shrink: 0; }
  .reorder-btn { padding: 0 2px; line-height: 1; color: var(--text-3); }
  .reorder-btn:disabled { opacity: 0.25; cursor: default; }
  .color-btn {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid transparent;
    flex-shrink: 0;
  }
  .color-btn.active { border-color: var(--text-1); box-shadow: 0 0 0 2px var(--bg-1), 0 0 0 3.5px var(--text-3); }
  .color-pick {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-text);
    cursor: pointer;
    position: relative;
    overflow: hidden;
  }
  .color-pick input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .bg-pick { width: 20px; height: 20px; flex-shrink: 0; border: 1px dashed var(--border); }
  .bg-pick.active { border-style: solid; }
  .bg-pick:not(.active) { color: var(--text-3); }
  .chip-num {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 700;
    color: var(--accent-text);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid transparent;
    cursor: pointer;
  }
  .chip-num:hover { border-color: var(--text-1); }
  .el-label {
    flex: 1;
    font-size: var(--fs-xs);
    color: var(--text-2);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .el-id { color: var(--text-3); }
  .shape-row {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 6px;
    border-radius: var(--r-sm);
    margin-bottom: 3px;
    border: 1px solid transparent;
    color: var(--text-3);
    cursor: pointer;
  }
  .shape-row:hover { background: var(--bg-2); }
  .shape-row.selected { border-color: var(--accent); background: var(--accent-soft); }
  .chip { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
  .comment-input {
    flex: 1;
    font-size: var(--fs-xs);
    padding: 4px 8px;
    background: transparent;
    border-color: transparent;
    min-width: 0;
  }
  .comment-input:hover, .comment-input:focus { background: var(--bg-2); border-color: var(--border); }
</style>
