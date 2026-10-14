<script>
  /**
   * The photo above the terrain it is matched on, the same frame through the
   * same lens, shown over the view when asked (the band's Side by side): the
   * plainest reading of a place, a hill in one found straight under it in the
   * other. The pictures come from the view (HorizonView `exportPicture`), the
   * summit names and the directions as the view placed them for that frame.
   * The trace shows on both: on the terrain, each piece of a cut collage
   * where the search read it (lib/horizon/overlay.js `traceOnTerrain`). A
   * line follows the pointer down both, with the direction it stands at.
   */
  import Icon from '../../components/Icon.svelte';
  import { rayFor } from '../../lib/horizon/camera.js';

  let {
    /** The two pictures, the photo then the terrain, as drawn canvases. */
    frames = [],
    /** The camera they were drawn through, in CSS pixels of the frame. */
    camera,
    /** The summit names and the directions' ticks the view placed for that camera. */
    labels = [],
    ticks = [],
    /** The trace in frame pixels, as traced on the photo and as laid on the terrain, and which strokes are ridges. */
    trace = [],
    traceOnTerrain = [],
    ridges = [],
    /** "Photo" or "Video", what lies over the terrain. */
    what = 'Photo',
    /** Whether the photo was pulled by its corners or edges, which its tag then says. */
    reshaped = false,
    /** Asked to write the pair out as a picture, and whether that is under way. */
    onsave = () => {},
    saving = false,
    onclose = () => {},
  } = $props();

  let room = $state({ width: 0, height: 0 });
  /** Where the pointer stands across the pictures, 0 to 1, or null. */
  let across = $state(null);

  const HEAD = 40;
  const RULER = 22;
  const GAP = 6;
  const PAD = 12;
  const aspect = $derived(camera?.width && camera?.height ? camera.width / camera.height : 16 / 9);
  /** Each picture's size on screen: as large as two fit one over the other. */
  const panel = $derived.by(() => {
    const wide = Math.max(0, room.width - PAD * 2);
    const tall = Math.max(0, (room.height - HEAD - RULER - GAP - PAD * 2) / 2);
    const height = Math.min(tall, wide / aspect);
    return { width: Math.round(height * aspect), height: Math.round(height) };
  });

  const points = (stroke) => stroke.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const percent = (value, whole) => `${((value / whole) * 100).toFixed(3)}%`;
  /** The direction under the pointer, in whole tenths of a degree. */
  const facing = $derived.by(() => {
    if (across == null || !camera) return '';
    const { azimuth } = rayFor(camera, across * camera.width, camera.height / 2);
    return `${(((azimuth % 360) + 360) % 360).toFixed(1)}°`;
  });

  function point(event) {
    const box = event.currentTarget.getBoundingClientRect();
    across = box.width ? Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) : null;
  }

  /** The drawn canvas laid in its place: it is the picture, not a copy of it. */
  const canvasIn = (canvas) => (node) => {
    if (canvas) node.replaceChildren(canvas);
  };

  function onKey(event) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onclose();
  }
</script>

<svelte:window onkeydown={onKey} />

{#snippet over(strokes)}
  <svg class="lines" viewBox="0 0 {camera.width} {camera.height}" preserveAspectRatio="none" aria-hidden="true">
    {#each strokes as stroke, index (index)}
      <polyline class="under" points={points(stroke)} />
      <polyline class="over" class:ridge={ridges[index]} points={points(stroke)} />
    {/each}
  </svg>
  {#each labels as label (label.name + label.x)}
    <span class="name" style:left={percent(label.left + label.width / 2, camera.width)} style:top={percent(label.baseline, camera.height)}
      >{label.name}</span
    >
  {/each}
  {#if across != null}
    <span class="cursor" style:left="{across * 100}%" aria-hidden="true"></span>
  {/if}
{/snippet}

<section class="side" aria-label="{what} above the terrain" bind:clientWidth={room.width} bind:clientHeight={room.height}>
  <header>
    <h2>{what} above the terrain</h2>
    <span class="say">The same frame on both{facing ? ` · ${facing}` : ''}</span>
    <button type="button" class="act" disabled={saving} aria-busy={saving} onclick={onsave} title="Write the two out as one picture">
      <Icon name="download" size={14} /><span>{saving ? 'Saving…' : 'Save as picture'}</span>
    </button>
    <button type="button" class="act icon" onclick={onclose} title="Back to the view (Esc)" aria-label="Close">
      <Icon name="x" size={15} />
    </button>
  </header>
  {#if camera && panel.width > 0}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="stack" style:width="{panel.width}px" onpointermove={point} onpointerleave={() => (across = null)}>
      <figure class="picture" style:height="{panel.height}px">
        <div class="canvas" {@attach canvasIn(frames[0])}></div>
        {@render over(trace)}
        <figcaption class="tag accent">{reshaped ? `${what}, reshaped` : what}</figcaption>
      </figure>
      <div class="ruler" aria-hidden="true">
        {#each ticks as tick (tick.azimuth ?? tick.x)}
          <span class="tick" class:named={tick.named} style:left={percent(tick.x, camera.width)}>{tick.label ?? ''}</span>
        {/each}
        {#if across != null}
          <span class="cursor" style:left="{across * 100}%"></span>
        {/if}
      </div>
      <figure class="picture" style:height="{panel.height}px">
        <div class="canvas" {@attach canvasIn(frames[1])}></div>
        {@render over(traceOnTerrain)}
        <figcaption class="tag">Terrain, simulated</figcaption>
      </figure>
    </div>
  {/if}
</section>

<style>
  .side {
    position: absolute;
    inset: 0;
    z-index: 6;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    padding: 0 12px 12px;
    background: color-mix(in srgb, var(--bg-0) 88%, black);
  }
  header {
    display: flex;
    align-items: center;
    gap: 10px;
    align-self: stretch;
    height: 40px;
    flex: none;
  }
  h2 {
    margin: 0;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-1);
  }
  .say {
    flex: 1;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .act {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-1);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .act.icon {
    width: 28px;
    padding: 0;
    justify-content: center;
  }
  .act:hover:not(:disabled) {
    background: var(--bg-3);
  }
  .act:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .stack {
    display: flex;
    flex-direction: column;
    cursor: crosshair;
  }
  .picture {
    position: relative;
    margin: 0;
    overflow: hidden;
    border-radius: var(--r-sm);
    background: #000;
  }
  .canvas,
  .canvas :global(canvas) {
    display: block;
    width: 100%;
    height: 100%;
  }
  .lines {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
  .lines polyline {
    fill: none;
    stroke-linecap: round;
    stroke-linejoin: round;
    vector-effect: non-scaling-stroke;
  }
  .lines .under {
    stroke: rgba(0, 0, 0, 0.55);
    stroke-width: 4;
  }
  .lines .over {
    stroke: var(--hz-mark);
    stroke-width: 1.75;
  }
  .lines .over.ridge {
    stroke: #4dd6ff;
  }
  .name {
    position: absolute;
    transform: translate(-50%, -100%);
    padding: 0 3px;
    color: #14181d;
    font-size: 10.5px;
    font-weight: 600;
    white-space: nowrap;
    text-shadow:
      0 0 3px rgba(255, 255, 255, 0.85),
      0 0 1px rgba(255, 255, 255, 0.85);
    pointer-events: none;
  }
  .tag {
    position: absolute;
    left: 8px;
    top: 8px;
    padding: 1px 7px;
    border-radius: var(--r-sm);
    background: rgba(10, 12, 15, 0.72);
    color: #e3e3e3;
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .tag.accent {
    color: var(--accent);
  }
  .ruler {
    position: relative;
    height: 22px;
    margin: 3px 0;
    color: var(--text-3);
    font: 10.5px var(--font-mono, monospace);
  }
  .tick {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    padding-top: 6px;
    border-left: 1px solid transparent;
    white-space: nowrap;
  }
  .tick::before {
    content: '';
    position: absolute;
    left: 50%;
    top: 0;
    width: 1px;
    height: 5px;
    background: currentColor;
  }
  .tick.named {
    color: var(--accent);
  }
  .cursor {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    border-left: 1px solid rgba(255, 255, 255, 0.9);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }
</style>
