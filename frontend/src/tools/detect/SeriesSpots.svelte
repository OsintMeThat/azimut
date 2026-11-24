<script>
  /**
   * A routine's spots as a matrix: one row a spot, one column a pass, each cell
   * saying whether the spot was seen on it. Filters narrow them to what came,
   * what went, what stays; a verdict on a row reaches all of its candidates at
   * once, which is the reason for reading them as spots at all.
   *
   * The grouping rule is on screen and can be changed: it groups, it never hides
   * a candidate or judges one. Drawn a page at a time, so a base with thousands of
   * spots opens as quickly as one with ten.
   */
  import Icon from '../../components/Icon.svelte';
  import { CATEGORIES, RADII, categoryCounts, presenceLine, shortDay, spansYears } from '../../lib/map/detectSeries.js';
  import { plural } from '../../lib/map/detections.js';

  let {
    series,
    colours = {},
    names = {},
    radius = $bindable(40),
    filter = $bindable('all'),
    selected = $bindable(null),
    busy = false,
    /** Put the map on a spot, leaving the dashboard. */
    onshow = () => {},
    /** Open the pass a spot was seen on, at that candidate. */
    onopen = () => {},
    onverdict = () => {},
  } = $props();

  /** Rows drawn at a time: enough for a busy base, light on a big one. */
  const PAGE = 60;
  let limit = $state(PAGE);

  const counts = $derived(categoryCounts(series.spots));
  const chips = $derived([{ id: 'all', label: 'All', rule: '' }, ...CATEGORIES].filter((chip) => chip.id === 'all' || counts[chip.id]));
  const listed = $derived(filter === 'all' ? series.spots : series.spots.filter((spot) => spot.category === filter));
  const shown = $derived(listed.slice(0, limit));
  const rule = $derived(CATEGORIES.find((entry) => entry.id === filter)?.rule ?? '');
  const year = $derived(spansYears(series.passes.map((pass) => pass.date)));
  const label = Object.fromEntries(CATEGORIES.map((entry) => [entry.id, entry.label]));
  const manyAreas = $derived(Object.keys(names).length > 1);
  const open = (spot) => spot.verdicts.toReview;
  const passes = $derived(series.passes.length);
  /** A day over every k-th column, so the dates never touch. */
  const every = $derived(Math.max(1, Math.ceil(passes / 14)));

  // a spot picked on the map past the rows drawn brings its page in
  $effect(() => {
    const at = selected ? listed.findIndex((spot) => spot.id === selected) : -1;
    if (at >= limit) limit = Math.ceil((at + 1) / PAGE) * PAGE;
  });
  // a filter that empties falls back to every spot rather than an empty list
  $effect(() => { if (filter !== 'all' && !counts[filter]) filter = 'all'; });

  function cellTitle(spot, at) {
    const state = spot.presence[at];
    return `${spot.id} · ${shortDay(series.passes[at].date, true)}: ${state === 'present' ? 'seen, press to open' : state === 'absent' ? 'looked at, not seen' : 'area not read that day'}`;
  }

  function cell(event, spot, at) {
    event.stopPropagation();
    const member = spot.members.find((entry) => entry.at === at);
    if (member) onopen(spot, member);
    else selected = spot.id;
  }
</script>

<div class="spots" style:--n={passes} class:areas={manyAreas}>
  <div class="tools">
    <div class="chips" role="group" aria-label="Show spots">
      {#each chips as chip (chip.id)}
        <button class="chip" class:on={filter === chip.id} aria-pressed={filter === chip.id} title={chip.rule || 'Every spot'}
          onclick={() => { filter = chip.id; limit = PAGE; }}>
          <span class={`dot ${chip.id}`} aria-hidden="true"></span>{chip.label}<small>{counts[chip.id]}</small>
        </button>
      {/each}
    </div>
    <label class="radius" title="Candidates this near on two passes count as one spot">
      <span>Same spot within</span>
      <select bind:value={radius} aria-label="Same spot within">
        {#each RADII as metres (metres)}<option value={metres}>{metres} m</option>{/each}
      </select>
    </label>
  </div>
  <p class="rule">{rule ? `${rule}.` : `Candidates within ${series.radius} m on two passes are one spot. A filled cell was seen; an empty one looked at and empty; a hatched one not read that day.`}</p>

  {#if !series.spots.length}
    <p class="hint">No candidate left in this routine's passes. Spots gather what its runs find.</p>
  {:else}
    <div class="matrix" role="table" aria-label="Spots by pass">
      <div class="line head" role="row">
        <span role="columnheader">Spot</span>
        <span role="columnheader">Kind</span>
        {#if manyAreas}<span role="columnheader">Area</span>{/if}
        <span class="days" role="columnheader" aria-label="Passes">
          {#each series.passes as pass, at (pass.id)}
            <span class="day">{at % every === 0 || at === passes - 1 ? shortDay(pass.date, year && at === 0) : ''}</span>
          {/each}
        </span>
        <span role="columnheader" class="num">Seen</span>
        <span role="columnheader">First → last</span>
        <span role="columnheader"></span>
      </div>
      {#each shown as spot (spot.id)}
        {@const tint = colours[spot.areaId] ?? 'var(--info)'}
        <div class="line spot" class:on={selected === spot.id} style:--tint={tint} role="row" tabindex="0"
          aria-selected={selected === spot.id}
          onclick={() => (selected = selected === spot.id ? null : spot.id)}
          onkeydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selected = spot.id; } }}>
          <strong class="id" role="cell">{spot.id}</strong>
          <span class={`kind ${spot.category}`} role="cell">{label[spot.category]}</span>
          {#if manyAreas}<span class="area" role="cell" title={names[spot.areaId]}>{names[spot.areaId] ?? 'Area'}</span>{/if}
          <span class="strip" class:dense={passes > 40} role="cell" title={presenceLine(spot.presence)}>
            {#each spot.presence as state, at (at)}
              <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
              <span class={`cell ${state}`} title={cellTitle(spot, at)} onclick={(event) => cell(event, spot, at)}></span>
            {/each}
          </span>
          <span class="num" role="cell">{spot.seen}/{spot.read}</span>
          <span class="when" role="cell">
            {spot.first === spot.last ? shortDay(spot.first, year) : `${shortDay(spot.first, year)} → ${shortDay(spot.last, year)}`}
            {#if spot.verdicts.pinned}<span class="tag pinned">{spot.verdicts.pinned} pinned</span>{/if}
            {#if open(spot)}<span class="tag review">{spot.verdicts.toReview} to review</span>{/if}
          </span>
          <span class="acts" role="cell">
            <button class="cmp-icon" title="Show it on the map" aria-label={`Show ${spot.id} on the map`}
              onclick={(event) => { event.stopPropagation(); onshow(spot); }}><Icon name="crosshair" size={13} /></button>
            <button class="cmp-icon" disabled={busy || !open(spot)} title={open(spot) ? 'Keep its candidates here' : 'All kept or pinned'}
              aria-label={`Keep ${spot.id} here`} onclick={(event) => { event.stopPropagation(); onverdict([spot], 'noted'); }}><Icon name="check" size={13} /></button>
            <button class="cmp-icon" disabled={busy || spot.verdicts.pinned === spot.verdicts.total}
              title="Dismiss its candidates from every pass" aria-label={`Dismiss ${spot.id}`}
              onclick={(event) => { event.stopPropagation(); onverdict([spot], 'dismissed'); }}><Icon name="x" size={13} /></button>
          </span>
        </div>
      {/each}
    </div>
    <div class="foot">
      {#if listed.length > shown.length}
        <button class="btn btn-sm" onclick={() => (limit += PAGE)}>
          Show {Math.min(PAGE, listed.length - shown.length)} more of {listed.length - shown.length}
        </button>
      {/if}
      <span class="count">{plural(listed.length, 'spot')}</span>
      {#if listed.length > 1}
        <span class="bulk">
          <button class="btn btn-sm" disabled={busy || !listed.some(open)} onclick={() => onverdict(listed, 'noted')}>
            Keep these {listed.length} here
          </button>
          <button class="btn btn-sm" disabled={busy} onclick={() => onverdict(listed, 'dismissed')}>Dismiss these {listed.length}…</button>
        </span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .spots { display: grid; gap: 10px; min-width: 0; }
  .tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
  .radius { display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); font-size: var(--fs-xs); }
  .radius select { height: 26px; padding: 0 6px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); color: var(--text-1); font-size: var(--fs-xs); }
  .count { color: var(--text-3); font-size: var(--fs-xs); }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 99px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .chip small { color: var(--text-3); font-variant-numeric: tabular-nums; }
  .chip:hover { border-color: var(--border-strong); color: var(--text-1); }
  .chip.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text-1); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--c, var(--text-3)); }
  .dot.all { display: none; }
  .dot.new, .kind.new { --c: var(--ok); }
  .dot.gone, .kind.gone { --c: var(--danger); }
  .dot.steady, .kind.steady { --c: var(--info); }
  .dot.once, .kind.once { --c: var(--text-3); }
  .dot.mixed, .kind.mixed { --c: var(--warn); }
  .rule { margin: -2px 0 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.45; }

  /* no overflow clip here: the head row sticks to the top of the window's scroll */
  .matrix { display: grid; min-width: 0; border: 1px solid var(--border); border-radius: var(--r-lg); }
  .line {
    display: grid;
    grid-template-columns: 56px 116px minmax(160px, 1fr) 54px 190px 96px;
    align-items: center;
    gap: 12px;
    min-height: 34px;
    padding: 0 10px 0 14px;
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-xs);
  }
  .areas .line { grid-template-columns: 56px 116px 150px minmax(160px, 1fr) 54px 190px 96px; }
  .line:last-child { border-bottom: none; }
  .head {
    position: sticky;
    top: -14px;
    z-index: 1;
    border-radius: var(--r-lg) var(--r-lg) 0 0;
    min-height: 30px;
    background: var(--bg-2);
    color: var(--text-3);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }
  .days { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 2px; text-transform: none; letter-spacing: 0; font-weight: 500; }
  .day { overflow: visible; white-space: nowrap; font-size: 10px; }
  .spot { position: relative; cursor: pointer; }
  .spot::before { position: absolute; top: 7px; bottom: 7px; left: 0; width: 3px; border-radius: 0 2px 2px 0; background: var(--tint); content: ''; }
  .spot:hover { background: var(--bg-2); }
  .spot.on { background: var(--accent-soft); }
  .spot:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
  .id { color: var(--text-1); font-size: var(--fs-sm); font-variant-numeric: tabular-nums; }
  .kind { color: var(--c); font-weight: 600; }
  .area { overflow: hidden; color: var(--text-2); text-overflow: ellipsis; white-space: nowrap; }
  .num { color: var(--text-2); font-variant-numeric: tabular-nums; text-align: right; }
  .head .num { text-align: right; }
  .when { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; color: var(--text-2); }
  .strip { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 2px; height: 14px; }
  .strip.dense { gap: 0; }
  .cell { border-radius: 2px; background: color-mix(in srgb, var(--text-3) 18%, transparent); }
  .strip.dense .cell { border-radius: 0; }
  .cell.present { background: var(--tint); cursor: pointer; }
  .cell.present:hover { outline: 1px solid var(--text-1); outline-offset: 1px; }
  .cell.unread { background: repeating-linear-gradient(135deg, transparent 0 2px, color-mix(in srgb, var(--text-3) 30%, transparent) 2px 3px); }
  .tag { padding: 0 6px; border-radius: 99px; font-size: 10px; font-weight: 600; line-height: 16px; white-space: nowrap; }
  .tag.pinned { background: var(--ok-soft); color: var(--ok); }
  .tag.review { background: var(--accent-soft); color: var(--accent); }
  .acts { display: flex; justify-content: flex-end; gap: 0; opacity: 0.4; transition: opacity 120ms var(--ease); }
  .acts .cmp-icon { width: 28px; height: 28px; }
  .spot:hover .acts, .spot.on .acts, .acts:focus-within { opacity: 1; }
  .foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
  .bulk { display: flex; gap: 6px; margin-left: auto; }
</style>
