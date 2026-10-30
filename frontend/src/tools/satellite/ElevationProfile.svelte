<script>
  /**
   * The ground along a measured line, as a chart that fills the window it is
   * in and redraws as that window is resized.
   *
   * Round heights up the side, round distances along the bottom, in the
   * analyst's units, the ground filled under its crest. The crest is coloured
   * by what the eye at A sees of it, the hidden ground shaded, or by how steep
   * each stretch is (`mode`). With a line of sight asked for, the eye and the
   * target stand on their posts over A and B, the sight drawn straight between
   * them over a ground raised by the Earth's bulge, and cut where the ground
   * stands in its way.
   *
   * The pointer reads it both ways: over the chart a rule follows the hand and
   * a card says how high, how far along, how steep and how far the sight passes
   * over the ground there, the same point marked on the map; over the line on
   * the map, the chart reads where the pointer is. A click, or Enter, brings
   * that point to the middle of the map, and the arrows walk the crest.
   */
  import { formatDistance, formatHeight } from '../../lib/measure.js';
  import { clearanceAt, gradeDegrees, profileChart, sampleNear, slopeBand, slopes, SLOPE_BANDS, stretchLabel } from '../../lib/profile.js';

  let {
    profile,
    busy = false,
    error = '',
    units = 'metric',
    /** 'sight' colours the crest by what the eye sees, 'slope' by how steep it is. */
    mode = 'sight',
    /** Where the line's inner corners fall along it, in metres. */
    marks = [],
    /** The sample read from the map, the pointer being over the line there. */
    readIndex = null,
    /** The sample under the pointer on the chart, or null when it leaves. */
    onhover = () => {},
    /** A sample clicked on the chart. */
    onpick = () => {},
  } = $props();

  // one chart's gradients never answer to another's
  const uid = `ground-${Math.random().toString(36).slice(2, 8)}`;

  let width = $state(600);
  let height = $state(160);
  let hovered = $state(null);

  const chart = $derived(profile ? profileChart(profile, { width, height, units, marks, top: 16, bottom: 24 }) : null);
  const grades = $derived(profile ? slopes(profile.distance_m, profile.elevation) : []);
  const sight = $derived(profile?.sight ?? null);
  const bySight = $derived(mode === 'sight' && !!chart?.sees.length);
  const shownIndex = $derived(hovered ?? readIndex);
  const reading = $derived.by(() => {
    if (shownIndex == null || !chart || shownIndex >= chart.tops.length) return null;
    const grade = grades[shownIndex];
    return {
      at: chart.tops[shownIndex],
      distance: profile.distance_m[shownIndex],
      height: profile.elevation[shownIndex],
      grade,
      band: slopeBand(grade),
      clearance: clearanceAt(profile, shownIndex),
    };
  });
  // the card stays inside the chart, on whichever side of the rule has room
  const flip = $derived(reading && reading.at.x > width - 190);

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
    onhover(index);
  }

  function pointerGone() {
    hovered = null;
    onhover(null);
  }

  /** The arrows walk the crest a sample at a time (Shift: ten), Enter centres the map there. */
  function keyed(event) {
    const last = profile.distance_m.length - 1;
    const step = event.shiftKey ? 10 : 1;
    const from = hovered ?? readIndex ?? 0;
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(last, from + step);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(0, from - step);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if ((event.key === 'Enter' || event.key === ' ') && hovered != null) {
      // the map's own keys (Shift and an arrow turn it) stay off while the chart reads
      event.preventDefault();
      event.stopPropagation();
      onpick(hovered);
      return;
    }
    if (next == null) return;
    event.preventDefault();
    event.stopPropagation();
    hovered = next;
    onhover(next);
  }

  function pick(event) {
    if (!chart) return;
    const box = event.currentTarget.getBoundingClientRect();
    onpick(sampleNear(chart.tops, event.clientX - box.left));
  }

  const distanceLabel = (d) => formatDistance(d, units);
  const heightLabel = (h) => formatHeight(h, units);
  const gradeLabel = (g) => `${g > 0 ? '↗' : g < 0 ? '↘' : '→'} ${Math.abs(Math.round(g))}% · ${Math.round(gradeDegrees(g))}°`;
</script>

<div class="plot" bind:clientWidth={width} bind:clientHeight={height}>
  {#if chart}
    {#key profile}
      <svg
        class="chart"
        {width}
        {height}
        viewBox="0 0 {width} {height}"
        role="slider"
        tabindex="0"
        aria-label="Heights along the line: arrows read it, Enter centres the map there"
        aria-valuemin="0"
        aria-valuemax={profile.distance_m.length - 1}
        aria-valuenow={shownIndex ?? 0}
        aria-valuetext={reading ? `${distanceLabel(reading.distance)} along, ${heightLabel(reading.height)}` : 'Not read'}
        onpointermove={pointerAt}
        onpointerleave={pointerGone}
        onclick={pick}
        onkeydown={keyed}
      >
        <defs>
          <linearGradient id="{uid}-ground" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#4cc3ff" stop-opacity="0.32" />
            <stop offset="1" stop-color="#4cc3ff" stop-opacity="0.02" />
          </linearGradient>
          <linearGradient id="{uid}-hidden" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#e05252" stop-opacity="0.34" />
            <stop offset="1" stop-color="#e05252" stop-opacity="0.04" />
          </linearGradient>
          <linearGradient id="{uid}-rule" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fff" stop-opacity="0" />
            <stop offset="0.35" stop-color="#fff" stop-opacity="0.55" />
            <stop offset="1" stop-color="#fff" stop-opacity="0.15" />
          </linearGradient>
        </defs>

        {#each chart.yTicks as tick (tick.label)}
          <line class="grid" x1="44" x2={width - 10} y1={tick.y} y2={tick.y} />
          <text class="axis" x="38" y={tick.y + 3.5} text-anchor="end">{tick.label}</text>
        {/each}
        {#each chart.xTicks as tick (tick.label)}
          <line class="tick" x1={tick.x} x2={tick.x} y1={chart.floor} y2={chart.floor + 4} />
          <text class="axis" x={tick.x} y={height - 7} text-anchor={tick.x < 60 ? 'start' : 'middle'}>{tick.label}</text>
        {/each}

        <path d={chart.area} fill="url(#{uid}-ground)" />
        {#if bySight}
          {#each chart.hidden as shade, i (i)}
            <path d={shade} fill="url(#{uid}-hidden)" />
          {/each}
        {/if}

        {#each chart.corners as corner (corner.n)}
          <line class="corner" x1={corner.x} x2={corner.x} y1="16" y2={chart.floor} />
        {/each}

        <path class="crest" class:under={bySight || mode === 'slope'} d={chart.line} />
        {#if bySight}
          {#each chart.sees as run, i (i)}
            <path class="sees" class:hidden={!run.seen} d={run.path} />
          {/each}
        {:else if mode === 'slope'}
          {#each chart.steepness as run, i (i)}
            <path class="slope" style:stroke={run.colour} d={run.path} />
          {/each}
        {/if}

        {#if chart.sight}
          {#each chart.sight.posts as post, i (i)}
            <path class="post" d={post} />
          {/each}
          {#if chart.sight.cut}
            <path class="sight" d={chart.sight.clear} />
            <path class="sight cut" d={chart.sight.cut} />
          {:else}
            <path class="sight" class:clear={sight.visible} d={chart.sight.path} />
          {/if}
          <g class="eye" transform="translate({chart.sight.eye.x} {chart.sight.eye.y})">
            <circle r="6.5" class="halo" />
            <circle r="3.5" />
          </g>
          <g class="target" class:missed={!sight.visible} transform="translate({chart.sight.target.x} {chart.sight.target.y})">
            <circle r="6.5" class="halo" />
            <circle r="3.5" />
          </g>
          {#if chart.blocked}
            <g class="block" transform="translate({chart.blocked.x} {chart.blocked.y})">
              <circle r="8" class="halo" />
              <path d="M-3,-3 L3,3 M3,-3 L-3,3" />
            </g>
            <text class="block-say" x={chart.blocked.x} y={chart.blocked.y - 13} text-anchor="middle">in the way</text>
          {/if}
        {/if}

        <line class="base" x1="44" x2={width - 10} y1={chart.floor} y2={chart.floor} />
        {#each chart.corners as corner (corner.n)}
          <circle class="corner-dot" cx={corner.x} cy={chart.floor} r="6.5" />
          <text class="corner-n" x={corner.x} y={chart.floor + 3} text-anchor="middle">{corner.n}</text>
        {/each}
        <g class="end" transform="translate({chart.tops[0].x} {chart.floor})">
          <circle r="8" />
          <text y="3.5" text-anchor="middle">A</text>
        </g>
        <g class="end" transform="translate({chart.tops.at(-1).x} {chart.floor})">
          <circle r="8" />
          <text y="3.5" text-anchor="middle">B</text>
        </g>
        {#if stretchLabel(chart.stretch)}
          <text class="stretch" x={width - 12} y="11" text-anchor="end">
            {stretchLabel(chart.stretch)}<title>The heights are drawn taller than the distances, to read the ground</title>
          </text>
        {/if}

        {#if reading}
          <line x1={reading.at.x} x2={reading.at.x} y1="12" y2={chart.floor} stroke="url(#{uid}-rule)" />
          <line class="level" x1="44" x2={reading.at.x} y1={reading.at.y} y2={reading.at.y} />
          <circle class="here-halo" cx={reading.at.x} cy={reading.at.y} r="8" />
          <circle class="here" cx={reading.at.x} cy={reading.at.y} r="4" />
        {/if}
      </svg>
    {/key}

    <div class="legend" aria-hidden="true">
      {#if bySight}
        <span><i class="swatch seen"></i>seen from A</span>
        <span><i class="swatch hid"></i>hidden from A</span>
      {:else if mode === 'slope'}
        <span class="scale">
          flat
          {#each SLOPE_BANDS as band (band.id)}<i class="band" style:background={band.colour} title={band.label}></i>{/each}
          25°+
        </span>
      {/if}
    </div>

    {#if reading}
      <div
        class="reading"
        class:flip
        style:left={`${reading.at.x + (flip ? -14 : 14)}px`}
        style:top={`${Math.max(4, Math.min(height - 100, reading.at.y - 46))}px`}
      >
        <strong class="mono">{heightLabel(reading.height)}</strong>
        <span class="mono">{distanceLabel(reading.distance)} from A</span>
        <span class="grade mono" style:--band={reading.band.colour}>{gradeLabel(reading.grade)}</span>
        {#if reading.clearance != null}
          <span class="clearance" class:under={reading.clearance < 0}>
            Sight {heightLabel(Math.abs(reading.clearance))} {reading.clearance < 0 ? 'under' : 'over'} the ground
          </span>
        {/if}
      </div>
    {/if}
  {:else if busy}
    <div class="skeleton" role="status">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
        <path d="M0,30 C12,22 20,26 30,18 S48,8 58,16 S78,30 88,20 S96,14 100,16 L100,40 L0,40 Z" />
      </svg>
      <p>Reading the ground along the line…</p>
    </div>
  {/if}
  {#if error}
    <p class="failed">{error}</p>
  {/if}
  {#if busy && chart}<div class="busy" aria-hidden="true"></div>{/if}
</div>

<style>
  .plot {
    position: relative;
    flex: 1;
    min-height: 110px;
    overflow: hidden;
  }
  .chart {
    position: absolute;
    inset: 0;
    display: block;
    cursor: crosshair;
    touch-action: none;
    animation: arrive 0.28s var(--ease);
  }
  .chart:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  @keyframes arrive {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  .grid {
    stroke: rgba(255, 255, 255, 0.06);
    stroke-dasharray: 2 4;
  }
  .tick,
  .base {
    stroke: rgba(255, 255, 255, 0.22);
  }
  .axis {
    font-family: var(--font-mono);
    font-size: 10px;
    fill: var(--text-3);
  }
  .crest {
    fill: none;
    stroke: #7dd3fc;
    stroke-width: 2;
    stroke-linejoin: round;
    filter: drop-shadow(0 0 3px rgba(76, 195, 255, 0.45));
  }
  .crest.under {
    stroke-opacity: 0.25;
    filter: none;
  }
  .sees,
  .slope {
    fill: none;
    stroke-width: 2.6;
    stroke-linejoin: round;
    stroke-linecap: round;
  }
  .sees {
    stroke: #6fcf97;
    filter: drop-shadow(0 0 3px rgba(111, 207, 151, 0.4));
  }
  .sees.hidden {
    stroke: #e05252;
    filter: drop-shadow(0 0 3px rgba(224, 82, 82, 0.4));
  }
  .corner {
    stroke: rgba(255, 255, 255, 0.14);
    stroke-dasharray: 3 3;
  }
  .corner-dot {
    fill: #1b1b1b;
    stroke: rgba(245, 166, 35, 0.85);
    stroke-width: 1.2;
  }
  .corner-n {
    fill: #f5a623;
    font: 700 8.5px var(--font-mono);
  }
  .post {
    stroke: rgba(255, 255, 255, 0.5);
    stroke-width: 1.2;
    stroke-dasharray: 1.5 2.5;
  }
  .sight {
    fill: none;
    stroke: rgba(255, 255, 255, 0.8);
    stroke-width: 1.5;
    stroke-dasharray: 6 4;
  }
  .sight.clear {
    stroke: #6fcf97;
  }
  .sight.cut {
    stroke: #e05252;
    stroke-opacity: 0.85;
  }
  .eye circle,
  .target circle {
    fill: #fff;
    stroke: #0d0d0d;
    stroke-width: 1.2;
  }
  .eye .halo {
    fill: rgba(255, 255, 255, 0.14);
    stroke: none;
  }
  .target .halo {
    fill: rgba(111, 207, 151, 0.22);
    stroke: none;
  }
  .target.missed .halo {
    fill: rgba(224, 82, 82, 0.24);
  }
  .block .halo {
    fill: rgba(224, 82, 82, 0.28);
    stroke: #e05252;
    stroke-width: 1.5;
  }
  .block path {
    stroke: #fff;
    stroke-width: 1.8;
    stroke-linecap: round;
  }
  .block-say {
    fill: #f0a0a0;
    font-size: 10px;
    font-weight: 600;
  }
  .end circle {
    fill: #f5a623;
    stroke: #1a1a1a;
    stroke-width: 1.5;
  }
  .end text {
    fill: #141414;
    font: 700 10px var(--font-sans);
  }
  .stretch {
    fill: var(--text-3);
    font-size: 10px;
  }
  .level {
    stroke: rgba(255, 255, 255, 0.18);
    stroke-dasharray: 2 3;
  }
  .here-halo {
    fill: rgba(76, 195, 255, 0.22);
  }
  .here {
    fill: #0f0f0f;
    stroke: #fff;
    stroke-width: 2;
  }
  .legend {
    position: absolute;
    left: 50px;
    top: 0;
    display: flex;
    gap: 12px;
    font-size: 10px;
    color: var(--text-3);
    pointer-events: none;
  }
  .legend span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .swatch {
    width: 12px;
    height: 3px;
    border-radius: 2px;
  }
  .scale {
    gap: 1px !important;
  }
  .scale .band {
    width: 14px;
    height: 4px;
  }
  .scale .band:first-of-type {
    margin-left: 4px;
    border-radius: 2px 0 0 2px;
  }
  .scale .band:last-of-type {
    margin-right: 4px;
    border-radius: 0 2px 2px 0;
  }
  .swatch.seen {
    background: #6fcf97;
  }
  .swatch.hid {
    background: #e05252;
  }
  .reading {
    position: absolute;
    display: grid;
    gap: 2px;
    min-width: 136px;
    padding: 7px 10px 8px;
    border-radius: var(--r-lg);
    background: rgba(12, 12, 12, 0.94);
    box-shadow: 0 0 0 1px var(--border-strong), var(--shadow-2);
    pointer-events: none;
    white-space: nowrap;
  }
  .reading.flip {
    transform: translateX(-100%);
  }
  .reading strong {
    font-size: var(--fs-lg);
    color: var(--text-1);
    line-height: 1.15;
  }
  .reading span {
    font-size: 10.5px;
    color: var(--text-2);
  }
  .reading .grade {
    justify-self: start;
    margin-top: 3px;
    padding: 1px 7px;
    border-radius: 999px;
    color: #141414;
    background: var(--band);
    font-weight: 700;
  }
  .reading .clearance {
    margin-top: 2px;
    color: #8fdcae;
  }
  .reading .clearance.under {
    color: #f0a0a0;
  }
  .skeleton {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }
  .skeleton svg {
    position: absolute;
    left: 44px;
    right: 10px;
    top: 18px;
    bottom: 24px;
    width: calc(100% - 54px);
    height: calc(100% - 42px);
  }
  .skeleton path {
    fill: rgba(76, 195, 255, 0.08);
    animation: breathe 1.4s ease-in-out infinite;
  }
  .skeleton p {
    position: relative;
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  @keyframes breathe {
    50% {
      fill: rgba(76, 195, 255, 0.16);
    }
  }
  .failed {
    position: absolute;
    inset: auto 0 6px;
    margin: 0;
    text-align: center;
    font-size: var(--fs-xs);
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
</style>
