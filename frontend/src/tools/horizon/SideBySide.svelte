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
   *
   * A cut collage the search eased is shown, by default, as the search read
   * it (`searched`, lib/horizon/cutView.js): the terrain laid piece by piece,
   * each through its own camera, the seams drawn on both, the names, ticks and
   * direction read through the piece under them. One camera shows the whole.
   */
  import Icon from '../../components/Icon.svelte';
  import { rayFor } from '../../lib/horizon/camera.js';
  import { easeText } from '../../lib/horizon/cutView.js';
  import { SEARCHED_TERRAIN_TAG, TERRAIN_TAG } from '../../lib/horizon/viewExport.js';

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
    /**
     * The terrain as the search read a cut collage, when it eased its pieces:
     * `{ frame, seams, layers, cameras, eases }` (Horizon `drawPair`), or null.
     */
    searched = null,
    /** Which piece of the collage a point of the frame (`{ u, v }`) lies in. */
    pieceAt = null,
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

  /** Whether the terrain shows as the search read the cut collage, piece by piece, or through one camera. */
  let bySearch = $state(true);
  const cut = $derived(Boolean(searched && bySearch));
  const terrainFrame = $derived(cut ? searched.frame : frames[1]);
  const shownLabels = $derived(cut ? searched.layers.labels : labels);
  const shownTicks = $derived(cut ? searched.layers.ticks : ticks);
  // each piece drawn through its own camera: the trace lies on it where it was drawn
  const terrainTrace = $derived(cut ? trace : traceOnTerrain);
  const seams = $derived(cut ? searched.seams : []);
  /** The piece under the pointer, while the terrain shows piece by piece. */
  const piece = $derived(cut && across != null && pieceAt ? pieceAt({ u: across, v: 0.5 }) : null);

  /** The direction under the pointer, in whole tenths of a degree, through its piece's camera when cut. */
  const facing = $derived.by(() => {
    const through = piece != null ? (searched.cameras[piece] ?? camera) : camera;
    if (across == null || !through) return '';
    const { azimuth } = rayFor(through, across * through.width, through.height / 2);
    return `${(((azimuth % 360) + 360) % 360).toFixed(1)}°`;
  });
  /** What the piece under the pointer was eased by. */
  const pieceSaid = $derived(
    piece != null ? `piece ${piece + 1} of ${searched.cameras.length}, ${easeText(searched.eases[piece])}` : ''
  );

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
    {#each seams as seam, index (index)}
      <polyline class="seam under" points={points(seam)} />
      <polyline class="seam over" points={points(seam)} />
    {/each}
    {#each strokes as stroke, index (index)}
      <polyline class="under" points={points(stroke)} />
      <polyline class="over" class:ridge={ridges[index]} points={points(stroke)} />
    {/each}
  </svg>
  {#each shownLabels as label (label.name + label.x)}
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
    <span class="say">The same frame on both{facing ? ` · ${facing}` : ''}{pieceSaid ? ` · ${pieceSaid}` : ''}</span>
    {#if searched}
      <div class="ways" role="radiogroup" aria-label="How the terrain is drawn">
        <button
          type="button"
          role="radio"
          aria-checked={!bySearch}
          class:on={!bySearch}
          onclick={() => (bySearch = false)}
          title="The terrain through the view's one camera">One camera</button
        >
        <button
          type="button"
          role="radio"
          aria-checked={bySearch}
          class:on={bySearch}
          onclick={() => (bySearch = true)}
          title="Each piece of the collage through the camera the search found for it">Piece by piece</button
        >
      </div>
    {/if}
    <button
      type="button"
      class="act"
      disabled={saving}
      aria-busy={saving}
      onclick={() => onsave({ cut })}
      title={cut ? 'Write the two out as one picture, the terrain piece by piece' : 'Write the two out as one picture'}>
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
        {#each shownTicks as tick (tick.azimuth ?? tick.x)}
          <span class="tick" class:named={tick.named} style:left={percent(tick.x, camera.width)}>{tick.label ?? ''}</span>
        {/each}
        {#if across != null}
          <span class="cursor" style:left="{across * 100}%"></span>
        {/if}
      </div>
      <figure class="picture" style:height="{panel.height}px">
        <div class="canvas" {@attach canvasIn(terrainFrame)}></div>
        {@render over(terrainTrace)}
        <figcaption class="tag">{cut ? SEARCHED_TERRAIN_TAG : TERRAIN_TAG}</figcaption>
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
  /* where the pieces of a cut collage meet, as the view draws its cuts */
  .lines .seam.under {
    stroke: rgba(0, 0, 0, 0.5);
    stroke-width: 3.5;
  }
  .lines .seam.over {
    stroke: #fff;
    stroke-width: 1.5;
    stroke-dasharray: 7 5;
  }
  .ways {
    display: flex;
    gap: 4px;
  }
  .ways button {
    height: 26px;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: 13px;
    background: transparent;
    color: var(--text-2);
    font: inherit;
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .ways button.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
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
