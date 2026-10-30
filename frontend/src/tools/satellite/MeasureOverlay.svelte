<script>
  /**
   * What the Measure tool draws on the screen rather than on the ground,
   * placed again as the map moves.
   *
   * - **The stretch to come** while a measure is drawn: from the last point to
   *   the pointer, with what it adds written beside the pointer, and a ring
   *   where the click would land on something already there. Drawn here, the
   *   pointer's every move repaints nothing on the ground, flat or in 3D.
   * - **The line of sight in the air**, in 3D: from the eye standing over A to
   *   the target standing over B, the stretch past the ground in its way drawn
   *   in red. The straight line between two points in the air, less the Earth's
   *   bulge under it, which is the line the verdict was read on.
   */
  import { haversine } from '../../lib/measure.js';

  let {
    engine = null,
    /** `tool.live`: `{ from, to, first, closing, text, label }`, or null. */
    live = null,
    /**
     * The sight to stand in the air: `{ a, b, eye, target, blockedAt }`, the
     * eye and the target in metres above the sea, the blocking ground's
     * distance from A or null; or null.
     */
    air = null,
  } = $props();

  /** Earth's radius enlarged for refraction (engine/horizon.py), for the bulge under the line. */
  const RADIUS = 6371008.8 / (1 - 0.13);
  const STEPS = 32;

  let tick = $state(0);
  let width = $state(0);
  $effect(() => {
    if (!engine) return;
    const offs = [engine.on('view-move', () => (tick += 1)), engine.on('view-settled', () => (tick += 1))];
    return () => offs.forEach((off) => off());
  });

  function at(point) {
    const p = engine?.latLngToContainerPoint(point);
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  }

  const band = $derived.by(() => {
    tick;
    if (!live || !engine) return null;
    const from = at(live.from);
    const to = at(live.to);
    if (!from || !to) return null;
    return { from, to, first: live.closing ? at(live.first) : null, snapped: Boolean(live.label) };
  });

  const sky = $derived.by(() => {
    tick;
    if (!air || !engine?.globe || typeof engine.projectAt !== 'function') return null;
    const span = haversine(air.a, air.b);
    const block = air.blockedAt == null ? 1 : Math.min(1, air.blockedAt / (span || 1));
    const points = [];
    for (let i = 0; i <= STEPS; i += 1) {
      const f = i / STEPS;
      const height = air.eye + f * (air.target - air.eye) - (span * span * f * (1 - f)) / (2 * RADIUS);
      const p = engine.projectAt(air.a.lat + f * (air.b.lat - air.a.lat), air.a.lon + f * (air.b.lon - air.a.lon), height);
      if (!p) return null;
      points.push({ ...p, clear: f <= block });
    }
    const groundA = at(air.a);
    const groundB = at(air.b);
    const path = (list) => list.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const cut = points.findIndex((p) => !p.clear);
    const seen = cut < 0 ? points : points.slice(0, cut + 1);
    const hidden = cut < 0 ? [] : points.slice(cut);
    // an eye or a target standing clear of its handle on screen is drawn on its post; one
    // the view sets on the handle itself is left to the handle, whose letter it would cover
    const apart = (ground, air) => ground && Math.hypot(ground.x - air.x, ground.y - air.y) > 12;
    const eye = points[0];
    const target = points.at(-1);
    return {
      seen: path(seen),
      hidden: hidden.length > 1 ? path(hidden) : '',
      eye: apart(groundA, eye) ? eye : null,
      target: apart(groundB, target) ? target : null,
      postA: apart(groundA, eye) ? `M${groundA.x},${groundA.y} L${eye.x},${eye.y}` : '',
      postB: apart(groundB, target) ? `M${groundB.x},${groundB.y} L${target.x},${target.y}` : '',
    };
  });
</script>

<div class="measure-layer" bind:clientWidth={width}>
<svg class="measure-overlay" aria-hidden="true">
  {#if sky}
    {#if sky.postA}<path class="post" d={sky.postA} />{/if}
    {#if sky.postB}<path class="post" d={sky.postB} />{/if}
    <path class="air seen" d={sky.seen} />
    {#if sky.hidden}<path class="air hidden" d={sky.hidden} />{/if}
    {#if sky.eye}<circle class="end" cx={sky.eye.x} cy={sky.eye.y} r="4" />{/if}
    {#if sky.target}<circle class="end" cx={sky.target.x} cy={sky.target.y} r="4" />{/if}
  {/if}
  {#if band}
    <line class="band" x1={band.from.x} y1={band.from.y} x2={band.to.x} y2={band.to.y} />
    {#if band.first}
      <line class="band closing" x1={band.to.x} y1={band.to.y} x2={band.first.x} y2={band.first.y} />
    {/if}
    {#if band.snapped}<circle class="snap" cx={band.to.x} cy={band.to.y} r="9" />{/if}
  {/if}
</svg>
{#if band && live}
  <!-- beside the pointer, on whichever side the map has room for it -->
  <div
    class="live mono"
    class:flip={band.to.x > width - 260}
    style:left={`${band.to.x + (band.to.x > width - 260 ? -14 : 14)}px`}
    style:top={`${band.to.y + (band.to.x > width - 260 ? -40 : 12)}px`}
  >
    {live.text}{#if live.label}<span class="on">on {live.label}</span>{/if}
  </div>
{/if}
</div>

<style>
  .measure-layer {
    position: absolute;
    inset: 0;
    z-index: 4;
    pointer-events: none;
  }
  .measure-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }
  .band {
    stroke: #f5a623;
    stroke-width: 2;
    stroke-dasharray: 6 4;
    stroke-opacity: 0.9;
  }
  .band.closing {
    stroke-opacity: 0.55;
  }
  .snap {
    fill: none;
    stroke: #fff;
    stroke-width: 2;
    filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.8));
  }
  .air {
    fill: none;
    stroke-width: 2.5;
    stroke-linecap: round;
    filter: drop-shadow(0 0 2px rgba(0, 0, 0, 0.7));
  }
  .air.seen {
    stroke: #66b578;
  }
  .air.hidden {
    stroke: #d97070;
    stroke-dasharray: 6 4;
  }
  .post {
    stroke: rgba(255, 255, 255, 0.75);
    stroke-width: 1.2;
    stroke-dasharray: 2 3;
  }
  .end {
    fill: #fff;
    stroke: rgba(0, 0, 0, 0.6);
  }
  .live {
    position: absolute;
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 3px 7px;
    border-radius: var(--r-sm);
    background: rgba(10, 10, 10, 0.88);
    box-shadow: 0 0 0 1px rgba(245, 166, 35, 0.6);
    color: #fff;
    font-size: 11px;
    white-space: nowrap;
    pointer-events: none;
  }
  .live.flip {
    transform: translateX(-100%);
  }
  .on {
    color: var(--text-3);
    font-size: 10px;
  }
</style>
