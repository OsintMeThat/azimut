<script>
  import { quadMatrix3d, collageBounds } from '../../lib/inspect.js';

  // Read-only miniature of a collage layout — the same node quads/urls the Save
  // tab will composite. Framed to the pieces' trimmed bounds (not the full
  // canvas), so the thumbnail matches the exported PNG instead of showing the
  // empty working area around the pieces.
  let { collage } = $props();

  let availW = $state(150);
  let availH = $state(112);

  const bounds = $derived(collageBounds(collage.nodes));
  const scale = $derived(Math.min(availW / bounds.width, availH / bounds.height) || 0);
  const boxOf = (n) => ({ w: n.w || 320, h: n.h || 240, url: n.url });
</script>

<div class="prev" bind:clientWidth={availW} bind:clientHeight={availH}>
  <div
    class="surface"
    class:checker={collage.transparent}
    style:width={`${bounds.width}px`}
    style:height={`${bounds.height}px`}
    style:transform={`scale(${scale})`}
    style:background={collage.transparent ? null : collage.background}
  >
    <div class="layer" style:transform={`translate(${-bounds.minX}px, ${-bounds.minY}px)`}>
      {#each collage.nodes as node (node.id)}
        {@const box = boxOf(node)}
        <img
          class="node"
          src={box.url}
          alt="collage piece"
          style:width={`${box.w}px`}
          style:height={`${box.h}px`}
          style:transform={quadMatrix3d(box.w, box.h, node.quad)}
          draggable="false"
        />
      {/each}
    </div>
  </div>
</div>

<style>
  .prev {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .surface {
    position: relative;
    transform-origin: center;
    flex-shrink: 0;
  }
  .surface.checker {
    background-color: #2a2f3a;
    background-image:
      linear-gradient(45deg, rgba(255, 255, 255, 0.07) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.07) 75%),
      linear-gradient(45deg, rgba(255, 255, 255, 0.07) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.07) 75%);
    background-size: 16px 16px;
    background-position: 0 0, 8px 8px;
  }
  .layer {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
  }
  .node {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    user-select: none;
  }
</style>
