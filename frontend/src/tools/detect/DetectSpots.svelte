<script>
  /**
   * A routine's spots on the map while its dashboard is open: one ring a spot, in
   * the colour of its kind (new, gone, regular, once, comes and goes), as wide on
   * the ground as the rule that grouped it. The spot picked in the list is ringed
   * and named; pressing one picks it. Read-only, like the watched areas.
   */
  import { relayWheel } from '../../lib/map/wheelRelay.js';

  let { engine, spots = [], radius = 40, selected = null, onpick = () => {} } = $props();

  let svg = $state(null);
  let revision = $state(0);
  $effect(() => {
    if (!engine) return;
    return engine.on('view-move', () => revision++);
  });

  const project = ([lon, lat]) => {
    revision;
    return engine?.latLngToContainerPoint({ lon, lat }) ?? { x: 0, y: 0 };
  };

  const drawn = $derived.by(() => {
    if (!engine || !spots.length) return [];
    // the rule's half-width on the ground, in pixels at this zoom
    const [lon, lat] = spots[0].centre;
    const here = project([lon, lat]);
    const east = project([lon + (radius / 2) / (111320 * Math.cos((lat * Math.PI) / 180)), lat]);
    const r = Math.max(4.5, Math.min(40, Math.abs(east.x - here.x)));
    // only what is on screen is drawn, so a routine of thousands of spots pans as lightly as one of ten
    const width = svg?.clientWidth || Infinity;
    const height = svg?.clientHeight || Infinity;
    const margin = r + 40;
    const shown = [];
    for (const spot of spots) {
      const point = project(spot.centre);
      if (point.x < -margin || point.y < -margin || point.x > width + margin || point.y > height + margin) continue;
      shown.push({ ...point, id: spot.id, kind: spot.category, r });
    }
    return shown;
  });

  function press(event, id) {
    if (event.button > 0) return;
    event.stopPropagation();
    onpick(id);
  }
</script>

<svg class="detect-spots" bind:this={svg} aria-label="Spots of this routine"
  onwheel={(event) => relayWheel(event, { engine, root: svg })}>
  {#each drawn as spot (spot.id)}
    {@const on = selected === spot.id}
    <g class={`spot ${spot.kind}`} class:on role="button" tabindex="-1" aria-label={`Spot ${spot.id}`}
      onpointerdown={(event) => press(event, spot.id)}>
      <circle class="halo" cx={spot.x} cy={spot.y} r={spot.r + 3} />
      <circle class="mark" cx={spot.x} cy={spot.y} r={spot.r} />
      {#if on || spot.r >= 9}
        <text x={spot.x + spot.r + 4} y={spot.y + 3.5}>{spot.id}</text>
      {/if}
    </g>
  {/each}
</svg>

<style>
  .detect-spots {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 545;
    pointer-events: none;
    overflow: hidden;
  }
  .spot { --c: var(--text-3); pointer-events: visiblePainted; cursor: pointer; }
  .spot.new { --c: #66b578; }
  .spot.gone { --c: #d97070; }
  .spot.steady { --c: #6f9fd8; }
  .spot.mixed { --c: #d9a53f; }
  .spot.once { --c: #bdbdbd; }
  .halo { fill: none; stroke: rgb(0 0 0 / 0.55); stroke-width: 4; }
  .mark { fill: color-mix(in srgb, var(--c) 22%, transparent); stroke: var(--c); stroke-width: 2; }
  .spot.gone .mark { fill: none; stroke-dasharray: 3 2; }
  .spot.on .mark { stroke: var(--accent); stroke-width: 3; fill: color-mix(in srgb, var(--accent) 22%, transparent); }
  .spot.on .halo { stroke-width: 6; }
  text {
    fill: #fff;
    font: 700 11px/1 var(--font-sans);
    paint-order: stroke;
    stroke: rgb(0 0 0 / 0.7);
    stroke-width: 3px;
    stroke-linejoin: round;
    pointer-events: none;
  }
</style>
