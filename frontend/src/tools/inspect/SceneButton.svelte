<script>
  import Icon from '../../components/Icon.svelte';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';

  // The player's own way to the scenes: it says how many the clip holds, tinted
  // while some are still to prove, and opens or closes their drawer beside the video
  // (`ScenePanel`). It adds no height to the workspace.
  let { scenes = [], open = false, onclick } = $props();

  const toProve = $derived(scenes.filter((s) => s.kind === 'draft').length);
</script>

<button
  class="scenes-btn"
  class:has={scenes.length > 0}
  class:open
  onclick={() => onclick?.()}
  aria-expanded={open}
  title={INSPECT_HELP.scenes}
  data-guide="inspect.scenes"
>
  <Icon name="pin" size={13} />
  <span>Scenes</span>
  {#if scenes.length}<span class="count" class:todo={toProve > 0}>{scenes.length}</span>{/if}
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
</style>
