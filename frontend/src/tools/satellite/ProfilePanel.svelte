<script>
  /**
   * The Elevation profile tool's panel in the rail's slot: how the line is
   * drawn and finished, and a way to start again. The heights of the eye and
   * the target sit with the answer, in the chart's own window.
   */
  import Icon from '../../components/Icon.svelte';

  let { points = 0, finished = false, clear } = $props();
</script>

<div class="profile-panel card">
  <p class="how">
    {finished
      ? 'Drag A, B or a corner to move it'
      : points >= 2
        ? 'Press Enter to finish the line and read the ground'
        : points === 1
          ? 'Click where the line goes next'
          : 'Click A, where the eye stands, then B'}
  </p>
  {#if points}
    <button class="btn btn-ghost btn-sm clear" onclick={clear} title="Start a new line">
      <Icon name="reset" size={13} /> Clear line
    </button>
  {/if}
</div>

<style>
  .profile-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: max-content;
    max-width: 260px;
    padding: 10px;
    background: rgba(24, 24, 24, 0.92);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-2);
  }
  .how {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-2);
  }
  .clear {
    align-self: flex-start;
  }
</style>
