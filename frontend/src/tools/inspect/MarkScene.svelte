<script>
  import Icon from '../../components/Icon.svelte';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';

  // Mark to geolocate, under Capture frame: the three kinds a scene's time takes, side by
  // side in the order its editor names them, each one press. Whole video keeps a scene
  // about all of it; Passage readies the bar for a drag across it, lit while it waits
  // (`drawing`), a second press calling it off; Instant keeps the frame on screen, as S
  // does. `wholeOff` says why the whole video is not offered, greyed with those words on
  // hover: a scene says so already, or scenes hold passages of the video.
  let { wholeOff = '', drawing = false, oninstant, onpassage, onwhole } = $props();
</script>

<div class="mark" role="group" aria-label="Mark to geolocate" data-guide="inspect.scene">
  <span class="mark-head"><Icon name="pin" size={12} /> Mark to geolocate</span>
  <div class="kinds">
    <button class="btn btn-sm kind" disabled={Boolean(wholeOff)} onclick={() => onwhole?.()} title={wholeOff || INSPECT_HELP.markWhole} data-guide="inspect.whole">
      <Icon name="video" size={13} />
      <span class="name">Whole video</span>
    </button>
    <button
      class="btn btn-sm kind"
      class:on={drawing}
      aria-pressed={drawing}
      onclick={() => onpassage?.()}
      title={drawing ? INSPECT_HELP.markPassageOff : INSPECT_HELP.markPassage}
    >
      <Icon name="clock" size={13} />
      <span class="name">Passage</span>
    </button>
    <button class="btn btn-sm kind" onclick={() => oninstant?.()} title={INSPECT_HELP.markInstant}>
      <Icon name="pin" size={13} />
      <span class="name">Instant</span>
      <kbd>S</kbd>
    </button>
  </div>
</div>

<style>
  .mark {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }
  .mark-head {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .mark-head :global(svg) {
    color: var(--accent);
  }
  /* One bar in three parts: a hairline between, the outer corners rounded. */
  .kinds {
    display: flex;
    width: 100%;
  }
  .kind {
    flex: 1 1 0;
    min-width: 0;
    justify-content: center;
    gap: 5px;
    border-radius: 0;
  }
  .kind + .kind {
    margin-left: -1px;
  }
  .kind:first-child {
    border-top-left-radius: var(--r-sm);
    border-bottom-left-radius: var(--r-sm);
  }
  .kind:last-child {
    border-top-right-radius: var(--r-sm);
    border-bottom-right-radius: var(--r-sm);
  }
  .kind :global(svg) {
    flex: none;
    color: var(--accent);
  }
  .kind:disabled :global(svg) {
    color: inherit;
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Passage while the bar waits for the drag. */
  .kind.on {
    position: relative;
    z-index: 1;
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  kbd {
    flex: none;
    padding: 0 4px;
    border-radius: 3px;
    border: 1px solid currentColor;
    font-size: 10px;
    font-family: var(--font-mono);
    opacity: 0.6;
  }
</style>
