<script>
  /**
   * The analyst's own icons, offered in every personal layer's palette.
   *
   * Imported here once, from files, a folder or a zipped pack, whose folders
   * become groups. Each icon is drawn in a disc, its shape inked in the marker's
   * colour, or as it is; the import guesses which and the analyst has the last
   * word. A layer keeps a copy of each icon it wears, so removing one here
   * changes no map, and the settings backup carries the whole library.
   */
  import Icon from '../../components/Icon.svelte';
  import SearchInput from '../../components/SearchInput.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import ConfirmDialog from '../../components/ConfirmDialog.svelte';
  import MarkerSymbol from '../satellite/MarkerSymbol.svelte';
  import { DEFAULT_GROUP, iconLibrary } from '../../lib/iconLibrary.svelte.js';
  import { ICON_MODES } from '../../lib/map/layerHelp.js';
  import { toast } from '../../lib/state.svelte.js';

  /** The disc colour a preview is drawn in. */
  const PREVIEW = '#0072b2';

  let files = $state();
  let folder = $state();
  let query = $state('');
  let busy = $state(false);
  let progress = $state(null);
  let report = $state(null);
  let over = $state(false);
  /** The tile whose ⋯ menu is open, `{ key, anchor }`, and the group a remove asks about. */
  let menu = $state(null);
  let newGroup = $state('');
  let removing = $state(null);

  $effect(() => { iconLibrary.load(); });

  const words = $derived(query.toLowerCase().trim().split(/\s+/).filter(Boolean));
  const shown = $derived(iconLibrary.icons.filter((icon) =>
    words.every((word) => `${icon.name} ${icon.group}`.toLowerCase().includes(word))));
  const groups = $derived([...new Set(shown.map((icon) => icon.group || DEFAULT_GROUP))]
    .map((group) => ({ group, icons: shown.filter((icon) => (icon.group || DEFAULT_GROUP) === group) })));
  const look = (icon) => iconLibrary.look(icon.key);

  async function bring(list) {
    if (!list?.length || busy) return;
    busy = true; report = null; progress = null;
    try {
      report = await iconLibrary.importFiles([...list], (sent, total) => { progress = { sent, total }; });
      const added = report.added.length;
      toast(added ? `${added} icon${added === 1 ? '' : 's'} added` : 'No new icons', added ? 'ok' : 'info');
    } catch (error) {
      toast(`Could not import the icons: ${error.message}`, 'danger', 5000);
    } finally {
      busy = false; progress = null;
    }
  }
  function picked(event) {
    const list = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = '';
    bring(list);
  }
  function dropped(event) {
    event.preventDefault();
    over = false;
    bring(event.dataTransfer?.files);
  }
  async function change(icon, changes) {
    try { await iconLibrary.update(icon.key, changes); } catch (error) { toast(error.message, 'danger'); }
  }
  async function moveTo(icon, group) {
    menu = null; newGroup = '';
    if (group.trim()) await change(icon, { group: group.trim() });
  }
  async function renameGroup(section, name) {
    const next = name.trim();
    if (!next || next === section.group) return;
    for (const icon of section.icons) await change(icon, { group: next });
  }
  async function remove(keys) {
    try {
      const count = await iconLibrary.remove(keys);
      toast(`${count} icon${count === 1 ? '' : 's'} removed`, 'ok');
    } catch (error) { toast(error.message, 'danger'); }
  }
  const opened = $derived(menu ? iconLibrary.find(menu.key) : null);
</script>

<section class="group">
  <h3>Icons</h3>
  <p class="note">
    Your own icons, offered in every layer's palette. A layer keeps a copy of each icon it wears, so removing one here changes no map.
  </p>
  <div class="drop" class:over role="region" aria-label="Drop icons here"
    ondragover={(event) => { event.preventDefault(); over = true; }} ondragleave={() => (over = false)} ondrop={dropped}>
    <Icon name="upload" size={16} />
    <span>Drop icons here, or</span>
    <button class="btn btn-sm" disabled={busy} onclick={() => files?.click()}
      title="PNG, JPEG, WebP, GIF or SVG files, or a zipped pack">Import files</button>
    <button class="btn btn-sm" disabled={busy} onclick={() => folder?.click()}
      title="Every picture of a folder; its subfolders become groups">Import a folder</button>
    <input type="file" multiple hidden bind:this={files} onchange={picked}
      accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.svg,.zip,application/zip" />
    <input type="file" multiple hidden bind:this={folder} onchange={picked} webkitdirectory />
    <small>PNG, JPEG, WebP, GIF, SVG or a .zip pack, 512 KB a file. A folder in a pack becomes a group.</small>
  </div>
  {#if progress}<p class="note" role="status">Importing {progress.sent} of {progress.total}…</p>
  {:else if busy}<p class="note" role="status">Reading the files…</p>{/if}
  {#if report}
    <div class="report" role="status">
      <span>{report.added.length} added</span>
      {#if report.already}<span>{report.already} already there</span>{/if}
      {#if report.skipped.length}
        <details>
          <summary>{report.skipped.length} skipped</summary>
          <ul>{#each report.skipped as item, index (index)}<li><b>{item.name}</b>: {item.reason}</li>{/each}</ul>
        </details>
      {/if}
      <button class="btn btn-ghost btn-sm" aria-label="Close the report" title="Close" onclick={() => (report = null)}><Icon name="x" size={12} /></button>
    </div>
  {/if}
</section>

<section class="group">
  <div class="head">
    <SearchInput bind:value={query} placeholder="Find an icon" width="200px" />
    <span class="count" title="Icons in your library, of the most it holds">{iconLibrary.icons.length} / {iconLibrary.max}</span>
  </div>
  {#if !iconLibrary.icons.length}
    <p class="no-icons">No icons yet. Import some, and they show in the Icon part of every layer's palette.</p>
  {:else if !shown.length}
    <p class="no-icons">No icon matches that.</p>
  {/if}
  {#each groups as section (section.group)}
    <div class="icon-group">
      <div class="group-head">
        <input class="group-name" aria-label={`Name of group ${section.group}`} title="Rename this group"
          value={section.group} maxlength="60" onchange={(event) => renameGroup(section, event.currentTarget.value)}
          onkeydown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        <span class="count">{section.icons.length}</span>
        <button class="btn btn-ghost btn-sm" title="Remove every icon of this group" aria-label={`Remove group ${section.group}`}
          onclick={() => (removing = section)}><Icon name="trash" size={12} /></button>
      </div>
      <div class="tiles">
        {#each section.icons as icon (icon.key)}
          <div class="tile">
            <MarkerSymbol colour={PREVIEW} icon={look(icon)} size={40} />
            <input class="name" aria-label={`Name of ${icon.name}`} title="Its name in the palette and in legends"
              value={icon.name} maxlength="80" onchange={(event) => change(icon, { name: event.currentTarget.value })}
              onkeydown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
            <div class="modes" role="group" aria-label={`How ${icon.name} is drawn`}>
              {#each ICON_MODES as [value, label, hover] (value)}
                <button type="button" aria-pressed={icon.mode === value} title={hover}
                  onclick={() => icon.mode !== value && change(icon, { mode: value })}>{label}</button>
              {/each}
            </div>
            <button class="more" aria-label={`More for ${icon.name}`} title="Move it to another group, or remove it"
              onclick={(event) => (menu = menu?.key === icon.key ? null : { key: icon.key, anchor: event.currentTarget })}>
              <Icon name="more" size={13} /></button>
          </div>
        {/each}
      </div>
    </div>
  {/each}
</section>

{#if menu && opened}
  <FloatingMenu anchor={menu.anchor} align="end" width={220} label={`${opened.name} menu`} onclose={() => (menu = null)}>
    <p class="fm-head">Move to</p>
    {#each iconLibrary.groups.filter((group) => group !== (opened.group || DEFAULT_GROUP)) as group (group)}
      <button type="button" class="fm-item" onclick={() => moveTo(opened, group)}>{group}</button>
    {/each}
    <form class="new-group" onsubmit={(event) => { event.preventDefault(); moveTo(opened, newGroup); }}>
      <input aria-label="New group" placeholder="New group" maxlength="60" bind:value={newGroup} title="Files the icon under a new group" />
    </form>
    <div class="fm-sep"></div>
    <button type="button" class="fm-item danger" title="Maps that wear it keep their own copy"
      onclick={() => { const key = opened.key; menu = null; remove([key]); }}>
      <Icon name="trash" size={13} /> Remove</button>
  </FloatingMenu>
{/if}

{#if removing}
  <ConfirmDialog title={`Remove ${removing.group}?`}
    message={`Its ${removing.icons.length} icon${removing.icons.length === 1 ? '' : 's'} leave your library. Maps that wear them keep their own copies.`}
    confirmLabel="Remove" tone="danger"
    onconfirm={() => { const keys = removing.icons.map((icon) => icon.key); removing = null; remove(keys); }}
    oncancel={() => (removing = null)} />
{/if}

<style>
  .drop { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 14px; border: 1px dashed var(--border);
    border-radius: var(--r-md, 6px); color: var(--text-2); }
  .drop.over { border-color: var(--accent); background: var(--accent-soft); }
  .drop small { flex-basis: 100%; color: var(--text-3); }
  .report { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px; margin-top: 8px; color: var(--text-2); font-size: var(--fs-xs); }
  .report details { flex-basis: 100%; }
  .report ul { margin: 4px 0 0; padding-left: 16px; max-height: 140px; overflow-y: auto; }
  .report button { margin-left: auto; }
  .head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .count { color: var(--text-3); font-size: var(--fs-xs); }
  .no-icons { color: var(--text-3); font-size: var(--fs-sm); }
  .icon-group + .icon-group { margin-top: 12px; }
  .group-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
  .group-name { flex: 0 1 220px; padding: 2px 6px; border: 1px solid transparent; background: none; font-weight: 600; color: var(--text-1); }
  .group-name:hover, .group-name:focus { border-color: var(--border); background: var(--bg-2); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px; }
  .tile { position: relative; display: grid; justify-items: center; gap: 4px; padding: 8px 6px 6px; border: 1px solid var(--border);
    border-radius: var(--r-sm); background: var(--bg-1); }
  .tile .name { width: 100%; padding: 2px 4px; border: 1px solid transparent; background: none; text-align: center; font-size: var(--fs-xs); color: var(--text-1); }
  .tile .name:hover, .tile .name:focus { border-color: var(--border); background: var(--bg-2); }
  .modes { display: flex; border: 1px solid var(--border); border-radius: var(--r-sm); overflow: hidden; }
  .modes button { padding: 2px 6px; color: var(--text-2); font-size: 10px; cursor: pointer; }
  .modes button + button { border-left: 1px solid var(--border); }
  .modes button[aria-pressed='true'] { background: var(--accent-soft); color: var(--text-1); font-weight: 600; }
  .more { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; width: 22px; height: 22px;
    border-radius: var(--r-sm); color: var(--text-3); cursor: pointer; }
  .more:hover { background: var(--bg-3); color: var(--text-1); }
  .new-group { padding: 2px 6px 4px; }
  .new-group input { width: 100%; }
</style>
