<script>
  /**
   * The check on the bench, on the ground: its view as a dashed frame with its
   * name, and its pins, a filled ring where a candidate should come out and a
   * struck ring where none should, green or red once the check has been read
   * with the rules as they stand. The map keeps its clicks: this only shows.
   */
  let { engine, marks = [], ground = null } = $props();

  let revision = $state(0);
  $effect(() => {
    if (!engine) return;
    return engine.on('view-move', () => revision++);
  });
  const placed = $derived.by(() => {
    revision;
    return marks.map((mark) => ({
      ...mark,
      at: engine?.latLngToContainerPoint({ lon: mark.point[0], lat: mark.point[1] }) ?? { x: 0, y: 0 },
    }));
  });
  /** The frame's four corners on screen, turned with the map if it is. */
  const frame = $derived.by(() => {
    revision;
    if (!engine || !ground) return null;
    const { west, south, east, north } = ground.bounds;
    const corners = [[west, north], [east, north], [east, south], [west, south]]
      .map(([lon, lat]) => engine.latLngToContainerPoint({ lon, lat }));
    const top = corners.reduce((best, point) => (point.y < best.y ? point : best), corners[0]);
    return { points: corners.map((point) => `${point.x},${point.y}`).join(' '), label: top };
  });
  const words = (mark) => `${mark.expect === 'found' ? 'Should be found' : 'Should stay empty'}${
    mark.ok === true ? ', and it is' : mark.ok === false ? ', and it is not' : ''}`;
</script>

{#if frame}
  <svg class="ground" aria-hidden="true"><polygon points={frame.points} /></svg>
  <span class="ground-name" style:left={`${frame.label.x}px`} style:top={`${frame.label.y}px`}>{ground.name}</span>
{/if}
{#each placed as mark, i (i)}
  <span class="mark pin-{mark.expect}" class:pass={mark.ok === true} class:fail={mark.ok === false}
    style:left={`${mark.at.x}px`} style:top={`${mark.at.y}px`} title={words(mark)} aria-label={words(mark)}></span>
{/each}

<style>
  .ground {
    position: absolute;
    inset: 0;
    z-index: 550;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  .ground polygon { fill: rgb(255 255 255 / 0.04); stroke: #f8fafc; stroke-width: 1.5; stroke-dasharray: 6 4; }
  .ground-name {
    position: absolute;
    z-index: 551;
    padding: 1px 6px;
    transform: translate(0, calc(-100% - 3px));
    border-radius: 3px;
    background: rgb(0 0 0 / 0.6);
    color: #f8fafc;
    font-size: 11px;
    white-space: nowrap;
    pointer-events: none;
  }
  .mark {
    --ring: #f8fafc;
    position: absolute;
    z-index: 555;
    width: 16px;
    height: 16px;
    transform: translate(-50%, -50%);
    border: 2px solid var(--ring);
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.65);
    pointer-events: none;
  }
  .mark.pass { --ring: #4ade80; }
  .mark.fail { --ring: #f87171; }
  .mark.pin-found::after {
    position: absolute;
    inset: 4px;
    border-radius: 50%;
    background: var(--ring);
    content: '';
  }
  .mark.pin-empty { border-style: dashed; }
  .mark.pin-empty::after {
    position: absolute;
    top: 50%;
    left: -2px;
    width: 16px;
    height: 2px;
    background: var(--ring);
    transform: rotate(-45deg);
    content: '';
  }
</style>
