<script>
  /**
   * A figure template drawn small: an infographic's page, its band and its panels laid out
   * as the engine lays them (half panels in two columns, a wide one under both), each chart
   * its kind's sketch; a chart alone as its kind's sketch; a map as a map. Shapes only, never
   * a number (`lib/notes/figureTemplates.js`, `sketchLayout`).
   */
  import { kindSketch } from '../../lib/notes/editor/chartForm.js';
  import { readChart, setting } from '../../lib/notes/editor/chartText.js';
  import { sketchLayout } from '../../lib/notes/figureTemplates.js';

  let { data = null, width = 46 } = $props();

  const W = 100;
  const PAD = 6;
  const figure = $derived(data?.figure ?? 'infographic');
  const layout = $derived(figure === 'infographic' ? sketchLayout(data?.text ?? '') : null);
  const height = $derived(layout ? Math.round(Math.max(0.42, layout.height) * W) + PAD * 2 : 70);
  const kind = $derived(figure === 'chart' ? (setting(readChart(data?.text ?? ''), 'kind') || 'bars').toLowerCase() : '');

  /** A chart kind's sketch as SVG, from the gallery's own drawings. */
  function sketch(name) {
    return kindSketch(name).querySelector('svg')?.innerHTML ?? '';
  }
  const MAP = '<path d="M4 8 22 3l20 6 18-5v28l-18 5-20-6-18 5Z" class="k-soft"/><path d="M22 3v28M42 9v28" class="k-axis"/><path d="M10 24c6-6 12 2 18-4s10-8 16-2 8 6 12 2" class="k-line k-c2s"/><circle cx="30" cy="18" r="2.6" class="k-c1f"/>';
  const WORDS = '<rect x="4" y="6" width="34" height="5" rx="1" class="k-ink"/><rect x="4" y="16" width="56" height="3" rx="1" class="k-mute"/><rect x="4" y="23" width="50" height="3" rx="1" class="k-mute"/><rect x="4" y="30" width="38" height="3" rx="1" class="k-mute"/>';
  const inner = (box) => (box.kind === 'map' ? MAP : box.kind === 'words' ? WORDS : sketch(box.chartKind || 'bars'));
</script>

<svg class="fts" viewBox={`0 0 ${W + PAD * 2} ${height}`} width={width} height={Math.round((width * height) / (W + PAD * 2))}
  role="img" aria-label={figure === 'infographic' ? `A page of ${layout?.boxes.length ?? 0} panels` : figure === 'chart' ? `A ${kind} chart` : 'A map'}>
  <rect class="fts-page" x="0.5" y="0.5" width={W + PAD * 2 - 1} height={height - 1} rx="3" />
  <g class="cf-sketch">
    {#if layout}
      {#if layout.band}
        <rect x={PAD} y={PAD} width={W * 0.3} height="3" rx="1" class="k-mute" />
        <rect x={PAD} y={PAD + 6} width={W * 0.78} height="6" rx="1.5" class="k-ink" />
      {/if}
      {#each layout.boxes as box, index (index)}
        <svg x={PAD + box.x * W} y={PAD + box.y * W} width={box.w * W} height={box.h * W} viewBox="0 0 64 40" preserveAspectRatio="xMidYMid meet">
          {@html inner(box)}
        </svg>
      {/each}
      {#if !layout.boxes.length}
        <rect x={PAD} y={PAD + (layout.band ? 18 : 4)} width={W} height="20" rx="2" class="fts-empty" />
      {/if}
    {:else}
      <svg x={PAD} y={PAD} width={W} height={height - PAD * 2} viewBox="0 0 64 40" preserveAspectRatio="xMidYMid meet">
        {@html figure === 'map' ? MAP : sketch(kind)}
      </svg>
    {/if}
  </g>
</svg>

<style>
  .fts { flex: none; display: block; }
  .fts-page { fill: var(--bg-1); stroke: var(--border); }
  .fts-empty { fill: none; stroke: var(--text-3); stroke-dasharray: 3 3; }
</style>
