<script>
  import Icon from '../../components/Icon.svelte';
  import Modal from '../../components/Modal.svelte';
  import FolderBrowser from '../../components/FolderBrowser.svelte';
  import PanelCategories from './PanelCategories.svelte';
  import { filterProofPanelItems } from '../../lib/composer.js';

  let {
    templateId = $bindable(),
    panelPaths = $bindable(),
    query = $bindable(),
    category = $bindable(),
    templates,
    items,
    filteredItems,
    loading,
    creating,
    caseId,
    togglePanel,
    requestCreation,
    close,
  } = $props();

  // "…" swaps the thumbnail grid for the folder view. Panels stay multi-select
  // there: a row toggles the same selection the grid does.
  let browserOpen = $state(false);
  let browsePath = $state('');
  const categoryItems = $derived(filterProofPanelItems(items, '', category));
  const browserEntries = $derived(
    categoryItems.map((item) => ({ ...item, id: item.src, attrs: { folder: item.folder ?? '' } }))
  );

  function toggleBrowser() {
    browserOpen = !browserOpen;
    browsePath = '';
  }

  function pickCategory(id) {
    category = id;
    browsePath = '';
  }
</script>

<Modal title="Create proof" onclose={() => { if (!creating) close(); }} width="780px">
  <form class="new-proof-form" onsubmit={(event) => { event.preventDefault(); requestCreation(); }}>
    <label class="new-proof-field">
      <span>Template</span>
      <select class="input" bind:value={templateId}>
        <option value="">No template</option>
        {#each templates as template (template.id)}
          <option value={template.id}>{template.name}</option>
        {/each}
      </select>
      <small>Sets the look without choosing content.</small>
    </label>

    <fieldset class="new-proof-panels">
      <legend>
        <span>Panels</span>
        <span class="selected-count">
          {panelPaths.length} panel{panelPaths.length === 1 ? '' : 's'} selected
        </span>
      </legend>

      <div class="panel-picker-bar">
        <div class="panel-search">
          <Icon name="search" size={13} />
          <input placeholder="Search panels…" bind:value={query} />
          {#if query}
            <button type="button" onclick={() => (query = '')} aria-label="Clear search">
              <Icon name="x" size={12} />
            </button>
          {/if}
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-sm browse-btn"
          title={browserOpen ? 'Show every image' : 'Browse folders'}
          onclick={toggleBrowser}
        >…</button>
        <PanelCategories {items} {category} onpick={pickCategory} />
      </div>

      {#if loading}
        <div class="picker-empty">Loading case images…</div>
      {:else if !items.length}
        <div class="picker-empty">No case images yet, but you can add panels later.</div>
      {:else if browserOpen}
        <FolderBrowser
          entries={browserEntries}
          path={browsePath}
          rootLabel="Case images"
          mark
          isSelected={(item) => panelPaths.includes(item.src)}
          matches={(item) => filterProofPanelItems([item], query, 'all').length > 0}
          emptyText="This folder has no matching images."
          icon={(item) => (item.kind === 'satellite' ? 'satellite' : 'image')}
          onnavigate={(path) => (browsePath = path)}
          onselect={(item) => togglePanel(item.src)}
        />
      {:else if !filteredItems.length}
        <div class="picker-empty">No panels match this search.</div>
      {:else}
        <div class="pick-grid new-proof-grid">
          {#each filteredItems as item (item.src)}
            <button
              type="button"
              class="pick card selectable-pick"
              class:selected={panelPaths.includes(item.src)}
              aria-pressed={panelPaths.includes(item.src)}
              onclick={() => togglePanel(item.src)}
            >
              <span class="pick-image">
                {#if item.thumb}
                  <img src={`/files/${caseId}/${item.thumb}`} alt="" loading="lazy" decoding="async" />
                {:else}
                  <!-- no cached thumbnail yet: a placeholder, never the
                       full-size original in a 150px cell -->
                  <span class="pick-placeholder">
                    <Icon name={item.thumbPending ? 'clock' : 'image'} size={20} />
                  </span>
                {/if}
                {#if panelPaths.includes(item.src)}
                  <span class="pick-selected"><Icon name="check" size={13} /></span>
                {/if}
              </span>
              <span class="pick-label" title={item.label}>
                <Icon name={item.kind === 'satellite' ? 'satellite' : 'image'} size={12} />
                {item.label}
              </span>
            </button>
          {/each}
        </div>
      {/if}
    </fieldset>

    <div class="new-proof-actions">
      <button type="button" class="btn" disabled={creating} onclick={close}>Cancel</button>
      <button type="submit" class="btn btn-primary" disabled={creating}>
        <Icon name="plus" size={15} /> {creating ? 'Creating…' : 'Create proof'}
      </button>
    </div>
  </form>
</Modal>

<style>
  .new-proof-form { display: flex; flex-direction: column; gap: 15px; }
  .new-proof-field {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    align-items: center;
    gap: 5px 12px;
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .new-proof-field small { grid-column: 2; color: var(--text-3); font-weight: 400; }
  .new-proof-panels { min-width: 0; padding: 0; border: 0; }
  .new-proof-panels legend {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 7px;
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-2);
  }
  .selected-count { color: var(--text-3); font-weight: 500; }
  .panel-picker-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 7px;
    margin-bottom: 10px;
    min-width: 0;
  }
  .panel-search {
    min-width: 170px;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-3);
  }
  .panel-search:focus-within { border-color: var(--accent); }
  .panel-search input {
    width: 100%;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text-1);
    font: inherit;
  }
  .panel-search button { display: flex; color: var(--text-3); }
  .browse-btn {
    min-width: 30px;
    font-size: var(--fs-lg);
    line-height: 1;
  }
  .pick-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }
  .new-proof-grid { max-height: min(42vh, 390px); overflow-y: auto; padding: 1px; }
  .pick {
    overflow: hidden;
    text-align: left;
    transition: border-color 0.15s var(--ease);
  }
  .pick:hover, .selectable-pick.selected { border-color: var(--accent); }
  .selectable-pick { position: relative; }
  .pick img {
    width: 100%;
    aspect-ratio: 16 / 11;
    object-fit: cover;
    background: var(--bg-2);
  }
  .pick-image { position: relative; display: block; }
  .pick-placeholder {
    width: 100%;
    aspect-ratio: 16 / 11;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-2);
    color: var(--text-3);
  }
  .pick-selected {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-text);
  }
  .pick-label {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 8px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .picker-empty {
    min-height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    border: 1px dashed var(--border);
    border-radius: var(--r-md);
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
  .new-proof-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 2px; }
</style>
