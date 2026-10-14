<script>
  /**
   * What the selected element of a plate is, field by field; the page's paper and
   * theme when nothing is selected. Every field writes the plate as it is set, and
   * the plate saves itself.
   */
  import Icon from '../../components/Icon.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import { api } from '../../lib/api.js';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { buildMediaQuery } from '../../lib/mediaQuery.js';
  import { isTracked } from '../../lib/map/layerHistory.js';
  import { FONTS, KIND_LABELS, PAPERS, labelBox } from '../../lib/plate/page.js';

  let {
    spec,
    selected = '',
    caseId = '',
    rows = [],
    /** The basemaps a plate offers, `[id, label]`. */
    grounds = [],
    /** The legend rows each map shows now, by map id, so they can be renamed. */
    legend = {},
    onpaper,
    onremove,
    onduplicate,
    onorder,
    onframe,
    onlabels,
    framing = '',
  } = $props();

  const element = $derived(spec.elements.find((item) => item.id === selected) ?? null);
  const maps = $derived(spec.elements.filter((item) => item.kind === 'map'));
  const credited = $derived(spec.elements.filter((item) => item.kind === 'credits').length);
  let picking = $state(false);
  let pickAnchor = $state(null);
  let pictures = $state([]);

  const OVERLAYS = [['relief', 'Relief shading'], ['boundaries', 'Borders and big names'], ['placenames', 'Town and village names']];

  function toggleOverlay(id) {
    const list = element.overlays ?? [];
    element.overlays = list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
  }
  function toggleLayer(row) {
    const list = element.layers ?? [];
    element.layers = list.some((entry) => entry.name === row.name)
      ? list.filter((entry) => entry.name !== row.name)
      : [...list, { name: row.name, hidden: [], stroke: 1 }];
  }
  function toggleGroup(entry, group) {
    entry.hidden = entry.hidden.includes(group) ? entry.hidden.filter((name) => name !== group) : [...entry.hidden, group];
  }
  async function openPictures(event) {
    pickAnchor = event.currentTarget;
    picking = true;
    try {
      const page = await api.get(buildMediaQuery(caseId, { kind: 'image', limit: 60 }));
      pictures = page.items ?? [];
    } catch { pictures = []; }
  }
  const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
</script>

<aside class="inspector" aria-label="Plate inspector">
  {#if !element}
    <h3>Page</h3>
    <div class="rows">
      <span class="key">Paper</span>
      <select aria-label="Paper" value={spec.page.paper} onchange={(event) => onpaper({ ...spec.page, paper: event.currentTarget.value })}>
        {#each Object.entries(PAPERS) as [id, paper] (id)}<option value={id}>{paper.label}</option>{/each}
      </select>
      <span class="key">Turned</span>
      <div class="segments" role="group" aria-label="Orientation">
        {#each [['landscape', 'Landscape'], ['portrait', 'Portrait']] as [value, label] (value)}
          <button type="button" aria-pressed={spec.page.orientation === value} onclick={() => onpaper({ ...spec.page, orientation: value })}>{label}</button>
        {/each}
      </div>
      <span class="key">Font</span>
      <select aria-label="Font" bind:value={spec.theme.font}>
        {#each Object.entries(FONTS) as [id, font] (id)}<option value={id}>{font.label}</option>{/each}
      </select>
      <span class="key">Paper colour</span><input type="color" aria-label="Paper colour" bind:value={spec.theme.paper} />
      <span class="key">Ink</span><input type="color" aria-label="Ink colour" bind:value={spec.theme.ink} />
      <span class="key">Accent</span><input type="color" aria-label="Accent colour" bind:value={spec.theme.accent} />
    </div>
    <p class="note">Pick an element on the page to set it. Double-click a map to frame it.</p>
  {:else}
    <header>
      <h3>{KIND_LABELS[element.kind]}</h3>
      <button type="button" class="icon-act" aria-label="Bring forward" title="Bring forward" onclick={() => onorder(element, 1)}><Icon name="chevronUp" size={13} /></button>
      <button type="button" class="icon-act" aria-label="Send back" title="Send back" onclick={() => onorder(element, -1)}><Icon name="chevronDown" size={13} /></button>
      {#if element.kind !== 'map' && element.kind !== 'credits'}
        <button type="button" class="icon-act" aria-label="Duplicate" title="Duplicate" onclick={() => onduplicate(element)}><Icon name="copy" size={13} /></button>
      {/if}
      <button type="button" class="icon-act danger" aria-label="Remove" title={element.kind === 'credits' && credited < 2 ? 'The map\'s sources are owed their credit' : 'Remove'}
        disabled={element.kind === 'credits' && credited < 2} onclick={() => onremove(element)}><Icon name="trash" size={13} /></button>
    </header>

    {#if element.kind === 'map'}
      <button type="button" class="btn btn-sm frame" class:on={framing === element.id} onclick={() => onframe(element)}>
        <Icon name="move" size={12} /> {framing === element.id ? 'Done framing' : 'Frame the map'}</button>
      <div class="rows">
        <span class="key">Ground</span>
        <select aria-label="Ground" bind:value={element.basemap}>
          {#each grounds as [id, label] (id)}<option value={id}>{label}</option>{/each}
        </select>
        <span class="key">Zoom</span>
        <input type="number" aria-label="Zoom" step="0.1" min="0" max="22" value={element.view.zoom.toFixed(2)}
          onchange={(event) => (element.view = { ...element.view, zoom: Math.min(22, Math.max(0, number(event.currentTarget.value, element.view.zoom))) })} />
        <span class="key">Turned</span>
        <input type="number" aria-label="Bearing" step="1" min="-180" max="180" value={Math.round(element.view.bearing ?? 0)}
          onchange={(event) => (element.view = { ...element.view, bearing: number(event.currentTarget.value, 0) % 360 })} />
        <span class="key">Grid</span>
        <div class="segments" role="group" aria-label="Grid">
          <button type="button" aria-pressed={element.grid !== 'latlon'} onclick={() => (element.grid = 'none')}>None</button>
          <button type="button" aria-pressed={element.grid === 'latlon'} onclick={() => (element.grid = 'latlon')}>Lat · lon</button>
        </div>
      </div>
      <div class="checks">
        {#each OVERLAYS as [id, label] (id)}
          {#if id !== 'relief' || element.basemap?.startsWith('plain')}
            <label><input type="checkbox" checked={(element.overlays ?? []).includes(id)} onchange={() => toggleOverlay(id)} /> {label}</label>
          {/if}
        {/each}
      </div>
      <h4>Layers</h4>
      {#if !rows.length}<p class="note">The case has no map layers yet. Add some in the Map.</p>{/if}
      <ul class="layers">
        {#each rows as row (row.name)}
          {@const entry = (element.layers ?? []).find((item) => item.name === row.name)}
          <li>
            <label class="layer"><input type="checkbox" checked={!!entry} onchange={() => toggleLayer(row)} />
              <span class="name">{row.title}</span>{#if isTracked(row)}<Icon name="clock" size={11} />{/if}</label>
            {#if entry}
              <div class="layer-set">
                <div class="groups">
                  {#each row.categories as group (group.name)}
                    <button type="button" class="chip" class:off={entry.hidden.includes(group.name)} title={entry.hidden.includes(group.name) ? 'Show on this plate' : 'Leave out of this plate'}
                      onclick={() => toggleGroup(entry, group.name)}>{group.name}</button>
                  {/each}
                </div>
                <label class="weight">Weight <input type="range" min="0.5" max="3" step="0.25" bind:value={entry.stroke} /> <span>{entry.stroke}×</span></label>
                <button type="button" class="text-act" onclick={() => onlabels(element, row)}>Label its named features</button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {:else if element.kind === 'inset'}
      <div class="rows">
        <span class="key">Ground</span>
        <select aria-label="Ground" bind:value={element.basemap}>
          {#each grounds as [id, label] (id)}<option value={id}>{label}</option>{/each}
        </select>
        <span class="key">Zoom</span>
        <input type="number" aria-label="Inset zoom" step="0.5" min="0" max="18" placeholder="Auto" value={element.zoom ?? ''}
          onchange={(event) => (element.zoom = event.currentTarget.value === '' ? null : number(event.currentTarget.value, null))} />
        <span class="key">Of</span>
        <select aria-label="Inset of" bind:value={element.of}>{#each maps as map (map.id)}<option value={map.id}>{map.id}</option>{/each}</select>
      </div>
      <p class="note">The inset follows its map and outlines the ground it shows.</p>
    {:else if element.kind === 'legend'}
      <div class="rows">
        <span class="key">Title</span><input aria-label="Legend title" bind:value={element.text} placeholder="Legend" maxlength="120" />
        <span class="key">Size</span><input type="number" aria-label="Text size" min="5" max="24" step="0.5" bind:value={element.size} />
        <span class="key">Columns</span><input type="number" aria-label="Columns" min="1" max="4" step="1" bind:value={element.columns} />
        <span class="key">Frame</span><input type="checkbox" aria-label="Legend frame" bind:checked={element.border} />
      </div>
      <h4>Rows</h4>
      {#each legend[element.of] ?? [] as entry (entry.key)}
        <input class="rename" aria-label={`Name of ${entry.label}`} placeholder={entry.label} maxlength="200"
          value={element.names?.[entry.key] ?? ''}
          onchange={(event) => { const names = { ...(element.names ?? {}) }; const value = event.currentTarget.value.trim();
            if (value) names[entry.key] = value; else delete names[entry.key]; element.names = names; }} />
      {:else}
        <p class="note">Layers shown on the map are listed here.</p>
      {/each}
    {:else if element.kind === 'text' || element.kind === 'label' || element.kind === 'credits'}
      {#if element.kind !== 'credits'}
        <textarea aria-label="Text" rows={element.kind === 'label' ? 2 : 4} bind:value={element.text} maxlength="4000"
          oninput={() => { if (element.kind === 'label') element.box = labelBox(element); }}></textarea>
        {#if element.kind === 'text'}<p class="note">{'{date}'} the plate's day, {'{today}'}, {'{case}'} and {'{title}'} are filled in.</p>{/if}
      {:else}
        <p class="note">The map's sources, written for you. A plate always carries them.</p>
      {/if}
      <div class="rows">
        <span class="key">Size</span><input type="number" aria-label="Text size" min="4" max="200" step="0.5" bind:value={element.size} />
        {#if element.kind !== 'credits'}
          <span class="key">Weight</span>
          <div class="segments" role="group" aria-label="Weight">
            {#each [[400, 'Regular'], [600, 'Semi'], [700, 'Bold']] as [value, label] (value)}
              <button type="button" aria-pressed={(element.weight ?? 400) === value} onclick={() => (element.weight = value)}>{label}</button>
            {/each}
          </div>
        {/if}
        {#if element.kind !== 'label'}
          <span class="key">Align</span>
          <div class="segments" role="group" aria-label="Align">
            {#each [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']] as [value, label] (value)}
              <button type="button" aria-pressed={(element.align ?? 'left') === value} onclick={() => (element.align = value)}>{label}</button>
            {/each}
          </div>
        {:else}
          <span class="key">Style</span>
          <div class="segments" role="group" aria-label="Label style">
            {#each [['plain', 'Plain'], ['bubble', 'Bubble'], ['box', 'Box']] as [value, label] (value)}
              <button type="button" aria-pressed={(element.style ?? 'plain') === value} onclick={() => (element.style = value)}>{label}</button>
            {/each}
          </div>
        {/if}
        <span class="key">Colour</span>
        <span class="colour"><input type="color" aria-label="Text colour" value={element.colour ?? spec.theme.ink} oninput={(event) => (element.colour = event.currentTarget.value)} />
          {#if element.colour}<button type="button" class="text-act" onclick={() => (element.colour = null)}>Theme</button>{/if}</span>
        {#if element.kind !== 'credits'}
          <span class="key">Fill</span>
          <span class="colour"><input type="color" aria-label="Fill colour" value={element.fill ?? '#ffffff'} oninput={(event) => (element.fill = event.currentTarget.value)} />
            {#if element.fill}<button type="button" class="text-act" onclick={() => (element.fill = null)}>None</button>{/if}</span>
        {/if}
        {#if element.kind === 'text'}<span class="key">Frame</span><input type="checkbox" aria-label="Text frame" bind:checked={element.border} />{/if}
      </div>
    {:else if element.kind === 'scale'}
      <div class="rows">
        <span class="key">Backing</span><input type="checkbox" aria-label="Scale backing" checked={!!element.fill}
          onchange={(event) => (element.fill = event.currentTarget.checked ? spec.theme.paper : null)} />
      </div>
      <p class="note">Measured at the map's centre, in the units set in Settings.</p>
    {:else if element.kind === 'arrow'}
      <div class="rows">
        <span class="key">Colour</span><input type="color" aria-label="Arrow colour" value={element.colour ?? spec.theme.accent} oninput={(event) => (element.colour = event.currentTarget.value)} />
        <span class="key">Width</span><input type="range" aria-label="Arrow width" min="0.3" max="4" step="0.1" bind:value={element.width} />
      </div>
      <p class="note">Drag its two ends on the map.</p>
    {:else if element.kind === 'image'}
      <button type="button" class="btn btn-sm" onclick={openPictures}><Icon name="image" size={12} /> {element.src ? 'Another picture' : 'Pick a picture'}</button>
      <div class="rows"><span class="key">Frame</span><input type="checkbox" aria-label="Picture frame" bind:checked={element.border} /></div>
    {:else if element.kind === 'north'}
      <p class="note">Turns with its map.</p>
    {/if}
  {/if}
</aside>

{#if picking}
  <FloatingMenu anchor={pickAnchor} width={300} label="Pictures of the case" onclose={() => (picking = false)}>
    <div class="pictures">
      {#each pictures as item (item.path)}
        <button type="button" class="picture" title={item.title || item.path}
          onclick={() => { element.src = item.path; picking = false; }}>
          <img src={fileUrl(caseId, item.thumbnail || item.path)} alt={item.title || ''} loading="lazy" />
        </button>
      {:else}
        <p class="note">No picture in this case yet.</p>
      {/each}
    </div>
  </FloatingMenu>
{/if}

<style>
  .inspector { width: 268px; flex: none; overflow-y: auto; padding: 10px 12px 16px; border-left: 1px solid var(--border); background: var(--bg-1); font-size: var(--fs-xs); }
  header { display: flex; align-items: center; gap: 2px; margin-bottom: 8px; }
  h3 { flex: 1; margin: 0 0 8px; font-size: var(--fs-sm); }
  header h3 { margin: 0; }
  h4 { margin: 14px 0 6px; color: var(--text-3); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .rows { display: grid; grid-template-columns: 82px minmax(0, 1fr); align-items: center; gap: 7px 8px; margin: 8px 0; }
  .key { color: var(--text-3); font-size: 11px; }
  select, input[type='number'], input:not([type]), .rename, textarea { width: 100%; min-width: 0; height: 26px; padding: 3px 6px; font-size: var(--fs-xs); border-radius: var(--r-sm); }
  textarea { height: auto; resize: vertical; line-height: 1.4; }
  input[type='color'] { width: 34px; height: 22px; padding: 0; border: 1px solid var(--border); border-radius: var(--r-sm); background: none; }
  .colour { display: flex; align-items: center; gap: 6px; }
  .rename { margin-bottom: 4px; }
  .segments { display: flex; border: 1px solid var(--border); border-radius: var(--r-sm); overflow: hidden; background: var(--bg-1); }
  .segments button { flex: 1; min-width: 0; padding: 4px 3px; color: var(--text-2); font-size: 11px; cursor: pointer; }
  .segments button + button { border-left: 1px solid var(--border); }
  .segments button[aria-pressed='true'] { background: var(--accent-soft); color: var(--text-1); font-weight: 600; }
  .checks { display: grid; gap: 4px; margin: 6px 0; }
  .checks label, .layer { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .layers { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .layer .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-1); }
  .layer-set { margin: 4px 0 4px 22px; display: grid; gap: 6px; }
  .groups { display: flex; flex-wrap: wrap; gap: 3px; }
  .chip { padding: 1px 7px; border: 1px solid var(--border); border-radius: 999px; background: var(--accent-soft); color: var(--text-1); font-size: 10.5px; cursor: pointer; }
  .chip.off { background: none; color: var(--text-3); text-decoration: line-through; }
  .weight { display: flex; align-items: center; gap: 6px; color: var(--text-3); font-size: 10.5px; }
  .weight input { flex: 1; }
  .frame { width: 100%; justify-content: center; margin-bottom: 4px; }
  .frame.on { border-color: var(--accent); color: var(--accent); }
  .note { margin: 6px 0; color: var(--text-3); font-size: 10.5px; line-height: 1.45; }
  .icon-act { display: grid; place-items: center; width: 24px; height: 24px; border-radius: var(--r-sm); color: var(--text-3); cursor: pointer; }
  .icon-act:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
  .icon-act.danger:hover:not(:disabled) { color: var(--danger); }
  .icon-act:disabled { opacity: .35; cursor: default; }
  .text-act { padding: 0; color: var(--text-3); font-size: 10.5px; text-align: left; cursor: pointer; }
  .text-act:hover { color: var(--text-1); text-decoration: underline; }
  .pictures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; padding: 4px; max-height: 320px; overflow-y: auto; }
  .picture { aspect-ratio: 1; padding: 0; border: 1px solid var(--border); border-radius: var(--r-sm); overflow: hidden; background: #000; cursor: pointer; }
  .picture:hover { border-color: var(--accent); }
  .picture img { width: 100%; height: 100%; object-fit: cover; }
</style>
