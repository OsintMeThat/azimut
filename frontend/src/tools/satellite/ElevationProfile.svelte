<script>
  /**
   * The ground along an Elevation profile line, as a chart that fills the
   * window it is in and redraws as that window is resized.
   *
   * Round heights up the side, round distances along the bottom, in the
   * analyst's units, the ground filled under its crest. The pointer reads it: a
   * rule follows the hand, a card says how far along, how high and how steep,
   * and the same point is marked on the line on the map.
   *
   * The sight verdict is read on the same curved, refracting Earth as every
   * horizon in the app (api/terrain.py). The ground is drawn with the Earth's
   * bulge added, which is what lets the line of sight be drawn straight.
   */
  import { formatDistance, formatHeight } from '../../lib/measure.js';
  import { climb, gradeDegrees, profileChart, sampleNear, slopes, stretchLabel } from '../../lib/profile.js';

  let {
    profile,
    busy = false,
    error = '',
    units = 'metric',
    /** The sample under the pointer, `{ lat, lon }`, or null when it leaves. */
    onhover = () => {},
  } = $props();

  let width = $state(600);
  let height = $state(160);
  let hovered = $state(null);

  const chart = $derived(profile ? profileChart(profile, { width, height, units }) : null);
  const stats = $derived(profile ? climb(profile.elevation) : null);
  const grades = $derived(profile ? slopes(profile.distance_m, profile.elevation) : []);
  const steepest = $derived(grades.length ? Math.max(...grades.map(Math.abs)) : 0);
  const sight = $derived(profile?.sight ?? null);
  const length = $derived(profile ? profile.distance_m.at(-1) : 0);
  const reading = $derived(
    hovered == null || !chart || hovered >= chart.tops.length
      ? null
      : {
          at: chart.tops[hovered],
          distance: profile.distance_m[hovered],
          height: profile.elevation[hovered],
          grade: grades[hovered],
        }
  );
  // the card stays inside the chart, on whichever side of the rule has room
  const flip = $derived(reading && reading.at.x > width - 170);

  // a new answer is a new line: the old reading means nothing on it
  $effect(() => {
    profile;
    hovered = null;
  });

  function pointerAt(event) {
    if (!chart) return;
    const box = event.currentTarget.getBoundingClientRect();
    const index = sampleNear(chart.tops, event.clientX - box.left);
    if (index === hovered) return;
    hovered = index;
    onhover({ lat: profile.lat[index], lon: profile.lon[index] });
  }

  function pointerGone() {
    hovered = null;
    onhover(null);
  }

  const distanceLabel = (d) => formatDistance(d, units);
  const heightLabel = (h) => formatHeight(h, units);
  const gradeLabel = (g) => `${g > 0 ? '+' : ''}${Math.round(g)}% (${Math.round(gradeDegrees(g))}°)`;
</script>

<div class="elevation">
  {#if stats}
    <div class="facts">
      <dl class="stats">
        <div><dt>Length</dt><dd class="mono">{distanceLabel(length)}</dd></div>
        <div><dt>Climb</dt><dd class="mono">↑ {heightLabel(stats.up)}</dd></div>
        <div><dt>Descent</dt><dd class="mono">↓ {heightLabel(stats.down)}</dd></div>
        <div><dt>Lowest</dt><dd class="mono">{heightLabel(stats.min)}</dd></div>
        <div><dt>Highest</dt><dd class="mono">{heightLabel(stats.max)}</dd></div>
        <div><dt>Steepest</dt><dd class="mono">{Math.round(gradeDegrees(steepest))}°</dd></div>
      </dl>
    </div>
  {/if}

  <div class="plot" bind:clientWidth={width} bind:clientHeight={height}>
    {#if chart}
      <svg
        {width}
        {height}
        viewBox="0 0 {width} {height}"
        role="img"
        aria-label="Heights along the line"
        onpointermove={pointerAt}
        onpointerleave={pointerGone}
      >
        {#each chart.yTicks as tick (tick.label)}
          <line class="grid" x1="44" x2={width - 10} y1={tick.y} y2={tick.y} />
          <text class="axis" x="38" y={tick.y + 3.5} text-anchor="end">{tick.label}</text>
        {/each}
        {#each chart.xTicks as tick (tick.label)}
          <line class="tick" x1={tick.x} x2={tick.x} y1={chart.floor} y2={chart.floor + 4} />
          <text class="axis" x={tick.x} y={height - 6} text-anchor={tick.x < 60 ? 'start' : 'middle'}>{tick.label}</text>
        {/each}
        <path class="area" d={chart.area} />
        <path class="crest" d={chart.line} />
        <line class="base" x1="44" x2={width - 10} y1={chart.floor} y2={chart.floor} />
        {#if chart.sight}
          <path class="sight" class:clear={sight.visible} d={chart.sight.path} />
          <circle class="end" cx={chart.sight.eye.x} cy={chart.sight.eye.y} r="3.5" />
          <circle class="end" cx={chart.sight.target.x} cy={chart.sight.target.y} r="3.5" />
        {/if}
        <text class="end-name" x={chart.tops[0].x + 6} y={chart.floor - 6}>A</text>
        <text class="end-name" x={chart.tops.at(-1).x - 6} y={chart.floor - 6} text-anchor="end">B</text>
        {#if stretchLabel(chart.stretch)}
          <text class="stretch" x={width - 12} y="20" text-anchor="end">{stretchLabel(chart.stretch)}</text>
        {/if}
        {#if chart.blocked}
          <circle class="block" cx={chart.blocked.x} cy={chart.blocked.y} r="4.5" />
        {/if}
        {#if reading}
          <line class="rule" x1={reading.at.x} x2={reading.at.x} y1="10" y2={chart.floor} />
          <circle class="here" cx={reading.at.x} cy={reading.at.y} r="4.5" />
        {/if}
      </svg>
      {#if reading}
        <div
          class="reading"
          class:flip
          style:left={`${reading.at.x + (flip ? -10 : 10)}px`}
          style:top={`${Math.max(4, reading.at.y - 40)}px`}
        >
          <strong class="mono">{heightLabel(reading.height)}</strong>
          <span class="mono">{distanceLabel(reading.distance)} · {gradeLabel(reading.grade)}</span>
        </div>
      {/if}
    {:else if busy}
      <p class="waiting">Reading the ground along the line…</p>
    {/if}
    {#if error}
      <p class="failed">{error}</p>
    {/if}
    {#if busy && chart}<div class="busy" aria-hidden="true"></div>{/if}
  </div>
</div>

<style>
  .elevation {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .facts {
    display: flex;
    align-items: center;
    gap: 18px;
    flex-wrap: wrap;
  }
  .stats {
    display: flex;
    gap: 16px;
    margin: 0;
    flex-wrap: wrap;
  }
  .stats div {
    display: grid;
  }
  .stats dt {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-3);
  }
  .stats dd {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-1);
  }
  .plot {
    position: relative;
    flex: 1;
    min-height: 90px;
    overflow: hidden;
  }
  svg {
    position: absolute;
    inset: 0;
    display: block;
    cursor: crosshair;
    touch-action: none;
  }
  .grid {
    stroke: rgba(255, 255, 255, 0.07);
  }
  .tick,
  .base {
    stroke: rgba(255, 255, 255, 0.25);
  }
  .axis {
    font-family: var(--font-mono);
    font-size: 10px;
    fill: var(--text-3);
  }
  .crest {
    fill: none;
    stroke: #4cc3ff;
    stroke-width: 1.8;
    stroke-linejoin: round;
  }
  .sight {
    fill: none;
    stroke: var(--danger, #e5484d);
    stroke-width: 1.4;
    stroke-dasharray: 5 4;
  }
  .sight.clear {
    stroke: var(--ok, #46a758);
  }
  .end {
    fill: #fff;
    stroke: rgba(0, 0, 0, 0.6);
    stroke-width: 1;
  }
  .block {
    fill: var(--danger, #e5484d);
    stroke: #fff;
    stroke-width: 1.5;
  }
  .rule {
    stroke: rgba(255, 255, 255, 0.55);
    stroke-width: 1;
  }
  .here {
    fill: #111;
    stroke: #4cc3ff;
    stroke-width: 2.5;
  }
  .reading {
    position: absolute;
    display: grid;
    gap: 1px;
    padding: 5px 8px;
    border-radius: var(--r-sm);
    background: rgba(10, 10, 10, 0.92);
    box-shadow: 0 0 0 1px var(--border), var(--shadow-2);
    pointer-events: none;
    white-space: nowrap;
  }
  .reading.flip {
    transform: translateX(-100%);
  }
  .reading strong {
    font-size: var(--fs-sm);
    color: var(--text-1);
  }
  .reading span {
    font-size: 10px;
    color: var(--text-2);
  }
  .waiting,
  .failed {
    margin: 0;
    padding: 12px 0;
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .failed {
    color: var(--warn);
  }
  /* a line read again after a corner moved: the old chart stays, a bar runs */
  .busy {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 2px;
    background: linear-gradient(90deg, transparent, #4cc3ff, transparent);
    animation: sweep 1.1s linear infinite;
  }
  @keyframes sweep {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(100%);
    }
  }
  .area {
    fill: rgba(76, 195, 255, 0.15);
  }
  .end-name {
    fill: #9fd8ff;
    font-size: 11px;
    font-weight: 700;
  }
  .stretch {
    fill: var(--text-3);
    font-size: 10px;
  }
</style>
