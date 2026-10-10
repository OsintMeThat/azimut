<script>
  /**
   * Capture: one button in the Horizon header, beside Export, filing the view
   * in the case as Satellite's capture files a crop of the map. It offers the
   * view as it shows, or an area of it dragged over the view; either is filed
   * at once, saved view or not.
   */
  import Icon from '../../components/Icon.svelte';

  let {
    /** Whether a capture is being drawn and filed. */
    busy = false,
    /** Asked to capture: `false` for the whole view, `true` for an area of it. */
    oncapture = () => {},
  } = $props();

  let open = $state(false);
  let root = $state(null);

  function close(event) {
    if (open && root && !root.contains(event.target)) open = false;
  }
  function onKey(event) {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      open = false;
    }
  }
  function pick(area) {
    open = false;
    oncapture(area);
  }
</script>

<svelte:window onpointerdown={close} onkeydown={onKey} />

<div class="cm" bind:this={root}>
  <button
    type="button"
    class="btn btn-sm cm-open"
    onclick={() => (open = !open)}
    disabled={busy}
    aria-haspopup="menu"
    aria-expanded={open}
    title={busy ? 'Capturing…' : 'File the view in the case, as it shows'}
    aria-label="Capture"
  >
    {#if busy}<span class="cm-spin" aria-hidden="true"></span>{:else}<Icon name="crop" size={13} />{/if}<span class="cm-label">Capture</span>
  </button>
  {#if open}
    <div class="cm-menu card" role="menu">
      <p class="cm-head">Capture into the case</p>
      <button type="button" role="menuitem" class="cm-row" title="The view as it shows, with its names" onclick={() => pick(false)}>
        <span>The whole view</span>
      </button>
      <button type="button" role="menuitem" class="cm-row" title="Drag a box over the view" onclick={() => pick(true)}>
        <span>An area of it</span><small>drag a box</small>
      </button>
    </div>
  {/if}
</div>

<style>
  .cm {
    position: relative;
    display: inline-flex;
  }
  .cm-open {
    white-space: nowrap;
  }
  /* a narrow view keeps the icon; the tooltip says the rest */
  @container (max-width: 1000px) {
    .cm-label {
      display: none;
    }
  }
  .cm-spin {
    width: 9px;
    height: 9px;
    border: 2px solid color-mix(in srgb, var(--text-1) 25%, transparent);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: cm-spin 0.8s linear infinite;
  }
  @keyframes cm-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .cm-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 30;
    width: 220px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cm-head {
    margin: 2px 6px 4px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .cm-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    padding: 6px;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--text-1);
    font: inherit;
    font-size: var(--fs-sm);
    text-align: left;
    cursor: pointer;
  }
  .cm-row small {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .cm-row:hover,
  .cm-row:focus-visible {
    background: var(--bg-3);
  }
</style>
