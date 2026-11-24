<script>
  /**
   * One routine's own page, as a dashboard of what its runs found over time.
   *
   * A routine is only worth saving if it remembers, so its runs are read together
   * (`lib/map/detectSeries.js`): **Overview** gives the headline figures, the
   * candidates found on each pass and the spots that appeared and left; **Spots**
   * lists the places candidates come back to, each with its passes, to judge at
   * once; **Runs** keeps the history. Every part goes into a note as a chart the
   * Notebook keeps editable, or out as a CSV.
   *
   * Running it again asks which pass to read rather than deciding silently, and
   * catching up lists the passes it missed: both cost Copernicus requests, and an
   * analyst usually knows which days they are chasing.
   */
  import { onDestroy } from 'svelte';
  import { areaColours, seriesFigures, shortDay, spansYears } from '../../lib/map/detectSeries.js';
  import { countsOf, freshness, isActive, plural, ruleLabel, runState } from '../../lib/map/detections.js';
  import { offerPuts, withdrawNote } from '../../lib/noteHere.svelte.js';
  import { pinned } from '../../lib/notes/putInNote.svelte.js';
  import { setDockOpen } from '../../lib/notes/noteDock.svelte.js';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import Icon from '../../components/Icon.svelte';
  import PutInNote from '../../components/PutInNote.svelte';
  import SeriesBars from './SeriesBars.svelte';
  import SeriesSpark from './SeriesSpark.svelte';
  import SeriesSpots from './SeriesSpots.svelte';
  import { candidatesCsv, downloadCsv, fileName, seriesOffers, sourceLine, spotsCsv } from './seriesNote.js';

  let {
    detection,
    /** The routine as saved: its areas, analyzer and rule. Null while loading. */
    detail = null,
    /** Its runs read together (`buildSeries`), or null while they load. */
    series = null,
    /** The shared areas of the case, for their names and colours. */
    areas = [],
    methods = [],
    /** Which collection its analyzer reads, for the note's source line. */
    sensor = 'sentinel2',
    busy = false,
    tab = $bindable('overview'),
    mode = $bindable('total'),
    only = $bindable(null),
    radius = $bindable(40),
    filter = $bindable('all'),
    selectedSpot = $bindable(null),
    onrun = () => {},
    oncatchup = () => {},
    onexport = () => {},
    oncancel = () => {},
    onedit = () => {},
    ondelete = () => {},
    onopenrun = () => {},
    onopenspot = () => {},
    onselectspot = () => {},
    onverdict = () => {},
  } = $props();

  const methodOf = (method) => methods.find((m) => m.id === method) ?? {};
  const single = $derived(detection.single ?? !!methodOf(detection.method).single);
  const state = $derived(runState(detection.active ?? detection.latest));
  const fresh = $derived(freshness(detection.lastPass));
  const waiting = $derived(Math.max(0, (detection.working?.length ?? 0) - 1));

  /** The routine's areas in their shared order, named and coloured apart. */
  const routineAreas = $derived.by(() => {
    const ids = (detail?.zones ?? detection.zones ?? []).map((zone) => zone.id);
    const known = areas.filter((area) => ids.includes(area.id));
    const named = Object.fromEntries((detail?.zones ?? detection.zones ?? []).map((zone) => [zone.id, zone.name]));
    return ids.map((id) => ({ id, name: known.find((area) => area.id === id)?.name ?? named[id] ?? 'Area',
      colour: known.find((area) => area.id === id)?.colour ?? '' }));
  });
  const colours = $derived(areaColours(routineAreas.map((area) => area.id), routineAreas));
  const names = $derived(Object.fromEntries(routineAreas.map((area) => [area.id, area.name])));
  const shownAreas = $derived(only ? routineAreas.filter((area) => area.id === only) : routineAreas);
  const figures = $derived(series ? seriesFigures(series) : null);
  const year = $derived(series ? spansYears(series.passes.map((pass) => pass.date)) : false);
  const newest = $derived(series?.passes.at(-1) ?? null);
  const spotOf = (id) => series?.spots.find((spot) => spot.id === id) ?? null;
  const byArea = $derived(mode === 'area' && !only && routineAreas.length > 1);

  // An area filter that names an area the routine no longer reads falls back to all of them.
  $effect(() => { if (only && !routineAreas.some((area) => area.id === only)) only = null; });

  const noteRead = () => ({ series, title: detection.title, areas: routineAreas.map((area) => ({ ...area, colour: colours[area.id] })),
    source: sourceLine({ analyzer: detection.analyzer, sensor }), byArea });
  const offers = seriesOffers(noteRead);
  // what the note's + offers while this page is up; the review offers its own
  $effect(() => {
    offerPuts('detect', () => (series?.passes.length ? offers : []));
  });
  onDestroy(() => withdrawNote('detect'));

  let exportAnchor = $state(null);
  let exporting = $state(false);
  function download(kind) {
    exporting = false;
    const options = { areas: routineAreas };
    downloadCsv(kind === 'spots' ? spotsCsv(series, options) : candidatesCsv(series, options), fileName(detection.title, kind));
  }

  const kindOfRun = (run) => (run.dates?.[0] && run.dates[0] !== run.dates[1] ? `against ${shortDay(run.dates[0], true)}` : 'one image');
  const sparks = $derived(countsOf(detection.history));
  const peak = $derived(Math.max(1, ...sparks.map((entry) => entry.value)));
</script>

<div class="cmp-dock-body dash" style:--tint={detection.colour || 'var(--accent)'}>
  <section class="head">
    <h3><span class="swatch" aria-hidden="true"></span>{detection.title}</h3>
    {#if detection.note}<p class="note">{detection.note}</p>{/if}
    <p class="meta">{[detection.analyzer, plural(detection.areas ?? routineAreas.length, 'area'),
      ruleLabel(detection.date_rule, single)].filter(Boolean).join(' · ')}</p>
    {#if detection.active}
      <p class={`state ${state.tone}`}>{state.text}{waiting ? ` · ${waiting} more queued` : ''}</p>
      {#if detection.active.status === 'running'}
        <progress max={detection.active.total || 1} value={detection.active.progress ?? 0}></progress>
      {/if}
    {:else if fresh.text}
      <p class="fresh" class:stale={fresh.stale}>
        <Icon name="clock" size={12} /> Last pass read {fresh.text}
        {#if fresh.stale}<button class="link" disabled={busy || !detail} onclick={oncatchup}>Catch up</button>{/if}
      </p>
    {:else}
      <p class={`state ${state.tone}`}>{state.text}</p>
    {/if}
    {#if detail?.missing_areas?.length}
      <p class="state warn">
        {detail.missing_areas.length === 1 ? 'An area it drew on was' : 'Areas it drew on were'} deleted. Edit the routine to add one.
      </p>
    {/if}
    <div class="actions">
      {#if detection.active}
        <button class="btn btn-sm grow" disabled={busy} onclick={() => oncancel(detection.working ?? [detection.active])}>
          <Icon name="square" size={11} /> {waiting ? `Stop all ${waiting + 1} runs` : 'Stop this run'}
        </button>
      {:else}
        <button class="btn btn-primary grow" disabled={busy || !detail} onclick={onrun}>
          <Icon name="play" size={12} /> Run routine
        </button>
        <button class="btn" disabled={busy || !detail} onclick={oncatchup} title="List the passes it missed and read them one run each">
          <Icon name="calendar" size={13} /> Catch up
        </button>
      {/if}
      <button class="cmp-icon" class:on={exporting} bind:this={exportAnchor} aria-haspopup="menu" aria-expanded={exporting}
        title="Put it in a note or download it" aria-label="Export" disabled={busy}
        onclick={() => (exporting = !exporting)}><Icon name="upload" size={14} /></button>
      <button class="cmp-icon" title="Edit this routine" aria-label={`Edit ${detection.title}`} disabled={busy}
        onclick={onedit}><Icon name="edit" size={13} /></button>
      <button class="cmp-icon" title="Delete this routine" aria-label={`Delete ${detection.title}`} disabled={busy}
        onclick={ondelete}><Icon name="trash" size={13} /></button>
    </div>
  </section>

  {#if exporting}
    <FloatingMenu anchor={exportAnchor} width={260} align="end" label="Export" onclose={() => (exporting = false)}>
      <div class="fm-head">Into a note</div>
      {#if !series?.passes.length}
        <p class="fm-note">Nothing to put in a note before a finished pass.</p>
      {:else if pinned.current}
        {#each offers as offer (offer.id)}
          <PutInNote {offer} named onput={() => (exporting = false)} />
        {/each}
      {:else}
        <button class="fm-item" role="menuitem" onclick={() => { exporting = false; setDockOpen(true); }}>
          <Icon name="note" size={13} /><span class="fm-grow">Open the note panel</span>
        </button>
        <p class="fm-note">Then each part of this dashboard goes in it as a chart or a table you can edit.</p>
      {/if}
      <div class="fm-sep"></div>
      <div class="fm-head">Download</div>
      <button class="fm-item" role="menuitem" disabled={!series?.passes.length} onclick={() => download('candidates')}>
        <Icon name="download" size={13} /><span class="fm-grow">Every candidate (CSV)</span>
      </button>
      <button class="fm-item" role="menuitem" disabled={!series?.spots.length} onclick={() => download('spots')}>
        <Icon name="download" size={13} /><span class="fm-grow">The spots (CSV)</span>
      </button>
      <div class="fm-sep"></div>
      <button class="fm-item" role="menuitem" onclick={() => { exporting = false; onexport(); }}>
        <Icon name="layers" size={13} /><span class="fm-grow">Snapshot what it kept as a SAT layer</span>
      </button>
    </FloatingMenu>
  {/if}

  <div class="cmp-seg fill tabs" role="tablist" aria-label="What to show">
    <button role="tab" aria-selected={tab === 'overview'} class:on={tab === 'overview'} onclick={() => (tab = 'overview')}>Overview</button>
    <button role="tab" aria-selected={tab === 'spots'} class:on={tab === 'spots'} onclick={() => (tab = 'spots')}>
      Spots{series?.spots.length ? ` · ${series.spots.length}` : ''}
    </button>
    <button role="tab" aria-selected={tab === 'runs'} class:on={tab === 'runs'} onclick={() => (tab = 'runs')}>
      Runs{detection.history.length ? ` · ${detection.history.length}` : ''}
    </button>
  </div>

  {#if tab !== 'runs' && routineAreas.length > 1 && series?.passes.length}
    <div class="areas" role="group" aria-label="Areas shown">
      <button class="area" class:on={!only} aria-pressed={!only} onclick={() => (only = null)}>All areas</button>
      {#each routineAreas as area (area.id)}
        <button class="area" class:on={only === area.id} aria-pressed={only === area.id} title={area.name}
          onclick={() => (only = only === area.id ? null : area.id)}>
          <span class="dot" style:background={colours[area.id]} aria-hidden="true"></span><span class="label-text">{area.name}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if tab === 'runs'}
    {#if !detection.history.length}<p class="hint">Not run yet.</p>{/if}
    <ul class="runs">
      {#each detection.history as run (run.id)}
        {@const past = runState(run)}
        <li class="run">
          <button class="past" disabled={busy} onclick={() => onopenrun(run)}>
            <span class="line"><strong>{shortDay(run.dates?.[1], true) || run.title}</strong>
              <span class={past.tone}>{run.status === 'ready' ? (run.to_review ? `${run.to_review} to review` : plural(run.count ?? 0, 'candidate')) : past.text}</span></span>
            <small>{kindOfRun(run)}</small>
            {#if run.status === 'ready'}<span class="meter" aria-hidden="true"><span style:width={`${((run.count ?? 0) / peak) * 100}%`}></span></span>{/if}
          </button>
          {#if isActive(run)}
            <button class="cmp-icon" title="Stop this run" aria-label={`Stop ${run.title}`} disabled={busy}
              onclick={() => oncancel([run])}><Icon name="square" size={12} /></button>
          {/if}
        </li>
      {/each}
    </ul>
  {:else if !series}
    <p class="hint loading">Reading its passes…</p>
  {:else if !series.passes.length}
    <div class="empty">
      <SeriesSpark values={[]} />
      <p>No finished pass yet. Run it on the newest pass, or catch up on the ones it missed: what it finds gathers here pass after pass.</p>
    </div>
  {:else if tab === 'overview'}
    <div class="tiles">
      <div class="tile">
        <span class="figure">{figures.passes}</span>
        <span class="what">{figures.passes === 1 ? 'pass read' : 'passes read'}</span>
        <small>{figures.first === figures.last ? shortDay(figures.last, true) : `${shortDay(figures.first, year)} → ${shortDay(figures.last, true)}`}</small>
      </div>
      <div class="tile">
        <span class="figure">{figures.candidates}</span>
        <span class="what">candidates</span>
        <small class:review={figures.toReview}>{figures.toReview ? `${figures.toReview} to review` : 'all reviewed'}</small>
      </div>
      <button class="tile press" onclick={() => { filter = 'all'; tab = 'spots'; }} title="List the spots">
        <span class="figure">{figures.spots}</span>
        <span class="what">spots</span>
        <small>{figures.steady} regular · within {series.radius} m</small>
      </button>
      <button class="tile press" onclick={() => onopenrun(newest)} title="Open the newest pass">
        <span class="figure">{figures.newest}</span>
        <span class="what">on {shortDay(figures.last)}</span>
        <small>{#if newest?.compared}<span class="up">+{figures.arrived}</span> <span class="down">−{figures.left}</span> since the pass before{:else}its first pass{/if}</small>
      </button>
    </div>

    <section class="card">
      <header>
        <h4>Candidates per pass</h4>
        {#if !only && routineAreas.length > 1}
          <div class="cmp-seg small" role="group" aria-label="Bars">
            <button class:on={mode === 'total'} aria-pressed={mode === 'total'} onclick={() => (mode = 'total')}>Total</button>
            <button class:on={mode === 'area'} aria-pressed={mode === 'area'} onclick={() => (mode = 'area')}>By area</button>
          </div>
        {/if}
      </header>
      <SeriesBars passes={series.passes} mode={byArea ? 'area' : 'total'} areaIds={shownAreas.map((area) => area.id)}
        {colours} {names} onpick={(pass) => onopenrun(pass)} label="Candidates per pass" />
      <div class="legend">
        {#if byArea}
          {#each routineAreas as area (area.id)}<span><i style:background={colours[area.id]}></i>{area.name}</span>{/each}
        {:else}
          <span><i class="info"></i>Candidates{only ? ` in ${names[only]}` : ''}</span>
        {/if}
        {#if figures.toReview}<span><i class="accent"></i>To review</span>{/if}
        <span class="aside">Press a column to open its pass</span>
      </div>
    </section>

    {#if series.passes.some((pass) => pass.compared)}
      <section class="card">
        <header><h4>Spots that appeared and left</h4></header>
        <SeriesBars kind="change" height={120} passes={series.passes} areaIds={shownAreas.map((area) => area.id)} {names}
          onpick={(pass) => onopenrun(pass)} label="Spots that appeared and left" />
        <div class="legend">
          <span><i class="ok"></i>Appeared</span><span><i class="danger"></i>Left</span>
          <span class="aside">Against the pass before that read the same area</span>
        </div>
      </section>
    {/if}

    {#if newest?.compared && (newest.arrived.length || newest.left.length)}
      <section class="card">
        <header><h4>On the newest pass, {shortDay(newest.date, true)}</h4></header>
        {#if newest.arrived.length}
          <div class="spot-chips"><span class="lead up">Appeared</span>
            {#each newest.arrived as id (id)}
              <button class="spot-chip up" onclick={() => { selectedSpot = id; const spot = spotOf(id); if (spot) onselectspot(spot); }}>{id}</button>
            {/each}
          </div>
        {/if}
        {#if newest.left.length}
          <div class="spot-chips"><span class="lead down">Left</span>
            {#each newest.left as id (id)}
              <button class="spot-chip down" onclick={() => { selectedSpot = id; const spot = spotOf(id); if (spot) onselectspot(spot); }}>{id}</button>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  {:else}
    <SeriesSpots {series} {colours} {names} {busy} bind:radius bind:filter bind:selected={selectedSpot}
      onselect={onselectspot} onopen={onopenspot} {onverdict} />
  {/if}
</div>

<style>
  .dash { gap: 12px; }
  .head { display: grid; gap: 6px; }
  h3 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: var(--fs-md); font-weight: 700; line-height: 1.3; }
  .swatch { flex: none; width: 4px; height: 16px; border-radius: 2px; background: var(--tint); }
  .note { margin: 0; color: var(--text-2); font-size: var(--fs-xs); line-height: 1.45; }
  .meta, .state, .fresh { margin: 0; font-size: var(--fs-xs); }
  .meta { color: var(--text-3); }
  .state { color: var(--text-2); }
  .state.new { color: var(--accent); font-weight: 600; }
  .state.busy { color: var(--info); }
  .state.warn { color: var(--warn); }
  .fresh { display: flex; align-items: center; gap: 5px; color: var(--text-2); }
  .fresh.stale { color: var(--warn); }
  .link { margin-left: auto; color: var(--accent); font-size: var(--fs-xs); font-weight: 600; }
  progress { width: 100%; height: 6px; accent-color: var(--accent); }
  .actions { display: flex; align-items: center; gap: 4px; margin-top: 4px; }
  .actions .grow { flex: 1; min-width: 0; }
  .actions .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
  .tabs { margin-top: 2px; }
  .areas { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: thin; padding-bottom: 2px; }
  .area {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 5px;
    max-width: 160px;
    height: 24px;
    padding: 0 9px;
    border: 1px solid var(--border);
    border-radius: 99px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .area:hover { border-color: var(--border-strong); color: var(--text-1); }
  .area.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text-1); }
  .area .dot { flex: none; width: 8px; height: 8px; border-radius: 2px; }
  .label-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 6px; }
  .tile {
    display: grid;
    align-content: start;
    gap: 1px;
    min-width: 0;
    padding: 9px 11px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--bg-2);
    text-align: left;
  }
  .tile.press:hover { border-color: var(--border-strong); background: var(--bg-3); }
  .figure { color: var(--text-1); font-size: var(--fs-xl); font-weight: 700; line-height: 1.15; font-variant-numeric: tabular-nums; }
  .what { color: var(--text-2); font-size: var(--fs-xs); }
  .tile small { overflow: hidden; color: var(--text-3); font-size: 10.5px; text-overflow: ellipsis; white-space: nowrap; }
  .tile small.review { color: var(--accent); font-weight: 600; }
  .up { color: var(--ok); font-weight: 650; }
  .down { color: var(--danger); font-weight: 650; }
  .card { display: grid; gap: 8px; min-width: 0; padding: 10px 10px 8px; border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--bg-1); }
  .card header { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; }
  h4 { margin: 0; color: var(--text-1); font-size: var(--fs-sm); font-weight: 650; }
  .cmp-seg.small > button { min-height: 22px; padding: 0 8px; font-size: var(--fs-xs); }
  .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 12px; color: var(--text-2); font-size: 10.5px; }
  .legend span { display: inline-flex; align-items: center; gap: 5px; }
  .legend i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; }
  .legend i.info { background: var(--info); }
  .legend i.accent { background: var(--accent); }
  .legend i.ok { background: var(--ok); }
  .legend i.danger { background: var(--danger); }
  .legend .aside { margin-left: auto; color: var(--text-3); }
  .spot-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }
  .spot-chips .lead { min-width: 64px; font-size: var(--fs-xs); }
  .spot-chip {
    height: 22px;
    padding: 0 8px;
    border-radius: 99px;
    font-size: var(--fs-xs);
    font-weight: 650;
    font-variant-numeric: tabular-nums;
  }
  .spot-chip.up { background: var(--ok-soft); color: var(--ok); }
  .spot-chip.down { background: var(--danger-soft); color: var(--danger); }
  .spot-chip:hover { outline: 1px solid currentColor; }
  .empty { display: grid; gap: 6px; padding: 8px 2px; }
  .empty p { margin: 0; color: var(--text-2); font-size: var(--fs-xs); line-height: 1.5; }
  .loading { padding: 12px 2px; }
  .runs { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
  .run { display: flex; align-items: center; gap: 4px; }
  .past {
    display: grid;
    flex: 1;
    gap: 3px;
    min-width: 0;
    padding: 7px 8px;
    border-radius: var(--r-sm);
    text-align: left;
  }
  .past:hover:not(:disabled) { background: var(--bg-2); }
  .past .line { display: flex; align-items: baseline; gap: 8px; font-size: var(--fs-xs); }
  .past strong { min-width: 74px; color: var(--text-1); font-size: var(--fs-sm); font-variant-numeric: tabular-nums; }
  .past .line span { color: var(--text-2); }
  .past .line .new { color: var(--accent); font-weight: 600; }
  .past .line .busy { color: var(--info); }
  .past .line .warn { color: var(--warn); }
  .past small { color: var(--text-3); font-size: 10.5px; }
  .meter { display: block; height: 3px; border-radius: 2px; background: var(--bg-3); overflow: hidden; }
  .meter span { display: block; height: 100%; background: var(--info); opacity: 0.7; }
</style>
