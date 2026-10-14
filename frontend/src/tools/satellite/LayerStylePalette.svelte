<script>
  /**
   * The palette a personal-layer style is picked from: the styles the layer
   * already shows, then the colours, then the icons with a search. Every pick
   * is handed back at once (`onpick`); where it lands is the caller's.
   *
   * Opened from a style button (`LayerStyleButton`), and laid out inline in a
   * Geo Proof point's menu, where an icon is chosen before the point is added.
   */
  import Icon from '../../components/Icon.svelte';
  import MarkerSymbol from './MarkerSymbol.svelte';
  import LayerPaletteEditor from './LayerPaletteEditor.svelte';
  import choices from '../../lib/map/layerSymbols.json';
  import { PLAIN_COLOURS, layerPalette } from '../../lib/map/layerPalette.svelte.js';

  let {
    label, symbol = 'pin', colour = '#0072b2', point = true, mixed = false,
    /** Styles already in the layer, `{ symbol, colour }`, offered first. */
    used = [],
    caseId = null, onpick,
  } = $props();
  let query = $state('');
  let naming = $state(false);
  const swatches = $derived(layerPalette.colours.length ? layerPalette.colours.map((entry) => [entry.colour, entry.name]) : PLAIN_COLOURS);
  const visible = $derived(choices.filter((choice) => {
    const text = `${choice.label} ${choice.group} ${(choice.keywords ?? []).join(' ')}`.toLowerCase();
    return query.toLowerCase().trim().split(/\s+/).every((word) => text.includes(word));
  }));
  // Themed while browsing; a search answers with one flat run of matches.
  const sections = $derived(query.trim() ? [{ group: '', items: visible }]
    : [...new Set(choices.map((choice) => choice.group))].map((theme) => ({ group: theme, items: choices.filter((choice) => choice.group === theme) })));
  const offered = $derived(used.filter((style) => point || style.colour).slice(0, 12));
  const colourName = $derived(layerPalette.nameOf(colour));
  const same = (first, second) => String(first ?? '').toLowerCase() === String(second ?? '').toLowerCase();
  $effect(() => { if (caseId) layerPalette.load(caseId); });
</script>

{#if offered.length > 1}
  <p class="fm-head">In this layer</p>
  <div class="used">
    {#each offered as style (`${style.symbol}${style.colour}`)}
      <button type="button" aria-label={`${label} as ${choices.find((choice) => choice.id === style.symbol)?.label ?? 'line'} in ${layerPalette.nameOf(style.colour) || style.colour}`}
        class:chosen={!mixed && style.symbol === symbol && same(style.colour, colour)}
        onclick={() => onpick?.(point ? { symbol: style.symbol, colour: style.colour } : { colour: style.colour })}>
        {#if point}<MarkerSymbol symbol={style.symbol} colour={style.colour} size={22} />
        {:else}<span class="dot" style={`--swatch:${style.colour}`}></span>{/if}
      </button>
    {/each}
  </div>
{/if}
<p class="fm-head">Colour</p>
<div class="palette" role="group" aria-label={`${label} palette`}>
  {#each swatches as [hex, name] (hex)}
    <button type="button" class="swatch" class:chosen={!mixed && same(hex, colour)} style={`--swatch:${hex}`}
      aria-label={`${label} ${name.toLowerCase()}`} title={name} aria-pressed={!mixed && same(hex, colour)}
      onclick={() => onpick?.({ colour: hex })}></button>
  {/each}
  <input type="color" aria-label={`${label} colour`} title="Any colour" value={colour}
    onchange={(event) => onpick?.({ colour: event.currentTarget.value })} />
  {#if caseId}
    <button type="button" class="name-colours" aria-label="Name the colours" title="Name what each colour means in this case"
      aria-expanded={naming} onclick={() => (naming = !naming)}><Icon name="tag" size={12} /></button>
  {/if}
</div>
{#if colourName && !mixed}<p class="colour-name">{colourName}</p>{/if}
{#if naming && caseId}<LayerPaletteEditor {caseId} defaults={PLAIN_COLOURS} onclose={() => (naming = false)} />{/if}
{#if point}
  <p class="fm-head">Icon</p>
  <input type="search" class="find" aria-label={`${label} find icon`} bind:value={query} placeholder="Find an icon" />
  <div class="icons" role="group" aria-label={`${label} icon palette`}>
    {#each sections as section (section.group)}
      {#if section.group}<p class="theme">{section.group}</p>{/if}
      {#each section.items as choice (choice.id)}
        <button type="button" class:chosen={!mixed && choice.id === symbol} title={choice.label}
          aria-label={`${label} ${choice.label} icon`} aria-pressed={!mixed && choice.id === symbol}
          onclick={() => onpick?.({ symbol: choice.id })}>
          <MarkerSymbol symbol={choice.id} {colour} size={24} />
        </button>
      {/each}
    {/each}
  </div>
  {#if !visible.length}<p class="fm-note">No icons match.</p>{/if}
{/if}

<style>
  .dot { width: 14px; height: 14px; border-radius: 3px; background: var(--swatch); border: 1px solid #0004; }
  .used { display: flex; flex-wrap: wrap; gap: 3px; padding: 0 4px 4px; }
  .used button, .icons button { display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--r-sm); cursor: pointer; }
  .used button:hover, .icons button:hover, .used .chosen, .icons .chosen { background: var(--bg-3); outline: 1px solid var(--accent); }
  .palette { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 2px 6px 4px; }
  .swatch { width: 18px; height: 18px; border-radius: 50%; background: var(--swatch); border: 1px solid #0003; cursor: pointer; }
  .swatch.chosen { outline: 2px solid var(--text-1); outline-offset: 2px; }
  input[type='color'] { width: 26px; height: 24px; padding: 1px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); cursor: pointer; }
  .name-colours { display: grid; place-items: center; width: 24px; height: 24px; margin-left: auto; border-radius: var(--r-sm); color: var(--text-3); cursor: pointer; }
  .name-colours:hover, .name-colours[aria-expanded='true'] { background: var(--bg-3); color: var(--text-1); }
  .colour-name { margin: 0 8px 4px; color: var(--text-2); font-size: 11px; }
  .find { width: calc(100% - 8px); margin: 0 4px; height: 26px; padding: 4px 6px; font-size: var(--fs-xs); }
  .icons { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; max-height: 232px; margin-top: 5px; padding: 1px 2px; overflow-y: auto; }
  .theme { grid-column: 1 / -1; margin: 4px 2px 0; font-size: 10px; color: var(--text-3); }
  .theme:first-child { margin-top: 0; }
</style>
