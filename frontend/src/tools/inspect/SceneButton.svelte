<script>
  import Icon from '../../components/Icon.svelte';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';
  import { liveScenes } from '../../lib/scenes.js';

  // The player's own way to the scenes: it says how many the clip holds, tinted
  // while some are still to prove, and opens or closes their drawer beside the video
  // (`ScenePanel`). An abandoned scene is not counted, as it waits folded at the foot
  // of the drawer. It adds no height to the workspace, and on a narrow player it
  // keeps its pin and its count, the word going first.
  let { scenes = [], open = false, onclick } = $props();

  const counted = $derived(liveScenes(scenes));
  const toProve = $derived(counted.filter((s) => s.kind === 'draft').length);
</script>

<button
  class="scenes-btn"
  class:has={counted.length > 0}
  class:open
  onclick={() => onclick?.()}
  aria-expanded={open}
  aria-label={counted.length ? `Scenes ${counted.length}` : 'Scenes'}
  title={INSPECT_HELP.scenes}
  data-guide="inspect.scenes"
>
  <Icon name="pin" size={13} />
  <span class="word">Scenes</span>
  {#if counted.length}<span class="count" class:todo={toProve > 0}>{counted.length}</span>{/if}
</button>

<style>
  .scenes-btn {
    height: 28px;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 8px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .scenes-btn:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .scenes-btn.has {
    color: var(--text-1);
  }
  .scenes-btn.open {
    color: var(--accent);
    background: var(--bg-2);
  }
  .count {
    min-width: 16px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--bg-3);
    font-size: 10px;
    line-height: 16px;
    text-align: center;
  }
  .count.todo {
    background: var(--accent);
    color: var(--accent-text);
  }
  /* the player bar is the container (VideoPlayer) */
  @container (max-width: 480px) {
    .word {
      display: none;
    }
  }
</style>
