<script>
  import Icon from '../../components/Icon.svelte';
  import ProofGlyph from '../../components/ProofGlyph.svelte';
  import { PROOF_ICONS } from '../../lib/proofIcons.js';
  import { canFill, fillPaint } from '../../lib/proofEdits.js';
  import { shortcut } from '../../lib/keys.js';
  import { CALLOUT_FONT } from '../../lib/pageMarks.js';
  import { LINE_STYLES } from '../../lib/proofEdits.js';
  import { LENSES, lensFov } from '../../lib/viewCone.js';
  import ToolbarFlyout from './ToolbarFlyout.svelte';

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
    // A blur box is drawn from the picture rather than in ink, so the swatch is
    // hidden for it — same rule, and same default.
    showColor = true,
    iconName = PROOF_ICONS[0].name,
    setIconName = () => {},
    strokeW,
    setColor,
    setStroke,
    setFill,
    // How a callout reaches its point. Shown with the callout tool in hand and on
    // a picked callout or label; `tailNone` offers taking the pointer off, which
    // only a picked mark can answer.
    // How a line is drawn, for the marks that have one.
    showDash = false,
    activeDash = 'solid',
    setDash = () => {},
    // A picked label's frame and background: `{ frame, bg }`, or null.
    textBox = null,
    setTextBox = () => {},
    // A picked panel's or overlay's border: `{ color, width }`, null for none,
    // undefined when no panel or overlay is picked.
    surfaceBorder = undefined,
    setSurfaceBorder = () => {},
    frameWidthMax = 60,
    // The lens a view cone opens to, with the cone tool in hand or a cone picked:
    // `{ lens, upright, fov }`, `lens` null for a width set by hand.
    showLens = false,
    activeLens = { lens: '1', upright: false, fov: 69 },
    setLens = () => {},
    // The pick's other sizes, each on its own slider beside the main one: a
    // tag's words, a callout's line, a label's frame, a cone's camera.
    // `[{ id, label, value, min, max }]`.
    moreSizes = [],
    setSize = () => {},
    // A picked caption or footer: `{ id, label, size, color, auto }`, `color`
    // null for the one the background gives (`auto`).
    pageText = null,
    setPageText = () => {},
    // A box's tag and the corner it hangs from, shown on a picked box.
    showTag = false,
    activeTag = 'none',
    setTagAt = () => {},
    showTail = false,
    tailNone = false,
    activeTail = 'leader',
    setTail = () => {},
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
  // A label and a callout are sized by their words; a callout's line follows.
  const fontSized = $derived(selectedShape?.kind === 'text' || selectedShape?.kind === 'callout');

  /**
   * A field of view drawn as the wedge it opens, from the middle of a w×h box's
   * bottom edge, as long as the box lets it be at that width.
   */
  function wedgePath(fov, w, h) {
    const half = (Math.min(Math.max(fov, 1), 170) * Math.PI) / 360;
    const r = Math.min(h - 1.5, (w / 2 - 1) / Math.max(Math.sin(half), 0.05));
    const cx = w / 2;
    const cy = h - 1;
    const dx = r * Math.sin(half);
    const y = cy - r * Math.cos(half);
    const f = (v) => v.toFixed(2);
    return `M${cx} ${cy}L${f(cx - dx)} ${f(y)}A${f(r)} ${f(r)} 0 0 1 ${f(cx + dx)} ${f(y)}Z`;
  }
  const sizeValue = $derived(
    fontSized
      ? (selectedShape.fontSize ?? (selectedShape.kind === 'callout' ? CALLOUT_FONT : 28))
      : (selectedShape?.strokeWidth ?? strokeW),
  );
  const TAILS = [
    { id: 'none', icon: 'text', label: 'No pointer: a plain label' },
    { id: 'leader', icon: 'calloutLeader', label: 'Leader line to the point' },
    { id: 'bubble', icon: 'calloutBubble', label: 'Speech bubble' },
  ];
  const tailIcon = $derived(TAILS.find((t) => t.id === activeTail)?.icon ?? 'calloutLeader');
  const TAGS = [
    { id: 'none', icon: 'square', label: 'No tag' },
    { id: 'tl', icon: 'tagTL', label: 'Tag on the top-left corner' },
    { id: 'tr', icon: 'tagTR', label: 'Tag on the top-right corner' },
    { id: 'bl', icon: 'tagBL', label: 'Tag on the bottom-left corner' },
    { id: 'br', icon: 'tagBR', label: 'Tag on the bottom-right corner' },
  ];
  const DASH = {
    solid: { icon: 'lineSolid', label: 'Solid line' },
    dash: { icon: 'lineDashed', label: 'Dashed line' },
    dot: { icon: 'lineDotted', label: 'Dotted line' },
  };
  const tagIcon = $derived(TAGS.find((t) => t.id === activeTag && t.id !== 'none')?.icon ?? 'tagTL');
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
  let tailOpen = $state(false);
  let tagOpen = $state(false);
  let overflowOpen = $state(false);
  // Wrapper refs feed outside-click detection; button refs anchor the flyout.
  let colorEl = $state();
  let sizeEl = $state();
  let fillEl = $state();
  let iconEl = $state();
  let tailEl = $state();
  let tagEl = $state();
  let overflowEl = $state();
  let colorBtn = $state();
  let sizeBtn = $state();
  let fillBtn = $state();
  let iconBtn = $state();
  let tailBtn = $state();
  let tagBtn = $state();
  let overflowBtn = $state();
  let colorPos = $state({});
  let sizePos = $state({});
  let fillPos = $state({});
  let iconPos = $state({});
  let tailPos = $state({});
  let tagPos = $state({});
  let overflowPos = $state({});

  function toggle(which) {
    colorOpen = which === 'color' ? !colorOpen : false;
    sizeOpen = which === 'size' ? !sizeOpen : false;
    fillOpen = which === 'fill' ? !fillOpen : false;
    iconOpen = which === 'icon' ? !iconOpen : false;
    tailOpen = which === 'tail' ? !tailOpen : false;
    tagOpen = which === 'tag' ? !tagOpen : false;
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
    if (!showTail) tailOpen = false;
    if (!showTag) tagOpen = false;
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
    if (tailOpen && tailBtn) tailPos = anchor(tailBtn);
  });
  $effect(() => {
    if (tagOpen && tagBtn) tagPos = anchor(tagBtn);
  });
  $effect(() => {
    if (overflowOpen && overflowBtn) overflowPos = anchor(overflowBtn);
  });

  // Close on outside click (mousedown capture, like Satellite.svelte) or Escape.
  $effect(() => {
    if (!colorOpen && !sizeOpen && !fillOpen && !iconOpen && !tailOpen && !tagOpen && !overflowOpen) return;
    const onDown = (e) => {
      if (tagOpen && tagEl && !tagEl.contains(e.target)) tagOpen = false;
      if (tailOpen && tailEl && !tailEl.contains(e.target)) tailOpen = false;
      if (colorOpen && colorEl && !colorEl.contains(e.target)) colorOpen = false;
      if (sizeOpen && sizeEl && !sizeEl.contains(e.target)) sizeOpen = false;
      if (fillOpen && fillEl && !fillEl.contains(e.target)) fillOpen = false;
      if (iconOpen && iconEl && !iconEl.contains(e.target)) iconOpen = false;
      if (overflowOpen && overflowEl && !overflowEl.contains(e.target)) overflowOpen = false;
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        colorOpen = sizeOpen = fillOpen = iconOpen = tailOpen = tagOpen = overflowOpen = false;
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
  <button class="tb-btn" title={shortcut('Undo (Ctrl+Z)')} disabled={!canUndo} onclick={undo}>
    <Icon name="undo" size={18} />
  </button>
  <button class="tb-btn" title={shortcut('Redo (Ctrl+Shift+Z / Ctrl+Y)')} disabled={!canRedo} onclick={redo}>
    <Icon name="redo" size={18} />
  </button>
  <div class="tb-sep"></div>
  <!-- Pressing the tool in hand puts it down: the way out of a drawing tool was
       aiming at the cursor button, and the button you are already on is the
       easier target of the two. -->
  {#each drawTools as entry (entry.id)}
    <button
      class="tb-btn"
      class:active={tool === entry.id}
      aria-pressed={tool === entry.id}
      title="{entry.label} ({entry.shortcut})"
      onclick={() => (tool = tool === entry.id ? 'select' : entry.id)}
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
      aria-pressed={tool === 'icon'}
      title="Symbol (s)"
      onclick={() => {
        // The grid is a picker: with the stamp in hand and the grid shut, the
        // press opens it again, so changing a glyph never costs the tool. It is
        // the press *with the grid open* that puts the stamp down, which is what
        // pressing the tool you are already on means everywhere else on the rail.
        if (tool === 'icon' && iconOpen) { tool = 'select'; toggle(''); return; }
        tool = 'icon';
        toggle('icon');
      }}
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

  <!-- A blur box answers to none of these, so the group is empty for it and the
       rule that marks it would be a line under nothing. -->
  {#if showContextTools && (showColor || showStroke || showFill)}
    <div class="tb-sep"></div>

    <!-- Colour: a swatch that opens the palette + custom picker. -->
    {#if showColor}
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
    {/if}

    <!-- Size: a horizontal slider for stroke width / font size. -->
    {#if showStroke}
    <div class="tb-group" bind:this={sizeEl}>
      <button
        class="tb-btn tb-size"
        class:active={sizeOpen}
        title={fontSized ? 'Font size' : 'Stroke width'}
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
        <div class="size-rows">
          <label class="size-row">
            <span class="size-name">{fontSized ? 'Text' : 'Line'}</span>
            <input
              class="stroke-slider"
              type="range"
              min={fontSized ? 8 : 1}
              max={fontSized ? 120 : 24}
              step="1"
              value={sizeValue}
              oninput={(event) => setStroke(+event.target.value)}
              aria-label={fontSized ? 'font size' : 'stroke width'}
            />
            <span class="size-num">{sizeValue}</span>
          </label>
          {#each moreSizes as row (row.id)}
            <label class="size-row">
              <span class="size-name">{row.label}</span>
              <input
                class="more-slider"
                type="range"
                min={row.min}
                max={row.max}
                step="1"
                value={row.value}
                oninput={(event) => setSize(row.id, +event.target.value)}
                aria-label={`${row.label} size`}
              />
              <span class="size-num">{row.value}</span>
            </label>
          {/each}
        </div>
      </div>
    </div>
    {/if}

    {#if showDash}
      <ToolbarFlyout title="Line style" active={activeDash !== 'solid'}>
        {#snippet button()}<Icon name={DASH[activeDash].icon} size={18} />{/snippet}
        {#snippet children(close)}
          <div class="flyout-row">
            {#each LINE_STYLES as style (style)}
              <button
                class="tb-btn"
                class:active={activeDash === style}
                title={DASH[style].label}
                aria-label={DASH[style].label}
                onclick={() => { setDash(style); close(); }}
              ><Icon name={DASH[style].icon} size={18} /></button>
            {/each}
          </div>
        {/snippet}
      </ToolbarFlyout>
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

    <!-- A label's box: a frame in its own colour, and a plate behind the words. -->
    {#if textBox}
      <button
        class="tb-btn"
        class:active={textBox.frame}
        aria-pressed={textBox.frame}
        title="Frame around the words"
        onclick={() => setTextBox({ frame: !textBox.frame })}
      ><Icon name="square" size={18} /></button>
      <ToolbarFlyout title="Background" active={!!textBox.bg}>
        {#snippet button()}<span class="tb-plate" style:background={textBox.bg ?? 'transparent'}></span>{/snippet}
        {#snippet children(close)}
          <div class="swatches">
            <button
              class="color-btn color-none"
              class:active={!textBox.bg}
              title="No background"
              aria-label="no background"
              onclick={() => { setTextBox({ bg: null }); close(); }}
            ><Icon name="x" size={11} /></button>
            {#each [...new Set(['#0d1117', '#ffffff', ...palette])] as entry (entry)}
              <button
                class="color-btn"
                class:active={textBox.bg === entry}
                style:background={entry}
                aria-label={`background ${entry}`}
                onclick={() => { setTextBox({ bg: entry }); close(); }}
              ></button>
            {/each}
            <label class="color-btn color-pick" style:background={textBox.bg ?? 'transparent'} title="Custom background">
              <Icon name="plus" size={12} />
              <input
                type="color"
                value={textBox.bg ?? '#000000'}
                oninput={(event) => setTextBox({ bg: event.target.value })}
                aria-label="custom background"
              />
            </label>
          </div>
        {/snippet}
      </ToolbarFlyout>
    {/if}
  {/if}

  <!-- A picked panel's captions, or the footer: how big and in what colour. -->
  {#if pageText}
    <div class="tb-sep"></div>
    <ToolbarFlyout title={`${pageText.label} text`} active={!!pageText.color}>
      {#snippet button()}
        <span class="tb-text" style:color={pageText.color ?? pageText.auto}>
          <Icon name="text" size={15} />
          <span class="tb-text-val">{pageText.size}</span>
        </span>
      {/snippet}
      {#snippet children()}
        <label class="size-row">
          <span class="size-name">Size</span>
          <input
            class="more-slider"
            type="range"
            min="8"
            max="80"
            step="1"
            value={pageText.size}
            oninput={(event) => setPageText({ size: +event.target.value })}
            aria-label={`${pageText.label} text size`}
          />
          <span class="size-num">{pageText.size}</span>
        </label>
        <div class="swatches">
          <button
            class="color-btn color-auto"
            class:active={!pageText.color}
            style:background={pageText.auto}
            title="The colour the background gives"
            aria-label={`${pageText.label} colour auto`}
            onclick={() => setPageText({ color: null })}
          >A</button>
          {#each [...new Set(['#ffffff', '#0d1117', ...palette])] as entry (entry)}
            <button
              class="color-btn"
              class:active={pageText.color === entry}
              style:background={entry}
              aria-label={`${pageText.label} colour ${entry}`}
              onclick={() => setPageText({ color: entry })}
            ></button>
          {/each}
          <label class="color-btn color-pick" style:background={pageText.color ?? pageText.auto} title="Custom colour">
            <Icon name="plus" size={12} />
            <input
              type="color"
              value={pageText.color ?? pageText.auto}
              oninput={(event) => setPageText({ color: event.target.value })}
              aria-label={`${pageText.label} custom colour`}
            />
          </label>
        </div>
      {/snippet}
    </ToolbarFlyout>
  {/if}

  <!-- A picked panel or overlay: the border drawn round its picture. -->
  {#if surfaceBorder !== undefined}
    <div class="tb-sep"></div>
    <ToolbarFlyout title="Border" active={!!surfaceBorder}>
      {#snippet button()}
        <span class="tb-border" style:border-color={surfaceBorder?.color ?? 'currentColor'}></span>
      {/snippet}
      {#snippet children(close)}
        <div class="swatches">
          {#each palette as entry (entry)}
            <button
              class="color-btn"
              class:active={surfaceBorder?.color === entry}
              style:background={entry}
              aria-label={`border ${entry}`}
              onclick={() => setSurfaceBorder({ color: entry })}
            ></button>
          {/each}
          <label class="color-btn color-pick" style:background={surfaceBorder?.color ?? 'transparent'} title="Custom border colour">
            <Icon name="plus" size={12} />
            <input
              type="color"
              value={surfaceBorder?.color ?? palette[0]}
              oninput={(event) => setSurfaceBorder({ color: event.target.value })}
              aria-label="border color"
            />
          </label>
        </div>
        {#if surfaceBorder}
          <input
            class="stroke-slider"
            type="range"
            min="1"
            max={frameWidthMax}
            step="1"
            value={surfaceBorder.width}
            oninput={(event) => setSurfaceBorder({ width: +event.target.value })}
            aria-label="border thickness"
            title="Border thickness"
          />
          <button class="btn btn-ghost btn-sm" onclick={() => { setSurfaceBorder(null); close(); }}>No border</button>
        {/if}
      {/snippet}
    </ToolbarFlyout>
  {/if}

  {#if showLens}
    <div class="tb-sep"></div>
    <!-- The camera's lens, each drawn as the wedge it opens, and how the phone
         was held: what an analyst knows of a camera, rather than its degrees. -->
    <ToolbarFlyout title="Lens">
      {#snippet button()}
        <span class="tb-cam">
          <svg width="22" height="13" viewBox="0 0 22 13" aria-hidden="true">
            <path d={wedgePath(activeLens.fov, 22, 13)} />
          </svg>
          <span class="tb-lens">{activeLens.lens ? `${activeLens.lens}×` : `${Math.round(activeLens.fov)}°`}</span>
        </span>
      {/snippet}
      {#snippet children(close)}
        <div class="cam">
          <span class="cam-head">Lens</span>
          <div class="lens-grid">
            {#each LENSES as lens (lens.id)}
              {@const fov = lensFov(lens.id, activeLens.upright)}
              <button
                class="lens-tile"
                class:active={activeLens.lens === lens.id}
                title={`${lens.label} · ${lens.mm} mm`}
                aria-label={lens.label}
                onclick={() => { setLens({ lens: lens.id }); close(); }}
              >
                <svg width="40" height="24" viewBox="0 0 40 24" aria-hidden="true">
                  <path d={wedgePath(fov, 40, 24)} />
                </svg>
                <span class="lens-x">{lens.id}×</span>
                <span class="lens-fov">{Math.round(fov)}°</span>
              </button>
            {/each}
          </div>
          <span class="cam-head">Held</span>
          <div class="held">
            <label class="held-opt" class:active={!activeLens.upright} title="Landscape">
              <input type="radio" name="cone-held" checked={!activeLens.upright} aria-label="Landscape"
                onchange={() => setLens({ upright: false })} />
              <svg width="22" height="14" viewBox="0 0 22 14" aria-hidden="true">
                <rect x="1" y="1.5" width="20" height="11" rx="2.2" /><circle cx="4.5" cy="7" r="1" />
              </svg>
              Landscape
            </label>
            <label class="held-opt" class:active={activeLens.upright} title="Phone held upright">
              <input type="radio" name="cone-held" checked={activeLens.upright} aria-label="Phone held upright"
                onchange={() => setLens({ upright: true })} />
              <svg width="14" height="20" viewBox="0 0 14 20" aria-hidden="true">
                <rect x="1.5" y="1" width="11" height="18" rx="2.2" /><circle cx="7" cy="4.5" r="1" />
              </svg>
              Upright
            </label>
          </div>
          {#if !activeLens.lens}
            <span class="lens-own">Set by hand: {Math.round(activeLens.fov)}°</span>
          {/if}
        </div>
      {/snippet}
    </ToolbarFlyout>
  {/if}

  {#if showTag}
    <div class="tb-sep"></div>
    <div class="tb-group" bind:this={tagEl}>
      <button
        class="tb-btn"
        class:active={tagOpen || activeTag !== 'none'}
        title="Tag"
        onclick={() => toggle('tag')}
        bind:this={tagBtn}
      >
        <Icon name={tagIcon} size={18} />
      </button>
      <div
        class="flyout flyout-tails"
        class:open={tagOpen}
        style:left={tagPos.left}
        style:top={tagPos.top}
        style:bottom={tagPos.bottom}
      >
        {#each TAGS.filter((t) => activeTag !== 'none' || t.id !== 'none') as entry (entry.id)}
          <button
            class="tb-btn"
            class:active={activeTag === entry.id}
            title={entry.label}
            aria-label={entry.label}
            onclick={() => { setTagAt(entry.id); tagOpen = false; }}
          >
            <Icon name={entry.icon} size={18} />
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if showTail}
    <div class="tb-sep"></div>
    <div class="tb-group" bind:this={tailEl}>
      <button
        class="tb-btn"
        class:active={tailOpen}
        title="Pointer"
        onclick={() => toggle('tail')}
        bind:this={tailBtn}
      >
        <Icon name={tailIcon} size={18} />
      </button>
      <div
        class="flyout flyout-tails"
        class:open={tailOpen}
        style:left={tailPos.left}
        style:top={tailPos.top}
        style:bottom={tailPos.bottom}
      >
        {#each TAILS.filter((t) => tailNone || t.id !== 'none') as entry (entry.id)}
          <button
            class="tb-btn"
            class:active={activeTail === entry.id}
            title={entry.label}
            aria-label={entry.label}
            onclick={() => { setTail(entry.id); tailOpen = false; }}
          >
            <Icon name={entry.icon} size={18} />
          </button>
        {/each}
      </div>
    </div>
  {/if}

</div>

<style>
  /* Two columns, always. In one column the rail stood around 750px tall, which
     is past the bottom of a laptop window once the topbar and the tab strip have
     taken their share — the colour, the width and the layout controls sat under
     the fold behind a scrollbar nobody looks for. Fixed rather than responsive: a
     toolbar that changes shape with the window is one nobody learns.
     The second column is paid for out of the buttons rather than the canvas: at
     the size they were, the rail read as a slab beside the picture it serves. A
     32px box still holds an 18px icon with room around it, and the whole rail
     ends up 26px wider than the single column it replaces, against some 400px of
     height it gives back.
     The groups the separators mark are kept by the grid itself — a separator
     spans both columns, so the buttons between two of them fill their own rows
     and read left to right, then down. */
  .toolbar {
    width: 76px;
    flex-shrink: 0;
    display: grid;
    grid-template-columns: repeat(2, 32px);
    justify-content: center;
    align-content: start;
    gap: 4px;
    padding: 8px 0;
    border-right: 1px solid var(--border);
    background: var(--bg-1);
    overflow-y: auto;
    overflow-x: hidden;
  }
  .tb-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-sm);
    color: var(--text-3);
    flex-shrink: 0;
  }
  .tb-btn:hover { color: var(--text-1); background: var(--bg-2); }
  /* The tool in hand is a selection, which is what the amber is for elsewhere in
     the app. Grey on grey said "pressed" and left the rail's own state to be
     worked out from the cursor. */
  .tb-btn.active { color: var(--accent); background: var(--accent-soft); }
  .tb-guide { font-size: 11px; font-weight: 700; }
  .tb-magic:not(:disabled) { color: var(--accent); }
  .tb-magic:not(:disabled):hover { background: var(--accent-soft); }
  .tb-magic:disabled { opacity: 0.4; cursor: default; }
  /* A hairline across the rail rather than a stub under one column: it is the
     only thing marking the groups, so it reads as a rule and not as a stray mark. */
  .tb-sep {
    grid-column: 1 / -1;
    justify-self: stretch;
    margin: 3px 4px;
    height: 1px;
    background: var(--border);
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
  .flyout-tails { gap: 6px; }
  /* Sizes: one labelled row per size the pick has. */
  .size-rows { display: flex; flex-direction: column; gap: 6px; }
  .size-row { display: grid; grid-template-columns: 58px 1fr 26px; align-items: center; gap: 8px; }
  .size-name { font-size: var(--fs-xs); color: var(--text-3); }
  .size-num { font-size: var(--fs-xs); color: var(--text-2); text-align: right; font-variant-numeric: tabular-nums; }

  /* The camera: lens tiles drawn as the wedge each opens, and how it was held. */
  .tb-cam { display: flex; flex-direction: column; align-items: center; gap: 1px; }
  .tb-cam svg path { fill: color-mix(in srgb, currentColor 22%, transparent); stroke: currentColor; stroke-width: 1.4; stroke-linejoin: round; }
  .tb-lens { font-size: 9px; font-weight: 700; line-height: 1; color: var(--text-2); }
  .cam { display: flex; flex-direction: column; gap: 6px; width: 236px; }
  .cam-head { font-size: var(--fs-xs); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--text-3); }
  .lens-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; }
  .lens-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 6px 2px 5px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    color: var(--text-2);
    background: var(--bg-2);
    transition: border-color 0.12s var(--ease), color 0.12s var(--ease);
  }
  .lens-tile:hover { color: var(--text-1); border-color: var(--text-3); }
  .lens-tile.active { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
  .lens-tile svg path { fill: color-mix(in srgb, currentColor 20%, transparent); stroke: currentColor; stroke-width: 1.3; stroke-linejoin: round; }
  .lens-x { font-size: var(--fs-sm); font-weight: 700; line-height: 1.1; }
  .lens-fov { font-size: 10px; color: var(--text-3); font-variant-numeric: tabular-nums; }
  .held { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
  .held-opt {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    height: 34px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    font-size: var(--fs-sm);
    color: var(--text-2);
    cursor: pointer;
  }
  .held-opt:hover { color: var(--text-1); border-color: var(--text-3); }
  .held-opt.active { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
  .held-opt input { position: absolute; opacity: 0; pointer-events: none; }
  .held-opt svg { fill: none; stroke: currentColor; stroke-width: 1.5; }
  .held-opt svg circle { fill: currentColor; stroke: none; }
  .lens-own { font-size: var(--fs-xs); color: var(--text-3); }

  .tb-text { display: flex; flex-direction: column; align-items: center; gap: 1px; }
  .tb-text-val { font-size: 9px; font-weight: 700; line-height: 1; color: var(--text-3); }
  .color-auto { font-size: 10px; font-weight: 700; color: var(--bg-0); border-color: var(--border); }
  .swatches { display: flex; flex-wrap: wrap; gap: 8px; width: 132px; align-items: center; }
  .color-none { display: flex; align-items: center; justify-content: center; color: var(--text-3); border-color: var(--border); }
  .tb-plate, .tb-border {
    width: 18px;
    height: 18px;
    border-radius: 4px;
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .tb-border { border: 3px solid; box-shadow: none; background: transparent; }
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
  .more-slider,
  .fill-slider {
    width: 140px;
    accent-color: var(--accent);
  }
  .tb-btn:disabled { opacity: 0.35; cursor: default; }
  .tb-btn:disabled:hover { color: var(--text-3); background: none; }
</style>
