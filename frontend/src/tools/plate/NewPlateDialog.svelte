<script>
  /**
   * New plate, on one screen: the layout picked on the left, the map and the page on
   * the right, each answered for you until you change it, so Create works at once.
   *
   * - **Layout**: the house layout, one of the ready plates (`gallery.js`), or one of
   *   the analyst's own templates, each drawn as its page.
   * - **Map**: the ground the Map is looking at or the ground the chosen layers cover,
   *   and which of the case's layers it draws.
   * - **Page**: the paper (a report, a post, a story…), which a ready plate is laid out
   *   again for rather than stretched, and the look, its own unless another is picked.
   *
   * A tile of the list of plates makes its plate straight away; this is what New plate opens.
   */
  import { untrack } from 'svelte';
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';
  import { isTracked } from '../../lib/map/layerHistory.js';
  import { THEMES, houseLayout } from '../../lib/plate/page.js';
  import { FORMATS, GALLERY, readyTemplate } from '../../lib/plate/gallery.js';
  import TemplateSketch from './TemplateSketch.svelte';
  import GroundSwatch from './GroundSwatch.svelte';

  let {
    /** The analyst's own map templates, `{ id, name, data }`. */
    templates = [],
    /** The case's layer rows. */
    rows = [],
    /** The layers a plate would draw if nothing is changed: those on in the Map, else the analyst's own. */
    layers: given = [],
    /** `(choice)`: `{ from: { kind, id }, where, layers, format, look }`. */
    onmake,
    onclose,
  } = $props();

  let from = $state({ kind: 'blank', id: '' });
  let where = $state('map');
  // the layers start from what the Map draws, then are the analyst's
  let layers = $state(untrack(() => [...given]));
  let format = $state('');
  let look = $state('');

  const blank = houseLayout();
  const ready = GALLERY.map((entry) => ({ ...entry, data: readyTemplate(entry.id) }));
  const framable = $derived(rows.some((row) => layers.includes(row.name) && row.bbox));

  function pick(kind, id = '') {
    from = { kind, id };
    // a ready plate opens on its own paper unless another is picked
    if (kind === 'ready') format = '';
  }
  function toggle(name) {
    layers = layers.includes(name) ? layers.filter((one) => one !== name) : [...layers, name];
  }
  function make() {
    onmake?.({ from: { ...from }, where: where === 'layers' && framable ? 'layers' : 'map', layers: [...layers], format, look });
  }
</script>

<Modal title="New plate" {onclose} width="940px" align="top">
  <div class="body">
    <section class="layouts">
      <h4>Layout</h4>
      <div class="gallery" role="listbox" aria-label="Layout">
        <button type="button" class="tile" role="option" aria-selected={from.kind === 'blank'} onclick={() => pick('blank')} ondblclick={make}>
          <TemplateSketch data={blank} width={180} /><span class="name">House layout</span><span class="note">The map, a key, a locator and the title.</span></button>
        {#each ready as entry (entry.id)}
          <button type="button" class="tile" role="option" aria-selected={from.kind === 'ready' && from.id === entry.id}
            onclick={() => pick('ready', entry.id)} ondblclick={make}>
            <TemplateSketch data={entry.data} width={180} /><span class="name">{entry.name}</span><span class="note">{entry.note}</span></button>
        {/each}
        {#each templates as template (template.id)}
          <button type="button" class="tile" role="option" aria-selected={from.kind === 'mine' && from.id === template.id}
            onclick={() => pick('mine', template.id)} ondblclick={make}>
            <TemplateSketch data={template.data} width={180} /><span class="name">{template.name}</span><span class="note">Your template.</span></button>
        {/each}
      </div>
    </section>

    <aside class="options">
      <h4>Map</h4>
      <div class="segments" role="group" aria-label="Where the plate looks">
        <button type="button" aria-pressed={where === 'map'} onclick={() => (where = 'map')}>Where the Map is looking</button>
        <button type="button" aria-pressed={where === 'layers'} disabled={!framable} title={framable ? '' : 'None of the layers picked has anything to frame'}
          onclick={() => (where = 'layers')}>Round the layers picked</button>
      </div>
      {#if rows.length}
        <ul class="layers" aria-label="Layers drawn">
          {#each rows as row (row.name)}
            <li><label><input type="checkbox" checked={layers.includes(row.name)} onchange={() => toggle(row.name)} />
              <span class="layer">{row.title}</span>{#if isTracked(row)}<Icon name="clock" size={11} />{/if}</label></li>
          {/each}
        </ul>
      {:else}
        <p class="note">No map layer in the case yet: Add › On the map draws zones, arrows and symbols on the plate itself.</p>
      {/if}

      <h4>Paper</h4>
      <div class="formats" role="group" aria-label="Paper">
        <button type="button" aria-pressed={format === ''} onclick={() => (format = '')}>{from.kind === 'blank' ? 'A4, wide' : 'As laid out'}</button>
        {#each FORMATS as [id, label] (id)}
          <button type="button" aria-pressed={format === id} onclick={() => (format = id)}>{label}</button>
        {/each}
      </div>

      <h4>Look</h4>
      <div class="looks" role="group" aria-label="Look">
        <button type="button" class="look" aria-pressed={look === ''} onclick={() => (look = '')}><span class="own">Aa</span><span>Its own</span></button>
        {#each Object.entries(THEMES) as [id, preset] (id)}
          <button type="button" class="look" aria-pressed={look === id} onclick={() => (look = id)}>
            <span class="sample" style:background={preset.theme.paper} style:color={preset.theme.ink}>
              <GroundSwatch id={preset.ground} width={30} height={20} /><b>Aa</b><i style:background={preset.theme.accent}></i></span>
            <span>{preset.label}</span></button>
        {/each}
      </div>
    </aside>
  </div>

  <div class="foot">
    <span class="said">All of it can be changed on the plate later.</span>
    <button type="button" class="btn" onclick={onclose}>Cancel</button>
    <button type="button" class="btn btn-primary" onclick={make}><Icon name="plus" size={14} /> Create plate</button>
  </div>
</Modal>

<style>
  .body { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 18px; height: min(64vh, 620px); }
  .layouts, .options { display: flex; flex-direction: column; min-height: 0; }
  .options { overflow: auto; padding-right: 4px; }
  h4 { margin: 14px 0 6px; color: var(--text-3); font-size: var(--fs-xs); font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
  .layouts h4, .options h4:first-child { margin-top: 0; }
  .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); align-content: start; gap: 10px; min-height: 0;
    overflow: auto; padding: 2px; }
  .tile { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 6px; border: 1px solid var(--border);
    border-radius: var(--r-md); background: var(--bg-1); color: var(--text-2); text-align: left; cursor: pointer; }
  .tile:hover { border-color: var(--text-3); }
  .tile[aria-selected='true'] { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .tile :global(.sketch) { width: 100%; border-radius: 2px; box-shadow: 0 0 0 1px var(--border); }
  .name { color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; }
  .note { color: var(--text-3); font-size: var(--fs-xs); line-height: 1.35; }
  .segments, .formats { display: flex; flex-wrap: wrap; gap: 4px; }
  .segments button, .formats button { padding: 4px 9px; border: 1px solid var(--border); border-radius: var(--r-sm); color: var(--text-2);
    font-size: var(--fs-sm); cursor: pointer; }
  .segments button[aria-pressed='true'], .formats button[aria-pressed='true'] { border-color: var(--accent); color: var(--text-1); background: var(--bg-2); }
  .segments button:disabled { opacity: .45; cursor: default; }
  .layers { max-height: 150px; margin: 8px 0 0; padding: 4px 8px; overflow: auto; list-style: none; border: 1px solid var(--border);
    border-radius: var(--r-sm); }
  .layers label { display: flex; align-items: center; gap: 6px; padding: 3px 0; color: var(--text-1); font-size: var(--fs-sm); cursor: pointer; }
  .layer { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .options .note { margin: 8px 0 0; }
  .looks { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .look { display: flex; flex-direction: column; align-items: stretch; gap: 3px; padding: 4px; border: 1px solid var(--border); border-radius: var(--r-sm);
    color: var(--text-2); font-size: var(--fs-xs); text-align: center; cursor: pointer; }
  .look[aria-pressed='true'] { border-color: var(--accent); color: var(--text-1); }
  .look .own { display: grid; place-items: center; height: 28px; border: 1px dashed var(--border); border-radius: 3px; color: var(--text-2); }
  .sample { position: relative; display: flex; align-items: center; gap: 4px; height: 28px; padding: 4px; border-radius: 3px; overflow: hidden; }
  .sample b { flex: 1; text-align: center; font-size: 12px; }
  .sample i { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; }
  .foot { display: flex; align-items: center; gap: 6px; margin-top: 14px; }
  .said { flex: 1; color: var(--text-3); font-size: var(--fs-xs); }
</style>
