<script>
  /**
   * Which way is up, as one reading: the needle resets north, the number opens
   * for an exact angle. Every map that can turn shows this same control, so a
   * turned view is read and undone the same way wherever it is met.
   */
  let { bearing = 0, onbearing = () => {} } = $props();

  let editing = $state(false);
  let typed = $state('');
  const shown = $derived(Math.round(bearing));

  function startEdit() {
    typed = String(shown);
    editing = true;
  }

  function commit() {
    const deg = parseFloat(typed);
    if (Number.isFinite(deg)) onbearing(deg);
    editing = false;
  }
</script>

<div class="rotate-ctl" class:turned={shown !== 0}>
  <button
    class="compass"
    onclick={() => onbearing(0)}
    title={shown ? 'Reset to north' : 'North up · middle-drag the map to rotate'}
    aria-label="Reset to north"
  >
    <svg width="15" height="15" viewBox="0 0 16 16" style="transform: rotate({shown}deg)">
      <!-- A needle, not a rose: the outline is the whole instrument and the
           filled half is north. Two colours and a disc read as decoration. -->
      <path
        d="M8 1.6 11.7 14 8 10.9 4.3 14Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linejoin="round"
      />
      <path d="M8 1.6 11.7 14 8 10.9Z" fill="currentColor" />
    </svg>
  </button>
  {#if editing}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="input deg-input mono"
      type="number"
      min="0"
      max="359"
      bind:value={typed}
      autofocus
      onblur={commit}
      onkeydown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') editing = false;
      }}
      aria-label="Set bearing in degrees"
    />
  {:else}
    <button class="deg mono" onclick={startEdit} title="Click to type an exact angle">
      {shown}°
    </button>
  {/if}
</div>

<style>
  .rotate-ctl {
    display: flex;
    align-items: stretch;
    height: 30px;
    border-radius: var(--radius-1);
    background: rgba(24, 24, 24, 0.88);
    backdrop-filter: blur(6px);
    box-shadow: 0 0 0 1px var(--border);
  }
  .rotate-ctl.turned {
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent);
  }
  .compass {
    display: grid;
    place-items: center;
    width: 30px;
    color: var(--text-2);
    cursor: pointer;
  }
  .compass:hover {
    color: var(--accent);
  }
  .deg {
    min-width: 42px;
    padding: 0 7px 0 5px;
    text-align: left;
    font-size: var(--fs-xs);
    color: var(--text-1);
    cursor: text;
  }
  .deg:hover {
    color: var(--accent);
  }
  .deg-input {
    width: 52px;
    padding: 0 4px;
    border: none;
    background: none;
    text-align: left;
    font-size: var(--fs-xs);
  }
</style>
