<script>
  import Icon from '../../components/Icon.svelte';
  import ProofGlyph from '../../components/ProofGlyph.svelte';
  import { iconByName } from '../../lib/proofIcons.js';
  import { fileUrl } from '../../lib/fileUrl.js';

  let {
    proof,
    collapsed,
    gonePanels,
    selectedPanelId,
    selectedPasteId,
    selectedIds,
    // A drawing tool holds the handles back on the canvas, so the rows stop
    // lighting up too: a pick shown in one column and absent from the other is
    // a selection the analyst cannot act on.
    selectionLive,
    selectShape,
    selectPanelRow,
    selectPasteRow,
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
    openCrop,
    resetCrop,
    removePanel,
    movePasteZ,
    removePaste,
    setFrame,
    pickImageFile,
    featureList,
    moveLegendColor,
    setColor,
    canBringForward,
    canSendBackward,
    bringForward,
    sendBackward,
    moveShapeTo,
    kindIcon,
    kindLabel,
    duplicateShape,
    deleteShape,
    markDirty,
  } = $props();

  // A row says which symbol it is, not merely that it is one: eleven rows all
  // reading "Symbol" would be a list nobody can navigate. A marker says its
  // number for the same reason — that number is the whole of what it states.
  const rowLabel = (shape) => {
    if (shape.kind === 'icon') return iconByName(shape.name)?.label ?? kindLabel.icon;
    if (shape.kind === 'number') return `${kindLabel.number} ${shape.n ?? ''}`.trim();
    return kindLabel[shape.kind];
  };

  /**
   * The elements front-first, which is how the Panels list above already reads
   * and how every layer list anywhere reads: the row on top is the mark on top
   * of the picture.
   *
   * The array runs the other way — a panel's shapes are drawn in array order, so
   * the last one is the one in front — and that is the spec's order, not a
   * reading order. So it is turned round here and nowhere else, and each row
   * carries the index it came from.
   */
  const rows = $derived(proof.shapes.map((shape, index) => ({ shape, index })).reverse());

  /**
   * Which picture each row is drawn on, named the way the lists above number
   * them — but shown only once more than one picture holds elements.
   *
   * The order is one order for the whole proof, while what an element is drawn
   * *over* is decided inside its own picture: two marks on two panels are
   * stacked by the panels. So a row moved past a row of another picture changes
   * nothing on screen, and this is the reason, on the row, rather than an arrow
   * greyed out with none.
   */
  const surfaceNames = $derived.by(() => {
    const names = new Map();
    proof.panels.forEach((panel, at) => names.set(panel.id, `P${at + 1}`));
    proof.pastes.forEach((paste, at) => names.set(paste.id, `I${at + 1}`));
    return names;
  });
  const manySurfaces = $derived(new Set(proof.shapes.map((shape) => shape.panel)).size > 1);

  // Dragging a row to reorder it. A press is armed first and becomes a drag a
  // few pixels later, so a plain click still picks the element it lands on, and
  // a press that starts on a field or a button belongs to that control.
  let armed = null;
  let dragging = $state(-1); // the seat being dragged, in list order
  let over = $state(-1); // the seat it would land on

  function rowPointerDown(event, seat) {
    if (event.button !== 0 || event.target.closest('input, button, label')) return;
    armed = { seat, x: event.clientX, y: event.clientY };
  }

  function rowPointerMove(event) {
    if (!armed) return;
    if (Math.hypot(event.clientX - armed.x, event.clientY - armed.y) < 4) return;
    dragging = armed.seat;
    over = armed.seat;
    armed = null;
  }

  function rowPointerEnter(seat) {
    if (dragging >= 0) over = seat;
  }

  function endDrag() {
    if (dragging >= 0 && over >= 0 && over !== dragging) {
      moveShapeTo(rows[dragging].index, rows[over].index);
    }
    armed = null;
    dragging = -1;
    over = -1;
  }

  // The release can land anywhere — outside the list, outside the window — so it
  // is heard at the window for as long as the panel is up. A press that never
  // became a drag is disarmed by the same handler, or it would turn into one the
  // next time the pointer crossed that row with no button held.
  $effect(() => {
    window.addEventListener('pointerup', endDrag, true);
    window.addEventListener('pointercancel', endDrag, true);
    return () => {
      window.removeEventListener('pointerup', endDrag, true);
      window.removeEventListener('pointercancel', endDrag, true);
    };
  });
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

<!-- The crop button is the keyboard-accessible counterpart to double-clicking
     an image. Rotation lives on the canvas as the round selection handle. -->
{#snippet transformControl(item, label)}
  <div class="transform-ctl">
    <button
      class="btn btn-ghost btn-sm"
      class:active={!!item.crop}
      title={`Crop ${label}`}
      aria-label={`Crop ${label}`}
      onclick={() => openCrop(item)}
    ><Icon name="crop" size={13} /></button>
    {#if item.crop}
      <button
        class="btn btn-ghost btn-sm"
        title={`Reset ${label} crop`}
        aria-label={`Reset ${label} crop`}
        onclick={() => resetCrop(item)}
      ><Icon name="reset" size={12} /></button>
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
      class:selected={selectionLive && selectedPanelId === panel.id}
      class:gone={gonePanels.includes(panel)}
    >
      <button
        class="panel-thumb"
        title="Select this panel on the canvas"
        onclick={() => selectPanelRow(panel.id)}
      >
        <img src={fileUrl(caseId, panel.src)} alt="" />
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
        {@render transformControl(panel, 'panel')}
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
    <div class="panel-row paste-row card" class:selected={selectionLive && selectedPasteId === paste.id}>
      <button
        class="panel-thumb"
        title="Select this overlay on the canvas"
        onclick={() => selectPasteRow(paste.id)}
      >
        <img src={paste.img?.src} alt="" />
        <span class="row-badge" title="Z1 is the foreground">Z{index + 1}</span>
      </button>
      <div class="panel-actions">
        {@render transformControl(paste, 'overlay')}
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
  <!-- Front-first: the row on top is the mark on top of the picture, and it is
       dragged up to bring it further forward. -->
  {#each rows as { shape, index }, seat (shape.id)}
    <div
      class="shape-row"
      class:selected={selectionLive && selectedIds.includes(shape.id)}
      class:dragging={dragging === seat}
      class:landing={dragging >= 0 && over === seat && dragging !== seat}
      class:from-below={dragging > seat}
      onclick={(event) => selectShape(shape.id, event.shiftKey)}
      onpointerdown={(event) => rowPointerDown(event, seat)}
      onpointermove={rowPointerMove}
      onpointerenter={() => rowPointerEnter(seat)}
      role="button"
      tabindex="0"
      title="Drag to reorder"
      onkeydown={(event) => event.key === 'Enter' && selectShape(shape.id, event.shiftKey)}
    >
      <div class="reorder">
        <button
          class="btn btn-ghost reorder-btn"
          disabled={!canBringForward(index)}
          title="Bring forward (over the others on its picture)"
          onclick={(event) => { event.stopPropagation(); bringForward(index); }}
        ><Icon name="chevronUp" size={11} /></button>
        <button
          class="btn btn-ghost reorder-btn"
          disabled={!canSendBackward(index)}
          title="Send backward"
          onclick={(event) => { event.stopPropagation(); sendBackward(index); }}
        ><Icon name="chevronDown" size={11} /></button>
      </div>
      <!-- A blur box has no colour to show: it is the one mark drawn from the
           picture's own pixels rather than in ink. -->
      {#if shape.kind !== 'blur'}
        <span class="chip" style:background={shape.color}></span>
      {/if}
      {#if manySurfaces}
        <span class="on-what" title="Drawn on {surfaceNames.get(shape.panel) ?? 'a picture'}">
          {surfaceNames.get(shape.panel) ?? '–'}
        </span>
      {/if}
      {#if shape.kind === 'icon'}
        <ProofGlyph name={shape.name} size={13} />
      {:else}
        <Icon name={kindIcon[shape.kind]} size={13} />
      {/if}
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
        <!-- Numbered by where the row sits, so the count follows the eye down
             the list rather than the array underneath it. -->
        <span class="el-label">{rowLabel(shape)} <span class="el-id">#{seat + 1}</span></span>
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
  {#if manySurfaces}
    <div class="list-hint">Elements stack inside the picture they are drawn on.</div>
  {/if}
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
  .transform-ctl {
    display: flex;
    align-items: center;
    gap: 1px;
    padding-right: 3px;
    border-right: 1px solid var(--border);
  }
  .transform-ctl .active { color: var(--accent); background: var(--accent-soft); }
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
  /* A row is dragged by its middle, and a drag over words selects them unless it
     is said not to. The label a text element carries is still a field, so it
     keeps its own selection. */
  .shape-row {
    -webkit-user-select: none;
    user-select: none;
  }
  .shape-row input {
    -webkit-user-select: text;
    user-select: text;
  }
  .shape-row:hover { background: var(--bg-2); }
  .shape-row.selected { border-color: var(--accent); background: var(--accent-soft); }
  /* Dragging: the row being carried fades, and a rule marks the gap it would
     drop into — on the side it is coming from, so the line is between the two
     rows it would end up between. */
  .shape-row.dragging { opacity: 0.45; }
  .shape-row.landing { box-shadow: inset 0 -2px 0 var(--accent); }
  .shape-row.landing.from-below { box-shadow: inset 0 2px 0 var(--accent); }
  .chip { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
  .on-what {
    flex-shrink: 0;
    padding: 0 4px;
    border-radius: var(--r-sm);
    background: var(--bg-3);
    color: var(--text-3);
    font-size: 9px;
    font-weight: 700;
  }
  .list-hint { margin: 4px 0 2px; font-size: var(--fs-xs); color: var(--text-3); }
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
