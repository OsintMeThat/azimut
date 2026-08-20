<script>
  import Icon from '../../components/Icon.svelte';
  import ProofGlyph from '../../components/ProofGlyph.svelte';
  import { PROOF_ICONS } from '../../lib/proofIcons.js';
  import { canFill, fillPaint } from '../../lib/proofEdits.js';

  let {
    canUndo,
    canRedo,
    undo,
    redo,
    drawTools,
    tool = $bindable(),
    palette,
    activeColor,
    activeFill,
    selectedShape,
    selectedCount,
    fillableSelection,
    // A silhouette has no outline, so the width control is hidden for it. Any
    // caller that says nothing gets the control.
    showStroke = true,
    iconName = PROOF_ICONS[0].name,
    setIconName = () => {},
    strokeW,
    setColor,
    setStroke,
    setFill,
    fit,
    layout,
    setLayoutMode,
    guide = $bindable(),
    tweetGuides,
    panelCount,
    applyMagic,
  } = $props();

  // Colour + size only matter while drawing or when something is selected. When
  // the analyst is just panning with Select, they stay hidden so the column
  // packs short enough to fit small screens without spilling controls off the
  // bottom. `selectedShape` is the one picked annotation and is null for a
  // family of them, so what is on screen answers to the count.
  const showContextTools = $derived(tool !== 'select' || selectedCount > 0);
  const sizeValue = $derived(
    selectedShape?.kind === 'text'
      ? (selectedShape.fontSize ?? 28)
      : (selectedShape?.strokeWidth ?? strokeW),
  );
  // Only the closed kinds hold a fill, so the control follows the box/ellipse
  // tool — or the box/ellipse in hand.
  const showFill = $derived(selectedCount > 0 ? fillableSelection : canFill(tool));
  const fillPercent = $derived(Math.round((activeFill ?? 0) * 100));

  // Flyouts: one open at a time. Content stays in the DOM (hidden via CSS) so
  // it renders on the server and can be tested; opening just reveals it.
  let colorOpen = $state(false);
  let sizeOpen = $state(false);
  let fillOpen = $state(false);
  let iconOpen = $state(false);
  let overflowOpen = $state(false);
  // Wrapper refs feed outside-click detection; button refs anchor the flyout.
  let colorEl = $state();
  let sizeEl = $state();
  let fillEl = $state();
  let iconEl = $state();
  let overflowEl = $state();
  let colorBtn = $state();
  let sizeBtn = $state();
  let fillBtn = $state();
  let iconBtn = $state();
  let overflowBtn = $state();
  let colorPos = $state({});
  let sizePos = $state({});
  let fillPos = $state({});
  let iconPos = $state({});
  let overflowPos = $state({});

  function toggle(which) {
    colorOpen = which === 'color' ? !colorOpen : false;
    sizeOpen = which === 'size' ? !sizeOpen : false;
    fillOpen = which === 'fill' ? !fillOpen : false;
    iconOpen = which === 'icon' ? !iconOpen : false;
    overflowOpen = which === 'overflow' ? !overflowOpen : false;
  }

  // The colour/size buttons vanish when the analyst switches to Select with
  // nothing selected; drop their flyouts so they never reappear stale.
  $effect(() => {
    if (!showContextTools) {
      colorOpen = false;
      sizeOpen = false;
    }
    if (!showFill) fillOpen = false;
  });

  // Flyouts are position:fixed so the toolbar can scroll (overflow-y) without
  // clipping them. Anchor to the right of the trigger; grow upward when the
  // trigger sits in the lower half of the viewport so the panel stays on-screen.
  function anchor(btn) {
    const r = btn.getBoundingClientRect();
    const left = r.right + 6;
    if (r.top > window.innerHeight / 2) {
      return { left: `${left}px`, bottom: `${window.innerHeight - r.bottom}px` };
    }
    return { left: `${left}px`, top: `${r.top}px` };
  }

  $effect(() => {
    if (colorOpen && colorBtn) colorPos = anchor(colorBtn);
  });
  $effect(() => {
    if (sizeOpen && sizeBtn) sizePos = anchor(sizeBtn);
  });
  $effect(() => {
    if (fillOpen && fillBtn) fillPos = anchor(fillBtn);
  });
  $effect(() => {
    if (iconOpen && iconBtn) iconPos = anchor(iconBtn);
  });
  $effect(() => {
    if (overflowOpen && overflowBtn) overflowPos = anchor(overflowBtn);
  });

  // Close on outside click (mousedown capture, like Satellite.svelte) or Escape.
  $effect(() => {
    if (!colorOpen && !sizeOpen && !fillOpen && !iconOpen && !overflowOpen) return;
    const onDown = (e) => {
      if (colorOpen && colorEl && !colorEl.contains(e.target)) colorOpen = false;
      if (sizeOpen && sizeEl && !sizeEl.contains(e.target)) sizeOpen = false;
      if (fillOpen && fillEl && !fillEl.contains(e.target)) fillOpen = false;
      if (iconOpen && iconEl && !iconEl.contains(e.target)) iconOpen = false;
      if (overflowOpen && overflowEl && !overflowEl.contains(e.target)) overflowOpen = false;
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        colorOpen = sizeOpen = fillOpen = iconOpen = overflowOpen = false;
      }
    };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="toolbar">
  <button class="tb-btn" title="Undo (Ctrl+Z)" disabled={!canUndo} onclick={undo}>
    <Icon name="undo" size={18} />
  </button>
  <button class="tb-btn" title="Redo (Ctrl+Shift+Z / Ctrl+Y)" disabled={!canRedo} onclick={redo}>
    <Icon name="redo" size={18} />
  </button>
  <div class="tb-sep"></div>
  {#each drawTools as entry (entry.id)}
    <button
      class="tb-btn"
      class:active={tool === entry.id}
      title="{entry.label} ({entry.shortcut})"
      onclick={() => (tool = entry.id)}
    >
      <Icon name={entry.icon} size={18} />
    </button>
  {/each}
  <!-- Symbols: a grid of stamps. The button takes the tool like every other
       button on this rail — and like the `s` its own tooltip promises — then
       opens the grid, so re-picking a glyph already chosen is never the price of
       coming back to the stamp. Lit by the tool in hand, not by the open grid. -->
  <div class="tb-group" bind:this={iconEl}>
    <button
      class="tb-btn"
      class:active={tool === 'icon'}
      title="Symbol (s)"
      onclick={() => { tool = 'icon'; toggle('icon'); }}
      bind:this={iconBtn}
    >
      <ProofGlyph name={iconName} size={18} />
    </button>
    <div
      class="flyout flyout-icons"
      class:open={iconOpen}
      style:left={iconPos.left}
      style:top={iconPos.top}
      style:bottom={iconPos.bottom}
    >
      {#each PROOF_ICONS as entry (entry.name)}
        <button
          class="icon-btn"
          class:active={iconName === entry.name}
          title={entry.label}
          aria-label={entry.label}
          onclick={() => { setIconName(entry.name); iconOpen = false; }}
        >
          <ProofGlyph name={entry.name} size={20} />
        </button>
      {/each}
    </div>
  </div>
  <div class="tb-sep"></div>
  <button class="tb-btn" title="Fit view (f)" onclick={fit}>
    <Icon name="eye" size={18} />
  </button>

  {#if showContextTools}
    <div class="tb-sep"></div>

    <!-- Colour: a swatch that opens the palette + custom picker. -->
    <div class="tb-group" bind:this={colorEl}>
      <button
        class="tb-btn"
        class:active={colorOpen}
        title="Annotation colour"
        onclick={() => toggle('color')}
        bind:this={colorBtn}
      >
        <span class="tb-swatch" style:background={activeColor}></span>
      </button>
      <div
        class="flyout flyout-colors"
        class:open={colorOpen}
        style:left={colorPos.left}
        style:top={colorPos.top}
        style:bottom={colorPos.bottom}
      >
        {#each palette as entry (entry)}
          <button
            class="color-btn"
            class:active={activeColor === entry}
            style:background={entry}
            title="Same color = same feature"
            onclick={() => { setColor(entry); colorOpen = false; }}
            aria-label={`color ${entry}`}
          ></button>
        {/each}
        <label
          class="color-btn color-pick"
          class:active={!palette.includes(activeColor)}
          style:background={activeColor}
          title="Custom color"
        >
          <Icon name="plus" size={12} />
          <input
            type="color"
            value={activeColor}
            oninput={(event) => setColor(event.target.value)}
            aria-label="custom color"
          />
        </label>
      </div>
    </div>

    <!-- Size: a horizontal slider for stroke width / font size. -->
    {#if showStroke}
    <div class="tb-group" bind:this={sizeEl}>
      <button
        class="tb-btn tb-size"
        class:active={sizeOpen}
        title={selectedShape?.kind === 'text' ? 'Font size' : 'Stroke width'}
        onclick={() => toggle('size')}
        bind:this={sizeBtn}
      >
        <Icon name="sliders" size={18} />
        <span class="tb-size-val">{sizeValue}</span>
      </button>
      <div
        class="flyout flyout-size"
        class:open={sizeOpen}
        style:left={sizePos.left}
        style:top={sizePos.top}
        style:bottom={sizePos.bottom}
      >
        <input
          class="stroke-slider"
          type="range"
          min={selectedShape?.kind === 'text' ? 8 : 1}
          max={selectedShape?.kind === 'text' ? 120 : 24}
          step="1"
          value={selectedShape?.kind === 'text'
            ? (selectedShape.fontSize ?? 28)
            : (selectedShape?.strokeWidth ?? strokeW)}
          oninput={(event) => setStroke(+event.target.value)}
          aria-label={selectedShape?.kind === 'text' ? 'font size' : 'stroke width'}
        />
      </div>
    </div>
    {/if}

    <!-- Fill: how much of the shape's own colour lands inside it. -->
    {#if showFill}
      <div class="tb-group" bind:this={fillEl}>
        <button
          class="tb-btn tb-size"
          class:active={fillOpen}
          title="Fill"
          onclick={() => toggle('fill')}
          bind:this={fillBtn}
        >
          <span class="tb-fill" style:background={fillPaint(activeColor, activeFill) ?? 'transparent'}
          ></span>
          <span class="tb-size-val">{fillPercent}</span>
        </button>
        <div
          class="flyout flyout-size"
          class:open={fillOpen}
          style:left={fillPos.left}
          style:top={fillPos.top}
          style:bottom={fillPos.bottom}
        >
          <input
            class="fill-slider"
            type="range"
            min="0"
            max="100"
            step="5"
            value={fillPercent}
            oninput={(event) => setFill(+event.target.value / 100)}
            title="Fill opacity"
            aria-label="fill opacity"
          />
        </div>
      </div>
    {/if}
  {/if}

  <div class="tb-sep"></div>

  <!-- Layout, tweet crops and repack live in one overflow flyout. -->
  <div class="tb-group" bind:this={overflowEl}>
    <button
      class="tb-btn"
      class:active={overflowOpen || layout === 'free' || !!guide}
      title="Layout, tweet crops & repack"
      onclick={() => toggle('overflow')}
      bind:this={overflowBtn}
    >
      <Icon name="grid" size={18} />
    </button>
    <div
      class="flyout flyout-overflow"
      class:open={overflowOpen}
      style:left={overflowPos.left}
      style:top={overflowPos.top}
      style:bottom={overflowPos.bottom}
    >
      <div class="flyout-row">
        <button
          class="tb-btn"
          class:active={layout !== 'free'}
          title="Grid layout: panels flow in rows"
          onclick={() => setLayoutMode('grid')}
        >
          <Icon name="grid" size={18} />
        </button>
        <button
          class="tb-btn"
          class:active={layout === 'free'}
          title="Free layout: drag panels anywhere"
          onclick={() => setLayoutMode('free')}
        >
          <Icon name="layers" size={18} />
        </button>
      </div>
      <div class="flyout-row">
        {#each Object.keys(tweetGuides) as entry (entry)}
          <button
            class="tb-btn tb-guide"
            class:active={guide === entry}
            title={`Preview the ${entry} tweet crop. Everything outside is cut off`}
            onclick={() => (guide = guide === entry ? null : entry)}
          >{entry}</button>
        {/each}
        <button
          class="tb-btn tb-magic"
          title={`Repack panels toward ${guide ?? '16:9'} and reset panel sizes`}
          disabled={!panelCount}
          onclick={applyMagic}
        >
          <Icon name="wand" size={18} />
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  .toolbar {
    width: 52px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px 0;
    border-right: 1px solid var(--border);
    background: var(--bg-1);
    overflow-y: auto;
    overflow-x: hidden;
  }
  .tb-btn {
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-sm);
    color: var(--text-3);
    flex-shrink: 0;
  }
  .tb-btn:hover { color: var(--text-1); background: var(--bg-2); }
  .tb-btn.active { color: var(--text-1); background: var(--bg-3); }
  .tb-guide { font-size: 11px; font-weight: 700; }
  .tb-magic:not(:disabled) { color: var(--accent); }
  .tb-magic:not(:disabled):hover { background: var(--accent-soft); }
  .tb-magic:disabled { opacity: 0.4; cursor: default; }
  .tb-sep {
    width: 26px;
    height: 1px;
    background: var(--border);
    margin: 4px 0;
    flex-shrink: 0;
  }
  .tb-size { position: relative; }
  .tb-size-val {
    position: absolute;
    right: 2px;
    bottom: 1px;
    font-size: 9px;
    font-weight: 700;
    line-height: 1;
    color: var(--text-3);
  }
  .tb-swatch {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
  }
  /* A hollow square that fills up as the opacity rises, so the button shows
     the state it sets. Empty at 0, which is where every shape starts. */
  .tb-fill {
    width: 18px;
    height: 18px;
    border-radius: 3px;
    box-shadow: inset 0 0 0 1.5px var(--text-3);
  }

  .tb-group { display: contents; }

  .flyout {
    position: fixed;
    z-index: 60;
    display: none;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-1);
    box-shadow: var(--shadow-2, 0 6px 24px rgba(0, 0, 0, 0.3));
  }
  .flyout.open { display: flex; }
  .flyout-colors {
    flex-wrap: wrap;
    gap: 8px;
    width: 132px;
    align-items: center;
  }
  .flyout-size { align-items: center; }
  .flyout-icons {
    flex-wrap: wrap;
    gap: 4px;
    width: 168px;
    align-items: center;
  }

  .icon-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: var(--r-sm, 5px);
    color: var(--text-2);
    background: transparent;
    cursor: pointer;
    transition: border-color 0.12s var(--ease), color 0.12s var(--ease);
  }
  .icon-btn:hover { border-color: var(--border); color: var(--text-1); }
  .icon-btn.active {
    border-color: var(--accent);
    /* --accent-text is ink for sitting ON the accent, not a foreground: on a
       transparent button it is near-black, which in the dark theme is invisible.
       Active follows .tb-btn.active instead — full-strength text, raised back. */
    color: var(--text-1);
    background: var(--bg-3);
  }
  .flyout-overflow { flex-direction: column; gap: 6px; }
  .flyout-row { display: flex; gap: 6px; }

  .color-btn {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid transparent;
    transition: border-color 0.12s var(--ease);
    flex-shrink: 0;
  }
  .color-btn:hover { border-color: var(--text-3); }
  .color-btn.active {
    border-color: var(--text-1);
    box-shadow: 0 0 0 2px var(--bg-1), 0 0 0 3.5px var(--text-3);
  }
  .color-pick {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-text);
    cursor: pointer;
    position: relative;
    overflow: hidden;
  }
  .color-pick input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .stroke-slider,
  .fill-slider {
    width: 140px;
    accent-color: var(--accent);
  }
  .tb-btn:disabled { opacity: 0.35; cursor: default; }
  .tb-btn:disabled:hover { color: var(--text-3); background: none; }
</style>
