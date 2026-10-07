<script>
  import { displayGroups } from '../../lib/map/analyzers.js';
  import { candidatePaths } from '../../lib/map/detectReview.js';
  import { relayWheel } from '../../lib/map/wheelRelay.js';
  let { engine, layers = [], selected = null, onpick = () => {}, active = true, markers = true, outlines = true, interactive = true } = $props();
  let svg = $state(null);
  let revision = $state(0);
  $effect(() => {
    if (!engine) return;
    return engine.on('view-move', () => revision++);
  });
  // Reading the camera's revision here keeps every projected shape on its
  // ground, boxes included, however the map is panned or turned.
  const project = ([lon, lat]) => {
    revision;
    return engine?.latLngToContainerPoint({ lon, lat }) ?? { x: 0, y: 0 };
  };
  const visible = (rows) => rows.filter((row) => row.review !== 'dismissed');
  const shown = $derived.by(() => {
    if (!engine || !active) return [];
    return layers.filter((layer) => layer.visible).map((layer) => ({ ...layer,
      boxes: visible(layer.results).map((row) => ({ id: row.id, label: row.phenomenon || 'Candidate', manual: row.origin === 'manual',
        path: candidatePaths(row.geometry ?? rectangle(row), project) })).filter((shape) => shape.path),
      groups: markers ? displayGroups(visible(layer.results), project) : [],
    }));
  });
  function rectangle(row) {
    const [w, s, e, n] = row.bbox;
    return { type: 'Polygon', coordinates: [[[w, n], [e, n], [e, s], [w, s], [w, n]]] };
  }
  function pick(layer, group) {
    if (!interactive) return;
    if (group.rows.length > 1 && engine) {
      const [lon, lat] = group.rows[0].coordinates;
      engine.setView({ lon, lat }, engine.getZoom() + 2);
    } else onpick(layer.id, group.rows[0].id);
  }
</script>

<svg class="analysis-overlay" bind:this={svg} aria-label="Analysis candidates"
  onwheel={(event) => relayWheel(event, { engine, root: svg })}>
  {#each shown as layer (layer.id)}
    {#if outlines && layer.input.recipe.style !== 'pins'}
      {#each layer.boxes as shape (shape.id)}
        <path class="outline" class:selected={shape.id === selected} class:passive={!interactive} d={shape.path}
          fill={layer.displayColour || layer.display_colour || layer.input.recipe.colour} fill-opacity="0.08" fill-rule="evenodd"
          stroke={layer.displayColour || layer.display_colour || layer.input.recipe.colour}
          stroke-width={shape.id === selected ? 3 : 1.5} stroke-dasharray={shape.manual ? '5 3' : undefined}
          role="button" tabindex={markers || !interactive ? -1 : 0} aria-disabled={!interactive} aria-label={`${shape.label} outline`}
          onclick={(event) => { if (interactive && event.button === 0) onpick(layer.id, shape.id); }}
          onkeydown={(event) => { if (interactive && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault(); onpick(layer.id, shape.id);
          } }} />
      {/each}
    {/if}
    {#each layer.groups as group, i (i)}
      {@const kept = group.rows.every((row) => row.review === 'kept' || row.review === 'noted')}
      <g class:passive={!interactive} role="button" tabindex={interactive ? 0 : -1} aria-disabled={!interactive}
        aria-label={group.rows.length > 1 ? `${group.rows.length} candidates` : group.rows[0].phenomenon}
        onclick={(event) => { if (event.button === 0) pick(layer, group); }}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(layer, group); } }}>
        <!-- The one under review wears a ring, so the panel and the map are
             never about two different candidates. -->
        {#if group.rows.some((row) => row.id === selected)}
          <circle cx={group.x} cy={group.y} r={group.rows.length > 1 ? 18 : 11}
            fill="none" stroke="#fff" stroke-width="2" />
        {/if}
        <circle cx={group.x} cy={group.y} r={group.rows.length > 1 ? 13 : 6}
          fill={layer.displayColour || layer.display_colour || layer.input.recipe.colour} stroke="#fff" stroke-width="1.5"
          stroke-dasharray={group.rows.some((row) => row.origin === 'manual') ? '3 2' : undefined} />
        {#if group.rows.length > 1}<text x={group.x} y={group.y + 4}>{group.rows.length}</text>
        {:else if kept}<circle cx={group.x} cy={group.y} r="2" fill="#fff" />{/if}
      </g>
    {/each}
  {/each}
</svg>

<style>
  .analysis-overlay { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 545; pointer-events: none; }
  g { pointer-events: auto; cursor: pointer; }
  .outline { pointer-events: stroke; cursor: pointer; }
  .outline.selected { filter: drop-shadow(0 0 2px #fff); }
  .outline:focus-visible { stroke: #fff; stroke-width: 2.5; outline: none; }
  .outline.passive, g.passive { pointer-events: none; }
  text { fill: #111; text-anchor: middle; font: bold 11px system-ui; pointer-events: none; }
</style>
