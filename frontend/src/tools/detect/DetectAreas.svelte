<script>
  /**
   * Every watched area of the case, drawn on the map at once, each in its
   * routine's colour and named by it. This is what makes the list a map rather
   * than a filing cabinet: the areas are the work, so you should be able to see
   * them all, and press one to open what watches it.
   *
   * Read-only on purpose. Areas are edited inside the detection that owns them.
   */
  import { zoneRing } from '../../lib/map/analyzers.js';
  import { relayWheel } from '../../lib/map/wheelRelay.js';

  let { engine, groups = [], highlight = [], onpick = () => {} } = $props();

  let svg = $state(null);
  /** Open an area from its outline, and only from a plain left press: the
   *  middle and right buttons turn and pan the map under it. */
  function press(event, id) {
    if (event.button > 0) return;
    onpick(id);
  }

  /** How wide an area has to draw, in pixels, before it is worth naming. */
  const NAMED = 44;

  let revision = $state(0);
  $effect(() => {
    if (!engine) return;
    return engine.on('view-move', () => revision++);
  });
  // Reading the camera's revision inside the projection is what keeps every
  // outline on its ground through a pan, a zoom or a turn.
  const project = ([lon, lat]) => {
    revision;
    return engine?.latLngToContainerPoint({ lon, lat }) ?? { x: 0, y: 0 };
  };

  const shapes = $derived.by(() => {
    if (!engine) return [];
    return groups.flatMap((group) => (group.zones ?? []).map((zone) => {
      const points = zoneRing(zone).map(project);
      const top = points.reduce((best, point) => (point.y < best.y ? point : best), points[0]);
      const xs = points.map((point) => point.x);
      const ys = points.map((point) => point.y);
      return {
        key: `${group.id}-${zone.id}`,
        id: group.id,
        title: group.title,
        colour: group.colour || '#38bdf8',
        outline: points.map((point) => `${point.x},${point.y}`).join(' '),
        // Zoomed out, an area is a few pixels wide and its name is longer than
        // the shape: the names would pile on top of each other and say nothing.
        // So a name shows where there is room for it, or where the pointer is.
        room: Math.max(...xs) - Math.min(...xs) >= NAMED || Math.max(...ys) - Math.min(...ys) >= NAMED,
        label: { x: top?.x ?? 0, y: (top?.y ?? 0) - 7 },
      };
    }));
  });
</script>

<svg class="detect-areas" bind:this={svg} aria-label="Watched areas"
  onwheel={(event) => relayWheel(event, { engine, root: svg })}>
  {#each shapes as shape (shape.key)}
    {@const on = highlight.includes(shape.id)}
    <g class="area" class:on role="button" tabindex="0" aria-label={`Open ${shape.title}`}
      onclick={(event) => press(event, shape.id)}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') onpick(shape.id); }}>
      <polygon points={shape.outline} fill={shape.colour} fill-opacity={on ? 0.22 : 0.08}
        stroke={shape.colour} stroke-width={on ? 2.5 : 1.5} />
      <!-- A thin line is hard to hit, so the press reads a wider invisible one. -->
      <polygon class="hit" points={shape.outline} />
      <!-- Named in the colour it is drawn in, so the list and the map agree. -->
      {#if shape.room || on}<text x={shape.label.x} y={shape.label.y} fill={shape.colour}>{shape.title}</text>{/if}
    </g>
  {/each}
</svg>

<style>
  .detect-areas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    z-index: 540;
    pointer-events: none;
    overflow: hidden;
  }
  /* An area is grabbed by its outline. Inside it the map is the map: the wheel
     zooms, a drag pans, and the middle button turns, exactly as it does on
     ground nothing is drawn over. */
  .area { pointer-events: none; }
  .hit { fill: none; stroke: transparent; stroke-width: 12; pointer-events: stroke; cursor: pointer; }
  text {
    font: 600 11px/1 var(--font-sans);
    paint-order: stroke;
    stroke: rgb(0 0 0 / 0.65);
    stroke-width: 3px;
    stroke-linejoin: round;
  }
</style>
