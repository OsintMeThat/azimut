<script>
  /**
   * One of the case's layers on one map of the plate, on a page of its own in place of
   * the map's inspector: what it stands for and how it is drawn, which of it shows, and
   * its names. Each map keeps its own settings for a layer, so the page says which map
   * it is on and moves to the same layer on another map that draws it. **Same on the
   * other maps** gives them this look and these groups at one press, their days and
   * hidden features staying their own. What should change everywhere is changed in the
   * layer itself, in the Map.
   */
  import Icon from '../../components/Icon.svelte';
  import MonthGrid from '../../components/MonthGrid.svelte';
  import { today as calendarToday } from '../../lib/calendar.js';
  import { categoryColour } from '../../lib/map/addedLayers.js';
  import { isTracked, momentLabel } from '../../lib/map/layerHistory.js';
  import { spanTo, withHidden } from '../../lib/plate/kept.js';
  import { dayOf } from '../../lib/plate/page.js';
  import { PLATE_HELP, hoverHelp } from '../../lib/plate/plateHelp.js';
  import { ROLE_LIST, withRole } from '../../lib/plate/roles.js';
  import { layeredMaps, mapName, sameLook, withLayer, withLookOf } from '../../lib/plate/source.js';
  import { toast } from '../../lib/state.svelte.js';
  import PlateColour from './PlateColour.svelte';

  let {
    spec,
    /** The map the layer is set on. */
    map,
    /** The layer, by name. */
    name,
    /** The case's layers, as `addedLayers` lists them. */
    rows = [],
    /** The plate's day, a moment or the page. */
    at = '',
    /** `(layer, id)`: a feature's name, for the ones hidden on this map. */
    featureName = () => '',
    /** `(name)`: the layer is followed over time. */
    datedLayer = () => false,
    /** Back to the map's inspector. */
    onback,
    /** `(map)`: the same layer on another map that draws it. */
    onmap = null,
    /** `(map, row)`: the layer opened for editing in the Map; null where it cannot be. */
    onopen = null,
    /** `(map, row)`: a label beside each of its named features in the frame. */
    onlabels = null,
  } = $props();

  const row = $derived(rows.find((item) => item.name === name) ?? { name, title: name, categories: [] });
  const entry = $derived((map.layers ?? []).find((item) => item.name === name) ?? null);
  /** The other maps that draw it, which this map's look can be given to. */
  const others = $derived(layeredMaps(spec).filter((item) => item !== map && (item.layers ?? []).some((one) => one.name === name)));
  const unlike = $derived(entry ? others.filter((item) => !sameLook(item.layers.find((one) => one.name === name), entry)) : []);
  const dated = $derived(datedLayer(name) || isTracked(row) || !!entry?.start || !!entry?.end);
  /** The map keeps the layer's own look: no role, colour, dash, fill or weight of its own. */
  const ownLook = $derived(!entry || sameLook(entry, withRole(entry, '', spec.theme)));
  const lastDay = $derived([calendarToday(), String(at ?? '').slice(0, 10)].sort().at(-1));
  const swatch = $derived(entry?.colour ?? (row.categories?.[0] ? categoryColour(row.categories[0], 0) : 'var(--text-3)'));

  /** The end of its days whose calendar is open: 'start', 'end', or neither. */
  let dating = $state('');
  $effect(() => { void map?.id; void name; dating = ''; });

  /** A field of this map's entry for the layer set, the entry replaced so the history and the save see it. */
  function set(change) {
    map.layers = (map.layers ?? []).map((item) => (item.name === name ? { ...item, ...change } : item));
  }
  function setRole(role) {
    map.layers = (map.layers ?? []).map((item) => (item.name === name ? withRole(item, role, spec.theme) : item));
  }
  function toggleGroup(group) {
    const hidden = entry.hidden ?? [];
    set({ hidden: hidden.includes(group) ? hidden.filter((item) => item !== group) : [...hidden, group] });
  }
  /**
   * The first or last day the map draws the layer on, or none for all of it. A plate on
   * a day outside them is put on the end it passed, so the day just set is the one shown.
   */
  function dateLayer(which, day) {
    set(spanTo(entry, which, day));
    dating = '';
    const shown = at ? dayOf(at) : '';
    const next = map.layers.find((item) => item.name === name);
    const onto = shown && next.start && shown < next.start ? next.start : shown && next.end && shown > next.end ? next.end : '';
    if (onto) Object.assign(spec.time, { at: onto, step: null });
  }
  function giveOthers() {
    const given = unlike.length;
    for (const other of unlike) other.layers = other.layers.map((item) => (item.name === name ? withLookOf(item, entry) : item));
    toast(`${row.title} drawn the same on ${given === 1 ? mapName(spec, unlike[0]) : `${given} other maps`}`, 'ok');
  }
  function takeOff() {
    map.layers = withLayer(map, name);
    onback?.();
  }
</script>

<aside class="layer-page" aria-label={`${row.title} on ${mapName(spec, map)}`} use:hoverHelp>
  <button type="button" class="back" title="Back to the map's settings" onclick={onback}><Icon name="chevronLeft" size={13} /> {mapName(spec, map)}</button>

  <header>
    <span class="swatch" style:background={swatch}></span>
    <h3 title={row.title}>{row.title}</h3>
    {#if dated}<span class="tag" title="Followed over time: the plate draws it as it stood on its day"><Icon name="clock" size={10} />dated</span>{/if}
  </header>
  <p class="where">
    {#if others.length && onmap}
      On <select aria-label="Map the layer is set on" value={map.id}
        onchange={(event) => { const next = layeredMaps(spec).find((item) => item.id === event.currentTarget.value); if (next) onmap(next); }}>
        {#each [map, ...others].sort((a, b) => spec.elements.indexOf(a) - spec.elements.indexOf(b)) as item (item.id)}<option value={item.id}>{mapName(spec, item)}</option>{/each}
      </select>
    {:else}
      On {mapName(spec, map)}
    {/if}
    <span class="quiet">· what is set here changes this map only</span>
  </p>

  {#if !entry}
    <p class="note">This map no longer draws it. <button type="button" class="text-act" onclick={() => (map.layers = withLayer(map, name))}>Draw it again</button></p>
  {:else}
    {#if others.length || (onopen && row.editable)}
      <div class="acts">
        {#if others.length}
          <button type="button" class="btn btn-xs" disabled={!unlike.length}
            title={unlike.length ? 'Gives the other maps that draw it this look and these groups' : 'The other maps already draw it this way'}
            onclick={giveOthers}><Icon name="copy" size={11} /> {unlike.length ? `Same on the other ${others.length === 1 ? 'map' : `${others.length} maps`}` : 'Same on every map'}</button>
        {/if}
        {#if onopen && row.editable}
          <button type="button" class="btn btn-xs" title="Edit the layer itself in the Map, for every plate and map that draws it"
            onclick={() => onopen(map, row)}><Icon name="external" size={11} /> Edit the layer in the Map</button>
        {/if}
      </div>
    {/if}

    <section aria-label="Look">
      <h4>Look</h4>
      <div class="grid">
        <span class="key" title="One press gives the layer its role's colour, fill and lines, named in the legend">Stands for</span>
        <select aria-label={`${row.title} stands for`} value={entry.role ?? ''} onchange={(event) => setRole(event.currentTarget.value)}>
          <option value="">Its own look</option>
          {#each ROLE_LIST as [value, label] (value)}<option {value}>{label}</option>{/each}
        </select>
        <span class="key">Colour</span>
        <span class="colour">
          <PlateColour label={`${row.title} colour on this plate`} value={entry.colour ?? '#c8102e'} theme={spec.theme} none onpick={(hex) => set({ colour: hex })} />
          {#if !entry.colour}<span class="quiet">its own colours</span>{/if}
        </span>
        <span class="key">Lines</span>
        <div class="segments" role="group" aria-label={`${row.title} lines on this plate`}>
          {#each [['', 'Its own'], ['dashed', 'Dashed'], ['dotted', 'Dotted']] as [value, label] (value)}
            <button type="button" aria-pressed={(entry.dash ?? '') === value} onclick={() => set({ dash: value })}>{label}</button>
          {/each}
        </div>
        <span class="key">Areas</span>
        <div class="segments" role="group" aria-label={`${row.title} areas on this plate`}>
          {#each [['', 'Its own'], ['solid', 'Full'], ['hatch', 'Hatched'], ['none', 'Outline']] as [value, label] (value)}
            <button type="button" aria-pressed={(entry.fill ?? '') === value} onclick={() => set({ fill: value })}>{label}</button>
          {/each}
        </div>
        <span class="key" title={PLATE_HELP['Lines on this plate']}>Line weight</span>
        <span class="range"><input type="range" aria-label={`${row.title} line weight`} min="0.5" max="3" step="0.25" value={entry.stroke ?? 1}
          oninput={(event) => set({ stroke: Number(event.currentTarget.value) })} /><span>{entry.stroke ?? 1}×</span></span>
        <span class="key" title={PLATE_HELP['Marks on this plate']}>Mark size</span>
        <span class="range"><input type="range" aria-label={`${row.title} mark size`} min="0.5" max="3" step="0.25" value={entry.icons ?? 1}
          oninput={(event) => set({ icons: Number(event.currentTarget.value) })} /><span>{entry.icons ?? 1}×</span></span>
      </div>
      {#if !ownLook}<button type="button" class="text-act" onclick={() => setRole('')}>Back to its own look</button>{/if}
    </section>

    <section aria-label="What shows">
      <h4>What shows</h4>
      {#if row.categories?.length}
        <span class="key" title="Its groups, each left out of this map by a press">Groups</span>
        <div class="groups">
          {#each row.categories as group, index (group.name)}
            {@const off = (entry.hidden ?? []).includes(group.name)}
            <button type="button" class="chip" class:off aria-pressed={!off} title={off ? 'Show it on this map' : 'Leave it out of this map'}
              onclick={() => toggleGroup(group.name)}><i style:background={categoryColour(group, index)}></i>{group.name}</button>
          {/each}
        </div>
      {/if}
      {#if dated}
        <div class="span">
          {#each [['start', 'From', 'first day', 'What began before this day is left out of this map', 'Its first day'],
            ['end', 'To', 'last day', 'What began after this day is left out of this map', 'Its last day']] as [which, key, said, title, open] (which)}
            <span class="key" {title}>{key}</span>
            <button type="button" class="end" class:open={dating === which} aria-expanded={dating === which} aria-label={`${row.title} ${said}`}
              {title} onclick={() => (dating = dating === which ? '' : which)}>
              <Icon name="calendar" size={12} />{entry[which] ? momentLabel(entry[which]) : open}</button>
            {#if dating === which}
              <div class="pick">
                <div class="tools">
                  {#if at}<button type="button" class="btn btn-xs" title={`${momentLabel(at)}, the plate's day`} onclick={() => dateLayer(which, dayOf(at))}>This day</button>{/if}
                  {#if entry[which]}<button type="button" class="btn btn-xs" title={which === 'start' ? 'Draws what began before it again' : 'Draws what began after it again'}
                    onclick={() => dateLayer(which, '')}>{open}</button>{/if}
                </div>
                <MonthGrid value={(entry[which] || dayOf(at) || lastDay).slice(0, 10)} max={lastDay} label={`${row.title} ${said}`} onpick={(day) => dateLayer(which, day)} />
              </div>
            {/if}
          {/each}
        </div>
      {/if}
      {#if entry.hidden_features?.length}
        <span class="key" title="What this map leaves out of it, each shown again by a press">Hidden here</span>
        <div class="groups hidden-here">
          {#each entry.hidden_features as id (id)}
            <button type="button" class="chip off" title="Show it again on this map"
              onclick={() => { map.layers = withHidden(map.layers, name, id, false); }}>{featureName(name, id) || 'No name'}</button>
          {/each}
        </div>
      {:else}
        <p class="note">A right-click on one of its features, on the map, hides it here alone.</p>
      {/if}
    </section>

    {#if onlabels}
      <section aria-label="Names">
        <h4>Names</h4>
        <button type="button" class="btn btn-xs" title="A label beside each named feature in the frame, none covering another" onclick={() => onlabels(map, row)}>
          <Icon name="text" size={11} /> Label its named features</button>
        <p class="note">Each label is the plate's own, to move or reword by hand.</p>
      </section>
    {/if}

    <div class="off-map">
      <button type="button" class="text-act" title="This map no longer draws it; the layer stays in the case" onclick={takeOff}>Take it off this map</button>
    </div>
  {/if}
</aside>

<style>
  .layer-page { display: grid; align-content: start; gap: 10px; width: 100%; height: 100%; overflow-y: auto; padding: 10px 12px 16px; background: var(--bg-1);
    font-size: var(--fs-xs); }
  .back { display: inline-flex; align-items: center; gap: 2px; justify-self: start; max-width: 100%; padding: 2px 6px 2px 2px; border-radius: var(--r-sm);
    color: var(--text-2); font-size: 11px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .back:hover, .back:focus-visible { background: var(--bg-3); color: var(--text-1); }
  header { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .swatch { flex: none; width: 12px; height: 12px; border-radius: 3px; box-shadow: 0 0 0 1px rgba(0, 0, 0, .25); }
  h3 { flex: 1; min-width: 0; margin: 0; overflow: hidden; color: var(--text-1); font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .tag { display: inline-flex; flex: none; align-items: center; gap: 2px; padding: 0 5px; border: 1px solid var(--border); border-radius: 999px;
    color: var(--text-2); font-size: 9.5px; }
  .where { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin: -4px 0 0; color: var(--text-2); font-size: 11px; }
  .where select { max-width: 150px; font-size: 11px; }
  .quiet { color: var(--text-3); }
  .acts { display: flex; flex-wrap: wrap; gap: 4px; }
  section { display: grid; gap: 6px; padding-top: 10px; border-top: 1px solid var(--border); }
  h4 { margin: 0; color: var(--text-3); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .grid { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 7px 10px; align-items: center; }
  .key { color: var(--text-3); font-size: 11px; }
  .grid select { min-width: 0; }
  .colour { display: grid; gap: 3px; min-width: 0; }
  .colour .quiet { font-size: 10.5px; }
  .segments { display: flex; gap: 2px; min-width: 0; }
  .segments button { flex: 1; min-width: 0; padding: 3px 1px; border: 1px solid var(--border); border-radius: var(--r-sm); color: var(--text-2);
    font-size: 10.5px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .segments button[aria-pressed='true'] { border-color: var(--accent); background: var(--bg-2); color: var(--text-1); }
  .range { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .range input { flex: 1; min-width: 0; }
  .range span { min-width: 30px; color: var(--text-2); font-size: 10.5px; font-variant-numeric: tabular-nums; text-align: right; }
  .groups { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px; background: var(--bg-2);
    color: var(--text-1); font-size: 10.5px; cursor: pointer; }
  .chip i { width: 8px; height: 8px; border-radius: 50%; }
  .chip.off { background: none; color: var(--text-3); text-decoration: line-through; }
  .chip.off i { opacity: .35; }
  .span { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 5px 10px; align-items: center; }
  .span .pick { grid-column: 1 / -1; display: grid; gap: 6px; }
  .tools { display: flex; flex-wrap: wrap; gap: 4px; }
  .end { display: flex; align-items: center; gap: 5px; min-width: 0; height: 24px; padding: 0 6px; border: 1px solid var(--border); border-radius: var(--r-sm);
    color: var(--text-1); font-size: 11px; cursor: pointer; }
  .end.open { border-color: var(--accent); }
  .end :global(svg) { flex: none; color: var(--text-3); }
  .note { margin: 0; color: var(--text-3); font-size: 11px; line-height: 1.4; }
  .text-act { justify-self: start; padding: 0; color: var(--accent); font-size: 11px; cursor: pointer; }
  .text-act:hover { text-decoration: underline; }
  .off-map { padding-top: 10px; border-top: 1px solid var(--border); }
  .off-map .text-act { color: var(--text-2); }
</style>
