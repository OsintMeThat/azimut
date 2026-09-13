<script>
  /**
   * The measure tools' settings, in the rail's one panel slot.
   *
   * It carries no reading of its own any more: a distance, an area and an angle
   * are numbers the map is telling you, and those all belong in the status bar
   * with the coordinates rather than in three different floating boxes.
   */
  import Icon from '../../components/Icon.svelte';

  let { mode, setMode, clear } = $props();

  const TOOLS = [
    { id: 'distance', label: 'Distance', icon: 'ruler' },
    { id: 'area', label: 'Area', icon: 'polygon' },
    { id: 'angle', label: 'Angle', icon: 'angle' },
  ];
</script>

<div class="measure-panel card">
  <div class="tools">
    {#each TOOLS as tool (tool.id)}
      <button
        class="btn btn-sm"
        class:on={mode === tool.id}
        onclick={() => setMode(tool.id)}
      >
        <Icon name={tool.icon} size={14} /> {tool.label}
      </button>
    {/each}
  </div>
  {#if mode}
    <button class="btn btn-ghost btn-sm clear" onclick={clear} title="Clear points">
      <Icon name="reset" size={13} /> Clear points
    </button>
  {/if}
</div>

<style>
  .measure-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: max-content;
    padding: 10px;
    background: rgba(24, 24, 24, 0.92);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-2);
  }
  .tools {
    display: flex;
    gap: 4px;
  }
  .tools .btn.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .clear {
    align-self: flex-start;
  }
</style>
