<script>
  /**
   * One routine's own page in the column: what it is, when it last read a pass,
   * a glance at what its passes found, and its runs.
   *
   * A routine is only worth saving if it remembers, so its runs are read together
   * (`lib/map/detectSeries.js`). The column keeps that light: four figures and a
   * small chart, which open the **dashboard** (`RoutineDashboard`) in a window
   * with room for the charts and the spots. While the page is up the map rings
   * the spots, and the one pressed there is summed up here, to judge or open.
   *
   * Running it again asks which pass to read rather than deciding silently, and
   * catching up lists the passes it missed: both cost Copernicus requests, and an
   * analyst usually knows which days they are chasing.
   */
  import { onDestroy } from 'svelte';
  import { CATEGORIES, areaColours, newestMember, seriesFigures, shortDay, spansYears } from '../../lib/map/detectSeries.js';
  import { countsOf, freshness, isActive, plural, ruleLabel, runState } from '../../lib/map/detections.js';
  import { offerPuts, withdrawNote } from '../../lib/noteHere.svelte.js';
  import Icon from '../../components/Icon.svelte';
  import RoutineDashboard from './RoutineDashboard.svelte';
  import SeriesBars from './SeriesBars.svelte';
  import SeriesExport from './SeriesExport.svelte';
  import { seriesOffers, sourceLine } from './seriesNote.js';

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
    /** Whether the dashboard window is open, and how it is looked at. */
    dashboard = $bindable(false),
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
    const zones = detail?.zones ?? detection.zones ?? [];
    return zones.map((zone) => {
      const known = areas.find((area) => area.id === zone.id);
      return { id: zone.id, name: known?.name ?? zone.name ?? 'Area', colour: known?.colour ?? '' };
    });
  });
  const colours = $derived(areaColours(routineAreas.map((area) => area.id), routineAreas));
  const names = $derived(Object.fromEntries(routineAreas.map((area) => [area.id, area.name])));
  const figures = $derived(series ? seriesFigures(series) : null);
  const year = $derived(series ? spansYears(series.passes.map((pass) => pass.date)) : false);
  const newest = $derived(series?.passes.at(-1) ?? null);
  const byArea = $derived(mode === 'area' && !only && routineAreas.length > 1);
  const picked = $derived(series?.spots.find((spot) => spot.id === selectedSpot) ?? null);
  const kindOf = Object.fromEntries(CATEGORIES.map((entry) => [entry.id, entry]));

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

  const kindOfRun = (run) => (run.dates?.[0] && run.dates[0] !== run.dates[1] ? `against ${shortDay(run.dates[0], true)}` : 'one image');
  const peak = $derived(Math.max(1, ...countsOf(detection.history).map((entry) => entry.value)));
  const exportAreas = $derived(routineAreas.map((area) => ({ ...area, colour: colours[area.id] })));
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
      <p class="fresh" class:stale={fresh.stale}><Icon name="clock" size={12} /> Last pass read {fresh.text}</p>
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
        <button class="btn" disabled={busy || !detail} onclick={oncatchup} title="List the passes it missed and read them one run each" data-guide="detect.catch-up">
          <Icon name="calendar" size={13} /> Catch up
        </button>
      {/if}
      <SeriesExport {series} title={detection.title} areas={exportAreas} {offers} {busy} onlayer={onexport} />
      <button class="cmp-icon" title="Edit this routine" aria-label={`Edit ${detection.title}`} disabled={busy}
        onclick={onedit}><Icon name="edit" size={13} /></button>
      <button class="cmp-icon" title="Delete this routine" aria-label={`Delete ${detection.title}`} disabled={busy}
        onclick={ondelete}><Icon name="trash" size={13} /></button>
    </div>
  </section>

  {#if !series}
    <p class="hint loading">Reading its passes…</p>
  {:else if !series.passes.length}
    <p class="empty">No finished pass yet. Run it on the newest pass, or catch up on the ones it missed: what it finds gathers here pass after pass.</p>
  {:else}
    <section class="glance" aria-label="What its passes found">
      <button class="open" data-guide="detect.glance" onclick={() => (dashboard = true)}>
        <span class="open-head">
          <span>Dashboard</span>
          <span class="open-go">Open <Icon name="maximize" size={12} /></span>
        </span>
        <span class="figures">
          <span><strong>{figures.passes}</strong>{figures.passes === 1 ? 'pass' : 'passes'}</span>
          <span><strong>{figures.candidates}</strong>candidates</span>
          <span><strong>{figures.spots}</strong>spots</span>
          <span><strong>{figures.newest}</strong>on {shortDay(figures.last)}</span>
        </span>
      </button>
      <SeriesBars passes={series.passes} height={78} compact label="Candidates per pass"
        areaIds={routineAreas.map((area) => area.id)} {colours} {names} onpick={(pass) => onopenrun(pass)} />
      <p class="line">
        {shortDay(figures.first, year)} → {shortDay(figures.last, true)}
        {#if figures.toReview}<span class="review">· {figures.toReview} to review</span>{/if}
        {#if newest?.compared}· <span class="up">+{figures.arrived}</span> <span class="down">−{figures.left}</span> on the newest pass{/if}
      </p>
    </section>

    {#if picked}
      {@const member = newestMember(picked)}
      <section class="picked" style:--spot={colours[picked.areaId]}>
        <header>
          <strong>{picked.id}</strong>
          <span class={`kind ${picked.category}`} title={kindOf[picked.category]?.rule}>{kindOf[picked.category]?.label}</span>
          <span class="seen">seen on {picked.seen} of {picked.read}</span>
          <button class="cmp-icon" aria-label="Let go of this spot" title="Let go" onclick={() => (selectedSpot = null)}><Icon name="x" size={12} /></button>
        </header>
        <span class="strip" style:--n={picked.presence.length} aria-hidden="true">
          {#each picked.presence as cell, at (at)}<span class={`cell ${cell}`}></span>{/each}
        </span>
        <p class="where">{names[picked.areaId] ?? 'Area'} · {picked.first === picked.last ? shortDay(picked.first, year) : `${shortDay(picked.first, year)} → ${shortDay(picked.last, year)}`}</p>
        <div class="row-acts">
          <button class="btn btn-sm" disabled={busy || !member} onclick={() => onopenspot(picked, member)}>Open its newest pass</button>
          <button class="cmp-icon" disabled={busy || !picked.verdicts.toReview} title="Keep its candidates here" aria-label={`Keep ${picked.id} here`}
            onclick={() => onverdict([picked], 'noted')}><Icon name="check" size={13} /></button>
          <button class="cmp-icon" disabled={busy || picked.verdicts.pinned === picked.verdicts.total} title="Dismiss its candidates from every pass"
            aria-label={`Dismiss ${picked.id}`} onclick={() => onverdict([picked], 'dismissed')}><Icon name="x" size={13} /></button>
          <button class="cmp-icon" title="Find it in the dashboard" aria-label={`Find ${picked.id} in the dashboard`}
            onclick={() => { filter = 'all'; tab = 'spots'; dashboard = true; }}><Icon name="maximize" size={13} /></button>
        </div>
      </section>
    {:else}
      <p class="hint">The rings on the map are its spots. Press one to see it here.</p>
    {/if}
  {/if}

  <section class="runs-list" aria-label="Runs">
    <h4>Runs <small>{detection.history.length}</small></h4>
    {#if !detection.history.length}<p class="hint">Not run yet.</p>{/if}
    <ul class="runs">
      {#each detection.history as run (run.id)}
        {@const past = runState(run)}
        <li class="run">
          <button class="past" disabled={busy} onclick={() => onopenrun(run)}>
            <span class="line-run"><strong>{shortDay(run.dates?.[1], true) || run.title}</strong>
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
  </section>
</div>

{#if dashboard && series?.passes.length}
  <RoutineDashboard {detection} {series} areas={routineAreas} {colours} {names} {single} {offers} {busy}
    bind:tab bind:mode bind:only bind:radius bind:filter bind:selectedSpot
    onclose={() => (dashboard = false)}
    onopenrun={(pass) => { dashboard = false; onopenrun(pass, { reopen: true }); }}
    onopenspot={(spot, member) => { dashboard = false; onopenspot(spot, member, { reopen: true }); }}
    onshowspot={(spot) => { dashboard = false; selectedSpot = spot.id; onselectspot(spot); }}
    {onverdict} onlayer={onexport} />
{/if}

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
  progress { width: 100%; height: 6px; accent-color: var(--accent); }
  .actions { display: flex; align-items: center; gap: 4px; margin-top: 4px; }
  .actions .grow { flex: 1; min-width: 0; }
  .actions .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
  .empty { margin: 0; color: var(--text-2); font-size: var(--fs-xs); line-height: 1.5; }
  .loading { padding: 10px 2px; }
  .glance { display: grid; gap: 8px; padding: 10px 10px 8px; border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--bg-1); }
  .open { display: grid; gap: 8px; text-align: left; }
  .open-head { display: flex; align-items: center; justify-content: space-between; color: var(--text-1); font-size: var(--fs-sm); font-weight: 650; }
  .open-go { display: inline-flex; align-items: center; gap: 5px; color: var(--accent); font-size: var(--fs-xs); font-weight: 600; }
  .open:hover .open-go { text-decoration: underline; }
  .figures { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
  .figures > span { display: grid; gap: 0; min-width: 0; color: var(--text-3); font-size: 10.5px; white-space: nowrap; }
  .figures strong { color: var(--text-1); font-size: var(--fs-lg); font-weight: 700; font-variant-numeric: tabular-nums; }
  .line { margin: 0; color: var(--text-3); font-size: var(--fs-xs); }
  .line .review { color: var(--accent); font-weight: 600; }
  .up { color: var(--ok); font-weight: 650; }
  .down { color: var(--danger); font-weight: 650; }
  .picked { display: grid; gap: 7px; padding: 10px; border: 1px solid var(--accent); border-radius: var(--r-lg); background: var(--accent-soft); }
  .picked header { display: flex; align-items: center; gap: 8px; font-size: var(--fs-xs); }
  .picked header strong { font-size: var(--fs-sm); }
  .picked header .cmp-icon { width: 24px; height: 24px; margin-left: auto; }
  .kind { font-weight: 600; }
  .kind.new { color: var(--ok); }
  .kind.gone { color: var(--danger); }
  .kind.steady { color: var(--info); }
  .kind.once { color: var(--text-2); }
  .kind.mixed { color: var(--warn); }
  .seen { color: var(--text-3); }
  .strip { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 2px; height: 10px; }
  .cell { border-radius: 2px; background: color-mix(in srgb, var(--text-3) 22%, transparent); }
  .cell.present { background: var(--spot, var(--info)); }
  .cell.unread { background: repeating-linear-gradient(135deg, transparent 0 2px, color-mix(in srgb, var(--text-3) 30%, transparent) 2px 3px); }
  .where { margin: 0; color: var(--text-3); font-size: 10.5px; }
  .row-acts { display: flex; align-items: center; gap: 2px; }
  .row-acts .btn { margin-right: auto; }
  .runs-list { display: grid; gap: 4px; }
  h4 { margin: 4px 0 0; color: var(--text-2); font-size: var(--fs-xs); font-weight: 650; letter-spacing: 0.03em; text-transform: uppercase; }
  h4 small { margin-left: 4px; color: var(--text-3); }
  .runs { display: grid; gap: 2px; margin: 0; padding: 0; list-style: none; }
  .run { display: flex; align-items: center; gap: 4px; }
  .past { display: grid; flex: 1; gap: 3px; min-width: 0; padding: 7px 8px; border-radius: var(--r-sm); text-align: left; }
  .past:hover:not(:disabled) { background: var(--bg-2); }
  .line-run { display: flex; align-items: baseline; gap: 8px; font-size: var(--fs-xs); }
  .past strong { min-width: 74px; color: var(--text-1); font-size: var(--fs-sm); font-variant-numeric: tabular-nums; }
  .line-run span { color: var(--text-2); }
  .line-run .new { color: var(--accent); font-weight: 600; }
  .line-run .busy { color: var(--info); }
  .line-run .warn { color: var(--warn); }
  .past small { color: var(--text-3); font-size: 10.5px; }
  .meter { display: block; height: 3px; border-radius: 2px; background: var(--bg-3); overflow: hidden; }
  .meter span { display: block; height: 100%; background: var(--info); opacity: 0.7; }
</style>
