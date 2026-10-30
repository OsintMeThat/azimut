<script>
  /**
   * "Add these icons to my library": a layer's own icons (a copied map's, an
   * imported KMZ's, GeoConfirmed's) filed in Settings › Icons, so any layer of
   * any case can wear them. All of them ticked to start; the analyst takes
   * some off. The ones the library already holds say so and are left out.
   *
   * Never done on its own: a GeoConfirmed map carries hundreds of icons, and
   * copying a map is not asking for all of them in every palette.
   */
  import Icon from '../../components/Icon.svelte';
  import MarkerSymbol from './MarkerSymbol.svelte';
  import { iconLibrary } from '../../lib/iconLibrary.svelte.js';
  import { ICON_HELP } from '../../lib/map/layerHelp.js';
  import { iconVersion, layerIconUrl } from '../../lib/map/ownIcons.js';
  import { toast } from '../../lib/state.svelte.js';

  let { caseId, row, onclose } = $props();
  let held = $state.raw(null);
  let ticked = $state(new Set());
  let busy = $state(false);

  $effect(() => {
    iconLibrary.load();
    iconLibrary.loadLayer(caseId, row.name).then((list) => {
      held = list;
      ticked = new Set(list.filter((icon) => !iconLibrary.holds(icon.key, icon.digest)).map((icon) => icon.key));
    });
  });
  const fresh = $derived((held ?? []).filter((icon) => !iconLibrary.holds(icon.key, icon.digest)));

  function toggle(key) {
    const next = new Set(ticked);
    if (next.has(key)) next.delete(key); else next.add(key);
    ticked = next;
  }
  async function file() {
    if (!ticked.size) return;
    busy = true;
    try {
      const body = await iconLibrary.fromLayer(caseId, row.name, [...ticked]);
      const added = body.added?.length ?? 0;
      toast(added ? `${added} icon${added === 1 ? '' : 's'} added to your library` : 'Your library already holds them', added ? 'ok' : 'info');
      onclose?.();
    } catch (error) {
      toast(error.message, 'danger');
    } finally { busy = false; }
  }
</script>

<div class="overlay" role="presentation" onclick={(event) => event.target === event.currentTarget && onclose?.()}>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={ICON_HELP.toLibrary}>
    <div class="head">
      <h3>{ICON_HELP.toLibrary}</h3>
      <button class="btn btn-ghost btn-sm" aria-label="Close" title="Close" onclick={() => onclose?.()}><Icon name="x" size={13} /></button>
    </div>
    <p class="note">From {row.title}, filed under its name in Settings › Icons.</p>
    {#if held === null}
      <p class="note">Reading the icons…</p>
    {:else if !fresh.length}
      <p class="note">Your library already holds every icon of this layer.</p>
    {:else}
      <div class="bar">
        <button type="button" class="link" onclick={() => (ticked = new Set(fresh.map((icon) => icon.key)))}>All</button>
        <button type="button" class="link" onclick={() => (ticked = new Set())}>None</button>
        <span>{ticked.size} of {fresh.length}</span>
      </div>
      <div class="grid">
        {#each fresh as icon (icon.key)}
          <label class="pick" class:on={ticked.has(icon.key)} title={icon.name ? `${icon.name}, worn ${icon.count} times` : `Worn ${icon.count} times`}>
            <input type="checkbox" checked={ticked.has(icon.key)} onchange={() => toggle(icon.key)}
              aria-label={`Add ${icon.name || 'this icon'}`} />
            <MarkerSymbol colour="#0072b2" icon={{ src: layerIconUrl(caseId, row.name, icon.key, iconVersion(row)), mode: icon.mode }} size={34} />
            <span>{icon.name || ICON_HELP.layerIcon}</span>
          </label>
        {/each}
      </div>
    {/if}
    <div class="actions">
      <button class="btn btn-sm" onclick={() => onclose?.()}>Cancel</button>
      <button class="btn btn-primary btn-sm" disabled={busy || !ticked.size} onclick={file}>
        Add {ticked.size || ''} to my library</button>
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; background: #0008; }
  .dialog { display: flex; flex-direction: column; gap: 8px; width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 64px);
    padding: 14px 16px; border: 1px solid var(--border); border-radius: var(--r-md, 6px); background: var(--bg-1); }
  .head { display: flex; align-items: center; justify-content: space-between; }
  .head h3 { margin: 0; font-size: var(--fs-md, 14px); }
  .note { margin: 0; color: var(--text-2); font-size: var(--fs-xs); }
  .bar { display: flex; align-items: center; gap: 10px; color: var(--text-3); font-size: var(--fs-xs); }
  .link { padding: 0; color: var(--accent); font-size: var(--fs-xs); cursor: pointer; text-decoration: underline; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 6px; overflow-y: auto; }
  .pick { position: relative; display: grid; justify-items: center; gap: 3px; padding: 8px 4px 6px; border: 1px solid var(--border);
    border-radius: var(--r-sm); color: var(--text-2); font-size: 10.5px; text-align: center; cursor: pointer; }
  .pick.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text-1); }
  .pick input { position: absolute; top: 4px; left: 4px; margin: 0; }
  .pick span { overflow: hidden; max-width: 100%; text-overflow: ellipsis; white-space: nowrap; }
  .actions { display: flex; justify-content: flex-end; gap: 6px; }
</style>
