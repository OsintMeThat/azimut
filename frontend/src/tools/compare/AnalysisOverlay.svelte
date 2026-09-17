<script>
  import { displayGroups } from '../../lib/map/analyzers.js';
  let { engine, layers = [], selected = null, onpick = () => {}, active = true } = $props();
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
      boxes: visible(layer.results).map((row) => ({ id: row.id, points: box(row) })),
      groups: displayGroups(visible(layer.results), project),
    }));
  });
  function box(row) {
    const [w, s, e, n] = row.bbox;
    return [[w, n], [e, n], [e, s], [w, s]].map((point) => {
      const p = project(point); return `${p.x},${p.y}`;
    }).join(' ');
  }
  function pick(layer, group) {
    if (group.rows.length > 1 && engine) {
      const [lon, lat] = group.rows[0].coordinates;
      engine.setView({ lon, lat }, engine.getZoom() + 2);
    } else onpick(layer.id, group.rows[0].id);
  }
</script>

<svg class="analysis-overlay" aria-label="Analysis candidates">
  {#each shown as layer (layer.id)}
    {#if layer.input.recipe.style !== 'pins'}
      {#each layer.boxes as shape (shape.id)}
        <polygon points={shape.points} fill={layer.input.recipe.colour} fill-opacity="0.08"
          stroke={layer.input.recipe.colour} stroke-width="1.5" />
      {/each}
    {/if}
    {#each layer.groups as group, i (i)}
      {@const kept = group.rows.every((row) => row.review === 'kept')}
      <g role="button" tabindex="0" aria-label={group.rows.length > 1 ? `${group.rows.length} candidates` : group.rows[0].phenomenon}
        onclick={() => pick(layer, group)} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') pick(layer, group); }}>
        <!-- The one under review wears a ring, so the panel and the map are
             never about two different candidates. -->
        {#if group.rows.some((row) => row.id === selected)}
          <circle cx={group.x} cy={group.y} r={group.rows.length > 1 ? 18 : 11}
            fill="none" stroke="#fff" stroke-width="2" />
        {/if}
        <circle cx={group.x} cy={group.y} r={group.rows.length > 1 ? 13 : 6}
          fill={layer.input.recipe.colour} stroke="#fff" stroke-width="1.5" />
        {#if group.rows.length > 1}<text x={group.x} y={group.y + 4}>{group.rows.length}</text>
        {:else if kept}<circle cx={group.x} cy={group.y} r="2" fill="#fff" />{/if}
      </g>
    {/each}
  {/each}
</svg>

<style>
  .analysis-overlay { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 545; pointer-events: none; }
  g { pointer-events: auto; cursor: pointer; }
  text { fill: #111; text-anchor: middle; font: bold 11px system-ui; pointer-events: none; }
</style>
