<script>
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import Icon from '../../components/Icon.svelte';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';

  // Mark to geolocate, under Capture frame: the main press keeps a scene at the frame
  // on screen, as S does, and the arrow offers that or the whole video. `wholeOff` says
  // why the whole video is not offered, greyed with those words on hover: a scene says
  // so already, or scenes hold passages of the video. Both keys are said here.
  let { wholeOff = '', onmoment, onwhole } = $props();

  let arrow = $state(null);
  let open = $state(false);

  function pick(act) {
    open = false;
    act?.();
  }
</script>

<div class="split" role="group" aria-label="Mark to geolocate" data-guide="inspect.scene">
  <button class="btn btn-sm press" onclick={() => onmoment?.()} title={INSPECT_HELP.markHere}>
    <Icon name="pin" size={13} />
    <span>Mark to geolocate</span>
    <kbd>S</kbd>
  </button>
  <button
    class="btn btn-sm more"
    bind:this={arrow}
    onclick={() => (open = !open)}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label="More ways to mark"
    title={INSPECT_HELP.markMenu}
  >
    <Icon name="chevronDown" size={13} />
  </button>
</div>

{#if open}
  <FloatingMenu anchor={arrow} width={200} align="end" label="Mark to geolocate" onclose={() => (open = false)}>
    <button class="fm-item" role="menuitem" onclick={() => pick(onmoment)} title={INSPECT_HELP.markMoment}>
      <Icon name="pin" size={13} />
      <span class="fm-grow">This instant</span>
      <kbd class="hint">S</kbd>
    </button>
    <button
      class="fm-item"
      role="menuitem"
      disabled={Boolean(wholeOff)}
      onclick={() => pick(onwhole)}
      title={wholeOff || INSPECT_HELP.markWhole}
    >
      <Icon name="video" size={13} />
      <span class="fm-grow">Whole video</span>
    </button>
    <div class="fm-sep"></div>
    <p class="fm-note"><kbd class="hint">Shift+S</kbd> ends a scene at the frame on screen</p>
  </FloatingMenu>
{/if}

<style>
  .split {
    display: flex;
    width: 100%;
  }
  .press {
    flex: 1;
    min-width: 0;
    justify-content: center;
    gap: 6px;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .press :global(svg) {
    color: var(--accent);
  }
  .more {
    flex: 0 0 30px;
    justify-content: center;
    padding-left: 0;
    padding-right: 0;
    margin-left: -1px;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .more[aria-expanded='true'] {
    color: var(--accent);
  }
  kbd {
    padding: 0 4px;
    border-radius: 3px;
    border: 1px solid currentColor;
    font-size: 10px;
    font-family: var(--font-mono);
    opacity: 0.6;
  }
  .hint {
    flex: none;
    color: var(--text-3);
    opacity: 1;
  }
</style>
