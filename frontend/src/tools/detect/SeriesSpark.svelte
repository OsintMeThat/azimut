<script>
  /**
   * A routine's runs at a glance: one small bar a pass, its height the candidates
   * found, the newest drawn brighter, an amber cap on what is still to review.
   * Decoration beside words that say the same, so it is hidden from readers.
   */
  let { values = [], width = 84, height = 18, max = 0, tint = 'var(--info)' } = $props();

  const shown = $derived(values.slice(-24));
  const top = $derived(Math.max(max, ...shown.map((entry) => entry.value), 1));
  const step = $derived(shown.length ? width / shown.length : width);
  const bar = $derived(Math.max(1.5, Math.min(6, step - 1.5)));
</script>

{#if shown.length > 1}
  <svg class="spark" {width} {height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style:--tint={tint}>
    {#each shown as entry, index (index)}
      {@const tall = Math.max(entry.value ? 2 : 1, (entry.value / top) * (height - 1))}
      {@const review = Math.min(tall, (entry.toReview / top) * (height - 1))}
      {@const x = index * step + (step - bar) / 2}
      <rect class="bar" class:newest={index === shown.length - 1} class:none={!entry.value}
        {x} y={height - tall} width={bar} height={tall} rx="1" />
      {#if review > 0}<rect class="review" {x} y={height - tall} width={bar} height={Math.max(1.5, review)} rx="1" />{/if}
    {/each}
  </svg>
{/if}

<style>
  .spark { display: block; flex: none; overflow: visible; }
  .bar { fill: var(--tint); opacity: 0.45; }
  .bar.newest { opacity: 1; }
  .bar.none { fill: var(--text-3); opacity: 0.5; }
  .review { fill: var(--accent); }
</style>
