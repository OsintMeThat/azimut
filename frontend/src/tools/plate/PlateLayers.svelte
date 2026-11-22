<script>
  /**
   * Where the plate's maps get what they draw, beside the list of what the page holds.
   * A plate keeps no data of its own: each map is drawn on a ground and draws some of
   * the case's layers, as the Map keeps them. This says it map by map: the ground and
   * the day its picture was taken, each of the case's layers ticked when the map draws
   * it, a dated one marked, since the plate draws it as it stood on its day. A map on a
   * picture of one day can draw its dated layers as they stood that day instead, so a
   * picture of the past never shows what came after it.
   *
   * A tick draws a layer or takes it off, as the inspector's own list does. **›** opens
   * a drawn layer's own page for that map, in the inspector's place: its role, colours,
   * groups, days and hidden features there. **Settings** opens the map's inspector.
   * **Open in the Map** edits a layer the analyst draws, the plate waiting for Back.
   */
  import Icon from '../../components/Icon.svelte';
  import { isTracked } from '../../lib/map/layerHistory.js';
  import { drawnOn } from '../../lib/plate/toLayer.js';
  import { groundSaid, imageryDay, layeredMaps, mapName, withLayer } from '../../lib/plate/source.js';

  let {
    spec,
    /** The case's layers, as `addedLayers` lists them. */
    rows = [],
    grounds = [],
    releases = [],
    years = [],
    /** The plate is a template: it keeps a layout, so its maps name no layer. */
    template = false,
    /** `(map)`: the map picked, its settings opened in the inspector. */
    onsettings = null,
    /** `(map, row)`: a layer the map draws, on a page of its own for that map. */
    onlayer = null,
    /** `(map, row)`: the layer opened for editing in the Map, where this map looks. */
    onopen = null,
    /** `(map)`: a new layer of the case, drawn on this map and opened in the Map. */
    onnewlayer = null,
    /** `(map)`: what was drawn by hand on this map, kept as a layer of the case. */
    onkeepdrawn = null,
  } = $props();

  const maps = $derived(layeredMaps(spec));

  const name = (map) => mapName(spec, map);
  /** The map's layers first, in the order it draws them, then the case's others. */
  function listed(map) {
    const own = (map.layers ?? []).map((entry) => rows.find((row) => row.name === entry.name)).filter(Boolean);
    return [...own, ...rows.filter((row) => !own.includes(row))];
  }
  const draws = (map, row) => (map.layers ?? []).some((entry) => entry.name === row.name);
</script>

<div class="source" aria-label="Where the maps get what they draw">
  <p class="lead">Each map draws the case's layers, as they stand in the Map. Tick one to draw it here.</p>
  {#if !maps.length}
    <p class="note">No map on the page yet. Add › Map puts one.</p>
  {/if}
  {#each maps as map (map.id)}
    {@const ground = groundSaid(map, { grounds, releases, years })}
    {@const drawn = drawnOn(spec, map.id).length}
    <section class="map">
      <div class="map-head">
        <Icon name="satellite" size={12} />
        <h5>{name(map)}</h5>
        {#if onsettings}
          <button type="button" class="mini" aria-label={`Settings of ${name(map)}`} title="Its ground and its layers, in the inspector"
            onclick={() => onsettings(map)}><Icon name="settings" size={12} /></button>
        {/if}
      </div>
      <p class="ground" title={ground.undated ? 'Stitched from pictures of several days, so it says no day' : ground.drawn ? 'Drawn from map data, so it has no day of its own' : 'The day its picture was taken'}>
        <span class="key">Ground</span> {ground.name}{#if ground.when}{' · '}<strong>{ground.when}</strong>{:else if ground.undated}{' · '}<span class="quiet">several days</span>{/if}
      </p>
      {#if imageryDay(map, { releases }) && !template}
        <label class="own-day" title="Draws the dated layers as they stood on the day this map's picture was taken, not on the plate's day">
          <input type="checkbox" checked={map.layers_on === 'imagery'} onchange={(event) => (map.layers_on = event.currentTarget.checked ? 'imagery' : 'plate')} />
          Layers as they stood that day</label>
      {/if}
      {#if template}
        <p class="note">A template keeps no layers: a plate made from it draws the case's.</p>
      {:else if !rows.length}
        <p class="note">The case has no map layers yet. Make one in the Map, in My layers, or here.</p>
      {:else}
        <ul class="layers" aria-label={`Layers ${name(map)} draws`}>
          {#each listed(map) as row (row.name)}
            <li>
              <label title={draws(map, row) ? 'Drawn on this map. Untick to take it off' : 'Tick to draw it on this map'}>
                <input type="checkbox" checked={draws(map, row)} onchange={() => (map.layers = withLayer(map, row.name))} />
                <span class="title">{row.title}</span>
              </label>
              {#if isTracked(row)}
                <span class="tag" title="Followed over time: the plate draws it as it stood on its day">
                  <Icon name="clock" size={10} />dated</span>
              {/if}
              {#if onlayer && draws(map, row)}
                <button type="button" class="mini" aria-label={`${row.title} on ${name(map)}`} title="Its look, what shows of it and its names, on this map"
                  onclick={() => onlayer(map, row)}><Icon name="chevronRight" size={12} /></button>
              {/if}
              {#if onopen && row.editable}
                <button type="button" class="mini" aria-label={`Open ${row.title} in the Map`} title="Edit it in the Map, where this map looks. Back comes back here"
                  onclick={() => onopen(map, row)}><Icon name="external" size={11} /></button>
              {/if}
            </li>
          {/each}
        </ul>
        {#if !(map.layers ?? []).length}
          <p class="note">Draws no layer yet, so only its ground and what is placed on it show.</p>
        {/if}
      {/if}
      {#if !template && (onnewlayer || (onkeepdrawn && drawn))}
        <div class="acts">
          {#if onnewlayer}
            <button type="button" class="btn btn-xs" title="A new layer of the case, drawn on this map and opened in the Map to draw in"
              onclick={() => onnewlayer(map)}><Icon name="plus" size={11} /> New layer here</button>
          {/if}
          {#if onkeepdrawn && drawn}
            <button type="button" class="btn btn-xs" title="Makes what was drawn by hand on this map a layer of the case"
              onclick={() => onkeepdrawn(map)}>Make a layer of the {drawn} drawn here</button>
          {/if}
        </div>
      {/if}
    </section>
  {/each}
</div>

<style>
  .source { display: grid; gap: 10px; }
  .lead { margin: 0; color: var(--text-2); font-size: 11px; line-height: 1.4; }
  .note { margin: 0; color: var(--text-3); font-size: 11px; line-height: 1.4; }
  .map { display: grid; gap: 5px; padding: 8px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); }
  .map-head { display: flex; align-items: center; gap: 6px; color: var(--text-2); }
  .map-head h5 { flex: 1; min-width: 0; margin: 0; overflow: hidden; color: var(--text-1); font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .ground { margin: 0; color: var(--text-2); font-size: 11px; line-height: 1.35; }
  .ground .key { color: var(--text-3); }
  .own-day { display: flex; align-items: center; gap: 6px; color: var(--text-1); font-size: 11px; cursor: pointer; }
  .ground strong { color: var(--text-1); font-weight: 600; }
  .quiet { color: var(--text-3); }
  .layers { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
  .layers li { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .layers label { display: flex; flex: 1; align-items: center; gap: 6px; min-width: 0; color: var(--text-1); font-size: 11.5px; cursor: pointer; }
  .title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { display: inline-flex; flex: none; align-items: center; gap: 2px; padding: 0 4px; border: 1px solid var(--border); border-radius: 999px;
    color: var(--text-2); font-size: 9.5px; }
  .mini { display: grid; flex: none; place-items: center; width: 20px; height: 20px; border-radius: var(--r-sm); color: var(--text-2); cursor: pointer; }
  .mini:hover, .mini:focus-visible { background: var(--bg-3); color: var(--text-1); }
  .acts { display: flex; flex-wrap: wrap; gap: 4px; }
</style>
