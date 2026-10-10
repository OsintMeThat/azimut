<script>
  /**
   * Export the view: one button in the Horizon header, beside Save, opening
   * the pictures the view can be written out as (lib/horizon/viewExport.js),
   * the photo and the terrain sent to Geo Proof, and the same camera in Google
   * Earth. What a picture carries is set above the kinds, before one is
   * picked: the skyline traced on the photo (left out unless asked, it is
   * working material), the Azimut signature (as Compare's exports carry it),
   * and a copy kept in the case under the view, once the view is saved.
   */
  import Icon from '../../components/Icon.svelte';
  import { EXPORT_KINDS } from '../../lib/horizon/viewExport.js';

  let {
    /** Whether a photo is laid: the side-by-side kinds, the blink and Geo Proof need one. */
    photo = false,
    /** Whether the view is saved, which keeping a picture in the case needs. */
    saved = false,
    /** Whether a skyline is traced on the photo, which a picture can carry. */
    traced = false,
    /** The kind being drawn, or ''. */
    busy = '',
    /** Google Earth's link for this camera, or ''. */
    earth = '',
    onexport = () => {},
    onproof = () => {},
  } = $props();

  let open = $state(false);
  let keep = $state(false);
  let trace = $state(false);
  let signed = $state(true);
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
  function pick(run) {
    open = false;
    run();
  }
</script>

<svelte:window onpointerdown={close} onkeydown={onKey} />

<div class="em" bind:this={root}>
  <button
    type="button"
    class="btn btn-sm em-open"
    onclick={() => (open = !open)}
    disabled={Boolean(busy)}
    aria-haspopup="menu"
    aria-expanded={open}
    title={busy ? 'Exporting…' : 'Export the view, or open it elsewhere'}
    aria-label="Export"
  >
    {#if busy}<span class="em-spin" aria-hidden="true"></span>{:else}<Icon name="download" size={13} />{/if}<span class="em-label">Export</span>
  </button>
  {#if open}
    <div class="em-menu card" role="menu">
      <p class="em-head">Export</p>
      <div class="em-options">
        {#if traced}
          <label title="The skyline traced on the photo, drawn over the picture">
            <input type="checkbox" bind:checked={trace} />
            Skyline trace
          </label>
        {/if}
        <label title="The logo and name close the credits line">
          <input type="checkbox" bind:checked={signed} />
          Sign it Azimut
        </label>
        <label class:off={!saved} title={saved ? 'The picture is also kept in the case, under this view' : 'Save the view to keep its pictures in the case'}>
          <input type="checkbox" bind:checked={keep} disabled={!saved} />
          Keep a copy in the case
        </label>
      </div>
      {#each EXPORT_KINDS as kind (kind.id)}
        <button
          type="button"
          role="menuitem"
          class="em-row"
          disabled={kind.photo && !photo}
          title={kind.photo && !photo ? 'Lay a photo over the view first' : kind.hint}
          onclick={() => pick(() => onexport(kind.id, { keep: keep && saved && kind.id !== 'blink', trace: traced && trace, signed }))}
        >
          <span>{kind.label}</span>
          <small>{kind.id === 'blink' ? 'GIF' : 'PNG'}</small>
        </button>
      {/each}
      <div class="em-acts">
        <button
          type="button"
          role="menuitem"
          class="em-row"
          disabled={!photo}
          title={photo ? 'The photo and the terrain through the same frame, as two panels of a proof' : 'Lay a photo over the view first'}
          onclick={() => pick(onproof)}
        >
          <span><Icon name="proof" size={13} />Send to Geo Proof</span>
        </button>
        {#if earth}
          <a class="em-row" role="menuitem" href={earth} target="_blank" rel="noreferrer" onclick={() => (open = false)} title="The same camera in Google Earth on the web">
            <span><Icon name="external" size={13} />Open in Google Earth</span>
          </a>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .em {
    position: relative;
    display: inline-flex;
  }
  .em-open {
    white-space: nowrap;
  }
  /* a narrow view keeps the icon; the tooltip says the rest */
  @container (max-width: 1000px) {
    .em-label {
      display: none;
    }
  }
  .em-spin {
    width: 9px;
    height: 9px;
    border: 2px solid color-mix(in srgb, var(--text-1) 25%, transparent);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: em-spin 0.8s linear infinite;
  }
  @keyframes em-spin {
    to {
      transform: rotate(360deg);
    }
  }
  .em-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 30;
    width: 270px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .em-head {
    margin: 2px 6px 4px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .em-row {
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
    text-decoration: none;
    cursor: pointer;
  }
  .em-row span {
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .em-row small {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .em-row:hover:not(:disabled),
  .em-row:focus-visible {
    background: var(--bg-3);
  }
  .em-row:disabled {
    color: var(--text-3);
    cursor: default;
  }
  .em-options {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin: 0 0 4px;
    padding: 0 6px 6px;
    border-bottom: 1px solid var(--border);
  }
  .em-options label {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .em-options label.off {
    color: var(--text-3);
  }
  .em-acts {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--border);
  }
</style>
