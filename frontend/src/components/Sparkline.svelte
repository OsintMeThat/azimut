<script>
  /**
   * When something was active, as a dozen bars across the case's own span.
   *
   * The same span for every row it is drawn on (`/catalog/events` returns one range),
   * so a column of these reads as who was busy when rather than as shapes that cannot
   * be compared. Each row scales to its own busiest bucket: the count sits beside it
   * in words, and a quiet subject drawn as a flat line would say nothing. An empty
   * bucket keeps its place on the baseline, so a gap reads as a gap.
   */
  let { buckets = [], width = 60, height = 14, label = '' } = $props();

  const peak = $derived(Math.max(1, ...buckets));
  const step = $derived(width / Math.max(1, buckets.length));
  const bars = $derived(
    buckets.map((n, index) => ({
      index,
      n,
      h: n > 0 ? Math.max(2, Math.round((n / peak) * (height - 1))) : 0,
    }))
  );
</script>

<svg
  class="sparkline"
  {width}
  {height}
  viewBox="0 0 {width} {height}"
  role="img"
  aria-label={label}
>
  <line class="base" x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} />
  {#each bars as bar (bar.index)}
    {#if bar.h}
      <rect
        x={bar.index * step + 0.5}
        y={height - bar.h}
        width={Math.max(1, step - 1.5)}
        height={bar.h}
        rx="1"
      />
    {/if}
  {/each}
</svg>

<style>
  .sparkline {
    display: block;
    flex-shrink: 0;
    overflow: visible;
  }
  .base {
    stroke: var(--border-strong);
    stroke-width: 1;
  }
  rect {
    fill: var(--timeline-statement);
  }
</style>
