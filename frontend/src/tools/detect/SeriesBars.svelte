<script>
  /**
   * A routine's passes as a chart, one column a pass, oldest on the left.
   *
   * `kind="count"` stacks the candidates found, as one total or by area in the
   * areas' colours, with an amber cap on what is still to review. `kind="change"`
   * draws the spots that appeared above a zero line and the ones that left under
   * it, against the pass before. Pointing at a column says what it holds; pressing
   * it opens that pass. Both kinds share their margins, so stacked one over the
   * other their columns line up.
   */
  import { shortDay, spansYears } from '../../lib/map/detectSeries.js';

  let {
    passes = [],
    kind = 'count',
    /** 'total', or 'area' to stack by area. */
    mode = 'total',
    areaIds = [],
    colours = {},
    names = {},
    /** The pass whose run is open or pointed at elsewhere, drawn ringed. */
    current = null,
    height = 150,
    label = 'Candidates per pass',
    onpick = () => {},
  } = $props();

  const LEFT = 28;
  const RIGHT = 6;
  const BOTTOM = 20;
  const TOP = 16;

  let width = $state(320);
  let hovered = $state(null);

  const year = $derived(spansYears(passes.map((pass) => pass.date)));
  const plotW = $derived(Math.max(40, width - LEFT - RIGHT));
  const band = $derived(passes.length ? plotW / passes.length : plotW);
  const barW = $derived(Math.max(3, Math.min(28, band * 0.66)));
  const xOf = (index) => LEFT + index * band + band / 2;

  /** A rounded top for the axis, and its ticks. */
  function niceTop(value) {
    if (value <= 4) return { top: Math.max(1, value), step: 1 };
    const raw = value / 4;
    const power = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((f) => f * power).find((s) => s >= raw) ?? power * 10;
    return { top: Math.ceil(value / step) * step, step };
  }

  const peak = $derived(kind === 'count'
    ? Math.max(1, ...passes.map((pass) => pass.counts.total))
    : Math.max(1, ...passes.map((pass) => Math.max(pass.arrived.length, pass.left.length))));
  const scale = $derived(niceTop(peak));
  const ticks = $derived(Array.from({ length: Math.floor(scale.top / scale.step) + 1 }, (_, i) => i * scale.step));
  const zero = $derived(kind === 'count' ? height - BOTTOM : TOP + (height - BOTTOM - TOP) / 2);
  const reach = $derived(kind === 'count' ? height - BOTTOM - TOP : (height - BOTTOM - TOP) / 2);
  const yOf = (value) => zero - (value / scale.top) * reach;

  /** Every k-th day labelled so the labels never touch; the newest always is. */
  const every = $derived(Math.max(1, Math.ceil((year ? 64 : 40) / band)));
  const labelled = (index) => index === passes.length - 1 || (index % every === 0 && passes.length - 1 - index >= every / 1.5);

  function segments(pass) {
    if (mode !== 'area') return [{ id: 'all', value: pass.counts.total, colour: 'var(--info)' }];
    return areaIds.map((id) => ({ id, value: pass.byArea[id]?.total ?? 0, colour: colours[id] ?? 'var(--info)' }))
      .filter((part) => part.value > 0);
  }

  function tip(pass) {
    const day = shortDay(pass.date, true);
    if (kind === 'change') {
      if (!pass.compared) return { day, lines: ['First pass of its areas: nothing to compare with'] };
      return { day, lines: [`${pass.arrived.length} appeared`, `${pass.left.length} left`] };
    }
    const lines = [`${pass.counts.total} candidate${pass.counts.total === 1 ? '' : 's'}`];
    if (mode === 'area' || areaIds.length > 1) {
      for (const id of areaIds) {
        if (!pass.read.has(id)) lines.push(`${names[id] ?? 'Area'}: not read`);
        else lines.push(`${names[id] ?? 'Area'}: ${pass.byArea[id]?.total ?? 0}`);
      }
    }
    if (pass.counts.toReview) lines.push(`${pass.counts.toReview} to review`);
    return { day, lines };
  }
  const readout = $derived((hovered === null ? null : passes[hovered]) ?? passes.find((pass) => pass.id === current) ?? passes.at(-1) ?? null);
  const unread = (pass) => areaIds.length > 0 && areaIds.every((id) => !pass.read.has(id));
</script>

<div class="chart" bind:clientWidth={width} role="group" aria-label={label}>
  <svg {width} {height} viewBox={`0 0 ${width} ${height}`}>
    {#each ticks as tick (tick)}
      <line class="grid" x1={LEFT} x2={width - RIGHT} y1={yOf(tick)} y2={yOf(tick)} />
      <text class="axis" x={LEFT - 6} y={yOf(tick) + 3.5} text-anchor="end">{tick}</text>
      {#if kind === 'change' && tick > 0}
        <line class="grid" x1={LEFT} x2={width - RIGHT} y1={zero + (tick / scale.top) * reach} y2={zero + (tick / scale.top) * reach} />
        <text class="axis" x={LEFT - 6} y={zero + (tick / scale.top) * reach + 3.5} text-anchor="end">{tick}</text>
      {/if}
    {/each}
    <line class="base" x1={LEFT} x2={width - RIGHT} y1={zero} y2={zero} />

    {#each passes as pass, index (pass.id)}
      {@const x = xOf(index) - barW / 2}
      {@const on = hovered === index || current === pass.id}
      <g class="column" class:on class:dim={hovered !== null && hovered !== index} role="button" tabindex="0"
        aria-label={`${tip(pass).day}: ${tip(pass).lines.join(', ')}. Open this pass`}
        onpointerenter={() => (hovered = index)} onpointerleave={() => (hovered = null)}
        onfocus={() => (hovered = index)} onblur={() => (hovered = null)}
        onclick={() => onpick(pass)}
        onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onpick(pass); } }}>
        <rect class="hit" x={LEFT + index * band} y={TOP - 10} width={band} height={height - BOTTOM - TOP + 10} />
        {#if kind === 'count'}
          {#if unread(pass)}
            <rect class="unread" x={x} y={zero - 10} width={barW} height={10} rx="2" />
          {:else}
            {@const parts = segments(pass)}
            {#each parts as part, at (part.id)}
              {@const below = parts.slice(0, at).reduce((sum, p) => sum + p.value, 0)}
              <rect class="bar" x={x} y={yOf(below + part.value)} width={barW}
                height={Math.max(0, yOf(below) - yOf(below + part.value) - (at < parts.length - 1 ? 1 : 0))}
                rx={at === parts.length - 1 ? 2 : 0} style:fill={part.colour} />
            {/each}
            {#if pass.counts.toReview}
              {@const total = pass.counts.total}
              {#if mode === 'area'}
                <circle class="review-dot" cx={xOf(index)} cy={yOf(total) - (band >= 18 ? 16 : 5)} r="2.6" />
              {:else}
                <rect class="review" x={x} y={yOf(total)} width={barW}
                  height={Math.max(2, yOf(total - pass.counts.toReview) - yOf(total))} rx="2" />
              {/if}
            {/if}
            {#if band >= 18 && pass.counts.total}
              <text class="value" x={xOf(index)} y={yOf(pass.counts.total) - 4} text-anchor="middle">{pass.counts.total}</text>
            {/if}
          {/if}
        {:else if pass.compared}
          {#if pass.arrived.length}
            <rect class="up" x={x} y={yOf(pass.arrived.length)} width={barW} height={zero - yOf(pass.arrived.length) - 0.5} rx="2" />
            {#if band >= 18}<text class="value" x={xOf(index)} y={yOf(pass.arrived.length) - 4} text-anchor="middle">{pass.arrived.length}</text>{/if}
          {/if}
          {#if pass.left.length}
            <rect class="down" x={x} y={zero + 0.5} width={barW} height={(pass.left.length / scale.top) * reach} rx="2" />
            {#if band >= 18}<text class="value" x={xOf(index)} y={zero + (pass.left.length / scale.top) * reach + 11} text-anchor="middle">{pass.left.length}</text>{/if}
          {/if}
          {#if !pass.arrived.length && !pass.left.length}<circle class="still" cx={xOf(index)} cy={zero} r="2" />{/if}
        {/if}
        {#if on}<rect class="ring" x={x - 2.5} y={TOP - 6} width={barW + 5} height={height - BOTTOM - TOP + 8} rx="3" />{/if}
        {#if labelled(index)}
          <text class="day" class:strong={on} x={xOf(index)} y={height - 5} text-anchor="middle">{shortDay(pass.date, year && (index === 0 || pass.date.slice(0, 4) !== passes[index - 1]?.date.slice(0, 4)))}</text>
        {/if}
      </g>
    {/each}
  </svg>
  {#if readout}
    {@const said = tip(readout)}
    <!-- what the column pointed at holds, or the newest pass when none is -->
    <p class="readout" aria-live="polite"><strong>{said.day}</strong>{#each said.lines as line (line)}<span>{line}</span>{/each}</p>
  {/if}
</div>

<style>
  .chart { position: relative; width: 100%; min-width: 0; user-select: none; }
  svg { display: block; overflow: visible; }
  .grid { stroke: var(--border); stroke-width: 1; }
  .base { stroke: var(--border-strong); stroke-width: 1; }
  .axis { fill: var(--text-3); font: 10px var(--font-sans); font-variant-numeric: tabular-nums; }
  .day { fill: var(--text-3); font: 10px var(--font-sans); }
  .day.strong { fill: var(--text-1); font-weight: 600; }
  .value { fill: var(--text-2); font: 600 10px var(--font-sans); font-variant-numeric: tabular-nums; pointer-events: none; }
  .column { cursor: pointer; outline: none; }
  .column .hit { fill: transparent; }
  .column.dim .bar, .column.dim .up, .column.dim .down { opacity: 0.45; }
  .bar, .up, .down, .review { transition: opacity 120ms var(--ease); }
  .up { fill: var(--ok); }
  .down { fill: var(--danger); }
  .review { fill: var(--accent); }
  .review-dot { fill: var(--accent); }
  .unread { fill: none; stroke: var(--text-3); stroke-dasharray: 2 2; }
  .still { fill: var(--text-3); }
  .ring { fill: none; stroke: var(--text-2); stroke-width: 1; stroke-dasharray: 3 2; pointer-events: none; }
  .column:focus-visible .ring, .column:focus-visible .hit { stroke: var(--accent); }
  .readout {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 10px;
    min-height: 18px;
    margin: 4px 0 0;
    padding-left: 28px;
    color: var(--text-2);
    font-size: var(--fs-xs);
    line-height: 1.4;
    font-variant-numeric: tabular-nums;
  }
  .readout strong { color: var(--text-1); font-weight: 650; }
</style>
