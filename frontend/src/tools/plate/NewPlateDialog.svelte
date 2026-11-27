<script>
  /**
   * New plate, on one screen: the layout picked on the left, the map and the page on
   * the right, each answered for you until you change it, so Create works at once.
   *
   * - **What it shows**: a row of chips (`ASKS`) over the layouts, each keeping in view
   *   those that answer it, All every one. A chip that hides the layout picked picks
   *   the first it keeps.
   * - **Layout**: the house layout, one of the ready plates (`gallery.js`), a blank page
   *   (the paper and the look, nothing on it), or one of the analyst's own templates,
   *   each drawn as its page.
   * - **Map**: the ground the Map is looking at or the ground the chosen layers cover,
   *   and which of the case's layers it draws. Before and after can start from one of
   *   the case's comparisons, which are read once that layout is picked, never before.
   * - **Page**: the paper (a report, a post, a story…), which a ready plate is laid out
   *   again for rather than stretched, and the look, its own unless another is picked.
   *
   * A tile of the list of plates makes its plate straight away; this is what New plate opens.
   */
  import { untrack } from 'svelte';
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';
  import { api } from '../../lib/api.js';
  import { isTracked } from '../../lib/map/layerHistory.js';
  import { THEMES, houseLayout } from '../../lib/plate/page.js';
  import { ASKS, FORMATS, GALLERY, readyTemplate } from '../../lib/plate/gallery.js';
  import TemplateSketch from './TemplateSketch.svelte';
  import GroundSwatch from './GroundSwatch.svelte';

  let {
    /** The analyst's own map templates, `{ id, name, data }`. */
    templates = [],
    /** The case's layer rows. */
    rows = [],
    /** The layers a plate would draw if nothing is changed: those on in the Map, else the analyst's own. */
    layers: given = [],
    /** The case, whose saved comparisons Before and after can start from. */
    caseId = '',
    /** `(choice)`: `{ from: { kind, id }, where, layers, format, look, comparison }`, `kind` house, ready, empty or mine. */
    onmake,
    onclose,
  } = $props();

  let from = $state({ kind: 'house', id: '' });
  let ask = $state('all');
  let where = $state('map');
  // the layers start from what the Map draws, then are the analyst's
  let layers = $state(untrack(() => [...given]));
  let format = $state('');
  let look = $state('');
  /** The case's comparisons, `satellite/index` rows: null until Before and after is first picked. */
  let pairs = $state(null);
  /** The comparison Before and after starts from, by its session; '' for none. */
  let pair = $state('');

  /** The ready plate a comparison can be set on. */
  const PAIRED = 'before-after';
  /** The chips the pictured guide frames on their own (lib/guide.js). */
  const ASK_GUIDES = { situation: 'plate.ask-situation', change: 'plate.ask-change', geolocation: 'plate.ask-geolocation' };
  /** What the house layout answers: a situation as of the plate's day, played day by day on a dated layer. */
  const HOUSE_ASKS = ['situation', 'evolution'];
  const house = houseLayout();
  const empty = { page: { ...house.page }, theme: {}, elements: [] };
  const ready = GALLERY.map((entry) => ({ ...entry, data: readyTemplate(entry.id) }));
  const framable = $derived(rows.some((row) => layers.includes(row.name) && row.bbox));
  const answers = (asks) => ask === 'all' || asks.includes(ask);
  const shown = $derived(ready.filter((entry) => answers(entry.asks)));
  const houseShown = $derived(answers(HOUSE_ASKS));
  const paired = $derived(from.kind === 'ready' && from.id === PAIRED);
  const pairing = $derived(paired && !!pair);

  function pick(kind, id = '') {
    from = { kind, id };
    // a ready plate opens on its own paper unless another is picked
    if (kind === 'ready') format = '';
    if (kind === 'ready' && id === PAIRED) readPairs();
  }
  /** A chip: the layouts answering it stay in view, and the one picked with them, else the first of them. */
  function choose(id) {
    ask = id;
    const kept = from.kind === 'empty' || (from.kind === 'house' && houseShown) || (from.kind === 'mine' && ask === 'all')
      || (from.kind === 'ready' && shown.some((entry) => entry.id === from.id));
    if (kept) return;
    if (houseShown) pick('house');
    else if (shown.length) pick('ready', shown[0].id);
    else pick('empty');
  }
  let asked = false;
  function readPairs() {
    if (asked || !caseId) return;
    asked = true;
    api.get(`/api/cases/${caseId}/satellite/index`).then((list) => {
      pairs = (Array.isArray(list) ? list : []).filter((row) => row.kind === 'comparison' && row.session);
    }, () => { pairs = []; });
  }
  function toggle(name) {
    layers = layers.includes(name) ? layers.filter((one) => one !== name) : [...layers, name];
  }
  function make() {
    onmake?.({ from: { ...from }, where: where === 'layers' && framable ? 'layers' : 'map', layers: [...layers], format, look,
      comparison: pairing ? pair : '' });
  }
</script>

<Modal title="New plate" {onclose} width="940px" align="top">
  <div class="body">
    <section class="layouts">
      <h4>Layout</h4>
      <div class="asks" role="group" aria-label="What the plate shows">
        {#each [['all', 'All'], ...ASKS] as [id, words] (id)}
          <button type="button" class="ask" aria-pressed={ask === id} data-guide={ASK_GUIDES[id]} onclick={() => choose(id)}>{words}</button>
        {/each}
      </div>
      <div class="gallery" role="listbox" aria-label="Layout">
        {#if houseShown}
          <button type="button" class="tile" role="option" aria-selected={from.kind === 'house'} data-guide="plate.layout-house" onclick={() => pick('house')} ondblclick={make}>
            <TemplateSketch data={house} width={180} /><span class="name">House layout</span><span class="note">The map, a key, a locator and the title.</span></button>
        {/if}
        {#each shown as entry (entry.id)}
          <button type="button" class="tile" role="option" aria-selected={from.kind === 'ready' && from.id === entry.id}
            onclick={() => pick('ready', entry.id)} ondblclick={make}>
            <TemplateSketch data={entry.data} width={180} /><span class="name">{entry.name}</span><span class="note">{entry.note}</span></button>
        {/each}
        <button type="button" class="tile" role="option" aria-selected={from.kind === 'empty'} onclick={() => pick('empty')} ondblclick={make}>
          <TemplateSketch data={empty} width={180} /><span class="name">Blank page</span><span class="note">The paper and the look, nothing on it yet.</span></button>
        {#if ask === 'all'}
          {#each templates as template (template.id)}
            <button type="button" class="tile" role="option" aria-selected={from.kind === 'mine' && from.id === template.id}
              onclick={() => pick('mine', template.id)} ondblclick={make}>
              <TemplateSketch data={template.data} width={180} /><span class="name">{template.name}</span><span class="note">Your template.</span></button>
          {/each}
        {/if}
      </div>
      {#if ask === 'evolution' && !rows.some(isTracked)}
        <p class="note under">Needs a dated layer: in the Map, open one of My layers and turn on Track over time in its ⋯ menu.</p>
      {:else if ask === 'angles'}
        <p class="note under">No ready plate for it yet: each angle gets a slide from + Slide under the page, and its footage from Add › Video.</p>
      {/if}
    </section>

    <aside class="options">
      <h4>Map</h4>
      {#if from.kind === 'empty'}
        <p class="note">A blank page has no map yet. The first one added looks where the Map is looking, with its layers.</p>
      {:else}
        {#if paired && pairs?.length}
          <label class="from-pair" data-guide="plate.from-pair"><span>From a comparison</span>
            <select aria-label="From a comparison" value={pair} onchange={(event) => (pair = event.currentTarget.value)}>
              <option value="">None</option>
              {#each pairs as row (row.session)}<option value={row.session}>{row.title || row.session}</option>{/each}
            </select></label>
          {#if pairing}<p class="note">Both maps look where it does, each on its side's ground and day.</p>{/if}
        {/if}
        <div class="segments" role="group" aria-label="Where the plate looks">
          <button type="button" aria-pressed={where === 'map'} disabled={pairing} title={pairing ? 'The comparison says where the maps look' : ''}
            onclick={() => (where = 'map')}>Where the Map is looking</button>
          <button type="button" aria-pressed={where === 'layers'} disabled={!framable || pairing}
            title={pairing ? 'The comparison says where the maps look' : framable ? '' : 'None of the layers picked has anything to frame'}
            onclick={() => (where = 'layers')}>Round the layers picked</button>
        </div>
        {#if rows.length}
          <ul class="layers" aria-label="Layers drawn">
            {#each rows as row (row.name)}
              <!-- the guide frames the first layer not ticked yet, the one its reader ticks (lib/guide.js) -->
              <li><label data-guide={layers.includes(row.name) ? undefined : 'plate.map-layer'}><input type="checkbox" checked={layers.includes(row.name)} onchange={() => toggle(row.name)} />
                <span class="layer">{row.title}</span>{#if isTracked(row)}<Icon name="clock" size={11} />{/if}</label></li>
            {/each}
          </ul>
        {:else}
          <p class="note">No map layer in the case yet: Add › On the map draws zones, arrows and symbols on the plate itself.</p>
        {/if}
      {/if}

      <h4>Paper</h4>
      <div class="formats" role="group" aria-label="Paper" data-guide="plate.paper">
        <button type="button" aria-pressed={format === ''} onclick={() => (format = '')}>{['house', 'empty'].includes(from.kind) ? 'A4, wide' : 'As laid out'}</button>
        {#each FORMATS as [id, label] (id)}
          <button type="button" aria-pressed={format === id} onclick={() => (format = id)}>{label}</button>
        {/each}
      </div>

      <h4>Look</h4>
      <div class="looks" role="group" aria-label="Look">
        <button type="button" class="look" aria-pressed={look === ''} data-guide="plate.look" onclick={() => (look = '')}><span class="own">Aa</span><span>Its own</span></button>
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
    <button type="button" class="btn btn-primary" data-guide="plate.create" onclick={make}><Icon name="plus" size={14} /> Create plate</button>
  </div>
</Modal>

<style>
  .body { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 18px; height: min(64vh, 620px); }
  .layouts, .options { display: flex; flex-direction: column; min-height: 0; }
  .options { overflow: auto; padding-right: 4px; }
  /* the column scrolls as a whole: none of its parts is squeezed to fit, the list of layers first of all */
  .options > * { flex: none; }
  h4 { margin: 14px 0 6px; color: var(--text-3); font-size: var(--fs-xs); font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
  .layouts h4, .options h4:first-child { margin-top: 0; }
  .asks { display: flex; flex-wrap: wrap; gap: 4px; margin: 0 0 10px; }
  .ask { padding: 3px 10px; border: 1px solid var(--border); border-radius: 999px; color: var(--text-2); font-size: var(--fs-xs); cursor: pointer; }
  .ask:hover { border-color: var(--text-3); color: var(--text-1); }
  .ask[aria-pressed='true'] { border-color: var(--accent); color: var(--text-1); background: var(--bg-2); }
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
  .layouts .under { flex: none; margin: 10px 2px 0; }
  .from-pair { display: grid; gap: 4px; margin: 0 0 10px; color: var(--text-2); font-size: var(--fs-sm); }
  .from-pair + .note { margin: -4px 0 10px; }
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
