<script>
  import { ADJUST_PRESETS, activePreset, adjustDefaults, isNeutral, presetValues } from '../../lib/inspect.js';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';
  import Icon from '../../components/Icon.svelte';
  import AdjustSliders from './AdjustSliders.svelte';
  import CropControls from './CropControls.svelte';
  import Histogram from './Histogram.svelte';
  import OrientationControls from './OrientationControls.svelte';

  // The Adjust tab beside one frame: crop and turn it, then set its tones. Edits are
  // kept with the file's work as they are made; only Save to case files a picture.
  //
  // `shown` is the picture as the viewer draws it (`url` with the CSS `filter`, or a
  // server render with none), so the histogram reads what the analyst reads.
  let {
    frame, filters, shared, shown,
    cropAspect = $bindable(null), cropEditing = $bindable(false), beginCrop, commitCrop,
    setRotation, rotationBusy = false, onduplicate, onhold,
  } = $props();

  const preset = $derived(activePreset(filters, frame.adjust));
  const tuned = $derived(!isNeutral(filters, frame.adjust));

  async function reset() {
    frame.adjust = adjustDefaults(filters);
    frame.crop = null;
    shared.cropMode = false;
    cropAspect = null;
    cropEditing = false;
    await setRotation(0);
  }

  function clearCrop() {
    frame.crop = null;
    shared.cropMode = false;
    cropAspect = null;
    cropEditing = false;
  }
</script>

<div class="module">
  <div class="block">
    <div class="crop-row">
      {#if cropEditing}
        <button class="btn btn-sm active" onclick={() => commitCrop?.()} title="Apply the crop (Enter)">
          <Icon name="check" size={14} /> Apply crop
        </button>
        <button class="btn btn-ghost btn-xs" onclick={() => (shared.cropMode = true)} title="Draw a fresh region">
          <Icon name="crop" size={13} /> Redraw
        </button>
      {:else}
        <button class="btn btn-sm" onclick={() => beginCrop?.()} title={INSPECT_HELP.crop}>
          <Icon name="crop" size={14} /> {frame.crop ? 'Edit crop' : 'Crop region'}
        </button>
        {#if frame.crop}
          <span class="crop-info">or double-click the image</span>
        {/if}
      {/if}
    </div>
    {#if cropEditing}
      <CropControls bind:crop={frame.crop} bind:aspect={cropAspect} natW={frame.w} natH={frame.h} onclear={clearCrop} />
    {/if}
  </div>

  <div class="block" title={INSPECT_HELP.orientation}>
    <span class="head">Orientation</span>
    <OrientationControls
      value={frame.rotation ?? 0}
      disabled={rotationBusy}
      onchange={setRotation}
      hint="The saved image uses this orientation."
    />
  </div>

  <div class="block">
    <div class="tones-head">
      <span class="head">Tones</span>
      <button
        class="btn btn-ghost btn-xs"
        onpointerdown={() => onhold?.(true)}
        onpointerup={() => onhold?.(false)}
        onpointerleave={() => onhold?.(false)}
        onblur={() => onhold?.(false)}
        title={INSPECT_HELP.original}
      ><Icon name="eyeOff" size={12} /> Hold to compare</button>
    </div>
    <Histogram url={shown.url} filter={shown.filter} crop={cropEditing ? null : frame.crop} />
    <div class="presets" role="group" aria-label="Presets">
      {#each ADJUST_PRESETS as p (p.id)}
        <button
          class="btn btn-xs"
          class:active={preset === p.id}
          aria-pressed={preset === p.id}
          title={INSPECT_HELP.preset}
          onclick={() => (frame.adjust = presetValues(filters, p))}
        >{p.label}</button>
      {/each}
    </div>
    <AdjustSliders {filters} values={frame.adjust} rendered />
    <button class="btn btn-ghost btn-xs reset-tones" disabled={!tuned} onclick={() => (frame.adjust = adjustDefaults(filters))} title={INSPECT_HELP.resetAdjust}>
      <Icon name="reset" size={12} /> Reset tones
    </button>
  </div>

  <div class="row">
    <button class="btn btn-ghost btn-sm" onclick={reset} title={INSPECT_HELP.resetFrame}><Icon name="reset" size={14} /> Reset frame</button>
    <button class="btn btn-ghost btn-sm" onclick={() => onduplicate?.(frame)} title={INSPECT_HELP.duplicate}>
      <Icon name="copy" size={14} /> Duplicate
    </button>
  </div>
</div>

<style>
  .module {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .block + .block {
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
  .head {
    font-weight: 600;
    font-size: var(--fs-sm);
  }
  .tones-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .crop-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .crop-info {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .btn.active {
    color: var(--accent);
    border-color: var(--accent);
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .reset-tones {
    align-self: flex-start;
  }
  .row {
    display: flex;
    gap: 6px;
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
</style>
