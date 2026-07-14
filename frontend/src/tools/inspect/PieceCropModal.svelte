<script>
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';
  import CropBox from './CropBox.svelte';
  import CropControls from './CropControls.svelte';

  // Crop editor for a collage piece. The fractional (0..1) box is drawn over the
  // piece's *base* image (its snapshot before any collage crop), so re-cropping
  // always replaces rather than compounds. Corners/edges nudge it, an aspect lock
  // and numeric fields make it precise. On apply the parent re-renders the node
  // through the backend crop op (applied before the perspective warp).
  let { node, onapply, onclose } = $props();

  let imgEl = $state();
  let natW = $state(node.w ?? null);
  let natH = $state(node.h ?? null);
  let crop = $state(node.crop ? { ...node.crop } : null);
  let aspect = $state(null);
  let draw = $state(!node.crop);

  function onImgLoad(e) {
    natW = e.currentTarget.naturalWidth;
    natH = e.currentTarget.naturalHeight;
  }

  function redraw() {
    crop = null;
    draw = true;
  }

  function apply() {
    const c = crop && crop.w > 0.02 && crop.h > 0.02
      ? { x: crop.x, y: crop.y, w: crop.w, h: crop.h }
      : null;
    onapply?.(c);
  }
</script>

<Modal title="Crop piece" width="560px" {onclose}>
  <p class="hint">Drag to draw a region, then nudge the handles or type exact values. Lock an aspect ratio to match a panel. Applied before the warp, so the collage updates in place.</p>
  <div class="stage">
    <img
      bind:this={imgEl}
      src={node.baseUrl || node.url}
      alt="piece"
      draggable="false"
      onload={onImgLoad}
      onerror={(e) => { if (node.url && e.currentTarget.src !== node.url) e.currentTarget.src = node.url; }}
    />
    <CropBox bind:crop bind:draw {aspect} {natW} {natH} />
  </div>
  <div class="tools">
    <CropControls bind:crop bind:aspect {natW} {natH} onclear={redraw} />
  </div>
  <div class="foot">
    <button class="btn btn-sm" onclick={redraw}><Icon name="crop" size={13} /> Redraw</button>
    <div class="spacer"></div>
    <button class="btn btn-sm" onclick={onclose}>Cancel</button>
    <button class="btn btn-sm primary" onclick={apply}><Icon name="check" size={13} /> Apply</button>
  </div>
</Modal>

<style>
  .hint {
    color: var(--text-3);
    font-size: var(--fs-xs);
    margin: 0 0 10px;
  }
  .stage {
    position: relative;
    line-height: 0;
    touch-action: none;
    display: block;
    width: fit-content;
    max-width: 100%;
    margin: 0 auto;
    background: var(--bg-0);
    border-radius: var(--r-sm);
    overflow: hidden;
    user-select: none;
  }
  .stage img {
    max-width: 100%;
    max-height: 60vh;
    display: block;
    user-select: none;
  }
  .tools {
    margin-top: 12px;
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
  }
  .spacer {
    flex: 1;
  }
  .primary {
    color: var(--accent);
    border-color: var(--accent);
  }
</style>
