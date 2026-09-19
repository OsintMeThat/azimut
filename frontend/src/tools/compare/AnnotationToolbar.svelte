<script>
  import Icon from '../../components/Icon.svelte';
  import ProofGlyph from '../../components/ProofGlyph.svelte';
  import { PROOF_ICONS, isSolidIcon } from '../../lib/proofIcons.js';
  import { STAMPED, canFill, ANNOTATION_TOOLS } from '../../lib/map/compareAnnotations.js';

  let {
    tool = $bindable(),
    glyph = PROOF_ICONS[0].name,
    setGlyph = () => {},
    stampSize = 16,
    selected = null,
    canUndo = false,
    canRedo = false,
    undo = () => {},
    redo = () => {},
    palette = [],
    colour,
    strokeWidth,
    fillOpacity,
    setColour = () => {},
    setStroke = () => {},
    setOutline = () => {},
    setFill = () => {},
    removeSelected = () => {},
    clear = () => {},
    count = 0,
    side = $bindable('both'),
    setSide = () => {},
  } = $props();

  const contextual = $derived(tool !== 'select' || Boolean(selected));
  const fillable = $derived(canFill(selected?.kind ?? tool));
  // A note and a stamp are sized by their own number: neither has a line to
  // widen, so the one slider sets that instead of a stroke width.
  const sizedByFont = $derived(
    selected ? (selected.kind === 'text' || STAMPED.has(selected.kind))
      : (tool === 'text' || STAMPED.has(tool))
  );
  const sizeValue = $derived(sizedByFont
    ? (selected?.font_size ?? stampSize)
    : (selected?.stroke_width ?? strokeWidth));
  // A symbol has both: how big it is drawn, and how heavy the line it is drawn
  // with. A silhouette is a shape with no line, so it takes the size alone.
  const outlined = $derived(
    (selected ? selected.kind === 'icon' : tool === 'icon')
      && !isSolidIcon(selected?.glyph ?? glyph)
  );
  const outlineValue = $derived(selected?.stroke_width ?? strokeWidth);
  let open = $state('');
  let flyout = $state({});
  // The panel floats free of the rail, so closing it on an outside press needs
  // both halves: the panel itself, and the button that opened it. Leaving the
  // button out would close the panel on the way down and let its own click
  // reopen it, which reads as a button that does nothing.
  let flyoutEl = $state();
  let opener = $state(null);

  function toggle(name, event) {
    open = open === name ? '' : name;
    opener = open ? event.currentTarget : null;
    if (!open) return;
    const box = event.currentTarget.getBoundingClientRect();
    flyout = box.top > window.innerHeight / 2
      ? { left: `${box.right + 6}px`, bottom: `${window.innerHeight - box.bottom}px` }
      : { left: `${box.right + 6}px`, top: `${box.top}px` };
  }

  // The colour and size buttons vanish when the analyst goes back to Select with
  // nothing selected, or deletes what was selected. Drop the panel with them
  // rather than leaving it floating over the maps with nothing behind it.
  $effect(() => {
    if (!contextual || (open === 'fill' && !fillable) || (open === 'outline' && !outlined)) open = '';
  });

  $effect(() => {
    if (!open) return;
    const key = (event) => {
      if (event.key === 'Escape') open = '';
    };
    const outside = (event) => {
      if (flyoutEl?.contains(event.target) || opener?.contains(event.target)) return;
      open = '';
    };
    document.addEventListener('keydown', key);
    document.addEventListener('mousedown', outside, true);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('mousedown', outside, true);
    };
  });
</script>

<aside class="annotation-toolbar" aria-label="Comparison annotation tools">
  <button class="tool-button" title="Undo (Ctrl+Z)" disabled={!canUndo} onclick={undo}><Icon name="undo" size={18} /></button>
  <button class="tool-button" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onclick={redo}><Icon name="redo" size={18} /></button>
  <div class="separator"></div>
  <!-- Pressing the tool in hand puts it down: the way out of a drawing tool was
       aiming at the cursor button, and the button you are already on is the
       easier target of the two. -->
  {#each ANNOTATION_TOOLS as entry (entry.id)}
    {#if entry.id === 'icon'}
      <!-- The symbol button takes the tool like every other button on the rail,
           and opens the grid with it: coming back to the stamp never costs
           re-picking a glyph already chosen. -->
      <button
        class="tool-button"
        class:active={tool === 'icon'}
        aria-pressed={tool === 'icon'}
        title={`${entry.label} (${entry.shortcut})`}
        onclick={(event) => {
          // With the stamp in hand and the grid shut, the press opens the grid
          // again: changing a glyph never costs the tool. The press with the grid
          // open is the one that puts the stamp down.
          if (tool === 'icon' && open === 'glyph') { tool = 'select'; open = ''; return; }
          tool = 'icon';
          toggle('glyph', event);
        }}
      ><ProofGlyph name={glyph} size={18} /></button>
    {:else}
      <button
        class="tool-button"
        class:active={tool === entry.id}
        aria-pressed={tool === entry.id}
        title={`${entry.label} (${entry.shortcut})`}
        onclick={() => (tool = tool === entry.id ? 'select' : entry.id)}
      ><Icon name={entry.icon} size={18} /></button>
    {/if}
  {/each}

  {#if contextual}
    <div class="separator"></div>
    <select aria-label="Annotation side" value={selected?.side ?? side} onchange={(event) => setSide(event.currentTarget.value)}>
      <option value="both">A/B</option><option value="a">A</option><option value="b">B</option>
    </select>
    <button class="tool-button" title="Annotation colour" onclick={(event) => toggle('colour', event)}>
      <span class="swatch" style:background={selected?.colour ?? colour}></span>
    </button>
    <button class="tool-button sized" title={sizedByFont ? 'Size' : 'Stroke width'} onclick={(event) => toggle('size', event)}>
      <Icon name="sliders" size={17} /><small>{sizeValue}</small>
    </button>
    {#if outlined}
      <button class="tool-button sized" title="Outline width" onclick={(event) => toggle('outline', event)}>
        <Icon name="line" size={17} /><small>{outlineValue}</small>
      </button>
    {/if}
    {#if fillable}
      <button class="tool-button sized" title="Fill opacity" onclick={(event) => toggle('fill', event)}>
        <span class="fill-sample" style:opacity={selected?.fill_opacity ?? fillOpacity}></span>
        <small>{Math.round((selected?.fill_opacity ?? fillOpacity) * 100)}</small>
      </button>
    {/if}
  {/if}

  {#if selected}
    <div class="separator"></div>
    <button class="tool-button danger" title="Delete selected annotation" onclick={removeSelected}><Icon name="trash" size={18} /></button>
  {/if}
  {#if count}
    <button class="tool-button" title="Clear all annotations" onclick={clear}><Icon name="reset" size={18} /></button>
  {/if}
</aside>

{#if open === 'glyph'}
  <div class="flyout glyphs" bind:this={flyoutEl} style:left={flyout.left} style:top={flyout.top} style:bottom={flyout.bottom}>
    {#each PROOF_ICONS as entry (entry.name)}
      <button
        class="glyph-button"
        class:active={glyph === entry.name}
        title={entry.label}
        aria-label={entry.label}
        onclick={() => { setGlyph(entry.name); open = ''; }}
      ><ProofGlyph name={entry.name} size={20} /></button>
    {/each}
  </div>
{:else if open === 'colour'}
  <div class="flyout colours" bind:this={flyoutEl} style:left={flyout.left} style:top={flyout.top} style:bottom={flyout.bottom}>
    {#each palette as entry (entry)}
      <button
        class="colour-button"
        class:active={(selected?.colour ?? colour) === entry}
        style:background={entry}
        aria-label={`Colour ${entry}`}
        onclick={() => { setColour(entry); open = ''; }}
      ></button>
    {/each}
    <label class="colour-button custom" style:background={selected?.colour ?? colour} title="Custom colour">
      <Icon name="plus" size={12} />
      <input type="color" value={selected?.colour ?? colour} oninput={(event) => setColour(event.currentTarget.value)} />
    </label>
  </div>
{:else if open === 'size'}
  <div class="flyout slider" bind:this={flyoutEl} style:left={flyout.left} style:top={flyout.top} style:bottom={flyout.bottom}>
    <input
      type="range"
      min="1"
      max={sizedByFont ? 72 : 24}
      value={sizeValue}
      aria-label={sizedByFont ? 'Size' : 'Stroke width'}
      oninput={(event) => setStroke(Number(event.currentTarget.value))}
    />
  </div>
{:else if open === 'outline'}
  <div class="flyout slider" bind:this={flyoutEl} style:left={flyout.left} style:top={flyout.top} style:bottom={flyout.bottom}>
    <input
      type="range"
      min="1"
      max="24"
      value={outlineValue}
      aria-label="Outline width"
      oninput={(event) => setOutline(Number(event.currentTarget.value))}
    />
  </div>
{:else if open === 'fill'}
  <div class="flyout slider" bind:this={flyoutEl} style:left={flyout.left} style:top={flyout.top} style:bottom={flyout.bottom}>
    <input
      type="range"
      min="0"
      max="100"
      step="5"
      value={Math.round((selected?.fill_opacity ?? fillOpacity) * 100)}
      aria-label="Fill opacity"
      oninput={(event) => setFill(Number(event.currentTarget.value) / 100)}
    />
  </div>
{/if}

<style>
  /* Two columns, like the Proof Maker rail this follows. In one column the nine
     tools plus the contextual controls ran past the bottom of a laptop window
     once the mode dock and the source cards had taken their share, and the
     colour and width buttons sat under a scrollbar nobody looks for. The second
     column is paid for out of the buttons rather than the stage: a 32px box
     still holds an 18px icon with room around it, so the rail ends up 24px
     wider and roughly half as tall. A separator spans both columns, so the
     groups it marks are kept by the grid itself. */
  .annotation-toolbar {
    position: relative;
    z-index: 610;
    width: 76px;
    flex: 0 0 76px;
    display: grid;
    grid-template-columns: repeat(2, 32px);
    justify-content: center;
    align-content: start;
    gap: 4px;
    padding: 8px 0;
    overflow-y: auto;
    overflow-x: hidden;
    border-right: 1px solid var(--border);
    background: var(--bg-1);
  }
  .tool-button {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: var(--r-sm);
    color: var(--text-3);
  }
  .tool-button:hover:not(:disabled), .tool-button.active { color: var(--accent); background: var(--bg-3); }
  .tool-button:disabled { opacity: .3; }
  .tool-button.danger:hover { color: var(--danger); }
  .tool-button.sized { position: relative; }
  .tool-button.sized small {
    position: absolute;
    right: 2px;
    bottom: 1px;
    min-width: 14px;
    color: var(--text-3);
    font-size: 8px;
    line-height: 1;
  }
  .separator {
    grid-column: 1 / -1;
    justify-self: stretch;
    height: 1px;
    margin: 3px 4px;
    background: var(--border);
  }
  .swatch { width: 19px; height: 19px; border: 2px solid rgba(255,255,255,.68); border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,.5); }
  .fill-sample { width: 20px; height: 17px; border: 2px solid currentColor; border-radius: 2px; background: currentColor; }
  .flyout {
    position: fixed;
    z-index: 1200;
    padding: 8px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-md);
    background: var(--bg-2);
    box-shadow: var(--shadow-2);
  }
  .colours { display: grid; grid-template-columns: repeat(3, 28px); gap: 7px; }
  .glyphs { display: grid; grid-template-columns: repeat(5, 30px); gap: 4px; }
  .glyph-button {
    width: 30px;
    height: 30px;
    display: grid;
    place-items: center;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    color: var(--text-2);
    cursor: pointer;
  }
  .glyph-button:hover { border-color: var(--border); color: var(--text-1); }
  .glyph-button.active { border-color: var(--accent); color: var(--text-1); background: var(--bg-3); }
  .colour-button { width: 28px; height: 28px; border: 2px solid transparent; border-radius: 50%; }
  .colour-button.active { border-color: #fff; box-shadow: 0 0 0 1px var(--accent); }
  .colour-button.custom { position: relative; display: grid; place-items: center; color: white; cursor: pointer; }
  .colour-button input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .slider { width: 180px; }
  .slider input { width: 100%; accent-color: var(--accent); }
  /* Which picture a mark belongs to is a word, not an icon, so it takes the
     whole width rather than being squeezed into one 32px cell. */
  select {
    grid-column: 1 / -1;
    justify-self: stretch;
    height: 24px;
    color: var(--text-1);
    background: var(--bg-2);
    font-size: 10px;
  }
</style>
