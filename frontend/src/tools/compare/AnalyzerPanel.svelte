<script>
  /**
   * Detect mode's own column: sweep a drawn area of Copernicus Sentinel-2 at
   * native resolution and keep what was found.
   *
   * The setup reads as three numbered steps because that is the order the work
   * actually happens in — an area first, then the images, then what to look for
   * — and because the flat wall of tabs it replaces gave no clue where to
   * start. Step 2 and the stage share one imagery between them, so what is on
   * screen is always what a run would sweep; see the effect that owns that.
   * Nothing here fetches anything. Only Run does.
   */
  import { onMount, untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { ensureCase, reloadCase, toast } from '../../lib/state.svelte.js';
  import {
    SECONDS_PER_FRAME,
    STRENGTHS,
    clone,
    coverage,
    describeMeasure,
    framesPerTile,
    mapSource,
    readableDuration,
    sizeBand,
    sizeOf,
    sourceLabel,
  } from '../../lib/map/analyzers.js';
  import { acquisitionQuery, areaKey, coverageWarning, sweptNote } from '../../lib/map/acquisitions.js';
  import AcquisitionPicker from './AcquisitionPicker.svelte';
  import CloudFilter from './CloudFilter.svelte';
  import Icon from '../../components/Icon.svelte';

  let {
    caseId,
    sources = {},
    zones = $bindable([]),
    drawing = $bindable('select'),
    selectedZone = $bindable(null),
    layers = $bindable([]),
    showZones = $bindable(true),
    /** The candidate the review is on, so the map can ring the same one. */
    selectedResult = $bindable(null),
    /** Reported up so the stage can stop showing a pair the run never reads. */
    singleImage = $bindable(false),
    opening = null,
    onfocus = () => {},
    onusecurrentview = () => {},
    onsources = () => {},
    onclose = () => {},
    /** What a run still lacks, said above everything else; empty when nothing. */
    needs = '',
    onsettings = () => {},
  } = $props();

  const EMPTY_SOURCE = { provider: 'sentinel2', date: '', layer: 'TRUE_COLOR', maxcc: 30 };
  const SIZES = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['all', 'All']];
  const INDICES = [
    ['ndvi', 'NDVI · vegetation'], ['nbr', 'NBR · burn scars'], ['mndwi', 'MNDWI · open water'],
    ['ndwi', 'NDWI · open water'], ['bsi', 'BSI · bare soil'], ['ndbi', 'NDBI · built-up'],
  ];

  let catalogue = $state(null);
  let recipe = $state(null);
  let chosen = $state('');
  let title = $state('');
  let a = $state({ ...EMPTY_SOURCE });
  let b = $state({ ...EMPTY_SOURCE });
  let dateRule = $state('manual');
  /** The Sentinel-2 passes the drawn areas have, and the lookup that found them. */
  let passes = $state([]);
  let passDays = $state(30);
  let passBusy = $state(false);
  let passError = $state('');
  let passTruncated = $state(false);
  let passSearched = $state(false);
  let offline = $state(false);
  /** True once the imagery was set by hand; the maps stop driving it. */
  let pinned = $state(false);
  let attachZones = $state(false);
  let zonesId = $state(null);
  let zonesTitle = $state('Analysis areas');
  let followupId = $state(null);
  let lists = $state({ zones: [], followups: [], runs: [] });
  let current = $state(null);
  let candidateId = $state(null);
  let busy = $state(false);
  let error = $state('');
  let view = $state('setup');
  let showImagery = $state(false);
  let showDetection = $state(false);
  let showRecipe = $state(false);
  let showNew = $state(false);
  /** Undefined until the first case is seen, so mounting is not a case switch. */
  let loadedCase;
  let lastMapKey = '';
  let lastAreaKey = '';
  let lastPushed = '';
  let generation = 0;
  /** True once this step took the wheel because the maps could not drive it. */
  let tookOver = $state(false);

  const pending = $derived(current && ['queued', 'running'].includes(current.status));
  const candidate = $derived(current?.results?.find((r) => r.id === candidateId));
  const candidates = $derived(current?.results ?? []);
  const counts = $derived.by(() => {
    const tally = { kept: 0, dismissed: 0, new: 0 };
    for (const row of candidates) tally[row.review] = (tally[row.review] ?? 0) + 1;
    return tally;
  });
  const tally = $derived(
    counts.new === 0 ? `All ${candidates.length} reviewed · ${counts.kept} kept, ${counts.dismissed} dismissed`
    : `${counts.new} still to review · ${counts.kept} kept, ${counts.dismissed} dismissed`
  );
  /** What the method can do, straight from the catalogue rather than by name:
   *  the panel should never keep its own list of which method is which. */
  const methodOf = (method) => catalogue?.methods?.find((m) => m.id === method) ?? {};
  const capability = $derived(methodOf(recipe?.method));
  /** Mine to change: a built-in is read-only, and an unsaved draft is not in the library yet. */
  const mine = $derived(!!(catalogue?.custom ?? []).some((r) => r.id === chosen));
  const draft = $derived(recipe?.id === 'custom');
  /** A vessel or a fire is present on a date, not a difference between two. */
  const single = $derived(!!capability.single);
  $effect(() => { singleImage = single; });
  $effect(() => { selectedResult = view === 'results' ? candidateId : null; });
  const size = $derived(recipe ? sizeOf(recipe.parameters, capability.sizes) : '');
  const cost = $derived(coverage(zones, catalogue?.grid ?? null));
  const tooMany = $derived(catalogue && cost.tiles > catalogue.max_tiles);
  /** The same pair on both maps, or null when they cannot drive a run. */
  const mapPair = $derived.by(() => {
    const left = mapSource(sources.a);
    const right = mapSource(sources.b);
    return left && right ? { left, right } : null;
  });
  const frames = $derived(cost.tiles * framesPerTile({ single }));
  const duration = $derived(readableDuration(frames * SECONDS_PER_FRAME));
  const blocked = $derived(
    !zones.length ? 'Draw an area to analyze.'
    : tooMany ? (Number.isFinite(cost.tiles)
        ? `These areas need ${cost.tiles} tiles; the limit is ${catalogue.max_tiles}. Draw smaller areas.`
        : `These areas are far past the ${catalogue.max_tiles}-tile limit. Draw smaller areas.`)
    // Said here rather than discovered when the run comes back failed.
    : dateRule === 'manual' && !b.date ? `Choose the ${single ? 'image' : 'image to compare'}.`
    : !single && !a.date && !(dateRule === 'latest_previous' && followupId)
      ? 'Choose the reference image.'
    : pending ? 'A run is already working in this case.'
    : ''
  );

  const base = (id = caseId) => `/api/cases/${id}/analysis`;
  const statusLabel = (status) => ({ queued: 'Queued', running: 'Running', ready: 'Completed',
    failed: 'Failed', cancelled: 'Cancelled', no_new_imagery: 'No new imagery' }[status] ?? status);
  const focus = (coordinates) => onfocus(coordinates, current?.input?.b ?? b);
  const round = (value, digits = 1) => Number(value.toFixed(digits));
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const dates = (input) => methodOf(input.recipe.method).single || !(input.a?.date || input.a?.release)
    ? sourceLabel(input.b) : `${sourceLabel(input.a)} → ${sourceLabel(input.b)}`;
  /** A candidate's reading, in the words its method's catalogue entry gives. */
  const reading = (row, input) => [
    STRENGTHS[row.strength],
    describeMeasure(methodOf(input.recipe.method).measure, row.measure, input.recipe.parameters.index),
  ].filter(Boolean).join(' · ');

  function setWeather(on) {
    if (!recipe) return;
    recipe.parameters = { ...recipe.parameters, ignore_clouds: on, ignore_shadows: on };
  }

  function setSize(name) {
    if (!recipe || !capability.sizes?.[name]) return;
    recipe.parameters = { ...recipe.parameters, ...capability.sizes[name] };
  }

  /** The pass behind a chosen date, so its coverage can be said out loud. */
  const passOf = (day) => passes.find((entry) => entry.date === day) ?? null;
  const coverWarnings = $derived(
    [coverageWarning(passOf(b.date)), single ? '' : coverageWarning(passOf(a.date))].filter(Boolean)
  );

  /**
   * What passes the drawn areas really have. Never on mount and never on a
   * redraw: it reaches Copernicus and is billed, so it waits to be asked for.
   */
  async function lookUpPasses() {
    if (passBusy || !zones.length) return;
    passBusy = true; passError = '';
    try {
      const found = await api.post('/api/satellite/sentinel/acquisitions',
        acquisitionQuery(zones, passDays));
      passes = found.dates ?? [];
      passTruncated = !!found.truncated;
      passSearched = true;
    } catch (e) {
      passes = []; passTruncated = false; passSearched = false;
      passError = e.message;
    } finally {
      passBusy = false;
    }
  }

  /** Taking a date off the list is a deliberate choice, so the maps follow it. */
  function usePass(letter, entry) {
    pinned = true;
    if (letter === 'a') a = { ...a, date: entry.date };
    else {
      b = { ...b, date: entry.date };
      if (single) a = { ...a, date: entry.date };
    }
  }

  async function act(fn) {
    if (busy) return;
    busy = true; error = '';
    try { await fn(); } catch (e) { error = e.message; }
    finally { busy = false; }
  }

  async function refresh(id = caseId) {
    if (!id) return;
    const epoch = generation;
    const answer = await Promise.all(['zones', 'followups', 'runs'].map((kind) => api.get(`${base(id)}/${kind}`)));
    if (epoch !== generation) return;
    lists = { zones: answer[0], followups: answer[1], runs: answer[2] };
  }

  onMount(() => {
    let alive = true;
    api.get('/api/compare/analyzers').then((answer) => {
      if (!alive) return;
      catalogue = answer;
      if (!recipe) choose(answer.builtins[0]?.id);
    }).catch((e) => { if (alive) error = e.message; });
    return () => { alive = false; generation++; };
  });

  // Another case is other work: its areas, drafts and result layers are not
  // this one's. Mounting is not a switch, so re-entering Detect keeps what the
  // parent is still holding.
  $effect(() => {
    const id = caseId;
    if (id === loadedCase) return;
    const switching = loadedCase !== undefined;
    loadedCase = id; generation++;
    current = null; followupId = null; zonesId = null; candidateId = null;
    if (switching) {
      layers = []; zones = []; selectedZone = null; drawing = 'select';
      view = 'setup'; pinned = false; lastMapKey = ''; title = '';
    }
    lists = { zones: [], followups: [], runs: [] };
    if (id) void refresh(id).catch((e) => (error = e.message));
  });

  /**
   * Which way the imagery flows, in one place.
   *
   * On arrival the maps lead: whatever is above the stage is almost always what
   * you came to analyze, and inheriting it silently is the whole reason this
   * step usually needs no attention. From the first deliberate change here —
   * or straight away when the maps show something other than Sentinel-2 — the
   * direction reverses and the stage follows this step, so what is on screen
   * is what a run would sweep. Keyed on values, so a parent re-render that
   * rebuilds the same objects changes nothing.
   */
  $effect(() => {
    if (!catalogue || !recipe) return;
    const key = mapPair ? JSON.stringify(mapPair) : '';
    if (!pinned && key) {
      if (key === lastMapKey) return;
      lastMapKey = key;
      untrack(() => { a = clone(mapPair.left); b = clone(mapPair.right); });
      return;
    }
    if (!pinned) {
      untrack(() => { pinned = true; tookOver = true; });
      return;
    }
    const shown = JSON.stringify({ a, b });
    if (shown === lastPushed) return;
    lastPushed = shown;
    untrack(() => onsources(JSON.parse(shown)));
  });

  /** Areas redrawn, so the coverage shares no longer describe them (`areaKey`). */
  $effect(() => {
    const key = areaKey(zones);
    if (key === lastAreaKey) return;
    lastAreaKey = key;
    untrack(() => {
      passes = [];
      passSearched = false;
      passTruncated = false;
      passError = '';
    });
  });

  $effect(() => {
    if (!pending || !caseId) return;
    const id = current.id;
    const owner = caseId;
    const epoch = generation;
    let stopped = false;
    let timer;
    async function poll() {
      try {
        const run = await api.get(`${base(owner)}/runs/${id}`);
        if (stopped || epoch !== generation) return;
        acceptRun(run);
        if (['queued', 'running'].includes(run.status)) timer = setTimeout(poll, 900);
        else { await refresh(owner); await reloadCase(); }
      } catch (e) { if (!stopped) error = e.message; }
    }
    timer = setTimeout(poll, 900);
    return () => { stopped = true; clearTimeout(timer); };
  });

  $effect(() => {
    if (!opening || !caseId) return;
    const match = /^(zones|followups|runs)-([a-f0-9]{12})$/.exec(opening);
    if (match) untrack(() => void act(() => openItem(match[1], match[2])));
  });

  function choose(id) {
    const found = [...(catalogue?.builtins ?? []), ...(catalogue?.custom ?? [])].find((r) => r.id === id);
    if (!found) return;
    recipe = clone(found); chosen = id;
    if (recipe.zones.length) zones = clone(recipe.zones);
    attachZones = recipe.zones.length > 0;
  }

  function followMaps() {
    if (!mapPair) return;
    pinned = false; tookOver = false; lastMapKey = ''; lastPushed = '';
    a = clone(mapPair.left); b = clone(mapPair.right);
  }

  function runTitle() {
    const name = title.trim();
    if (name) return name;
    return `${recipe?.name ?? 'Detection'} · ${new Date().toISOString().slice(0, 10)}`;
  }

  function input() {
    return { title: runTitle(), zones: clone(zones),
      recipe: { ...clone(recipe), zones: attachZones ? clone(zones) : [] },
      a: clone(a), b: clone(b), date_rule: dateRule, offline, followup_id: followupId };
  }

  /** Runs and watches saved before Detect went Copernicus-only name a Wayback
   *  release; they reopen undated, which is what they are for Sentinel-2. */
  const sentinelSource = (source) => source?.provider === 'sentinel2'
    ? { ...EMPTY_SOURCE, ...clone(source) } : { ...EMPTY_SOURCE };

  function hydrate(body) {
    title = body.title; zones = clone(body.zones); recipe = clone(body.recipe); chosen = recipe.id;
    a = sentinelSource(body.a); b = sentinelSource(body.b); offline = body.offline;
    dateRule = body.date_rule; attachZones = recipe.zones.length > 0;
    followupId = body.followup_id;
    pinned = true;
  }

  function acceptRun(run) {
    current = run;
    if (run.status === 'ready') {
      const old = layers.find((r) => r.id === run.id);
      layers = [...layers.filter((r) => r.id !== run.id), { ...clone(run), visible: old?.visible ?? true }];
      if (!run.results.some((r) => r.id === candidateId)) candidateId = run.results[0]?.id ?? null;
    }
  }

  async function openItem(kind, id) {
    if (!id) return;
    const epoch = generation;
    const body = await api.get(`${base()}/${kind}/${id}`);
    if (epoch !== generation) return;
    if (kind === 'zones') { zones = clone(body.zones); zonesTitle = body.title; zonesId = id; view = 'setup'; }
    if (kind === 'followups') { hydrate(body); followupId = id; view = 'setup'; }
    if (kind === 'runs') { hydrate(body.input); acceptRun(body); view = 'results'; }
  }

  /**
   * Start an analyzer of your own, from this one or from a plain one.
   *
   * Built-ins cannot be written over, so "copy" is how an analyst keeps a tuned
   * version: the library is shared by every case, which is why it is explicit.
   */
  function startNew(from) {
    const base = from === 'copy'
      ? recipe
      : (catalogue?.builtins ?? []).find((r) => r.id === 'large-change') ?? catalogue?.builtins?.[0];
    if (!base) return;
    recipe = { ...clone(base), id: 'custom',
      name: from === 'copy' ? `${base.name} copy` : 'My analyzer' };
    chosen = 'custom';
    showNew = false;
    showRecipe = true;
  }

  async function deleteRecipe() {
    if (!mine) return;
    const gone = chosen;
    await api.del(`/api/compare/analyzers/${gone}`);
    catalogue = await api.get('/api/compare/analyzers');
    showRecipe = false;
    choose(catalogue?.builtins?.[0]?.id ?? '');
    toast('Analyzer removed from the library', 'ok');
  }

  async function saveRecipe(asNew = false) {
    const next = { ...clone(recipe), zones: attachZones ? clone(zones) : [] };
    if (asNew) next.id = 'custom';
    recipe = await api.post('/api/compare/analyzers', next);
    chosen = recipe.id;
    catalogue = await api.get('/api/compare/analyzers');
    toast('Analyzer saved for all cases', 'ok');
  }

  async function saveAreas(asNew = false) {
    const owner = await ensureCase();
    const data = { title: zonesTitle, zones: clone(zones) };
    const saved = zonesId && !asNew ? await api.put(`${base(owner.id)}/zones/${zonesId}`, data)
      : await api.post(`${base(owner.id)}/zones`, data);
    zonesId = saved.id; await refresh(owner.id); await reloadCase();
    toast('Areas saved in this case', 'ok');
  }

  async function saveWatch(asNew = false) {
    const owner = await ensureCase();
    const saved = followupId && !asNew ? await api.put(`${base(owner.id)}/followups/${followupId}`, input())
      : await api.post(`${base(owner.id)}/followups`, input());
    followupId = saved.id; await refresh(owner.id); await reloadCase();
    toast('Watch saved. Run it again from Saved whenever you want.', 'ok');
  }

  async function run() {
    const owner = await ensureCase();
    const result = await api.post(`${base(owner.id)}/runs`, input());
    candidateId = null; view = 'results';
    acceptRun(result);
    await refresh(owner.id); await reloadCase();
  }

  /** A watch is a recipe, its areas and a date rule. Running it again is the
   *  whole of the recurring check: load what was saved, then launch it. */
  async function runWatch(id) {
    await openItem('followups', id);
    await run();
  }

  function applyResult(row) {
    acceptRun({ ...current, results: current.results.map((r) => r.id === row.id ? row : r) });
  }

  /** Reviewing is a queue: a verdict moves on to the next one still waiting. */
  function advance() {
    const index = candidates.findIndex((r) => r.id === candidateId);
    for (let i = 1; i <= candidates.length; i++) {
      const row = candidates[(index + i) % candidates.length];
      if (row?.review === 'new') { candidateId = row.id; focus(row.coordinates); return; }
    }
  }

  async function review(value) {
    applyResult(await api.patch(`${base()}/runs/${current.id}/results/${candidateId}`, { review: value }));
    if (value !== 'new') advance();
  }

  /** The pin's name has to mean something in the case, long after this run. */
  const pinTitle = (row) =>
    `${row.phenomenon} · ${row.coordinates[1].toFixed(4)}, ${row.coordinates[0].toFixed(4)}`.slice(0, 120);

  async function keep() {
    const answer = await api.post(`${base()}/runs/${current.id}/results/${candidateId}/promote`,
      { title: pinTitle(candidate) });
    applyResult(answer.result);
    await reloadCase();
    toast('Pin and evidence saved in this case', 'ok');
    advance();
  }

  async function undoKeep() {
    const answer = await api.del(`${base()}/runs/${current.id}/results/${candidateId}/promote`);
    applyResult(answer.result);
    await reloadCase();
    toast('The pin went to Trash', 'ok');
  }

  function step(direction) {
    const index = candidates.findIndex((r) => r.id === candidateId);
    const row = candidates[(index + direction + candidates.length) % candidates.length];
    if (row) { candidateId = row.id; focus(row.coordinates); }
  }

  export function pick(runId, resultId) {
    const found = layers.find((r) => r.id === runId);
    if (found) { current = found; candidateId = resultId; view = 'results'; }
  }

  function removeZone(id) {
    zones = zones.filter((z) => z.id !== id);
    if (selectedZone === id) selectedZone = null;
  }

  async function removeItem(kind, id) {
    await api.del(`${base()}/${kind}/${id}`);
    if (kind === 'runs') { layers = layers.filter((r) => r.id !== id); if (current?.id === id) current = null; }
    if (kind === 'zones' && zonesId === id) zonesId = null;
    if (kind === 'followups' && followupId === id) followupId = null;
    await refresh(); await reloadCase(); toast('Moved to Trash', 'ok');
  }
</script>

<aside class="cmp-dock" aria-label="Detect">
  <header>
    <strong>Detect</strong>
    <button
      class="cmp-icon"
      class:on={showZones}
      aria-label={showZones ? 'Hide the analysis areas' : 'Show the analysis areas'}
      aria-pressed={showZones}
      title={showZones ? 'Hide the areas' : 'Show the areas'}
      onclick={() => (showZones = !showZones)}
    >
      <Icon name={showZones ? 'eye' : 'eyeOff'} size={15} />
    </button>
    <button class="cmp-icon" onclick={onclose} aria-label="Leave Detect mode" title="Back to side by side">
      <Icon name="x" size={14} />
    </button>
  </header>

  <div class="cmp-seg fill views">
    <button class:on={view === 'setup'} onclick={() => (view = 'setup')}>Setup</button>
    <button class:on={view === 'results'} disabled={!current && !layers.length} onclick={() => (view = 'results')}>
      Results{candidates.length ? ` · ${candidates.length}` : ''}
    </button>
    <button class:on={view === 'saved'} onclick={() => (view = 'saved')}>Saved</button>
  </div>

  <div class="cmp-dock-body">
    {#if needs}
      <p class="warn needs">
        {needs}
        <button class="btn btn-sm" onclick={onsettings}>Open Settings</button>
      </p>
    {/if}
    {#if error}<p class="warn" role="alert">{error}</p>{/if}
    {#if !catalogue}<p class="hint">Reading the local analyzer library…</p>{/if}

    {#if view === 'setup' && recipe}
      <!-- 1 · Area -->
      <section class="cmp-step" class:done={zones.length > 0} aria-label="Area">
        <header>
          <span class="cmp-step-n">1</span>
          <strong>Area</strong>
          {#if zones.length}<span class="count">{zones.length}</span>{/if}
        </header>
        <div class="row wrap">
          {#each [['rect', 'Rectangle'], ['polygon', 'Polygon'], ['ellipse', 'Circle']] as [kind, label]}
            <button class="btn btn-sm" class:active={drawing === kind} disabled={zones.length >= 32}
              onclick={() => { drawing = drawing === kind ? 'select' : kind; showZones = true; }}>{label}</button>
          {/each}
          <button class="btn btn-sm" disabled={zones.length >= 32} onclick={onusecurrentview}>Use current view</button>
        </div>
        {#if drawing !== 'select'}
          <p class="hint">{drawing === 'polygon' ? 'Click corners on either map; Enter finishes, Escape cancels.' : 'Drag on either map. Escape cancels.'}</p>
        {:else if !zones.length}
          <p class="hint">Draw on either map, take the current view, or open a saved set.</p>
        {/if}
        {#if zones.length}
          {#each zones as zone (zone.id)}
            <div class="row area-row">
              <button class="cmp-icon" aria-label={`Show ${zone.name}`} title={`Show ${zone.name}`}
                onclick={() => { selectedZone = zone.id; drawing = 'select'; focus(zone.points[0]); }}>
                <Icon name="pin" size={13} />
              </button>
              <input class="grow" aria-label="Area name" bind:value={zone.name} maxlength="120" />
              <button class="cmp-icon" aria-label={`Remove ${zone.name}`} title={`Remove ${zone.name}`} onclick={() => removeZone(zone.id)}>
                <Icon name="x" size={12} />
              </button>
            </div>
          {/each}
          <p class="hint" class:warn={tooMany}>{[
            `${round(cost.km2, cost.km2 < 10 ? 2 : 0)} km²`,
            Number.isFinite(cost.tiles) ? plural(cost.tiles, 'tile') : 'over the tile limit',
            tooMany ? '' : `${plural(frames, 'request')}, about ${duration}`,
          ].filter(Boolean).join(' · ')}</p>
          <div class="row">
            <input class="grow" aria-label="Area set name" bind:value={zonesTitle} maxlength="120" />
            <button class="btn btn-sm" disabled={busy} onclick={() => act(() => saveAreas())}>Save</button>
            {#if zonesId}<button class="btn btn-sm" disabled={busy} onclick={() => act(() => saveAreas(true))}>As new</button>{/if}
          </div>
        {/if}
      </section>

      <!-- 2 · Imagery -->
      <section class="cmp-step" class:done={pinned || !!mapPair} aria-label="Imagery">
        <header>
          <span class="cmp-step-n">2</span>
          <strong>Imagery</strong>
          <span class="chip">{pinned ? 'On the maps' : 'From the maps'}</span>
        </header>
        {#if tookOver}
          <p class="hint">Detect reads Sentinel-2, so the maps now show it.</p>
        {/if}
        <p class="pair">
          {#if !single}{sourceLabel(a)} <Icon name="arrowRight" size={11} />{/if} {sourceLabel(b)}
        </p>
        <div class="row">
          <button class="link" onclick={() => (showImagery = !showImagery)} aria-expanded={showImagery}>
            {showImagery ? 'Hide imagery settings' : 'Change dates or the rule…'}
          </button>
          {#if pinned && mapPair && !tookOver}<button class="link" onclick={followMaps}>Back to the map's imagery</button>{/if}
        </div>
        {#if showImagery}
          <label title="Keep explicit dates, compare to a fixed reference, or use the last completed run.">Dates
            <select aria-label="Date rule" bind:value={dateRule}>
              <option value="manual">Choose images</option>
              <option value="latest_reference">Latest against fixed reference</option>
              <option value="latest_previous">Latest against previous run</option>
            </select>
          </label>
          {#if !single || dateRule === 'manual'}
            <AcquisitionPicker
              list={passes}
              days={passDays}
              busy={passBusy}
              error={passError}
              truncated={passTruncated}
              searched={passSearched}
              areas={zones.length}
              {single}
              wantsReference={!single}
              wantsCompare={dateRule === 'manual'}
              a={a.date}
              b={b.date}
              ondays={(value) => { passDays = value; passSearched = false; passes = []; }}
              onlook={lookUpPasses}
              onpick={usePass}
            />
          {/if}
          {#each coverWarnings as note}<p class="warn">{note}</p>{/each}
          <label title="The picture you review. Detection reads the bands, whatever this shows.">Picture
            <select value={b.layer} onchange={(e) => { pinned = true; b = { ...b, layer: e.currentTarget.value }; a = { ...a, layer: e.currentTarget.value }; }}>
              <option value="TRUE_COLOR">True colour</option><option value="FALSE_COLOR">False colour</option><option value="SWIR">SWIR</option>
            </select>
          </label>
          <label title="Reject scenes above this cloud ceiling; some cloud can remain within a scene.">Maximum cloud cover · {b.maxcc}%
            <input type="range" min="0" max="100" value={b.maxcc} oninput={(e) => { pinned = true; b = { ...b, maxcc: Number(e.currentTarget.value) }; a = { ...a, maxcc: Number(e.currentTarget.value) }; }} />
          </label>
          {#if dateRule !== 'manual'}
            <p class="hint">Run looks up recent passes when you press it. Nothing downloads on its own.</p>
          {/if}
          <label class="check" title="Read only the tile cache and frames kept from earlier runs; a missing input stops the run rather than reaching the network.">
            <input type="checkbox" bind:checked={offline} /> Use local images only
          </label>
        {/if}
      </section>

      <!-- 3 · What to look for -->
      <section class="cmp-step done" aria-label="What to look for">
        <header><span class="cmp-step-n">3</span><strong>What to look for</strong></header>
        <div class="row">
          <label class="grow">
            <select aria-label="Analyzer" value={chosen} onchange={(e) => choose(e.currentTarget.value)}>
              <optgroup label="Built in">{#each catalogue?.builtins ?? [] as r}<option value={r.id}>{r.name}</option>{/each}</optgroup>
              {#if catalogue?.custom?.length}
                <optgroup label="Mine">{#each catalogue.custom as r}<option value={r.id}>{r.name}</option>{/each}</optgroup>
              {/if}
              {#if draft}
                <option value="custom">{recipe.name} — not saved yet</option>
              {:else if ![...(catalogue?.builtins ?? []), ...(catalogue?.custom ?? [])].some((r) => r.id === chosen)}
                <option value={chosen}>{recipe.name} (from a saved run)</option>
              {/if}
            </select>
          </label>
          <button class="cmp-icon" aria-label="New analyzer" aria-expanded={showNew}
            title="Make an analyzer of your own" onclick={() => (showNew = !showNew)}>
            <Icon name="plus" size={15} />
          </button>
        </div>
        {#if showNew}
          <div class="new-menu" role="group" aria-label="New analyzer">
            <button type="button" onclick={() => startNew('copy')}>
              Copy “{recipe.name}”<small>Its settings, under a name of your own.</small>
            </button>
            <button type="button" onclick={() => startNew('blank')}>
              Start from scratch<small>Any surface change, at a medium target size.</small>
            </button>
          </div>
        {/if}
        {#if recipe.description}<p class="hint">{recipe.description}</p>{/if}
        {#if capability.sizes}
          <div class="cmp-seg fill" role="group" aria-label="Target size">
            {#each SIZES as [name, label] (name)}
              {#if capability.sizes[name]}
                <button type="button" class:on={size === name} aria-pressed={size === name}
                  title={sizeBand(capability.sizes[name])}
                  onclick={() => setSize(name)}>{label}</button>
              {/if}
            {/each}
          </div>
          <p class="hint">
            {size ? sizeBand(capability.sizes[size]) : 'Sizes are set by hand below.'}
          </p>
        {/if}
        {#if capability.clouds}
          <CloudFilter
            clouds={recipe.parameters.ignore_clouds}
            shadows={recipe.parameters.ignore_shadows}
            ontoggle={setWeather}
          />
        {/if}
        <div class="row">
          <button class="link" onclick={() => (showDetection = !showDetection)} aria-expanded={showDetection}>
            {showDetection ? 'Hide thresholds' : 'Adjust thresholds…'}
          </button>
          <button class="link" onclick={() => (showRecipe = !showRecipe)} aria-expanded={showRecipe}>
            {showRecipe ? 'Hide this analyzer' : mine || draft ? 'Edit this analyzer…' : 'See how it is built…'}
          </button>
        </div>
        {#if showDetection}
          <label title="Higher finds fainter signals, and more noise with them.">Sensitivity · {recipe.parameters.sensitivity}
            <input aria-label="Analyzer sensitivity" type="range" min="0" max="100" bind:value={recipe.parameters.sensitivity} />
          </label>
          <div class="row">
            <label class="grow" title="Drop candidates smaller than this.">Min area (m²)
              <input aria-label="Minimum area" type="number" min="0" max="100000000" bind:value={recipe.parameters.min_area} />
            </label>
            <label class="grow" title="Drop candidates larger than this; 0 keeps them all.">Max area (m²)
              <input aria-label="Maximum area" type="number" min="0" max="100000000" bind:value={recipe.parameters.max_area} />
            </label>
          </div>
          {#if recipe.method === 'index'}
            <label>Index
              <select aria-label="Spectral index" bind:value={recipe.parameters.index}>
                {#each INDICES as [id, label] (id)}<option value={id}>{label}</option>{/each}
              </select>
            </label>
          {/if}
          {#if !single}
            <label title="Keep what brightened, what darkened, or both.">Direction
              <select bind:value={recipe.parameters.direction}><option value="both">Both</option><option value="gain">Gain</option><option value="loss">Loss</option></select>
            </label>
          {/if}
          {#if capability.clouds}
            <label class="check"><input type="checkbox" bind:checked={recipe.parameters.ignore_clouds} /> Exclude cloud and snow</label>
            <label class="check"><input type="checkbox" bind:checked={recipe.parameters.ignore_shadows} /> Exclude cloud shadow</label>
            <label title="Grow the mask past the edge the classification drew.">Mask margin · {recipe.parameters.cloud_margin}px
              <input aria-label="Cloud mask margin" type="range" min="0" max="10" bind:value={recipe.parameters.cloud_margin} />
            </label>
          {/if}
          <details>
            <summary>Noise and grouping</summary>
            <label title="Remove specks narrower than this; it also removes small real objects.">Noise cleanup · {recipe.parameters.cleanup}px<input type="range" min="0" max="3" bind:value={recipe.parameters.cleanup} /></label>
            <label title="Blur the reading first; zero keeps the finest detail.">Smoothing · {recipe.parameters.smoothing}px<input type="range" min="0" max="3" bind:value={recipe.parameters.smoothing} /></label>
            <label title="Join candidates this close; zero joins only touching ones.">Group within (m)<input type="number" min="0" max="500" bind:value={recipe.parameters.merge_metres} /></label>
          </details>
        {/if}
        {#if showRecipe}
          <label title="The name shown in the analyzer library across all cases.">Name<input aria-label="Analyzer name" bind:value={recipe.name} maxlength="120" /></label>
          <label title="What this analyzer looks for, and what it cannot tell you.">Description<textarea bind:value={recipe.description} maxlength="500"></textarea></label>
          <label title="The label each candidate carries. It does not change what is detected.">Candidate label<input bind:value={recipe.phenomenon} maxlength="120" /></label>
          <label title="What is measured. None of these recognise objects.">Method
            <select aria-label="Analyzer method" bind:value={recipe.method}>
              {#each catalogue?.methods ?? [] as method}<option value={method.id}>{method.label}</option>{/each}
            </select>
          </label>
          <div class="row">
            <label class="grow">Colour<input type="color" bind:value={recipe.colour} /></label>
            <label class="grow">Layer style
              <select bind:value={recipe.style}>
                <option value="both">Pins and outlines</option><option value="pins">Pins</option><option value="outlines">Outlines with pins</option>
              </select>
            </label>
          </div>
          <label class="check" title="Store a copy of these areas in the shared analyzer; past runs keep their own copy.">
            <input type="checkbox" bind:checked={attachZones} /> Keep these areas with the analyzer
          </label>
          <div class="row">
            {#if mine || draft}
              <button class="btn btn-sm" disabled={busy} onclick={() => act(() => saveRecipe())}>
                {draft ? 'Add to my analyzers' : 'Save changes'}
              </button>
            {/if}
            {#if !draft}
              <button class="btn btn-sm" disabled={busy} onclick={() => act(() => saveRecipe(true))}>Save as a copy</button>
            {/if}
            {#if mine}
              <button class="btn btn-sm danger" disabled={busy} onclick={() => act(() => deleteRecipe())}>Delete</button>
            {/if}
          </div>
          <p class="hint">
            {mine || draft ? 'Shared by every case, and carried by Settings backup.'
              : 'A built-in cannot be written over. Saving a copy keeps your version beside it.'}
          </p>
        {/if}
      </section>
    {/if}

    {#if view === 'results'}
      {#if current}
        <section class="run">
          <div class="row run-head">
            <strong class="grow">{current.title}</strong>
            {#if current.status === 'ready'}
              <button class="link" onclick={() => { hydrate(current.input); view = 'setup'; }}>Edit and rerun</button>
            {/if}
          </div>
          <p class="hint">{[
            statusLabel(current.status),
            current.status === 'ready' ? plural(current.total, 'tile') : `${current.progress}/${current.total} tiles`,
            current.input?.b ? dates(current.input) : '',
          ].filter(Boolean).join(' · ')}</p>
          {#if pending}
            <progress max={current.total} value={current.progress}></progress>
            <button class="btn btn-sm" disabled={busy}
              onclick={() => act(async () => acceptRun(await api.post(`${base()}/runs/${current.id}/cancel`, {})))}>Cancel</button>
          {/if}
          {#if current.message}<p class="hint" role="status">{current.message}</p>{/if}
          <!-- "Nothing found" and "never looked" are not the same answer. -->
          {#if sweptNote(current.swept)}<p class="warn">{sweptNote(current.swept)}</p>{/if}
          {#if current.status === 'ready' && !candidates.length}<p class="hint">Nothing passed these thresholds.</p>{/if}
        </section>
      {:else}
        <p class="hint">Run an analyzer, or open a saved run from Saved.</p>
      {/if}

      {#if candidate}
        <section class="candidate">
          <div class="row nav">
            <button class="cmp-icon" aria-label="Previous candidate" title="Previous candidate" onclick={() => step(-1)}><Icon name="chevronLeft" size={14} /></button>
            <span class="grow centre position">{candidates.findIndex((r) => r.id === candidateId) + 1} of {candidates.length}</span>
            <button class="cmp-icon" aria-label="Next candidate" title="Next candidate" onclick={() => step(1)}><Icon name="chevronRight" size={14} /></button>
          </div>
          <strong>{candidate.phenomenon}</strong>
          <img class="preview" src={`${base()}/runs/${current.id}/results/${candidate.id}/preview`}
            alt={methodOf(current.input.recipe.method).single ? 'Candidate evidence' : 'Candidate evidence: A on the left, B on the right'} />
          {#if reading(candidate, current.input)}
            <p class={`strength ${candidate.strength ?? ''}`}>{reading(candidate, current.input)}</p>
          {/if}
          <p class="facts">
            {Math.round(candidate.area)} m² · {Math.round(candidate.width)} × {Math.round(candidate.height)} m ·
            <button class="link inline" onclick={() => focus(candidate.coordinates)}>
              {candidate.coordinates[1].toFixed(5)}, {candidate.coordinates[0].toFixed(5)}
            </button>
          </p>

          <!-- Two verdicts and nothing in between: keeping is what writes to the
               case, dismissing is what takes a candidate off the map. -->
          {#if candidate.review === 'kept'}
            <p class="verdict kept"><Icon name="check" size={13} /> Kept as a pin in this case</p>
            <button class="link" disabled={busy} onclick={() => act(undoKeep)}>Undo and send the pin to Trash</button>
          {:else if candidate.review === 'dismissed'}
            <p class="verdict off"><Icon name="eyeOff" size={13} /> Dismissed · hidden on the map</p>
            <button class="link" disabled={busy} onclick={() => act(() => review('new'))}>Put it back among the candidates</button>
          {:else}
            <div class="row verdict-row">
              <button class="btn btn-primary grow" disabled={busy} onclick={() => act(keep)}>Keep as a pin</button>
              <button class="btn btn-sm" disabled={busy} onclick={() => act(() => review('dismissed'))}>Dismiss</button>
            </div>
          {/if}
          <p class="hint">{tally}</p>
        </section>
      {/if}

      {#if layers.length}
        <section>
          <strong>Result layers</strong>
          {#each layers as layer (layer.id)}
            <div class="row">
              <button class="cmp-icon" aria-label={`Toggle ${layer.title}`} title={`Toggle ${layer.title}`} aria-pressed={layer.visible}
                onclick={() => { layer.visible = !layer.visible; }}>
                <Icon name={layer.visible ? 'eye' : 'eyeOff'} size={15} />
              </button>
              <button class="link grow" onclick={() => { current = layer; candidateId = layer.results[0]?.id; }}>
                {layer.title} · {layer.count}
              </button>
            </div>
          {/each}
        </section>
      {/if}
    {/if}

    {#if view === 'saved'}
      <section>
        <strong>Watches</strong>
        <p class="hint">An analyzer, its areas and a date rule. Run one again whenever you want; nothing runs on its own.</p>
        {#if !lists.followups.length}<p class="hint">None saved in this case.</p>{/if}
        {#each lists.followups as row (row.id)}
          <div class="row">
            <button class="link grow" disabled={busy} onclick={() => act(() => openItem('followups', row.id))}>
              {row.title}<small>{row.created_at}</small>
            </button>
            <button class="btn btn-sm" disabled={busy || pending} onclick={() => act(() => runWatch(row.id))}>Run again</button>
            <button class="cmp-icon" disabled={busy} aria-label={`Delete ${row.title}`} title={`Delete ${row.title}`} onclick={() => act(() => removeItem('followups', row.id))}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        {/each}
      </section>
      {#each [['zones', 'Area sets'], ['runs', 'Past runs']] as [kind, label]}
        <section>
          <strong>{label}</strong>
          {#if !lists[kind].length}<p class="hint">None saved in this case.</p>{/if}
          {#each lists[kind] as row (row.id)}
            <div class="row">
              <button class="link grow" disabled={busy} onclick={() => act(() => openItem(kind, row.id))}>
                {row.title}<small>{row.created_at}{row.status ? ` · ${statusLabel(row.status)}` : ''}</small>
              </button>
              <button class="cmp-icon" disabled={busy || ['queued', 'running'].includes(row.status)}
                aria-label={`Delete ${row.title}`} title={`Delete ${row.title}`} onclick={() => act(() => removeItem(kind, row.id))}>
                <Icon name="trash" size={13} />
              </button>
            </div>
          {/each}
        </section>
      {/each}
    {/if}
  </div>

  {#if view === 'setup'}
    <div class="cmp-dock-foot">
      <input aria-label="Analysis name" placeholder={recipe ? `${recipe.name} · ${new Date().toISOString().slice(0, 10)}` : 'Name'}
        bind:value={title} maxlength="120" />
      <button class="btn btn-primary" disabled={busy || !recipe || !!blocked} onclick={() => act(run)}>
        {busy ? 'Starting…' : `Run on ${zones.length || 'no'} area${zones.length === 1 ? '' : 's'}`}
      </button>
      {#if blocked}
        <span class="reason">{blocked}</span>
      {:else}
        <button class="link centre" disabled={busy} onclick={() => act(() => saveWatch(!followupId))}>
          {followupId ? 'Update this watch' : 'Save as a watch to run again later'}
        </button>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .needs {
    display: grid;
    gap: 6px;
    justify-items: start;
  }
  .views { margin: 10px 12px 0; }
  /* The two ways to start one of your own, said in full rather than implied by
     a "duplicate" button next to a save. */
  .new-menu {
    display: grid;
    gap: 2px;
    padding: 4px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .new-menu button {
    display: grid;
    gap: 1px;
    padding: 6px 8px;
    border-radius: var(--r-sm);
    text-align: left;
    font-size: var(--fs-xs);
    color: var(--text-1);
  }
  .new-menu button:hover { background: var(--bg-3); }
  .new-menu small { color: var(--text-3); font-size: 10.5px; }
  .btn.danger { color: var(--warn); }
  .row.wrap { flex-wrap: wrap; }
  .area-row input { font-size: var(--fs-xs); }
  .count {
    padding: 1px 6px;
    border-radius: 99px;
    color: var(--text-2);
    background: var(--bg-3);
    font-size: 10px;
  }
  .chip {
    padding: 1px 6px;
    border-radius: 99px;
    color: var(--accent);
    background: var(--accent-soft);
    font-size: 10px;
    font-weight: 600;
  }
  .pair {
    display: flex;
    align-items: center;
    gap: 5px;
    margin: 0;
    color: var(--text-1);
    font-size: var(--fs-xs);
    overflow-wrap: anywhere;
  }
  section { display: grid; gap: 7px; }
  section.run, section.candidate { border-top: 1px solid var(--border); padding-top: 10px; }
  section > strong, .run-head strong { font-size: var(--fs-xs); }
  details { display: grid; gap: 8px; }
  details[open] { padding-top: 4px; }
  summary { color: var(--text-2); font-size: var(--fs-xs); cursor: pointer; }
  .link { color: var(--accent); font-size: var(--fs-xs); text-align: left; }
  .link:disabled { opacity: 0.5; }
  .link small { display: block; color: var(--text-3); font-size: 10px; }
  .link.inline { display: inline; font-family: var(--font-mono); font-size: 11px; }
  .centre { text-align: center; }
  .nav { justify-content: space-between; }
  .position { color: var(--text-2); font-size: var(--fs-xs); }
  .facts { margin: 0; color: var(--text-2); font-size: var(--fs-xs); line-height: 1.5; }
  .strength { margin: 0; font-size: var(--fs-xs); font-weight: 600; color: var(--text-1); }
  .strength.strong { color: var(--ok); }
  .strength.weak { color: var(--text-3); }
  .verdict { display: flex; align-items: center; gap: 5px; margin: 0; font-size: var(--fs-xs); font-weight: 600; }
  .verdict.kept { color: var(--ok); }
  .verdict.off { color: var(--text-3); }
  .verdict-row { gap: 6px; }
  .preview { width: 100%; max-height: 280px; object-fit: contain; border-radius: var(--r-sm); background: var(--bg-0); }
  progress { width: 100%; accent-color: var(--accent); }
  .active { outline: 1px solid var(--accent); }
</style>
