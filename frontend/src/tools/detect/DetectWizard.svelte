<script>
  /**
   * A detection, built one step at a time: where to look, what to look for,
   * which imagery, then a name and the start.
   *
   * The kind is settled before any of it, because it changes the questions. A
   * **one pass** sweeps two dates you name and is reviewed once. A **routine**
   * is a place you come back to: it holds a baseline rather than a date, and
   * the pass is chosen at each launch, so this step asks what each run should
   * compare against instead of which day to read.
   *
   * Nothing here fetches anything but Find passes, which waits to be pressed.
   */
  import { untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { ensureCase, reloadCase, toast } from '../../lib/state.svelte.js';
  import {
    SECONDS_PER_FRAME,
    analyzerGroups,
    analyzerLock,
    clone,
    coverage,
    framesPerTile,
    readableDuration,
    sizeOf,
    zoneRing,
  } from '../../lib/map/analyzers.js';
  import { plural } from '../../lib/map/detections.js';
  import { recipeCapability } from '../../lib/map/analyzerRules.js';
  import { openCopernicusSettings } from '../../lib/navigate.js';
  import { ADVISED_MAXCC, ceilingWarning, uniform, whenNeed, whenSummary } from '../../lib/map/detectWhen.js';
  import CloudFilter from '../compare/CloudFilter.svelte';
  import AnalyzerSettings from './AnalyzerSettings.svelte';
  import AnalyzerSize from './AnalyzerSize.svelte';
  import WhenStep from './WhenStep.svelte';
  import Icon from '../../components/Icon.svelte';

  let {
    caseId,
    catalogue,
    /** Ordered area groups shared with the Areas tab. */
    areaGroups = [],
    areas = [],
    /** Where it starts: `{ kind, body, followupId, fromRun }`. */
    seed = {},
    /** An analyzer just made in the library, to pick. */
    offer = null,
    busy = false,
    /** Why the last launch or save failed, said beside the button that did it. */
    failure = '',
    zones = $bindable([]),
    drawing = $bindable('select'),
    selectedZone = $bindable(null),
    showZones = $bindable(true),
    onfocus = () => {},
    onusecurrentview = () => {},
    /** Put a date on the map, so what is on screen is what a run would sweep. */
    onshow = () => {},
    onsubmit = () => {},
    onlibrary = () => {},
    onareas = async () => {},
    onopenareas = () => {},
  } = $props();

  const EMPTY_SOURCE = { provider: 'sentinel2', date: '', layer: 'TRUE_COLOR', maxcc: ADVISED_MAXCC };
  const STEPS = [[1, 'Where'], [2, 'What'], [3, 'When'], [4, 'Start']];
  const SIZE_NAMES = { small: 'Small', medium: 'Medium', large: 'Large', all: 'All sizes' };

  let step = $state(1);
  let kind = $state('once');
  let recipe = $state(null);
  let chosen = $state('');
  /** A size pressed in this detection, which holds for the next analyzer picked. */
  let pickedSize = $state('');
  let title = $state('');
  let note = $state('');
  let a = $state({ ...EMPTY_SOURCE });
  let b = $state({ ...EMPTY_SOURCE });
  /** A routine compares each pass with the one before it, or with its baseline. */
  let against = $state('previous');
  let offline = $state(false);
  let followupId = $state(null);
  let lastPasses = $state({});
  let groupTitle = $state('');
  let areaSearch = $state('');
  /** Groups opened by hand; every group starts folded, the first one too. */
  let openGroups = $state({});
  let pairs = $state([]);
  /** A one pass reads B on a chosen day rather than the newest pass. */
  let chooseB = $state(false);
  /** The passes last looked up, kept while the areas stay the same. */
  let lookup = $state(null);
  let working = $state(false);
  let error = $state('');

  const builtins = $derived(catalogue?.builtins ?? []);
  const custom = $derived(catalogue?.custom ?? []);
  const capability = $derived(recipeCapability(recipe, catalogue?.methods ?? []));
  /** A vessel or a fire is present on a date, not a difference between two. */
  const isSingle = $derived(!!capability.single);
  /** Radar reads Sentinel-1 through the layer Settings found, and has no clouds. */
  const radar = $derived(capability.sensor === 'sentinel1');
  const routine = $derived(kind === 'routine');
  /** Picked from a saved detection whose analyzer is no longer in the library. */
  const unlisted = $derived(!!recipe && ![...builtins, ...custom].some((r) => r.id === chosen));
  const cost = $derived(coverage(zones, catalogue?.grid ?? null));
  const tooMany = $derived(!!catalogue && cost.tiles > catalogue.max_tiles);
  const frames = $derived(cost.tiles * (capability.frames ?? framesPerTile({ single: isSingle })));
  const duration = $derived(readableDuration(frames * SECONDS_PER_FRAME));
  const size = $derived(recipe ? sizeOf(recipe.parameters, capability.sizes) : '');
  const round = (value, digits = 1) => Number(value.toFixed(digits));
  /** Ground area, left unsaid when the areas are past measuring. */
  const area = $derived(Number.isFinite(cost.km2) ? `${round(cost.km2, cost.km2 < 10 ? 2 : 0)} km²` : '');

  const areaNeeds = $derived(
    !zones.length ? 'Draw an area to look in.'
    : tooMany ? (Number.isFinite(cost.tiles)
        ? `These areas need ${cost.tiles} tiles; the limit is ${catalogue.max_tiles}. Draw smaller areas.`
        : `These areas are far past the ${catalogue.max_tiles}-tile limit. Draw smaller areas.`)
    : ''
  );
  // Said here rather than discovered when the run comes back failed. A routine
  // that compares each pass with the one before it still needs a first one.
  const imageryNeeds = $derived(
    whenNeed({ single: isSingle, routine, against, pairs, chooseB, lastPasses, radar })
  );
  // A locked analyzer can still be picked and read about; a run of it cannot
  // start, and saying why here beats a run that comes back failed.
  const groups = $derived(analyzerGroups(catalogue));
  const lock = $derived(analyzerLock(recipe, catalogue));
  const radarNeeds = $derived(
    !lock ? ''
    : radar && catalogue?.copernicus_key !== false
      ? 'Radar analyzers read a Sentinel-1 layer of your Copernicus configuration, not set up yet.'
      : 'Detect reads Copernicus, and no key is set up yet. It is free.'
  );
  const needsOf = (n) => (n === 1 ? areaNeeds : n === 2 ? radarNeeds : n === 3 ? imageryNeeds : '');
  const blocked = $derived(areaNeeds || radarNeeds || imageryNeeds);
  /** A step opens once every one before it has what it needs. */
  const reachable = (n) => STEPS.every(([k]) => k >= n || !needsOf(k));
  const defaultName = $derived(
    !recipe ? 'Detection'
    : zones.length === 1 ? `${recipe.name} · ${zones[0].name}`
    : `${recipe.name} · ${plural(zones.length, 'area')}`
  );
  const timing = $derived(whenSummary({ single: isSingle, routine, against, pairs, radar, maxcc: b.maxcc }));

  /** A detection saved against Wayback reopens undated, which is what it is
   *  for Copernicus. A radar run's sources keep their day and pass time; the
   *  engine names the collection whatever the analyzer turns out to be. */
  const sentinelSource = (source) => ['sentinel2', 'sentinel1'].includes(source?.provider)
    ? { ...EMPTY_SOURCE, ...clone(source) } : { ...EMPTY_SOURCE };

  function choose(id) {
    const found = [...builtins, ...custom].find((r) => r.id === id);
    if (!found) return;
    const next = clone(found);
    const sizes = recipeCapability(next, catalogue?.methods ?? []).sizes;
    if (pickedSize && sizes?.[pickedSize]) next.parameters = { ...next.parameters, ...sizes[pickedSize] };
    recipe = next;
    chosen = id;
  }

  // Where the detection starts, read once: the panel mounts a fresh wizard for
  // every new seed, so this never has to undo an earlier one.
  untrack(() => {
    kind = seed.kind ?? (seed.followupId ? 'routine' : 'once');
    if (!seed.body) {
      choose(builtins[0]?.id);
      return;
    }
    const body = seed.body;
    pairs = clone(body.area_dates ?? []);
    title = body.title;
    note = body.note ?? '';
    recipe = clone(body.recipe);
    chosen = body.recipe.id;
    a = sentinelSource(body.a);
    b = sentinelSource(body.b);
    offline = !!body.offline;
    against = body.date_rule === 'latest_reference' ? 'reference' : 'previous';
    chooseB = kind !== 'routine' && (!!body.b?.date || pairs.some((pair) => pair.b?.date));
    followupId = seed.followupId ?? null;
    lastPasses = seed.lastPasses ?? {};
    step = seed.followupId ? 4 : 1;
  });

  $effect(() => {
    if (offer) untrack(() => choose(offer));
  });

  // Leaving the first step must not leave the map armed to draw an area.
  $effect(() => {
    if (step !== 1) untrack(() => { drawing = 'select'; });
  });

  // A new area takes the days every other one shares, so one choice keeps
  // standing for all of them; it starts empty only among areas that differ.
  $effect(() => {
    const current = zones.map((zone) => zone.id);
    untrack(() => {
      const shared = pairs.length && uniform(pairs) ? pairs[0] : null;
      pairs = current.map((id) => pairs.find((pair) => pair.area_id === id) ?? (shared
        ? { ...clone(shared), area_id: id }
        : {
          area_id: id, a: clone(a), b: { ...clone(b), date: seed.body?.b?.date ?? '' },
          date_rule: routine && against === 'previous' ? 'latest_previous' : 'latest_reference',
        }));
    });
  });

  async function act(fn) {
    if (working) return;
    working = true; error = '';
    try { await fn(); } catch (e) { error = e.message; }
    finally { working = false; }
  }

  function setPicture(patch) {
    a = { ...a, ...patch };
    b = { ...b, ...patch };
    pairs = pairs.map((pair) => ({ ...pair, a: { ...pair.a, ...patch }, b: { ...pair.b, ...patch } }));
  }
  function setWeather(on) {
    recipe.parameters = { ...recipe.parameters, ignore_clouds: on, ignore_shadows: on };
  }

  function removeZone(id) {
    zones = zones.filter((z) => z.id !== id);
    if (selectedZone === id) selectedZone = null;
  }

  const areaZone = (area) => ({ id: area.id, name: area.name, kind: 'polygon',
    points: clone(area.geometry.coordinates[0].slice(0, -1)) });
  const groupZones = (group) => group.area_ids
    ? group.area_ids.map((id) => areas.find((area) => area.id === id)).filter(Boolean).map(areaZone)
    : clone(group.zones ?? []);
  const groupedIds = $derived(new Set(areaGroups.flatMap((group) => group.area_ids ?? [])));
  const ungrouped = $derived(areas.filter((area) => !groupedIds.has(area.id)));
  const matching = (name) => name.toLowerCase().includes(areaSearch.trim().toLowerCase());

  function useGroup(group) {
    const additions = groupZones(group).filter((zone) => !zones.some((selected) => selected.id === zone.id));
    if (zones.length + additions.length > 32) return;
    zones = [...zones, ...additions];
  }

  async function saveGroup() {
    if (!groupTitle.trim()) return;
    const owner = await ensureCase();
    const replacements = new Map();
    try {
      for (const zone of zones) {
        if (areas.some((area) => area.id === zone.id)) continue;
        const ring = zoneRing(zone);
        const saved = await api.post(`/api/cases/${owner.id}/analysis/areas`, {
          name: zone.name, colour: recipe.colour,
          geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
        });
        replacements.set(zone.id, saved.id);
      }
      await api.post(`/api/cases/${owner.id}/analysis/zones`, {
        title: groupTitle.trim(), area_ids: zones.map((zone) => replacements.get(zone.id) ?? zone.id),
      });
      groupTitle = '';
      toast('Group saved', 'ok');
    } finally {
      if (replacements.size) {
        zones = zones.map((zone) => ({ ...zone, id: replacements.get(zone.id) ?? zone.id }));
        pairs = pairs.map((pair) => ({ ...pair, area_id: replacements.get(pair.area_id) ?? pair.area_id }));
      }
      await onareas(owner.id);
      await reloadCase();
    }
  }

  async function saveArea(zone) {
    const owner = await ensureCase();
    const ring = zoneRing(zone);
    const saved = await api.post(`/api/cases/${owner.id}/analysis/areas`, {
      name: zone.name, colour: recipe.colour, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] },
    });
    pairs = pairs.map((pair) => pair.area_id === zone.id ? { ...pair, area_id: saved.id } : pair);
    zones = zones.map((entry) => entry.id === zone.id ? { ...entry, id: saved.id } : entry);
    await onareas(owner.id); await reloadCase();
  }
  function useArea(area) {
    if (zones.some((zone) => zone.id === area.id)) return;
    zones = [...zones, { id: area.id, name: area.name, kind: 'polygon', points: clone(area.geometry.coordinates[0].slice(0, -1)) }];
  }

  function submit(run) {
    onsubmit({
      kind,
      followupId,
      run,
      input: {
        title: title.trim() || defaultName, note: note.trim(), zones: clone(zones),
        recipe: clone(recipe), a: clone(a), b: clone(b),
        area_dates: pairs.map((pair) => ({ ...clone(pair),
          a: isSingle ? { ...clone(a), date: '' } : clone(pair.a),
          b: routine ? { ...clone(pair.b), date: '' } : clone(pair.b),
          date_rule: routine ? (!isSingle && against === 'previous' ? 'latest_previous' : 'latest_reference')
            : pair.b.date ? 'manual' : 'latest_reference',
        })),
        date_rule: routine ? (against === 'reference' ? 'latest_reference' : 'latest_previous') : 'manual',
        // A latest-date lookup reaches Copernicus, so only fixed dates run offline.
        offline: routine ? false : offline,
        followup_id: followupId,
      },
    });
  }
</script>

<nav class="stepper" aria-label="Steps">
  {#each STEPS as [n, label] (n)}
    <button type="button" class:current={step === n} class:done={n < step}
      aria-current={step === n ? 'step' : undefined}
      disabled={n > step && !reachable(n)} onclick={() => (step = n)}>
      <span class="n">{n}</span>{label}
    </button>
  {/each}
</nav>

<div class="cmp-dock-body">
  {#if error}<p class="warn" role="alert">{error}</p>{/if}

  {#if step === 1}
    <section class="step" aria-label="Where to look">
      <h3>Where to look</h3>
      {#if areas.length || areaGroups.length}
        <input class="area-search" aria-label="Search areas or groups" placeholder="Search areas or groups…"
          bind:value={areaSearch} />
        {#each areaGroups as group (group.id)}
          {@const members = groupZones(group)}
          {@const shown = members.filter((zone) => !areaSearch || matching(group.title) || matching(zone.name))}
          {#if !areaSearch || matching(group.title) || shown.length}
            <div class="area-group">
              <div class="area-group-head">
                <button class="group-fold grow" aria-expanded={!!areaSearch || !!openGroups[group.id]}
                  onclick={() => (openGroups = { ...openGroups, [group.id]: !openGroups[group.id] })}>
                  <Icon name={(areaSearch || openGroups[group.id]) ? 'chevronDown' : 'chevronRight'} size={12} />
                  {group.title} <small>{plural(members.length, 'area')}</small>
                </button>
                <button class="btn btn-sm" aria-label={`Use ${group.title}`}
                  disabled={!!group.pending_review?.length || !members.length || zones.length + members.filter((zone) => !zones.some((selected) => selected.id === zone.id)).length > 32}
                  onclick={() => useGroup(group)}>Use</button>
              </div>
              {#if group.pending_review?.length}
                <button class="link" onclick={onopenareas}>Review saved shapes in Areas</button>
              {/if}
              {#if areaSearch || openGroups[group.id]}
                <div class="shared">
                  {#each shown as zone (zone.id)}
                    {@const area = areas.find((item) => item.id === zone.id)}
                    {@const on = zones.some((selected) => selected.id === zone.id)}
                    <button class="area-chip" class:on aria-pressed={on}
                      disabled={!!group.pending_review?.length || (!on && zones.length >= 32)}
                      onclick={() => (on ? removeZone(zone.id) : area ? useArea(area) : (zones = [...zones, zone]))}>
                      <span class="swatch" style={`--tint: ${area?.colour ?? '#38bdf8'}`}></span>{zone.name}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          {/if}
        {/each}
        {@const loose = ungrouped.filter((area) => !areaSearch || matching(area.name))}
        {#if loose.length}
          <div class="area-group">
            <div class="area-group-head"><strong>Ungrouped</strong><small>{plural(loose.length, 'area')}</small></div>
            <div class="shared">
              {#each loose as area (area.id)}
                {@const on = zones.some((zone) => zone.id === area.id)}
                <button class="area-chip" class:on aria-pressed={on} disabled={!on && zones.length >= 32}
                  onclick={() => (on ? removeZone(area.id) : useArea(area))}>
                  <span class="swatch" style={`--tint: ${area.colour}`}></span>{area.name}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      {/if}
      <div class="row wrap">
        {#each [['rect', 'Rectangle'], ['polygon', 'Polygon'], ['ellipse', 'Circle']] as [shape, label]}
          <button class="btn btn-sm" class:active={drawing === shape} disabled={zones.length >= 32}
            onclick={() => { drawing = drawing === shape ? 'select' : shape; showZones = true; }}>{label}</button>
        {/each}
        <button class="btn btn-sm" disabled={zones.length >= 32} onclick={onusecurrentview}>Use current view</button>
      </div>
      {#if drawing !== 'select'}
        <p class="hint">{drawing === 'polygon' ? 'Click corners on the map; Enter finishes, Escape cancels.' : 'Drag on the map. Escape cancels.'}</p>
      {:else if !zones.length}
        <p class="hint">{areas.length ? 'Pick an area above, draw on the map, or take the current view.' : 'Draw on the map, or take the current view.'}</p>
      {/if}
      {#each zones as zone (zone.id)}
        <div class="row area-row">
          <button class="cmp-icon" aria-label={`Show ${zone.name}`} title={`Show ${zone.name}`}
            onclick={() => { selectedZone = zone.id; drawing = 'select'; onfocus(zone.points[0]); }}>
            <Icon name="pin" size={13} />
          </button>
          <input class="grow" aria-label="Area name" bind:value={zone.name} maxlength="120" />
          {#if !areas.some((area) => area.id === zone.id)}
            <button class="btn btn-sm" disabled={working} onclick={() => act(() => saveArea(zone))}>Save as area</button>
          {/if}
          <button class="cmp-icon" aria-label={`Remove ${zone.name}`} title={`Remove ${zone.name}`}
            onclick={() => removeZone(zone.id)}>
            <Icon name="x" size={12} />
          </button>
        </div>
      {/each}
      {#if zones.length}
        <p class="hint" class:warn={tooMany}>{[
          area,
          Number.isFinite(cost.tiles) ? plural(cost.tiles, 'tile') : 'over the tile limit',
          tooMany ? '' : `${plural(frames, 'request')} a run, about ${duration}`,
        ].filter(Boolean).join(' · ')}</p>
      {/if}
      {#if zones.length}
        <details>
          <summary>Save selection as group</summary>
          <div class="row">
            <input class="grow" aria-label="Group name" bind:value={groupTitle} maxlength="120" />
            <button class="btn btn-sm" disabled={working || !groupTitle.trim()} onclick={() => act(saveGroup)}>Save group</button>
          </div>
        </details>
      {/if}
    </section>
  {:else if step === 2}
    <section class="step" aria-label="What to look for">
      <h3>What to look for</h3>
      {#if recipe}
        <div class="size">
          <p class="group">Target size</p>
          <AnalyzerSize bind:recipe {capability} onpick={(name) => (pickedSize = name)} />
        </div>
        {#if capability.clouds}
          <CloudFilter clouds={recipe.parameters.ignore_clouds} shadows={recipe.parameters.ignore_shadows}
            ontoggle={setWeather} />
        {/if}
        {#if !radar}
          <label class="cloud-ceiling">Maximum cloud cover · {b.maxcc}%
            <input type="range" min="0" max="100" value={b.maxcc} aria-label="Maximum cloud cover"
              oninput={(event) => setPicture({ maxcc: Number(event.currentTarget.value) })} />
          </label>
          {#if ceilingWarning(b.maxcc)}<p class="hint warn">{ceilingWarning(b.maxcc)}</p>{/if}
        {/if}
      {/if}
      <div class="choices" role="radiogroup" aria-label="Analyzer">
        {#each groups as group (group.label)}
          <p class="group">{group.label}</p>
          {#each group.list as entry (entry.id)}
            {@const locked = analyzerLock(entry, catalogue)}
            {@const trust = catalogue?.reliability?.[entry.id]}
            <button type="button" role="radio" aria-checked={chosen === entry.id} class="choice"
              class:on={chosen === entry.id} class:locked={!!locked} style={`--tint: ${entry.colour}`}
              title={locked || undefined} onclick={() => choose(entry.id)}>
              <span class="swatch" aria-hidden="true"></span>{entry.name}
              {#if trust}<span class="trust {trust}">({trust})</span>{/if}
              {#if locked}<small class="lock"><Icon name="key" size={11} /> set up</small>{/if}
            </button>
          {/each}
        {/each}
        {#if unlisted}
          <p class="group">This detection</p>
          <button type="button" role="radio" aria-checked="true" class="choice on" style={`--tint: ${recipe.colour}`}>
            <span class="swatch" aria-hidden="true"></span>{recipe.name}<small>as saved</small>
          </button>
        {/if}
      </div>
      {#if recipe.description}<p class="hint">{recipe.description}</p>{/if}
      <AnalyzerSettings bind:recipe {capability} showSize={false} showCloud={false} />
      <button class="link" onclick={onlibrary}>Make an analyzer of your own…</button>
    </section>
  {:else if step === 3}
    <WhenStep {zones} bind:pairs {routine} single={isSingle} sensor={capability.sensor} {lastPasses}
      maxcc={radar ? 100 : b.maxcc}
      bind:against bind:chooseB bind:lookup {onshow} />
    {#if radar}
      {#if !routine}
        <label class="check" title="Use cached or retained frames without downloading">
          <input type="checkbox" bind:checked={offline} /> Use local images only
        </label>
      {/if}
    {:else}
      <details>
        <summary>{routine ? 'Picture' : 'Picture and local images'}</summary>
        <label title="Image used for review">Picture
          <select value={b.layer} onchange={(e) => setPicture({ layer: e.currentTarget.value })}>
            <option value="TRUE_COLOR">True colour</option><option value="FALSE_COLOR">False colour</option><option value="SWIR">SWIR</option>
          </select>
        </label>
        {#if !routine}
          <label class="check" title="Use cached or retained frames without downloading">
            <input type="checkbox" bind:checked={offline} /> Use local images only
          </label>
        {/if}
      </details>
    {/if}
  {:else}
    <section class="step" aria-label="Name and start">
      <h3>{followupId ? 'This routine' : routine ? 'Name the routine' : 'Name and start'}</h3>
      <label>Name
        <input aria-label="Detection name" placeholder={defaultName} bind:value={title} maxlength="120" />
      </label>
      <label title="Purpose recorded with each run">What it is for
        <textarea aria-label="Detection description" rows="2" bind:value={note} maxlength="500"
          placeholder={routine ? 'Weekly look at the anchorage' : 'Checking the strike reported on the 12th'}></textarea>
      </label>
      <div class="recap">
        <button type="button" onclick={() => (step = 1)} title="Change the areas">
          <span class="k">Where</span>
          <span class="v">{[plural(zones.length, 'area'), area, Number.isFinite(cost.tiles) ? plural(cost.tiles, 'tile') : 'over the tile limit'].filter(Boolean).join(' · ')}</span>
        </button>
        <button type="button" onclick={() => (step = 2)} title="Change what it looks for">
          <span class="k">What</span>
          <span class="v">{recipe.name}{size ? ` · ${SIZE_NAMES[size]}` : ' · tuned by hand'}</span>
        </button>
        <button type="button" onclick={() => (step = 3)} title="Change the imagery">
          <span class="k">When</span>
          <span class="v">{timing}</span>
        </button>
      </div>
      {#if !tooMany}
        <p class="hint">{plural(frames, 'request')} a run, about {duration}. It keeps going if you leave Detect.</p>
      {/if}
    </section>
  {/if}
</div>

<div class="cmp-dock-foot">
  {#if failure}<p class="warn" role="alert">{failure}</p>{/if}
  <div class="row">
    {#if step > 1}<button class="btn btn-sm" onclick={() => step--}>Back</button>{/if}
    {#if step < 4}
      <button class="btn btn-primary grow" disabled={!!needsOf(step)} onclick={() => step++}>Next: {STEPS[step][1]}</button>
    {:else}
      <button class="btn btn-primary grow" disabled={busy || !!blocked} onclick={() => submit(true)}>
        {busy ? 'Starting…' : !routine ? 'Run this pass' : followupId ? 'Save and run' : 'Save and run the first pass'}
      </button>
    {/if}
  </div>
  {#if step < 4 && needsOf(step)}
    <span class="reason">{needsOf(step)}</span>
    {#if step === 2 && radarNeeds}
      <button class="link centre" onclick={openCopernicusSettings}>How to add it, in Settings → Imagery</button>
    {/if}
  {:else if step === 4 && blocked}
    <span class="reason warn">{blocked}</span>
  {:else if step === 4 && routine}
    <button class="link centre" disabled={busy} onclick={() => submit(false)}>
      {followupId ? 'Save changes without running' : 'Save without running'}
    </button>
  {/if}
</div>

<style>
  .area-search { width: 100%; }
  .area-group { display: grid; gap: 6px; }
  .area-group-head { display: flex; align-items: center; gap: 7px; min-height: 30px;
    padding: 3px 0; font-size: var(--fs-xs); }
  .area-group-head strong { flex: 1; }
  .area-group-head small { color: var(--text-3); }
  .group-fold { display: flex; align-items: center; gap: 5px; min-width: 0; text-align: left;
    font-size: var(--fs-xs); }
  .group-fold small { margin-left: auto; }
  .shared { display: flex; flex-wrap: wrap; gap: 5px; }
  .area-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 9px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .area-chip:hover:not(:disabled) { color: var(--text-1); border-color: var(--text-3); }
  .area-chip.on { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
  .area-chip .swatch { width: 8px; height: 8px; border-radius: 2px; background: var(--tint); }
  .stepper {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    padding: 7px 12px 0;
    border-bottom: 1px solid var(--border);
  }
  .stepper button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 37px;
    padding: 5px 2px 8px;
    border-bottom: 2px solid transparent;
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .stepper button:hover:not(:disabled) { color: var(--text-1); }
  .stepper button:disabled { opacity: 0.45; cursor: not-allowed; }
  .stepper .n {
    color: var(--text-3);
    font: 700 10px/1 var(--font-mono);
  }
  .stepper .done { color: var(--text-1); }
  .stepper .current { color: var(--text-1); border-bottom-color: var(--accent); }
  .stepper .current .n { color: var(--accent); }
  .step { display: grid; gap: 12px; }
  h3 { margin: 0 0 3px; font-size: var(--fs-lg); font-weight: 650; }
  .row.wrap { flex-wrap: wrap; }
  .active { outline: 1px solid var(--accent); }
  .area-row input { font-size: var(--fs-xs); }
  details { display: grid; gap: 8px; }
  details[open] { padding-bottom: 2px; }
  summary { color: var(--text-2); font-size: var(--fs-xs); cursor: pointer; }
  .link { color: var(--accent); font-size: var(--fs-xs); text-align: left; justify-self: start; }
  .link:disabled { opacity: 0.5; }
  .centre { justify-self: center; text-align: center; }
  .size { display: grid; gap: 5px; }
  .choices { display: grid; gap: 0; }
  .group {
    margin: 6px 0 2px;
    color: var(--text-3);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .group:first-child { margin-top: 0; }
  .choice {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 35px;
    padding: 7px 8px;
    border-bottom: 1px solid var(--border);
    color: var(--text-1);
    font-size: var(--fs-sm);
    text-align: left;
  }
  .choice:hover { background: var(--bg-2); }
  .choice.on { color: var(--text-1); background: var(--accent-soft); font-weight: 600; }
  .choice small { margin-left: auto; color: var(--text-3); font-weight: 400; }
  .choice.locked { color: var(--text-2); }
  .choice .lock { display: inline-flex; align-items: center; gap: 3px; color: var(--accent); }
  .trust { color: var(--text-3); font-size: 10.5px; font-weight: 400; }
  .trust.reliable { color: var(--ok, #46a758); }
  .trust.rough { color: var(--warn, #e2a03f); }
  .swatch { flex: 0 0 auto; width: 9px; height: 9px; border-radius: 50%; background: var(--tint); }
  .recap {
    display: grid;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    overflow: hidden;
  }
  .recap button {
    display: grid;
    grid-template-columns: 52px 1fr;
    gap: 8px;
    padding: 7px 9px;
    text-align: left;
    font-size: var(--fs-xs);
  }
  .recap button + button { border-top: 1px solid var(--border); }
  .recap button:hover { background: var(--bg-2); }
  .recap .k { color: var(--text-3); font-weight: 700; }
  .recap .v { color: var(--text-1); overflow-wrap: anywhere; }
</style>
