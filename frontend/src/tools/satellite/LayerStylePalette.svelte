<script>
  /**
   * The palette a personal-layer style is picked from: the styles the layer
   * already shows, then the colours, then the icons with a search. Every pick
   * is handed back at once (`onpick`); where it lands is the caller's.
   *
   * The colours offered at once are the case's named ones, each said by its
   * name, and those the layer wears; "+" unfolds the rest: the plain colours,
   * those picked lately, the browser's picker and a code typed or pasted. With
   * nothing named and nothing in the layer yet, the plain colours are offered at
   * once. The tag
   * names what the colours and icons worn here stand for (`LayerKeyButton`).
   *
   * The styles the layer shows fill one row, "+" showing the rest.
   * The icons run from the layer's own to the app's: the icons the layer holds
   * that the library does not (a copied map's), then the analyst's library,
   * group by group, then the app's badges, a chip per group scrolling the grid
   * to it. Only the grid scrolls, the colours staying in view above it. An own
   * icon is picked as `{ icon }`, one of the app's as `{ symbol, icon: '' }`,
   * which takes an own icon off.
   *
   * Opened from a style button (`LayerStyleButton`), and laid out inline in a
   * Geo Proof point's menu, where an icon is chosen before the point is added.
   */
  import Icon from '../../components/Icon.svelte';
  import MarkerSymbol from './MarkerSymbol.svelte';
  import LayerKeyButton from './LayerKeyButton.svelte';
  import HexField from '../../components/HexField.svelte';
  import { recentColours } from '../../lib/recentColours.svelte.js';
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
    /** Whether a colour is offered: a group in one colour gives its own. */
    colours = true,
    onpick,
  } = $props();
  let query = $state('');
  let grid = $state(null);
  /** Whether every colour is offered, and every style the layer shows; folded on each opening. */
  let allColours = $state(false);
  let allStyles = $state(false);
  /** As many styles as one row holds. */
  const ROW = 7;
  $effect(() => { if (point && own) iconLibrary.load(); });
  $effect(() => { if (point && own && caseId && layer) iconLibrary.loadLayer(caseId, layer); });
  const words = $derived(query.toLowerCase().trim().split(/\s+/).filter(Boolean));
  const matches = (text) => words.every((word) => text.toLowerCase().includes(word));
  const named = $derived(layerPalette.colours);
  const hexes = (list) => list.map((hex) => String(hex ?? '').toLowerCase()).filter((hex) => /^#[0-9a-f]{6}$/.test(hex));
  /** The colours offered at once beyond the named ones: those the layer wears and the one worn now, `[hex, where]`. */
  const near = $derived.by(() => {
    const seen = new Set(named.map((entry) => entry.colour));
    const found = [];
    for (const [hex, where] of [...hexes(used.map((style) => style.colour)).map((hex) => [hex, 'In this layer']),
      ...(mixed ? [] : hexes([colour]).map((hex) => [hex, 'Worn now']))]) {
      if (seen.has(hex)) continue;
      seen.add(hex);
      found.push([hex, PLAIN_COLOURS.find(([one]) => one === hex)?.[1] ?? where]);
    }
    return found.slice(0, 10);
  });
  /** With nothing named and nothing in the layer yet, the plain colours are the ones offered at once. */
  const bare = $derived(!named.length && !hexes(used.map((style) => style.colour)).length);
  /** What "+" unfolds: the plain colours not offered already, then those picked lately. */
  const rest = $derived.by(() => {
    const seen = new Set([...named.map((entry) => entry.colour), ...near.map(([hex]) => hex)]);
    const found = [];
    for (const [hex, where] of [...PLAIN_COLOURS.map(([one, name]) => [one, name]), ...hexes(recentColours.list).map((hex) => [hex, 'Picked lately'])]) {
      if (seen.has(hex)) continue;
      seen.add(hex);
      found.push([hex, where]);
    }
    return found.slice(0, 15);
  });
  const plainName = (hex) => PLAIN_COLOURS.find(([one]) => one === hex)?.[1] ?? '';
  function pickColour(hex) {
    if (!PLAIN_COLOURS.some(([one]) => same(one, hex)) && !named.some((entry) => same(entry.colour, hex))) recentColours.keep(hex);
    onpick?.({ colour: hex });
  }
  /** The colours and icons worn where the palette opened, for the key to name. */
  const wornColours = $derived(hexes([...used.map((style) => style.colour), ...(mixed ? [] : [colour])]));
  const wornKeys = $derived(point ? [...new Set([...used.map((style) => style.icon || style.symbol), ...(mixed ? [] : [icon || symbol])])].filter(Boolean) : []);
  /** The groups of the grid, as chips over it: a press scrolls the grid there. */
  const themes = $derived(words.length ? [] : [...(layerOwn.length ? [ICON_HELP.layerIcons] : []),
    ...libraryGroups.map((section) => section.group), ...sections.map((section) => section.group)]);
  function goTo(theme) {
    const node = [...(grid?.querySelectorAll('.theme') ?? [])].find((one) => one.dataset.theme === theme);
    if (node) grid.scrollTo?.({ top: node.offsetTop - 2 });
  }
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
  const styles = $derived(allStyles || offered.length <= ROW ? offered : offered.slice(0, ROW - 1));
  const iconMeaning = $derived(mixed ? '' : layerPalette.iconNameOf(icon || symbol));
  const worn = $derived(icon ? look(icon) : null);
  const same = (first, second) => String(first ?? '').toLowerCase() === String(second ?? '').toLowerCase();
  const styleName = (style) => (style.icon ? look(style.icon)?.name || 'own icon' : choices.find((choice) => choice.id === style.symbol)?.label ?? 'line');
  const usedChosen = (style) => !mixed && same(style.colour, colour) && (style.icon ? style.icon === icon : !icon && style.symbol === symbol);
  $effect(() => { if (caseId) layerPalette.load(caseId); });
</script>

<!-- a swatch: a plain colour said by its name, any other by its code and where it comes from -->
{#snippet swatch(hex, where)}
  {@const plain = plainName(hex)}
  <button type="button" class="swatch" class:chosen={!mixed && same(hex, colour)} style={`--swatch:${hex}`}
    aria-label={`${label} ${plain ? plain.toLowerCase() : hex}`} title={`${plain || where}, ${hex}`} aria-pressed={!mixed && same(hex, colour)}
    onclick={() => pickColour(hex)}></button>
{/snippet}

{#if offered.length > 1}
  <p class="fm-head">In this layer</p>
  <div class="used">
    {#each styles as style (`${style.icon ?? ''}${style.symbol}${style.colour}`)}
      <button type="button" aria-label={`${label} as ${styleName(style)} in ${layerPalette.nameOf(style.colour) || style.colour}`}
        class:chosen={usedChosen(style)}
        onclick={() => onpick?.(point ? (style.icon ? { icon: style.icon, colour: style.colour } : { symbol: style.symbol, icon: '', colour: style.colour }) : { colour: style.colour })}>
        {#if point}<MarkerSymbol symbol={style.symbol} colour={style.colour} icon={style.icon ? look(style.icon) : null} size={22} />
        {:else}<span class="dot" style={`--swatch:${style.colour}`}></span>{/if}
      </button>
    {/each}
    {#if styles.length < offered.length}
      <button type="button" class="more-styles" aria-label={`Show all ${offered.length} styles of this layer`} title="Every style this layer shows"
        onclick={() => (allStyles = true)}>+{offered.length - styles.length}</button>
    {/if}
  </div>
{/if}
{#if colours}
<div class="head-row">
  <p class="fm-head">Colour</p>
  {#if caseId}<LayerKeyButton {caseId} colours={wornColours} worn={wornKeys} {look}
    text={named.length || layerPalette.icons.length ? 'Edit names' : 'Name colours and icons'} />{/if}
</div>
<!-- the case's named colours by their names, the layer's own, and "+" for the rest -->
<div class="palette" role="group" aria-label={`${label} palette`}>
  {#each named as entry (entry.colour)}
    <button type="button" class="named-chip" class:chosen={!mixed && same(entry.colour, colour)} style={`--swatch:${entry.colour}`}
      aria-label={`${label} ${entry.name}`} title={`${entry.name}, ${entry.colour}`} aria-pressed={!mixed && same(entry.colour, colour)}
      onclick={() => pickColour(entry.colour)}><span class="chip-dot"></span><span class="chip-name">{entry.name}</span></button>
  {/each}
  {#each near as [hex, where] (hex)}{@render swatch(hex, where)}{/each}
  {#if bare}{#each rest as [hex, where] (hex)}{@render swatch(hex, where)}{/each}{/if}
  <button type="button" class="more-colours" aria-label="More colours" aria-expanded={allColours}
    title={allColours ? 'Fewer colours' : 'The plain colours, those picked lately, and a code typed or pasted'}
    onclick={() => (allColours = !allColours)}><Icon name={allColours ? 'minus' : 'plus'} size={11} /></button>
</div>
{#if allColours}
  {#if !bare && rest.length}
    <div class="palette" role="group" aria-label={`${label} more colours`}>
      {#each rest as [hex, where] (hex)}{@render swatch(hex, where)}{/each}
    </div>
  {/if}
  <div class="code-row">
    <input type="color" aria-label={`${label} colour`} title="Any colour" value={colour}
      onchange={(event) => pickColour(event.currentTarget.value)} />
    <HexField value={mixed ? '' : colour} label={`${label} colour code`} onpick={pickColour} />
  </div>
{/if}
{#if point && worn?.mode === 'image' && !mixed}<p class="colour-name keeps">{ICON_HELP.keepsColours}</p>{/if}
{/if}
{#if point}
  <p class="fm-head">Icon{#if iconMeaning}<span class="meant">{` · ${iconMeaning}`}</span>{/if}</p>
  <input type="search" class="find" aria-label={`${label} find icon`} bind:value={query} placeholder="Find an icon" />
  {#if themes.length > 1}
    <div class="themes" role="group" aria-label={`${label} icon groups`}>
      {#each themes as theme (theme)}<button type="button" class="theme-chip" title={`Go to ${theme}`} onclick={() => goTo(theme)}>{theme}</button>{/each}
    </div>
  {/if}
  <div class="icons" role="group" aria-label={`${label} icon palette`} bind:this={grid}>
    {#if layerOwn.length}
      <p class="theme" data-theme={ICON_HELP.layerIcons} title={ICON_HELP.layerIconsHint}>{ICON_HELP.layerIcons}</p>
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
      <p class="theme" data-theme={section.group}>{section.group}</p>
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
      {#if section.group}<p class="theme" data-theme={section.group}>{section.group}</p>{/if}
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
  .used button { display: grid; place-items: center; width: 32px; height: 32px; border-radius: var(--r-sm); cursor: pointer; }
  .icons button:not(.link) { display: grid; place-items: center; width: 100%; height: 32px; border-radius: var(--r-sm); cursor: pointer; }
  .used button:hover, .icons button:not(.link):hover, .used .chosen, .icons .chosen { background: var(--bg-3); outline: 1px solid var(--accent); }
  .palette { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; padding: 2px 6px 4px; }
  .swatch { width: 18px; height: 18px; border-radius: 50%; background: var(--swatch); border: 1px solid #0003; cursor: pointer; }
  .swatch.chosen { outline: 2px solid var(--text-1); outline-offset: 2px; }
  .code-row { display: flex; align-items: center; gap: 6px; padding: 0 6px 4px; }
  input[type='color'] { width: 26px; height: 24px; padding: 1px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); cursor: pointer; }
  .head-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding-right: 2px; }
  .named-chip { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; height: 22px; padding: 0 8px 0 5px; border: 1px solid var(--border);
    border-radius: 999px; background: var(--bg-2); color: var(--text-1); font-size: 11px; cursor: pointer; }
  .named-chip:hover { border-color: var(--text-3); }
  .named-chip.chosen { border-color: var(--accent); background: var(--accent-soft); }
  .chip-dot { flex: none; width: 11px; height: 11px; border-radius: 50%; background: var(--swatch); border: 1px solid #0003; }
  .chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .more-colours { display: grid; place-items: center; width: 20px; height: 20px; border: 1px dashed var(--border); border-radius: 50%; color: var(--text-3); cursor: pointer; }
  .more-colours:hover, .more-colours[aria-expanded='true'] { border-style: solid; border-color: var(--accent); color: var(--text-1); }
  .more-styles { color: var(--text-3); font-size: 11px; }
  .more-styles:hover { color: var(--text-1); }
  .meant { color: var(--text-2); font-weight: 400; letter-spacing: 0; text-transform: none; }
  .themes { display: flex; flex-wrap: wrap; gap: 3px; margin: 5px 4px 0; }
  .theme-chip { padding: 1px 7px; border: 1px solid var(--border); border-radius: 999px; color: var(--text-2); font-size: 10px; cursor: pointer; }
  .theme-chip:hover { border-color: var(--accent); color: var(--text-1); }
  .colour-name { margin: 0 8px 4px; color: var(--text-2); font-size: 11px; }
  .colour-name.keeps { color: var(--text-3); }
  .find { width: calc(100% - 8px); margin: 0 4px; height: 26px; padding: 4px 6px; font-size: var(--fs-xs); }
  /* as many columns as fit, so a scrollbar never pushes one out sideways; the one part that scrolls */
  .icons { position: relative; display: grid; grid-template-columns: repeat(auto-fill, minmax(30px, 1fr)); gap: 2px; flex: 0 1 auto;
    min-height: 96px; max-height: 232px; margin-top: 5px; padding: 1px 2px; overflow-x: hidden; overflow-y: auto; }
  .theme { grid-column: 1 / -1; margin: 4px 2px 0; font-size: 10px; color: var(--text-3); }
  .theme:first-child { margin-top: 0; }
  .own-hint { line-height: 1.5; }
  .link { padding: 0; border: 0; background: none; color: var(--accent); font: inherit; cursor: pointer; text-decoration: underline; }
</style>
