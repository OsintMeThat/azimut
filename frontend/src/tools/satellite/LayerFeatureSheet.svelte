<script module>
  /** Whether the Look rows are open, kept from one feature to the next while the app is open. */
  let lookShown = false;
</script>

<script>
  /**
   * What the selected features of a personal layer say, as a sheet of rows:
   * group, status, day, direction, sources, who geolocated it, a note. A marker
   * that follows a case item shows it first, the footage before the proof, each
   * picture opening it.
   *
   * Every row saves as it is set; a name or a note when the field is left, or
   * before the selection moves on (`commitForm` in the editor state). One
   * feature shows its own values; several show what they share and change
   * together, a row they disagree on reading "Several". How a feature is drawn
   * (its size, line, fill and name) folds under Look, after what it says.
   */
  import Icon from '../../components/Icon.svelte';
  import DayPicker from '../../components/DayPicker.svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import LayerSelectionStyle from './LayerSelectionStyle.svelte';
  import LayerFeatureWhen from './LayerFeatureWhen.svelte';
  import { linesOf } from '../../lib/map/layerHit.js';
  import { facingLabel } from '../../lib/map/turnRing.js';
  import { formatArea, formatDistance, pathLength, polygonArea } from '../../lib/measure.js';
  import { caseState, prefs } from '../../lib/state.svelte.js';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { hasHistory, momentLabel, spanLabel, spanOf } from '../../lib/map/layerHistory.js';
  import { CONFIDENCE_CHOICES, LAYER_HELP as HELP, ORIGIN_CHOICES, STATUS_CHOICES } from '../../lib/map/layerHelp.js';

  let { controller, onfollowed = null, ondeleteplace = null } = $props();
  const DASHES = [['', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']];
  const ARROWS = [['', 'None'], ['end', 'At its end'], ['both', 'Both ends']];
  const FILLS = [['', 'Filled'], ['hatch', 'Hatched'], ['none', 'Outline']];
  const NAMES = [['', 'Group'], ['on', 'Shown'], ['off', 'Hidden']];
  /** What a followed case item is called, by its entity type. */
  const KINDS = { place: 'place', capture: 'capture', 'compare-session': 'comparison', 'horizon-view': 'view', proof: 'proof', media: 'file' };
  const groups = $derived(controller.groups ?? []);
  const selection = $derived(controller.selection ?? []);
  const chosen = $derived(controller.features.filter((feature) => selection.includes(feature.properties.key)));
  const one = $derived(selection.length > 1 ? null : controller.selected);
  const form = $derived(controller.form);
  const point = $derived(one?.geometry.type === 'Point');
  // edits queue behind each other, so the sheet never waits on a save
  const busy = $derived(controller.loading);
  /** What the picked features are: markers, lines, areas; a row shows only where it means something. */
  const kinds = $derived(new Set(chosen.map((feature) => (feature.geometry.type.includes('Point') ? 'point' : feature.geometry.type.includes('Line') ? 'line' : 'area'))));
  const only = (kind) => kinds.size === 1 && kinds.has(kind);
  /** A slider shows where it is held while it moves, and saves where it is let go. */
  let sliding = $state({});
  function slide(field, value) { sliding = { ...sliding, [field]: value }; }
  function release(field) {
    const value = sliding[field];
    sliding = { ...sliding, [field]: undefined };
    if (value !== undefined) set(field, value);
  }
  const valueOf = (field, fallback) => sliding[field] ?? (one ? form?.[field] : shared(field, '')) ?? fallback;
  let menu = $state(false);
  let menuAnchor = $state(null);
  let adding = $state(false);
  let address = $state('');
  let refused = $state('');
  // A save hands back a fresh copy of the same feature; only another feature resets the sheet.
  const oneKey = $derived(one?.properties.key ?? '');
  /** The pictures that failed to load, for this feature: the thumbnail cache let them go. */
  let gone = $state(new Set());
  $effect(() => { void oneKey; adding = false; address = ''; refused = ''; menu = false; gone = new Set(); });

  /** The one value several features share, or null when they differ. */
  function shared(field, fallback = '') {
    const values = new Set(chosen.map((feature) => feature.properties[field] ?? fallback));
    return values.size === 1 ? [...values][0] : null;
  }
  /** One feature: set the field and save it. Several: change them all at once. A status is the day shown's, never the form's. */
  function set(field, value) {
    if (field === 'status') controller.setStatus(value);
    else if (one && form) { form[field] = value; controller.saveForm(); }
    else controller.updateSelection({ [field]: value === '' ? null : value });
  }
  const host = (link) => { try { return new URL(link).hostname.replace(/^www\./, ''); } catch { return link; } };
  function addSource() {
    const text = address.trim();
    if (!text) { adding = false; refused = ''; return; }
    if (!/^https?:\/\/\S+$/i.test(text)) { refused = 'Start the address with http:// or https://'; return; }
    if (!form.links.includes(text)) set('links', [...form.links, text]);
    address = ''; refused = ''; adding = false;
  }

  /** The length of a line, the area of an area, as the map would measure it. */
  const measured = $derived.by(() => {
    const geometry = one?.geometry;
    const type = String(geometry?.type ?? '');
    const points = (ring) => ring.map(([lon, lat]) => ({ lat, lon }));
    if (type.includes('LineString')) return ['Length', formatDistance(linesOf(geometry).reduce((sum, ring) => sum + pathLength(points(ring)), 0), prefs.units)];
    if (type.includes('Polygon')) {
      const polygons = type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      const area = polygons.reduce((sum, rings) => sum + rings.reduce((inner, ring, index) =>
        inner + (index ? -1 : 1) * polygonArea(points(ring.slice(0, -1))), 0), 0);
      return ['Area', formatArea(area, prefs.units)];
    }
    return null;
  });
  // on a tracked layer read at a moment, the status the feature had then
  const status = $derived(one ? one.properties.status ?? '' : shared('status'));
  const origin = $derived(one ? form?.provenance ?? '' : shared('provenance'));
  const day = $derived(one ? form?.date ?? '' : shared('date'));
  const group = $derived(one ? form?.group ?? '' : shared('group'));
  /** The layer is followed over time: when a feature shows is said under its name. */
  const tracked = $derived(!!controller.editor?.track?.on);
  /** While edits carry no date, the day a status changed on holds it: it is set from a day. */
  const statusHeld = $derived(chosen.map((feature) => controller.held?.(feature).status ?? '').find(Boolean) ?? '');
  /** Picked features not on the map on the day shown: what is dated there would move their days. */
  const away = $derived(tracked && controller.cursor !== null && chosen.some((feature) => feature.properties.$absent));
  /** The group the picked features share, whose look they draw in when they set none of their own. */
  const their = $derived(groups.find((option) => option.id === group) ?? null);
  let look = $state(lookShown);
  function showLook() { look = !look; lookShown = look; }
  /** The look rows set on what is picked, said on the folded Look line. */
  const lookSet = $derived([['marker_size', 'Size'], ['line_width', 'Width'], ['line_dash', 'Dash'], ['line_arrow', 'Arrow'],
    ['area_fill', 'Fill'], ['fill_opacity', 'Strength'], ['label', 'Name'], ['label_size', 'Name size']]
    .filter(([field]) => (one ? form?.[field] : shared(field, '')) ?? '').map(([, label]) => label));
  /** Its group's features are events, there on their day and fading after it. */
  const inEvents = $derived(!!groups.find((option) => option.id === one?.properties.group)?.events);
  /** Several picked, all events: their one day is said as an event's. */
  const allEvents = $derived(chosen.every((feature) => !!groups.find((option) => option.id === feature.properties.group)?.events));
  const blur = (event) => { if (event.key === 'Enter') event.currentTarget.blur(); };
</script>

<!-- a slider shows its value, quieter while its group sets it, and goes back to the group's with Reset -->
{#snippet slider(field, label, range, fallback, said, help)}
  {@const own = valueOf(field, '')}
  <span class="slider" title={help}><input type="range" aria-label={label} min={range[0]} max={range[1]} step={range[2]} value={own || fallback}
      oninput={(event) => slide(field, Number(event.currentTarget.value))} onchange={() => release(field)} />
    <span class="unit" class:quiet={!own}>{said(own || fallback)}</span>
    {#if own}<button type="button" class="text-act" title={field === 'label_size' ? 'Back to the usual size' : HELP.toGroup} disabled={busy}
      onclick={() => set(field, '')}>Reset</button>{/if}</span>
{/snippet}

{#if one && form || chosen.length > 1}
  <div class="sheet" role="group" aria-label={one ? 'Feature' : 'Selected features'}>
    <div class="sheet-head">
      <LayerSelectionStyle {controller} label="Feature style" size={22} regroup={false} disabled={busy} />
      {#if one}
        <input class="name" aria-label="Feature name" bind:value={form.name} maxlength="300" placeholder="Name"
          onchange={() => controller.saveForm()} onkeydown={blur} />
      {:else}
        <span class="name count">{chosen.length} selected</span>
      {/if}
      <button type="button" class="icon-act more-btn" aria-label="Feature actions" title="Save as a place, remove" aria-expanded={menu}
        bind:this={menuAnchor} onclick={() => (menu = !menu)}><Icon name="more" size={14} /></button>
      <button type="button" class="icon-act" aria-label="Clear the selection" title="Close"
        onclick={() => controller.select(null)}><Icon name="x" size={13} /></button>
    </div>

    {#if one && tracked}<LayerFeatureWhen {controller} feature={one} event={inEvents} />
    {:else if tracked && chosen.length > 1}<LayerFeatureWhen {controller} features={chosen} event={allEvents} />{/if}

    {#if one?.properties.entity_id}
      {@const said = one.properties}
      {@const kind = KINDS[said.entity_type] ?? 'case item'}
      <!-- what the marker stands for, first: the footage, then the proof that geolocates it -->
      <div class="follows">
        {#if (said.source_picture && !gone.has('source')) || (said.entity_picture && !gone.has('item'))}
          <div class="follow-pictures">
            {#if said.source_picture && !gone.has('source')}
              <button type="button" class="follow-picture" title={`Open the footage “${said.source_label || 'Untitled'}”`} disabled={!onfollowed}
                onclick={() => onfollowed?.(said.source_id)}>
                <img src={fileUrl(caseState.current?.id, said.source_picture)} alt={said.source_label || 'Footage'}
                  onerror={() => (gone = new Set([...gone, 'source']))} /><span>Source</span></button>
            {/if}
            {#if said.entity_picture && !gone.has('item')}
              <button type="button" class="follow-picture" title={`Open the ${kind}`} disabled={!onfollowed}
                onclick={() => onfollowed?.(said.entity_id)}>
                <img src={fileUrl(caseState.current?.id, said.entity_picture)} alt={said.entity_label || kind}
                  onerror={() => (gone = new Set([...gone, 'item']))} /><span>{said.entity_type === 'proof' ? 'Proof' : 'Source'}</span></button>
            {/if}
          </div>
        {/if}
        <div class="follow-text">
          <span title="Updated from it on each save, except what you rewrite here"><Icon name="link" size={11} /> Follows the {kind} “{said.entity_label || 'Untitled'}”</span>
          <span class="follow-acts">
            {#if onfollowed}<button type="button" class="text-act" onclick={() => onfollowed(said.entity_id)}>Open</button>{/if}
            <button type="button" class="text-act" disabled={busy} onclick={() => controller.unlink(said.key)}>Unlink</button>
          </span>
        </div>
      </div>
    {/if}

    {#if away}
      <p class="away" role="note">{one ? 'Not' : 'Some are not'} on the map on {momentLabel(controller.cursor)}: set when {one ? 'it shows' : 'they show'} to change {one ? 'it' : 'them'} there.</p>
    {/if}

    <div class="rows">
      {#if groups.length > 1}
        <span class="key" title={HELP.group}>Group</span>
        <select aria-label="Feature group" title={HELP.group} value={group ?? ''} disabled={busy} onchange={(event) => set('group', event.currentTarget.value)}>
          {#if group === null}<option value="" disabled>Several</option>{/if}
          {#each groups as option (option.id)}<option value={option.id}>{option.name}</option>{/each}
        </select>
      {/if}

      {#if only('point')}
        <span class="key" title={HELP.status}>Status</span>
        <div class="segments" role="group" aria-label="Feature status">
          {#each STATUS_CHOICES as [value, label, said] (value)}
            <button type="button" class:short={!value} aria-pressed={status === value} aria-label={value ? label : said} disabled={busy || !!statusHeld || away}
              title={statusHeld ? `Changes on ${momentLabel(statusHeld)}: pick a day to set it` : said} onclick={() => set('status', value)}>{label}</button>
          {/each}
        </div>
      {/if}

      <span class="key" title={HELP.confidence}>How sure</span>
      <div class="segments" role="group" aria-label="Feature confidence">
        {#each CONFIDENCE_CHOICES as [value, label, said] (value)}
          <button type="button" class:short={!value} aria-pressed={(one ? form?.confidence ?? '' : shared('confidence')) === value} disabled={busy} title={said}
            onclick={() => set('confidence', value)}>{label}</button>
        {/each}
      </div>

      <!-- on a layer followed over time, the When line under the name says it -->
      {#if !tracked && one && hasHistory(one)}
        <span class="key" title={HELP.days}>Days</span>
        <span class="value quiet" title={HELP.days}>{spanLabel(spanOf(one))}</span>
      {:else if !tracked}
        <span class="key" title={HELP.day}>Day</span>
        <DayPicker value={day ?? ''} label="Feature day" placeholder={day === null ? 'Several days' : 'No day'} clearable
          onpick={(picked) => set('date', picked)} />
      {/if}

      {#if point}
        <span class="key" title={HELP.facing}>Facing</span>
        {#if form.bearing !== '' && form.bearing !== null}
          <span class="value">{facingLabel(form.bearing)}
            <button type="button" class="icon-act" aria-label="Clear the direction" title="Clear" disabled={busy}
              onclick={() => set('bearing', '')}><Icon name="x" size={11} /></button></span>
        {:else}
          <span class="value quiet" title={HELP.facing}>Turn the ring on the map</span>
        {/if}
      {/if}

      {#if one}
        <span class="key" title={HELP.sources}>Sources</span>
        <div class="sources">
          {#each form.links as link, index (link)}
            <span class="chip">
              <a href={link} target="_blank" rel="noreferrer noopener" title={link}>{host(link)}</a>
              <button type="button" aria-label={`Remove source ${index + 1}`} title="Remove" disabled={busy}
                onclick={() => set('links', form.links.filter((_, at) => at !== index))}><Icon name="x" size={10} /></button>
            </span>
          {/each}
          {#if adding}
            <!-- svelte-ignore a11y_autofocus -->
            <input type="url" class="address" aria-label="New source" placeholder="https://" bind:value={address} maxlength="2000" autofocus
              onkeydown={(event) => { if (event.key === 'Enter') addSource(); else if (event.key === 'Escape') { event.stopPropagation(); adding = false; refused = ''; } }}
              onblur={addSource} />
          {:else if form.links.length < 10}
            <button type="button" class="add-source" aria-label="Add a source" title="Add the address of a post, a page or a map" onclick={() => (adding = true)}><Icon name="plus" size={11} /> Add</button>
          {/if}
          {#if refused}<p class="refused" role="alert">{refused}</p>{/if}
        </div>
      {/if}

      <span class="key" title={HELP.origin}>Geolocated by</span>
      <div class="segments" role="group" aria-label="Geolocated by">
        {#each ORIGIN_CHOICES as [value, label, said] (value)}
          <button type="button" aria-pressed={origin === value} disabled={busy} title={said} onclick={() => set('provenance', value)}>{label}</button>
        {/each}
      </div>
      {#if one?.properties.credit}
        <span class="key" title={HELP.credit}>Credit</span>
        <span class="value quiet" title={HELP.credit}>{one.properties.credit}</span>
      {/if}

      {#if one}
        <span class="key" title={HELP.note}>Note</span>
        <textarea aria-label="Feature note" title={HELP.note} bind:value={form.description} maxlength="4000" rows="2" placeholder="What it shows, what it rests on"
          onchange={() => controller.saveForm()}></textarea>
      {/if}

      {#if measured}<span class="key">{measured[0]}</span><span class="value">{measured[1]}</span>{/if}
    </div>

    <!-- how it is drawn comes after what it says, folded until asked for -->
    <button type="button" class="look" aria-expanded={look} title={HELP.look} onclick={showLook}>
      <Icon name={look ? 'chevronDown' : 'chevronRight'} size={11} /><span>Look</span>
      {#if !look && lookSet.length}<span class="look-set">{lookSet.join(' · ')}</span>{/if}
    </button>
    {#if look}
      <div class="rows look-rows">
        {#if only('point')}
          <span class="key" title={HELP.size}>Size</span>
          {@render slider('marker_size', 'Marker size', [0.5, 3, 0.25], 1, (value) => `${Math.round(value * 100)}%`, HELP.size)}
        {:else if kinds.size && !kinds.has('point')}
          <span class="key" title={HELP.lineWidth}>Width</span>
          {@render slider('line_width', 'Line width', [0.5, 12, 0.5], their?.stroke ?? 2, (value) => `${value} px`, HELP.lineWidth)}
          <span class="key" title={HELP.dash}>Dash</span>
          <div class="segments" role="group" aria-label="Line dash" title={HELP.dash}>
            {#each DASHES as [value, label] (value)}
              <button type="button" aria-pressed={(one ? form?.line_dash ?? '' : shared('line_dash')) === value} disabled={busy} onclick={() => set('line_dash', value)}>{label}</button>
            {/each}
          </div>
          {#if only('line')}
            <span class="key" title={HELP.arrow}>Arrow</span>
            <div class="segments" role="group" aria-label="Line arrow" title={HELP.arrow}>
              {#each ARROWS as [value, label] (value)}
                <button type="button" aria-pressed={(one ? form?.line_arrow ?? '' : shared('line_arrow')) === value} disabled={busy} onclick={() => set('line_arrow', value)}>{label}</button>
              {/each}
            </div>
          {/if}
          {#if only('area')}
            <span class="key" title={HELP.fill}>Fill</span>
            <div class="segments" role="group" aria-label="Area fill" title={HELP.fill}>
              {#each FILLS as [value, label] (value)}
                <button type="button" aria-pressed={(one ? form?.area_fill ?? '' : shared('area_fill')) === value} disabled={busy} onclick={() => set('area_fill', value)}>{label}</button>
              {/each}
            </div>
            {#if (one ? form?.area_fill ?? '' : shared('area_fill')) === ''}
              <span class="key" title={HELP.strength}>Strength</span>
              {@render slider('fill_opacity', 'Fill strength', [0.05, 0.9, 0.05], their?.fill_opacity ?? 0.18, (value) => `${Math.round(value * 100)}%`, HELP.strength)}
            {/if}
          {/if}
        {/if}

        <span class="key" title={HELP.name}>Name</span>
        <div class="segments" role="group" aria-label="Name on the map">
          {#each NAMES as [value, label] (value)}
            <button type="button" aria-pressed={(one ? form?.label ?? '' : shared('label')) === value} disabled={busy}
              title={value ? `${label} on the map` : 'As its group says'} onclick={() => set('label', value)}>{label}</button>
          {/each}
        </div>
        {#if (one ? form?.label : shared('label')) === 'on'}
          <span class="key" title={HELP.nameSize}>Name size</span>
          {@render slider('label_size', 'Name size', [6, 32, 1], 11, (value) => `${value} px`, HELP.nameSize)}
        {/if}
      </div>
    {/if}

  </div>

  {#if menu}
    <FloatingMenu anchor={menuAnchor} align="end" width={220} label="Feature actions" onclose={() => (menu = false)}>
      {#if one}
        {#if point && !one.properties.entity_id}
          <button type="button" class="fm-item" disabled={busy} onclick={() => { menu = false; controller.promote(one.properties.key); }}>
            <Icon name="pin" size={14} /><span class="fm-grow">Save as case place</span></button>
        {/if}
        {#if one.properties.entity_type === 'place' && one.properties.entity_id && ondeleteplace}
          <button type="button" class="fm-item danger" onclick={() => { menu = false; ondeleteplace(one.properties.entity_id); }}>
            <Icon name="trash" size={14} /><span class="fm-grow">Delete case place</span></button>
        {/if}
        <button type="button" class="fm-item danger" disabled={busy} onclick={() => { menu = false; controller.remove(one.properties.key); }}>
          <Icon name="x" size={14} /><span class="fm-grow">Remove from the layer</span></button>
      {:else}
        <button type="button" class="fm-item" disabled={busy} onclick={() => { menu = false; controller.moveSelection(); }}>
          <Icon name="move" size={14} /><span class="fm-grow">Move with a handle</span></button>
        <button type="button" class="fm-item danger" disabled={busy} onclick={() => { menu = false; controller.removeSelection(); }}>
          <Icon name="x" size={14} /><span class="fm-grow">Remove {chosen.length} from the layer</span></button>
      {/if}
    </FloatingMenu>
  {/if}
{/if}

<style>
  .sheet { margin: 8px 0; padding: 6px 8px 8px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); }
  .sheet-head { display: flex; align-items: center; gap: 4px; margin: 0 -2px 6px -4px; }
  .name { flex: 1; min-width: 0; height: 28px; padding: 3px 6px; border: 1px solid transparent; border-radius: var(--r-sm); background: transparent;
    color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; }
  input.name:hover { border-color: var(--border); }
  input.name:focus { border-color: var(--accent); background: var(--bg-1); }
  .count { display: flex; align-items: center; }
  .rows { display: grid; grid-template-columns: 66px minmax(0, 1fr); align-items: center; gap: 7px 6px; }
  .slider { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .slider input { flex: 1; min-width: 0; }
  .unit { flex: none; min-width: 34px; color: var(--text-1); font-size: 10px; font-variant-numeric: tabular-nums; text-align: right; }
  .unit.quiet { color: var(--text-3); }
  .look { display: flex; align-items: center; gap: 5px; width: 100%; margin: 9px 0 0; padding: 6px 0 0; border-top: 1px solid var(--border);
    color: var(--text-2); font-size: 11px; font-weight: 600; text-align: left; cursor: pointer; }
  .look:hover { color: var(--text-1); }
  .look-set { min-width: 0; overflow: hidden; color: var(--text-3); font-weight: 400; text-overflow: ellipsis; white-space: nowrap; }
  .look-rows { margin-top: 7px; }
  .away { margin: 0 0 8px; padding: 4px 7px; border-radius: var(--r-sm); background: var(--bg-1); color: var(--text-2); font-size: 10.5px; line-height: 1.4; }
  .key { color: var(--text-3); font-size: 11px; }
  .value { display: flex; align-items: center; gap: 4px; min-height: 24px; color: var(--text-1); font-size: var(--fs-xs); font-variant-numeric: tabular-nums; }
  .value.quiet { color: var(--text-3); }
  select, textarea, .address { width: 100%; min-width: 0; padding: 3px 6px; font-size: var(--fs-xs); border-radius: var(--r-sm); }
  select, .address { height: 26px; }
  textarea { resize: vertical; line-height: 1.4; }
  .segments { display: flex; border: 1px solid var(--border); border-radius: var(--r-sm); overflow: hidden; background: var(--bg-1); }
  .segments button { flex: 1; min-width: 0; padding: 4px 2px; color: var(--text-2); font-size: 10.5px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .segments button + button { border-left: 1px solid var(--border); }
  .segments button.short { flex: 0 0 22px; }
  .segments button:hover:not(:disabled) { background: var(--bg-3); }
  .segments button[aria-pressed='true'] { background: var(--accent-soft); color: var(--text-1); font-weight: 600; }
  .segments button:disabled { opacity: .5; cursor: default; }
  .sources { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-width: 0; }
  .chip { display: inline-flex; align-items: center; gap: 2px; max-width: 100%; padding: 1px 2px 1px 7px; border: 1px solid var(--border); border-radius: 999px; background: var(--bg-1); font-size: 11px; }
  .chip a { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--accent); text-decoration: none; }
  .chip a:hover { text-decoration: underline; }
  .chip button { display: grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; color: var(--text-3); cursor: pointer; }
  .chip button:hover { background: var(--bg-3); color: var(--text-1); }
  .add-source { display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; border: 1px dashed var(--border); border-radius: 999px; color: var(--text-3); font-size: 11px; cursor: pointer; }
  .add-source:hover { border-color: var(--text-3); color: var(--text-1); }
  .refused { flex-basis: 100%; margin: 0; color: var(--danger); font-size: 10px; }
  .follows { display: flex; flex-direction: column; gap: 6px; margin: 0 0 8px; padding-bottom: 7px; border-bottom: 1px solid var(--border); color: var(--text-3); font-size: 10px; }
  .follow-pictures { display: flex; gap: 6px; }
  .follow-picture { position: relative; flex: 1; min-width: 0; max-width: 50%; height: 72px; padding: 0; border: 1px solid var(--border); border-radius: var(--r-sm); background: #000; overflow: hidden; cursor: pointer; }
  .follow-picture:hover:not(:disabled) { border-color: var(--accent); }
  .follow-picture img { display: block; width: 100%; height: 100%; object-fit: cover; }
  .follow-picture span { position: absolute; left: 4px; bottom: 4px; padding: 0 5px; border-radius: 999px; background: rgb(0 0 0 / 0.65); color: #fff; font-size: 10px; }
  .follow-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .follow-text > span:first-child { overflow-wrap: anywhere; }
  .follow-acts { display: flex; gap: 8px; }
  .icon-act { display: grid; place-items: center; flex: none; width: 24px; height: 24px; color: var(--text-2); border-radius: var(--r-sm); cursor: pointer; }
  .more-btn { border: 1px solid var(--border); background: var(--bg-1); color: var(--text-1); }
  .more-btn:hover:not(:disabled), .more-btn[aria-expanded='true'] { border-color: var(--accent); }
  .icon-act:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
  .text-act { color: var(--text-2); font-size: 10px; cursor: pointer; }
  .text-act:hover { color: var(--text-1); text-decoration: underline; }
</style>
