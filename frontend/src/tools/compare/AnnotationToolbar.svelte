<script>
  import Icon from '../../components/Icon.svelte';
  import { canFill, ANNOTATION_TOOLS } from '../../lib/map/compareAnnotations.js';

  let {
    tool = $bindable(),
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
    setFill = () => {},
    removeSelected = () => {},
    clear = () => {},
    count = 0,
    side = $bindable('both'),
    setSide = () => {},
  } = $props();

  const contextual = $derived(tool !== 'select' || Boolean(selected));
  const fillable = $derived(canFill(selected?.kind ?? tool));
  const sizeValue = $derived(selected?.kind === 'text'
    ? (selected.font_size ?? 20)
    : (selected?.stroke_width ?? strokeWidth));
  let open = $state('');
  let flyout = $state({});

  function toggle(name, event) {
    open = open === name ? '' : name;
    if (!open) return;
    const box = event.currentTarget.getBoundingClientRect();
    flyout = box.top > window.innerHeight / 2
      ? { left: `${box.right + 6}px`, bottom: `${window.innerHeight - box.bottom}px` }
      : { left: `${box.right + 6}px`, top: `${box.top}px` };
  }

  $effect(() => {
    if (!open) return;
    const close = (event) => {
      if (event.key === 'Escape') open = '';
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  });
</script>

<aside class="annotation-toolbar" aria-label="Comparison annotation tools">
  <button class="tool-button" title="Undo (Ctrl+Z)" disabled={!canUndo} onclick={undo}><Icon name="undo" size={18} /></button>
  <button class="tool-button" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onclick={redo}><Icon name="redo" size={18} /></button>
  <div class="separator"></div>
  {#each ANNOTATION_TOOLS as entry (entry.id)}
    <button
      class="tool-button"
      class:active={tool === entry.id}
      aria-pressed={tool === entry.id}
      title={`${entry.label} (${entry.shortcut})`}
      onclick={() => (tool = entry.id)}
    ><Icon name={entry.icon} size={18} /></button>
  {/each}

  {#if contextual}
    <div class="separator"></div>
    <select aria-label="Annotation side" value={selected?.side ?? side} onchange={(event) => setSide(event.currentTarget.value)}>
      <option value="both">A/B</option><option value="a">A</option><option value="b">B</option>
    </select>
    <button class="tool-button" title="Annotation colour" onclick={(event) => toggle('colour', event)}>
      <span class="swatch" style:background={selected?.colour ?? colour}></span>
    </button>
    <button class="tool-button sized" title={selected?.kind === 'text' ? 'Font size' : 'Stroke width'} onclick={(event) => toggle('size', event)}>
      <Icon name="sliders" size={17} /><small>{sizeValue}</small>
    </button>
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

{#if open === 'colour'}
  <div class="flyout colours" style:left={flyout.left} style:top={flyout.top} style:bottom={flyout.bottom}>
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
  <div class="flyout slider" style:left={flyout.left} style:top={flyout.top} style:bottom={flyout.bottom}>
    <input
      type="range"
      min="1"
      max={selected?.kind === 'text' ? 72 : 24}
      value={sizeValue}
      aria-label={selected?.kind === 'text' ? 'Font size' : 'Stroke width'}
      oninput={(event) => setStroke(Number(event.currentTarget.value))}
    />
  </div>
{:else if open === 'fill'}
  <div class="flyout slider" style:left={flyout.left} style:top={flyout.top} style:bottom={flyout.bottom}>
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
  .annotation-toolbar {
    position: relative;
    z-index: 610;
    width: 52px;
    flex: 0 0 52px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 7px 6px;
    overflow-y: auto;
    border-right: 1px solid var(--border);
    background: var(--bg-1);
  }
  .tool-button {
    width: 38px;
    height: 38px;
    flex: 0 0 38px;
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
  .separator { width: 28px; height: 1px; flex: 0 0 1px; margin: 3px 0; background: var(--border); }
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
  .colour-button { width: 28px; height: 28px; border: 2px solid transparent; border-radius: 50%; }
  .colour-button.active { border-color: #fff; box-shadow: 0 0 0 1px var(--accent); }
  .colour-button.custom { position: relative; display: grid; place-items: center; color: white; cursor: pointer; }
  .colour-button input { position: absolute; width: 1px; height: 1px; opacity: 0; }
  .slider { width: 180px; }
  .slider input { width: 100%; accent-color: var(--accent); }
  select { width: 42px; color: var(--text-1); background: var(--bg-2); font-size: 10px; }
</style>
