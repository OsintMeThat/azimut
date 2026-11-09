<script>
  /**
   * A scene's two counts, with the small mark of where it stands (`lib/sceneCounts.js`):
   * the map's captures by the map's icon, the video's frames and collages by the
   * video's, a picture marked to geolocate by the picture's. A count at 0 is greyed, the
   * mark of the scene being geolocated keeps the accent, and the hover says it all in
   * words. `mark` leaves the mark out where the row already draws one; `bump` pulses
   * the map's count, as the pill does when a capture lands.
   */
  import Icon from './Icon.svelte';
  import { countWords, mapCount, sceneStage, videoCount } from '../lib/sceneCounts.js';

  let { scene, live = false, mark = true, size = 11, bump = false } = $props();

  const stage = $derived(sceneStage(scene, live));
  const map = $derived(mapCount(scene));
  const given = $derived(videoCount(scene));
  const picture = $derived(scene?.file_kind === 'image');
  const words = $derived(countWords(scene, live));
</script>

<span class="sc-counts" title={words} data-testid="scene-counts" data-stage={stage}>
  <span class="sc-words">{words}</span>
  {#if mark}<span class="sc-stage {stage}" aria-hidden="true"></span>{/if}
  <span class="sc-count" class:none={!map} class:bump aria-hidden="true" data-testid="count-map">
    <Icon name="satellite" {size} />{map}
  </span>
  <span class="sc-count" class:none={!given} aria-hidden="true" data-testid="count-video">
    <Icon name={picture ? 'image' : 'video'} {size} />{given}
  </span>
</span>

<style>
  .sc-counts {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    flex: none;
    color: var(--text-2);
    font-size: inherit;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  /* said once for a screen reader, which reads no icon */
  .sc-words {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .sc-count {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .sc-count :global(svg) {
    flex: none;
    color: var(--text-3);
  }
  .sc-count.none {
    color: var(--text-3);
    opacity: 0.6;
  }
  .sc-count.bump {
    animation: sc-bump 0.9s var(--ease);
  }
  @keyframes sc-bump {
    25% { transform: scale(1.18); color: var(--accent); }
  }
  /* To geolocate an empty ring, In progress a ring holding a dot, the scene being
     geolocated the solid accent, an abandoned one a dashed ring. */
  .sc-stage {
    flex: none;
    width: 8px;
    height: 8px;
    box-sizing: border-box;
    border: 1.5px solid var(--text-3);
    border-radius: 50%;
  }
  .sc-stage.progress {
    border-color: var(--accent);
    background: radial-gradient(circle, var(--accent) 0 1.5px, transparent 2px);
  }
  .sc-stage.live {
    border-color: var(--accent);
    background: var(--accent);
    box-shadow: 0 0 0 2.5px var(--accent-soft);
  }
  .sc-stage.abandoned {
    border-style: dashed;
  }
  @media (prefers-reduced-motion: reduce) {
    .sc-count.bump {
      animation: none;
    }
  }
</style>
