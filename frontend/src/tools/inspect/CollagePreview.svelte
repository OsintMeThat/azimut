<script>
  import { fileUrl } from '../../lib/fileUrl.js';
  import Icon from '../../components/Icon.svelte';

  // What a collage looks like in its list: the preview the tool drew, or the
  // pieces' outlines until it has drawn one.
  let { row, caseId, iconSize = 18 } = $props();

  const src = $derived(row.thumb ? `${fileUrl(caseId, row.thumb)}?v=${row.thumb_v ?? ''}` : null);
</script>

<span class="preview">
  {#if src}
    <img {src} alt="" loading="lazy" draggable="false" />
  {:else if row.outline}
    <svg viewBox={`0 0 ${row.outline.width} ${row.outline.height}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {#each row.outline.quads as quad, i (i)}
        <polygon points={quad.map(([x, y]) => `${x},${y}`).join(' ')} vector-effect="non-scaling-stroke" />
      {/each}
    </svg>
  {:else}
    <Icon name="grid" size={iconSize} />
  {/if}
</span>

<style>
  /* The frame sets the size and the picture fits inside it, so a tall collage
     cannot stretch its card. */
  .preview {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    overflow: hidden;
    color: var(--text-3);
    background: var(--bg-0);
  }
  img,
  svg {
    position: absolute;
    inset: 6%;
    width: 88%;
    height: 88%;
    object-fit: contain;
  }
  polygon {
    fill: color-mix(in srgb, var(--accent) 12%, transparent);
    stroke: var(--text-3);
    stroke-width: 1;
  }
</style>
