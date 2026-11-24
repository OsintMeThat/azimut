<script>
  /**
   * A routine's dashboard, in a window of its own over the map: room for the
   * charts and the spots to be read rather than squeezed into the column.
   *
   * **Overview** sets the headline figures over the candidates found on each pass,
   * the spots that appeared and left against the pass before, the spots by kind and
   * what the newest pass changed. **Spots** is the matrix of every spot against
   * every pass. Area chips narrow both to one area; the export menu puts any part
   * in a note or a file. Opening a pass or showing a spot on the map closes the
   * window, and Back to the routine brings it again.
   */
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';
  import { CATEGORIES, categoryCounts, seriesFigures, shortDay, spansYears } from '../../lib/map/detectSeries.js';
  import { freshness, plural, ruleLabel } from '../../lib/map/detections.js';
  import SeriesBars from './SeriesBars.svelte';
  import SeriesExport from './SeriesExport.svelte';
  import SeriesSpots from './SeriesSpots.svelte';

  let {
    detection,
    series,
    /** The routine's areas in their order, `{ id, name, colour }`, coloured apart. */
    areas = [],
    colours = {},
    names = {},
    single = false,
    offers = [],
    busy = false,
    tab = $bindable('overview'),
    mode = $bindable('total'),
    only = $bindable(null),
    radius = $bindable(40),
    filter = $bindable('all'),
    selectedSpot = $bindable(null),
    onclose = () => {},
    onopenrun = () => {},
    onopenspot = () => {},
    onshowspot = () => {},
    onverdict = () => {},
    onlayer = () => {},
  } = $props();

  const figures = $derived(seriesFigures(series));
  const year = $derived(spansYears(series.passes.map((pass) => pass.date)));
  const newest = $derived(series.passes.at(-1) ?? null);
  const shownAreas = $derived(only ? areas.filter((area) => area.id === only) : areas);
  const byArea = $derived(mode === 'area' && !only && areas.length > 1);
  const kinds = $derived(categoryCounts(series.spots));
  const widest = $derived(Math.max(1, ...CATEGORIES.map((entry) => kinds[entry.id])));
  const fresh = $derived(freshness(detection.lastPass));
  const span = $derived(figures.first === figures.last ? shortDay(figures.last, true)
    : `${shortDay(figures.first, year)} → ${shortDay(figures.last, true)}`);

  // each tab opens at its top, whatever the other was scrolled to
  let body = $state(null);
  $effect(() => {
    void tab;
    if (body) body.scrollTop = 0;
  });

  function showKind(id) {
    filter = id;
    tab = 'spots';
  }
</script>

<Modal title={`${detection.title}, dashboard`} bare width="min(1280px, calc(100vw - 48px))" {onclose}>
  <div class="dashboard" style:--tint={detection.colour || 'var(--accent)'}>
    <header class="top">
      <div class="title">
        <h2><span class="swatch" aria-hidden="true"></span>{detection.title}</h2>
        <p>
          {[detection.analyzer, plural(detection.areas ?? areas.length, 'area'), ruleLabel(detection.date_rule, single)].filter(Boolean).join(' · ')}
          {#if fresh.text}<span class:stale={fresh.stale}> · last pass read {fresh.text}</span>{/if}
        </p>
      </div>
      <div class="cmp-seg tabs" role="tablist" aria-label="What to show">
        <button role="tab" aria-selected={tab === 'overview'} class:on={tab === 'overview'} onclick={() => (tab = 'overview')}>Overview</button>
        <button role="tab" aria-selected={tab === 'spots'} class:on={tab === 'spots'} onclick={() => (tab = 'spots')}>
          Spots <small>{series.spots.length}</small>
        </button>
      </div>
      <div class="end">
        <SeriesExport {series} title={detection.title} areas={areas.map((area) => ({ ...area, colour: colours[area.id] }))}
          {offers} {busy} label="Export" {onlayer} />
        <button class="cmp-icon" aria-label="Close" title="Close (Esc)" onclick={onclose}><Icon name="x" size={16} /></button>
      </div>
    </header>

    {#if areas.length > 1}
      <div class="areas" role="group" aria-label="Areas shown">
        <button class="area" class:on={!only} aria-pressed={!only} onclick={() => (only = null)}>All areas</button>
        {#each areas as area (area.id)}
          <button class="area" class:on={only === area.id} aria-pressed={only === area.id} title={area.name}
            onclick={() => (only = only === area.id ? null : area.id)}>
            <span class="dot" style:background={colours[area.id]} aria-hidden="true"></span><span class="name">{area.name}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="body" bind:this={body}>
      {#if tab === 'overview'}
        <div class="tiles">
          <div class="tile">
            <span class="figure">{figures.passes}</span>
            <span class="what">{figures.passes === 1 ? 'pass read' : 'passes read'}</span>
            <small>{span}</small>
          </div>
          <div class="tile">
            <span class="figure">{figures.candidates}</span>
            <span class="what">candidates found</span>
            <small class:review={figures.toReview}>{figures.toReview ? `${figures.toReview} to review` : 'all reviewed'}</small>
          </div>
          <button class="tile press" onclick={() => showKind('all')} title="List the spots">
            <span class="figure">{figures.spots}</span>
            <span class="what">spots</span>
            <small>{figures.steady} regular · within {series.radius} m</small>
          </button>
          <button class="tile press" onclick={() => onopenrun(newest)} title="Open the newest pass">
            <span class="figure">{figures.newest}</span>
            <span class="what">on {shortDay(figures.last, true)}</span>
            <small>{#if newest?.compared}<span class="up">+{figures.arrived} appeared</span> · <span class="down">−{figures.left} left</span>{:else}its first pass{/if}</small>
          </button>
        </div>

        <section class="card wide">
          <header>
            <h3>Candidates per pass</h3>
            {#if !only && areas.length > 1}
              <div class="cmp-seg small" role="group" aria-label="Bars">
                <button class:on={mode === 'total'} aria-pressed={mode === 'total'} onclick={() => (mode = 'total')}>Total</button>
                <button class:on={mode === 'area'} aria-pressed={mode === 'area'} onclick={() => (mode = 'area')}>By area</button>
              </div>
            {/if}
          </header>
          <SeriesBars passes={series.passes} height={260} mode={byArea ? 'area' : 'total'} areaIds={shownAreas.map((area) => area.id)}
            {colours} {names} onpick={(pass) => onopenrun(pass)} label="Candidates per pass" />
          <div class="legend">
            {#if byArea}
              {#each areas as area (area.id)}<span><i style:background={colours[area.id]}></i>{area.name}</span>{/each}
            {:else}
              <span><i class="info"></i>Candidates{only ? ` in ${names[only]}` : ''}</span>
            {/if}
            {#if figures.toReview}<span><i class="accent"></i>To review</span>{/if}
            <span class="aside">Press a column to open its pass</span>
          </div>
        </section>

        <div class="pair">
          <section class="card">
            <header><h3>Spots that appeared and left</h3></header>
            {#if series.passes.some((pass) => pass.compared)}
              <SeriesBars kind="change" height={190} passes={series.passes} areaIds={shownAreas.map((area) => area.id)} {names}
                onpick={(pass) => onopenrun(pass)} label="Spots that appeared and left" />
              <div class="legend">
                <span><i class="ok"></i>Appeared</span><span><i class="danger"></i>Left</span>
                <span class="aside">Against the pass before that read the same area</span>
              </div>
            {:else}
              <p class="hint">One pass so far: nothing to compare it with yet.</p>
            {/if}
          </section>

          <section class="card">
            <header><h3>Spots by kind</h3></header>
            <div class="kinds">
              {#each CATEGORIES as entry (entry.id)}
                <button class={`kind-row ${entry.id}`} disabled={!kinds[entry.id]} title={entry.rule} onclick={() => showKind(entry.id)}>
                  <span class="kind-name">{entry.label}</span>
                  <span class="kind-bar"><span style:width={`${(kinds[entry.id] / widest) * 100}%`}></span></span>
                  <span class="kind-count">{kinds[entry.id]}</span>
                </button>
              {/each}
            </div>
            {#if newest?.compared && (newest.arrived.length || newest.left.length)}
              <div class="newest">
                <h4>On {shortDay(newest.date, true)}</h4>
                {#if newest.arrived.length}
                  <div class="spot-chips"><span class="lead up">Appeared</span>
                    {#each newest.arrived as id (id)}
                      <button class="spot-chip up" onclick={() => { selectedSpot = id; filter = 'all'; tab = 'spots'; }}>{id}</button>
                    {/each}
                  </div>
                {/if}
                {#if newest.left.length}
                  <div class="spot-chips"><span class="lead down">Left</span>
                    {#each newest.left as id (id)}
                      <button class="spot-chip down" onclick={() => { selectedSpot = id; filter = 'all'; tab = 'spots'; }}>{id}</button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </section>
        </div>
      {:else}
        <SeriesSpots {series} {colours} {names} {busy} bind:radius bind:filter bind:selected={selectedSpot}
          onshow={onshowspot} onopen={onopenspot} {onverdict} />
      {/if}
    </div>
  </div>
</Modal>

<style>
  /* The window sits outside the dock, so it names the dock's tokens itself. */
  .dashboard {
    --glass-line: var(--border);
    --glass-hover: var(--bg-2);
    --glass-ink: var(--text-1);
    --glass-muted: var(--text-2);
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: min(860px, calc(100vh - 80px));
    color: var(--text-1);
  }
  .top {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 16px;
    padding: 16px 18px 12px 22px;
    border-bottom: 1px solid var(--border);
  }
  .title { min-width: 0; }
  h2 { display: flex; align-items: center; gap: 10px; margin: 0; font-size: var(--fs-lg); font-weight: 700; }
  .swatch { flex: none; width: 4px; height: 18px; border-radius: 2px; background: var(--tint); }
  .title p { margin: 4px 0 0 14px; overflow: hidden; color: var(--text-3); font-size: var(--fs-xs); text-overflow: ellipsis; white-space: nowrap; }
  .title p .stale { color: var(--warn); }
  .tabs > button { min-height: 28px; padding: 0 14px; }
  .tabs small { margin-left: 4px; color: var(--text-3); font-variant-numeric: tabular-nums; }
  .end { display: flex; align-items: center; gap: 6px; }
  .areas { display: flex; flex: none; gap: 5px; overflow-x: auto; padding: 10px 22px 0; scrollbar-width: thin; }
  .area {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 6px;
    max-width: 220px;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 99px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .area:hover { border-color: var(--border-strong); color: var(--text-1); }
  .area.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text-1); }
  .area .dot { flex: none; width: 8px; height: 8px; border-radius: 2px; }
  .area .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .body { display: grid; flex: 1; align-content: start; gap: 14px; min-height: 0; overflow-y: auto; padding: 14px 22px 22px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
  .tile {
    display: grid;
    align-content: start;
    gap: 2px;
    min-width: 0;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--bg-2);
    text-align: left;
  }
  .tile.press:hover { border-color: var(--border-strong); background: var(--bg-3); }
  .figure { color: var(--text-1); font-size: 1.9rem; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .what { color: var(--text-2); font-size: var(--fs-sm); }
  .tile small { overflow: hidden; color: var(--text-3); font-size: var(--fs-xs); text-overflow: ellipsis; white-space: nowrap; }
  .tile small.review { color: var(--accent); font-weight: 600; }
  .up { color: var(--ok); font-weight: 650; }
  .down { color: var(--danger); font-weight: 650; }
  .card { display: grid; align-content: start; gap: 10px; min-width: 0; padding: 14px 16px 12px; border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--bg-0); }
  .card header { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 26px; }
  h3 { margin: 0; font-size: var(--fs-md); font-weight: 650; }
  h4 { margin: 0 0 6px; color: var(--text-2); font-size: var(--fs-xs); font-weight: 600; }
  .cmp-seg.small > button { min-height: 24px; padding: 0 10px; font-size: var(--fs-xs); }
  .pair { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(260px, 1fr); gap: 14px; }
  @media (max-width: 980px) { .pair { grid-template-columns: minmax(0, 1fr); } }
  .legend { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; color: var(--text-2); font-size: var(--fs-xs); }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 2px; }
  .legend i.info { background: var(--info); }
  .legend i.accent { background: var(--accent); }
  .legend i.ok { background: var(--ok); }
  .legend i.danger { background: var(--danger); }
  .legend .aside { margin-left: auto; color: var(--text-3); }
  .kinds { display: grid; gap: 4px; }
  .kind-row {
    display: grid;
    grid-template-columns: 118px minmax(0, 1fr) 34px;
    align-items: center;
    gap: 10px;
    padding: 5px 6px;
    border-radius: var(--r-sm);
    font-size: var(--fs-xs);
    text-align: left;
  }
  .kind-row:hover:not(:disabled) { background: var(--bg-2); }
  .kind-row:disabled { opacity: 0.45; cursor: default; }
  .kind-name { color: var(--c); font-weight: 600; }
  .kind-bar { height: 8px; border-radius: 99px; background: var(--bg-3); overflow: hidden; }
  .kind-bar span { display: block; height: 100%; border-radius: 99px; background: var(--c); }
  .kind-count { color: var(--text-1); font-weight: 650; font-variant-numeric: tabular-nums; text-align: right; }
  .kind-row.new { --c: var(--ok); }
  .kind-row.gone { --c: var(--danger); }
  .kind-row.steady { --c: var(--info); }
  .kind-row.once { --c: var(--text-2); }
  .kind-row.mixed { --c: var(--warn); }
  .newest { padding-top: 10px; border-top: 1px solid var(--border); }
  .spot-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-bottom: 5px; }
  .spot-chips .lead { min-width: 70px; font-size: var(--fs-xs); }
  .spot-chip { height: 24px; padding: 0 9px; border-radius: 99px; font-size: var(--fs-xs); font-weight: 650; font-variant-numeric: tabular-nums; }
  .spot-chip.up { background: var(--ok-soft); color: var(--ok); }
  .spot-chip.down { background: var(--danger-soft); color: var(--danger); }
  .spot-chip:hover { outline: 1px solid currentColor; }
  .hint { margin: 0; color: var(--text-3); font-size: var(--fs-xs); }
</style>
