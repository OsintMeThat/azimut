<script>
  /**
   * The palette a personal-layer style is picked from: the styles the layer
   * already shows, then the colours, then the icons with a search. Every pick
   * is handed back at once (`onpick`); where it lands is the caller's.
   *
   * The icons run from the layer's own to the app's: the icons the layer holds
   * that the library does not (a copied map's), then the analyst's library,
   * group by group, then the app's badges. An own icon is picked as `{ icon }`,
   * one of the app's as `{ symbol, icon: '' }`, which takes an own icon off.
   *
   * Opened from a style button (`LayerStyleButton`), and laid out inline in a
   * Geo Proof point's menu, where an icon is chosen before the point is added.
   */
  import Icon from '../../components/Icon.svelte';
  import MarkerSymbol from './MarkerSymbol.svelte';
  import LayerPaletteEditor from './LayerPaletteEditor.svelte';
  import choices from '../../lib/map/layerSymbols.json';
  import { PLAIN_COLOURS, layerPalette } from '../../lib/map/layerPalette.svelte.js';
  import { DEFAULT_GROUP, iconLibrary } from '../../lib/iconLibrary.svelte.js';
  import { openIconSettings } from '../../lib/navigate.js';
  import { ICON_HELP } from '../../lib/map/layerHelp.js';

  let {
    label, symbol = 'pin', colour = '#0072b2', point = true, mixed = false,
    /** The own icon worn now, '' for none. */
    icon = '',
    /** Styles already in the layer, `{ symbol, colour, icon? }`, offered first. */
    used = [],
    caseId = null,
    /** The layer the pick lands in, whose own icons are offered; its `{key: {mode, name}}`. */
    layer = null, meta = null,
    /** Whether own icons are offered at all: a plate's symbol is drawn from the app's only. */
    own = true,
    onpick,
  } = $props();
  let query = $state('');
  let naming = $state(false);
  $effect(() => { if (point && own) iconLibrary.load(); });
  $effect(() => { if (point && own && caseId && layer) iconLibrary.loadLayer(caseId, layer); });
  const words = $derived(query.toLowerCase().trim().split(/\s+/).filter(Boolean));
  const matches = (text) => words.every((word) => text.toLowerCase().includes(word));
  const swatches = $derived(layerPalette.colours.length ? layerPalette.colours.map((entry) => [entry.colour, entry.name]) : PLAIN_COLOURS);
  const visible = $derived(choices.filter((choice) => matches(`${choice.label} ${choice.group} ${(choice.keywords ?? []).join(' ')}`)));
  // Themed while browsing; a search answers with one flat run of matches.
  const sections = $derived(words.length ? [{ group: '', items: visible }]
    : [...new Set(choices.map((choice) => choice.group))].map((theme) => ({ group: theme, items: choices.filter((choice) => choice.group === theme) })));
  const look = (key) => iconLibrary.look(key, { caseId, layer, meta });
  /** The layer's own icons the library does not hold, most worn first. */
  const layerOwn = $derived(point && own && caseId && layer
    ? iconLibrary.layerIcons(caseId, layer).filter((held) => !iconLibrary.holds(held.key, held.digest)
      && matches(`${held.name} ${ICON_HELP.layerIcons}`))
    : []);
  const library = $derived(point && own ? iconLibrary.icons.filter((entry) => matches(`${entry.name} ${entry.group}`)) : []);
  const libraryGroups = $derived([...new Set(library.map((entry) => entry.group || DEFAULT_GROUP))]
    .map((group) => ({ group, items: library.filter((entry) => (entry.group || DEFAULT_GROUP) === group) })));
  const offered = $derived(used.filter((style) => point || style.colour).slice(0, 12));
  const colourName = $derived(layerPalette.nameOf(colour));
  const worn = $derived(icon ? look(icon) : null);
  const same = (first, second) => String(first ?? '').toLowerCase() === String(second ?? '').toLowerCase();
  const styleName = (style) => (style.icon ? look(style.icon)?.name || 'own icon' : choices.find((choice) => choice.id === style.symbol)?.label ?? 'line');
  const usedChosen = (style) => !mixed && same(style.colour, colour) && (style.icon ? style.icon === icon : !icon && style.symbol === symbol);
  $effect(() => { if (caseId) layerPalette.load(caseId); });
</script>

{#if offered.length > 1}
  <p class="fm-head">In this layer</p>
  <div class="used">
    {#each offered as style (`${style.icon ?? ''}${style.symbol}${style.colour}`)}
      <button type="button" aria-label={`${label} as ${styleName(style)} in ${layerPalette.nameOf(style.colour) || style.colour}`}
        class:chosen={usedChosen(style)}
        onclick={() => onpick?.(point ? (style.icon ? { icon: style.icon, colour: style.colour } : { symbol: style.symbol, icon: '', colour: style.colour }) : { colour: style.colour })}>
        {#if point}<MarkerSymbol symbol={style.symbol} colour={style.colour} icon={style.icon ? look(style.icon) : null} size={22} />
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
{#if point && worn?.mode === 'image' && !mixed}<p class="colour-name keeps">{ICON_HELP.keepsColours}</p>{/if}
{#if naming && caseId}<LayerPaletteEditor {caseId} defaults={PLAIN_COLOURS} onclose={() => (naming = false)} />{/if}
{#if point}
  <p class="fm-head">Icon</p>
  <input type="search" class="find" aria-label={`${label} find icon`} bind:value={query} placeholder="Find an icon" />
  <div class="icons" role="group" aria-label={`${label} icon palette`}>
    {#if layerOwn.length}
      <p class="theme" title={ICON_HELP.layerIconsHint}>{ICON_HELP.layerIcons}</p>
      {#each layerOwn as held (held.key)}
        {@const shown = iconLibrary.look(held.key, { caseId, layer, mode: held.mode })}
        <button type="button" class:chosen={!mixed && icon === held.key} title={held.name || ICON_HELP.layerIcon}
          aria-label={`${label} ${held.name || ICON_HELP.layerIcon} icon, this layer`} aria-pressed={!mixed && icon === held.key}
          onclick={() => onpick?.({ icon: held.key })}>
          <MarkerSymbol {colour} icon={shown} size={24} />
        </button>
      {/each}
    {/if}
    {#each libraryGroups as section (section.group)}
      <p class="theme">{section.group}</p>
      {#each section.items as entry (entry.key)}
        <button type="button" class:chosen={!mixed && icon === entry.key} title={entry.name}
          aria-label={`${label} ${entry.name} icon, ${entry.group || DEFAULT_GROUP}`} aria-pressed={!mixed && icon === entry.key}
          onclick={() => onpick?.({ icon: entry.key })}>
          <MarkerSymbol {colour} icon={look(entry.key)} size={24} />
        </button>
      {/each}
    {/each}
    {#if own && iconLibrary.loaded && !iconLibrary.icons.length && !words.length}
      <p class="theme own-hint">{ICON_HELP.noLibrary}
        <button type="button" class="link" title={ICON_HELP.openSettings} onclick={openIconSettings}>Import icons</button></p>
    {/if}
    {#each sections as section (section.group)}
      {#if section.group}<p class="theme">{section.group}</p>{/if}
      {#each section.items as choice (choice.id)}
        <button type="button" class:chosen={!mixed && !icon && choice.id === symbol} title={choice.label}
          aria-label={`${label} ${choice.label} icon`} aria-pressed={!mixed && !icon && choice.id === symbol}
          onclick={() => onpick?.(own ? { symbol: choice.id, icon: '' } : { symbol: choice.id })}>
          <MarkerSymbol symbol={choice.id} {colour} size={24} />
        </button>
      {/each}
    {/each}
  </div>
  {#if !visible.length && !library.length && !layerOwn.length}<p class="fm-note">No icons match.</p>{/if}
{/if}

<style>
  .dot { width: 14px; height: 14px; border-radius: 3px; background: var(--swatch); border: 1px solid #0004; }
  .used { display: flex; flex-wrap: wrap; gap: 3px; padding: 0 4px 4px; }
  .used button, .icons button:not(.link) { display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--r-sm); cursor: pointer; }
  .used button:hover, .icons button:not(.link):hover, .used .chosen, .icons .chosen { background: var(--bg-3); outline: 1px solid var(--accent); }
  .palette { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 2px 6px 4px; }
  .swatch { width: 18px; height: 18px; border-radius: 50%; background: var(--swatch); border: 1px solid #0003; cursor: pointer; }
  .swatch.chosen { outline: 2px solid var(--text-1); outline-offset: 2px; }
  input[type='color'] { width: 26px; height: 24px; padding: 1px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); cursor: pointer; }
  .name-colours { display: grid; place-items: center; width: 24px; height: 24px; margin-left: auto; border-radius: var(--r-sm); color: var(--text-3); cursor: pointer; }
  .name-colours:hover, .name-colours[aria-expanded='true'] { background: var(--bg-3); color: var(--text-1); }
  .colour-name { margin: 0 8px 4px; color: var(--text-2); font-size: 11px; }
  .colour-name.keeps { color: var(--text-3); }
  .find { width: calc(100% - 8px); margin: 0 4px; height: 26px; padding: 4px 6px; font-size: var(--fs-xs); }
  .icons { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; max-height: 232px; margin-top: 5px; padding: 1px 2px; overflow-y: auto; }
  .theme { grid-column: 1 / -1; margin: 4px 2px 0; font-size: 10px; color: var(--text-3); }
  .theme:first-child { margin-top: 0; }
  .own-hint { line-height: 1.5; }
  .link { padding: 0; border: 0; background: none; color: var(--accent); font: inherit; cursor: pointer; text-decoration: underline; }
</style>
