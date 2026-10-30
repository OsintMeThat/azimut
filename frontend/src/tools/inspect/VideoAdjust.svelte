<script>
  import { adjustDefaults, isNeutral } from '../../lib/inspect.js';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';
  import Icon from '../../components/Icon.svelte';
  import AdjustSliders from './AdjustSliders.svelte';
  import Histogram from './Histogram.svelte';
  import OrientationControls from './OrientationControls.svelte';
  import SaveToCase from './SaveToCase.svelte';

  // The Adjust tab beside the video: turn and tune the whole clip. Frames captured
  // from now on start from it, and a turned or adjusted clip can be saved as a new
  // video; the original is never touched.
  let {
    videoFilters, work, video = null, filter = '', tick = 0,
    videoEdited = false, videoSave, folder = $bindable(''), onhold,
  } = $props();

  const tuned = $derived(!isNeutral(videoFilters, work.videoAdjust));
</script>

<div class="module">
  <div class="block" title={INSPECT_HELP.orientation}>
    <span class="head">Orientation</span>
    <OrientationControls
      value={work.videoRotation}
      onchange={(angle) => (work.videoRotation = angle)}
      hint="New frames and a saved video use this orientation."
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
    {#if video}<Histogram {video} {filter} {tick} />{/if}
    <p class="hint">Applies to the whole clip and to the frames captured from now on.</p>
    <AdjustSliders filters={videoFilters} values={work.videoAdjust} />
    <button class="btn btn-ghost btn-xs reset" disabled={!tuned} onclick={() => (work.videoAdjust = adjustDefaults(videoFilters))} title={INSPECT_HELP.resetAdjust}>
      <Icon name="reset" size={12} /> Reset tones
    </button>
  </div>

  {#if videoEdited}
    <div class="block">
      <SaveToCase
        defaultName={videoSave.defaultName}
        filedPath={videoSave.filedPath}
        busy={videoSave.busy}
        bind:folder
        hint="Re-encodes the whole clip turned and adjusted as shown."
        onsave={videoSave.onsave}
      />
    </div>
  {/if}
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
  .hint {
    color: var(--text-3);
    font-size: var(--fs-xs);
    margin: 0;
  }
  .reset {
    align-self: flex-start;
  }
</style>
