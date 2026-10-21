<script>
  /**
   * The distances a click with the Distance tool lays on a line, picked here
   * first: one, or several when unsure (lib/horizon/traceMarks.js
   * DISTANCE_BANDS). Shown while the tool is out, in Find's photo and over the
   * view in Overlay alike.
   */
  import { DISTANCE_BANDS } from '../../lib/horizon/traceMarks.js';

  let {
    /** The overlay (state/overlay.svelte.js): its `farPicked` and `setFarPicked`. */
    overlay,
  } = $props();

  function toggle(id) {
    const now = overlay.farPicked ?? [];
    overlay.setFarPicked(now.includes(id) ? now.filter((one) => one !== id) : [...now, id]);
  }
</script>

<div class="dc" role="group" aria-label="How far the line stands">
  <span class="dc-name">How far</span>
  {#each DISTANCE_BANDS as band (band.id)}
    <button
      type="button"
      class:on={overlay.farPicked?.includes(band.id)}
      aria-pressed={overlay.farPicked?.includes(band.id)}
      title="The line stands {band.label} from the camera"
      onclick={() => toggle(band.id)}>{band.label}</button
    >
  {/each}
</div>

<style>
  .dc {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 3px;
    padding: 4px 6px;
    border-radius: var(--r-md);
    background: color-mix(in srgb, #0b0d10 82%, transparent);
    pointer-events: auto;
  }
  .dc-name {
    margin-right: 4px;
    color: #c9d1dc;
    font-size: var(--fs-xs);
  }
  .dc button {
    height: 22px;
    padding: 0 7px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 11px;
    background: transparent;
    color: #c9d1dc;
    font: inherit;
    font-size: var(--fs-xs);
    white-space: nowrap;
    cursor: pointer;
  }
  .dc button.on {
    border-color: #ffd166;
    background: color-mix(in srgb, #ffd166 22%, transparent);
    color: #ffd166;
    font-weight: 600;
  }
  .dc button:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px #ffd166;
  }
</style>
