<script>
  /**
   * Open a saved view: one labelled button in the Horizon header, there as
   * soon as a case is open, eye or no eye. It lists the case's views to open
   * one, goes back to the saved version of the open one when it has changes,
   * and starts another view from where the tab stands.
   */
  import { fileUrl } from '../../lib/fileUrl.js';
  import Icon from '../../components/Icon.svelte';

  let {
    /** The case's views (state/views.svelte.js). */
    views,
    caseId = null,
    /** Whether the open view has changes Save would keep, which Revert takes back. */
    unsaved = false,
    onopen = () => {},
    onnew = null,
    onrevert = null,
  } = $props();

  let open = $state(false);
  let root = $state(null);

  const changed = $derived(Boolean(views.current && unsaved));

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

  const where = (item) =>
    Number.isFinite(item.lat) && Number.isFinite(item.lon) ? `${item.lat.toFixed(4)}, ${item.lon.toFixed(4)}` : '';
  const thumb = (item) => `${fileUrl(caseId, item.thumb)}?v=${encodeURIComponent(item.updated_at ?? '')}`;
</script>

<svelte:window onpointerdown={close} onkeydown={onKey} />

<div class="vm" bind:this={root}>
  <button
    type="button"
    class="btn btn-sm vm-open"
    onclick={() => (open = !open)}
    disabled={!caseId}
    aria-haspopup="menu"
    aria-expanded={open}
    title={caseId ? 'Open a view saved in this case' : 'Open a case to keep views'}
    aria-label="Open a saved view"
  >
    <Icon name="folderOpen" size={13} /><span class="vm-label">Open</span>
  </button>
  {#if open}
    <div class="vm-menu card" role="menu">
      <p class="vm-head">Views in this case</p>
      <div class="vm-list">
        {#each views.list as item (item.name)}
          <button
            type="button"
            role="menuitem"
            class="vm-row"
            class:current={views.current?.name === item.name}
            onclick={() => pick(() => onopen(item.name))}
          >
            <span class="vm-thumb">
              {#if item.thumb}<img src={thumb(item)} alt="" loading="lazy" />{:else}<Icon name="horizon" size={14} />{/if}
            </span>
            <span class="vm-text">
              <span class="vm-title">{item.title}</span>
              <small>{item.photo ?? where(item)}</small>
            </span>
            {#if views.current?.name === item.name}<Icon name="check" size={13} />{/if}
          </button>
        {:else}
          <p class="vm-empty">No saved view yet</p>
        {/each}
      </div>
      {#if (onrevert && changed) || (onnew && views.current)}
        <div class="vm-acts">
          {#if onrevert && changed}
            <button type="button" role="menuitem" class="vm-act" onclick={() => pick(onrevert)}>
              <Icon name="undo" size={13} />Revert to saved
            </button>
          {/if}
          {#if onnew && views.current}
            <button type="button" role="menuitem" class="vm-act" onclick={() => pick(onnew)} title="Keep this view as it is saved and start another from here">
              <Icon name="plus" size={13} />New view from here
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .vm {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .vm-open {
    white-space: nowrap;
  }
  /* a narrow view keeps the icon; the tooltip says the rest */
  @container (max-width: 1000px) {
    .vm-label {
      display: none;
    }
  }
  .vm-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 30;
    width: 290px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .vm-head {
    margin: 2px 6px 4px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .vm-list {
    max-height: 320px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .vm-row,
  .vm-act {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 5px 6px;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--text-1);
    text-align: left;
    cursor: pointer;
  }
  .vm-row:hover,
  .vm-act:hover,
  .vm-row:focus-visible,
  .vm-act:focus-visible {
    background: var(--bg-3);
  }
  .vm-row.current {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }
  .vm-thumb {
    flex: none;
    display: grid;
    place-items: center;
    width: 48px;
    height: 28px;
    border-radius: var(--r-sm);
    overflow: hidden;
    background: var(--bg-2);
    color: var(--text-2);
  }
  .vm-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .vm-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .vm-title,
  .vm-text small {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .vm-text small {
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .vm-empty {
    margin: 4px 6px 6px;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .vm-acts {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 4px;
    padding-top: 4px;
    border-top: 1px solid var(--border);
  }
</style>
