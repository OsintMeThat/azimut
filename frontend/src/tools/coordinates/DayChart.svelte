<script>
  // The day as altitude against local clock time: two lines, the horizon, and
  // the twilight bands. Altitude is the y axis because that is the question the
  // chart answers ("how high, and when"), with azimuth read off the crosshair
  // rather than plotted, so there is one scale and no second y axis.
  //
  // Plain SVG. A charting library would be a dependency for one figure, and the
  // shape is fixed: 145 points, two series.
  // The viewBox is sized to the width the panel actually gives it, so the SVG
  // renders near 1:1: scaled up from a narrower box, the 2px strokes and the
  // 10px labels would grow with it and leave the design system behind.
  const WIDTH = 1100;
  const HEIGHT = 260;
  const PAD = { top: 14, right: 16, bottom: 22, left: 36 };

  let { curve, minutes, selected = null, sun = null, moon = null } = $props();

  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;

  const span = $derived(minutes?.length ? minutes[minutes.length - 1] : 1440);
  // Room for the deepest line plus the astronomical band, so the horizon and the
  // bands are always on screen even during a polar night.
  const low = $derived(
    Math.min(-22, ...(curve?.sun_altitude ?? [0]), ...(curve?.moon_altitude ?? [0])) - 4,
  );
  const high = $derived(
    Math.max(20, ...(curve?.sun_altitude ?? [0]), ...(curve?.moon_altitude ?? [0])) + 6,
  );

  const x = (m) => PAD.left + (m / span) * plotWidth;
  const y = (alt) => PAD.top + ((high - alt) / (high - low)) * plotHeight;

  function line(values) {
    if (!values?.length) return '';
    return values.map((alt, i) => `${i ? 'L' : 'M'}${x(minutes[i]).toFixed(1)},${y(alt).toFixed(1)}`).join('');
  }

  // Bands of sky darkness, read straight off the sun's altitude.
  const bands = $derived([
    { from: 0, to: -6, opacity: 0.28 },
    { from: -6, to: -12, opacity: 0.45 },
    { from: -12, to: -18, opacity: 0.62 },
    { from: -18, to: low, opacity: 0.78 },
  ].filter((b) => b.from > low));

  // Two-hourly, by index rather than by arithmetic on the minute: the label has
  // to be the payload's own wall clock, which is not span/60 on the days
  // daylight saving shortens or lengthens.
  const hours = $derived(
    (minutes ?? [])
      .map((minute, index) => ({ minute, index }))
      .filter(({ minute }) => minute % 120 === 0),
  );

  // Peak of each line, for the direct labels that keep identity off colour alone.
  function peak(values) {
    if (!values?.length) return null;
    let best = 0;
    values.forEach((v, i) => {
      if (v > values[best]) best = i;
    });
    return { minute: minutes[best], altitude: values[best] };
  }
  const sunPeak = $derived(peak(curve?.sun_altitude));
  const moonPeak = $derived(peak(curve?.moon_altitude));

  let hover = $state(null);

  function track(event) {
    const box = event.currentTarget.getBoundingClientRect();
    const at = ((event.clientX - box.left) / box.width) * WIDTH;
    const minute = ((at - PAD.left) / plotWidth) * span;
    if (minute < 0 || minute > span) {
      hover = null;
      return;
    }
    const step = minutes.length > 1 ? minutes[1] - minutes[0] : 10;
    const index = Math.min(minutes.length - 1, Math.max(0, Math.round(minute / step)));
    hover = { index, minute: minutes[index] };
  }

  // Whole degrees: the curve is sampled every ten minutes, so a decimal here
  // would be precision the figure does not have.
  const round = (value) => Math.round(value);
</script>

<figure class="chart">
  <figcaption>
    <span class="key"><i style="background: var(--sky-sun)"></i>Sun</span>
    <span class="key"><i style="background: var(--sky-moon)"></i>Moon</span>
    <span class="axis-note">altitude above the horizon, by local time</span>
  </figcaption>

  <svg
    viewBox="0 0 {WIDTH} {HEIGHT}"
    role="img"
    aria-label="Altitude of the sun and the moon through the day"
    onpointermove={track}
    onpointerleave={() => (hover = null)}
  >
    {#each bands as band (band.from)}
      <rect
        x={PAD.left}
        y={y(band.from)}
        width={plotWidth}
        height={Math.max(0, y(band.to) - y(band.from))}
        fill="var(--text-1)"
        opacity={band.opacity * 0.12}
      />
    {/each}

    {#each hours as tick (tick.minute)}
      <line
        x1={x(tick.minute)}
        y1={PAD.top}
        x2={x(tick.minute)}
        y2={HEIGHT - PAD.bottom}
        stroke="var(--border)"
      />
      <text class="tick" x={x(tick.minute)} y={HEIGHT - 6} text-anchor="middle"
        >{curve?.clock?.[tick.index] ?? ''}</text
      >
    {/each}

    {#each [high > 60 ? 60 : 30, 0] as level (level)}
      <text class="tick" x={PAD.left - 6} y={y(level) + 3} text-anchor="end">{level}°</text>
    {/each}

    <line
      x1={PAD.left}
      y1={y(0)}
      x2={WIDTH - PAD.right}
      y2={y(0)}
      stroke="var(--border-strong)"
      stroke-width="1"
    />

    <path d={line(curve?.moon_altitude)} fill="none" stroke="var(--sky-moon)" stroke-width="2" />
    <path d={line(curve?.sun_altitude)} fill="none" stroke="var(--sky-sun)" stroke-width="2" />

    {#if selected !== null && selected >= 0 && selected <= span}
      <line
        x1={x(selected)}
        y1={PAD.top}
        x2={x(selected)}
        y2={HEIGHT - PAD.bottom}
        stroke="var(--accent)"
        stroke-width="1.5"
      />
      {#if sun !== null}
        <circle cx={x(selected)} cy={y(sun)} r="4" fill="var(--sky-sun)" stroke="var(--bg-1)" stroke-width="2" />
      {/if}
      {#if moon !== null}
        <circle cx={x(selected)} cy={y(moon)} r="4" fill="var(--sky-moon)" stroke="var(--bg-1)" stroke-width="2" />
      {/if}
    {/if}

    {#if sunPeak && sunPeak.altitude > low}
      <text class="series-label" x={x(sunPeak.minute)} y={y(sunPeak.altitude) - 7} text-anchor="middle">Sun</text>
    {/if}
    {#if moonPeak && moonPeak.altitude > low}
      <text class="series-label" x={x(moonPeak.minute)} y={y(moonPeak.altitude) - 7} text-anchor="middle">Moon</text>
    {/if}

    {#if hover}
      <line
        x1={x(hover.minute)}
        y1={PAD.top}
        x2={x(hover.minute)}
        y2={HEIGHT - PAD.bottom}
        stroke="var(--border-strong)"
      />
    {/if}
  </svg>

  <div class="readout" class:muted={!hover}>
    {#if hover}
      <span class="mono">{curve?.clock?.[hover.index] ?? ''}</span>
      <span
        ><i style="background: var(--sky-sun)"></i>az {round(curve.sun_azimuth[hover.index])}° alt
        {round(curve.sun_altitude[hover.index])}°</span
      >
      <span
        ><i style="background: var(--sky-moon)"></i>az {round(curve.moon_azimuth[hover.index])}° alt
        {round(curve.moon_altitude[hover.index])}°</span
      >
    {:else}
      Hover the chart for the azimuth and altitude at any moment.
    {/if}
  </div>
</figure>

<style>
  .chart {
    margin: 0;
  }
  figcaption {
    display: flex;
    align-items: center;
    gap: 14px;
    padding-bottom: 6px;
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .axis-note {
    color: var(--text-3);
  }
  .key,
  .readout span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .key i,
  .readout i {
    width: 9px;
    height: 9px;
    border-radius: 2px;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
    touch-action: none;
  }
  .tick {
    fill: var(--text-3);
    font-size: 10px;
    font-family: var(--font-mono);
  }
  .series-label {
    fill: var(--text-2);
    font-size: 10px;
  }
  .readout {
    display: flex;
    gap: 16px;
    padding-top: 6px;
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .readout.muted {
    color: var(--text-3);
  }
  .readout .mono {
    font-family: var(--font-mono);
    color: var(--text-1);
  }
</style>
