<script>
  /**
   * The measure tools' settings, in the rail's one panel slot.
   *
   * It carries no reading of its own: a distance, an area and an angle are
   * numbers the map is telling you, and those belong in the status bar with the
   * coordinates. What it adds is how a line or an area is finished and moved.
   */
  import Icon from '../../components/Icon.svelte';

  let {
    mode,
    setMode,
    clear,
    points = [],
    finished = false,
  } = $props();

  /** Lines and areas are finished with Enter; an angle is done at its third point. */
  const finishable = $derived(mode === 'distance' || mode === 'area');
  const enough = $derived(points.length >= (mode === 'area' ? 3 : 2));

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
  {#if finishable && enough}
    <p class="how">
      {finished ? 'Drag a point to move it' : mode === 'area' ? 'Enter closes the area' : 'Enter finishes the line'}
    </p>
  {/if}
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
  .how {
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
</style>
