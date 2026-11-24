<script>
  /**
   * A routine's spots, one row each: where candidates keep coming back to, with
   * a cell a pass saying whether it was there. Filters narrow them to what came,
   * what went, what stays; a verdict on a row reaches all of its candidates at
   * once, which is the reason for reading them as spots at all.
   *
   * The grouping rule is on screen and can be changed: it groups, it never
   * hides a candidate or judges one.
   */
  import Icon from '../../components/Icon.svelte';
  import { CATEGORIES, RADII, categoryCounts, presenceLine, shortDay, spansYears } from '../../lib/map/detectSeries.js';
  import { passCount, plural } from '../../lib/map/detections.js';

  let {
    series,
    colours = {},
    names = {},
    radius = $bindable(40),
    filter = $bindable('all'),
    selected = $bindable(null),
    busy = false,
    onselect = () => {},
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
  const open = (spot) => spot.verdicts.toReview;

  // a spot picked on the map past the rows drawn brings its page in
  $effect(() => {
    const at = selected ? listed.findIndex((spot) => spot.id === selected) : -1;
    if (at >= limit) limit = Math.ceil((at + 1) / PAGE) * PAGE;
  });
  // a filter that empties falls back to every spot rather than an empty list
  $effect(() => { if (filter !== 'all' && !counts[filter]) filter = 'all'; });

  function pick(spot) {
    selected = selected === spot.id ? null : spot.id;
    if (selected) onselect(spot);
  }

  function cellTitle(spot, at) {
    const pass = series.passes[at];
    const state = spot.presence[at];
    return `${spot.id} · ${shortDay(pass.date, true)}: ${state === 'present' ? 'seen, press to open' : state === 'absent' ? 'looked at, not seen' : 'area not read that day'}`;
  }

  function cell(event, spot, at) {
    event.stopPropagation();
    const member = spot.members.find((entry) => entry.at === at);
    if (member) onopen(spot, member);
    else pick(spot);
  }
</script>

<div class="spots">
  <div class="tools">
    <label class="radius" title="Candidates this near on two passes count as one spot">
      <span>Same spot within</span>
      <select bind:value={radius} aria-label="Same spot within">
        {#each RADII as metres (metres)}<option value={metres}>{metres} m</option>{/each}
      </select>
    </label>
    <span class="count">{plural(listed.length, 'spot')}</span>
  </div>

  <div class="chips" role="group" aria-label="Show spots">
    {#each chips as chip (chip.id)}
      <button class="chip" class:on={filter === chip.id} aria-pressed={filter === chip.id} title={chip.rule || 'Every spot'}
        onclick={() => { filter = chip.id; limit = PAGE; }}>
        <span class={`dot ${chip.id}`} aria-hidden="true"></span>{chip.label}<small>{counts[chip.id]}</small>
      </button>
    {/each}
  </div>
  {#if rule}<p class="rule">{rule}.</p>{/if}

  {#if !series.spots.length}
    <p class="hint">No candidate left in this routine's passes. Spots gather what its runs find.</p>
  {:else}
    <div class="scale" aria-hidden="true">
      <span>{shortDay(series.passes[0]?.date, year)}</span>
      <span>{passCount(series.passes.length)}</span>
      <span>{shortDay(series.passes.at(-1)?.date, year)}</span>
    </div>
    <ul class="rows">
      {#each shown as spot (spot.id)}
        {@const tint = colours[spot.areaId] ?? 'var(--info)'}
        <li class="spot-row" class:on={selected === spot.id} style:--tint={tint}>
          <button class="main" onclick={() => pick(spot)} aria-pressed={selected === spot.id}
            aria-label={`${spot.id}, ${label[spot.category]}, seen on ${spot.seen} of ${spot.read} passes, ${names[spot.areaId] ?? ''}`}>
            <span class="name">
              <strong>{spot.id}</strong>
              <span class={`kind ${spot.category}`}>{label[spot.category]}</span>
              <span class="seen">{spot.seen}/{spot.read}</span>
            </span>
            <span class="strip" class:dense={series.passes.length > 40} style:--n={series.passes.length} title={presenceLine(spot.presence)}>
              {#each spot.presence as state, at (at)}
                <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
                <span class={`cell ${state}`} title={cellTitle(spot, at)} onclick={(event) => cell(event, spot, at)}></span>
              {/each}
            </span>
            <span class="where">
              {names[spot.areaId] ?? 'Area'} · {spot.first === spot.last ? shortDay(spot.first, year) : `${shortDay(spot.first, year)} → ${shortDay(spot.last, year)}`}
              {#if spot.verdicts.pinned}<span class="tag pinned">{spot.verdicts.pinned} pinned</span>{/if}
              {#if open(spot)}<span class="tag review">{spot.verdicts.toReview} to review</span>{/if}
            </span>
          </button>
          <span class="acts">
            <button class="cmp-icon" disabled={busy || !open(spot)} title={open(spot) ? 'Keep its candidates here' : 'All kept or pinned'}
              aria-label={`Keep ${spot.id} here`} onclick={() => onverdict([spot], 'noted')}><Icon name="check" size={13} /></button>
            <button class="cmp-icon" disabled={busy || spot.verdicts.pinned === spot.verdicts.total}
              title="Dismiss its candidates from every pass" aria-label={`Dismiss ${spot.id}`}
              onclick={() => onverdict([spot], 'dismissed')}><Icon name="x" size={13} /></button>
          </span>
        </li>
      {/each}
    </ul>
    {#if listed.length > shown.length}
      <button class="btn btn-sm more" onclick={() => (limit += PAGE)}>
        Show {Math.min(PAGE, listed.length - shown.length)} more of {listed.length - shown.length}
      </button>
    {/if}
    {#if listed.length > 1}
      <div class="bulk">
        <button class="btn btn-sm" disabled={busy || !listed.some(open)} onclick={() => onverdict(listed, 'noted')}>
          Keep these {listed.length} here
        </button>
        <button class="btn btn-sm" disabled={busy} onclick={() => onverdict(listed, 'dismissed')}>Dismiss these {listed.length}…</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .spots { display: grid; gap: 8px; min-width: 0; }
  .tools { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .radius { display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); font-size: var(--fs-xs); }
  .radius select { height: 24px; padding: 0 4px; font-size: var(--fs-xs); }
  .count { color: var(--text-3); font-size: var(--fs-xs); }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: 99px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .chip small { color: var(--text-3); font-variant-numeric: tabular-nums; }
  .chip:hover { border-color: var(--border-strong); color: var(--text-1); }
  .chip.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text-1); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); }
  .dot.all { display: none; }
  .dot.new, .kind.new { --c: var(--ok); }
  .dot.gone, .kind.gone { --c: var(--danger); }
  .dot.steady, .kind.steady { --c: var(--info); }
  .dot.once, .kind.once { --c: var(--text-3); }
  .dot.mixed, .kind.mixed { --c: var(--warn); }
  .dot { background: var(--c); }
  .rule { margin: -2px 0 0; color: var(--text-3); font-size: var(--fs-xs); }
  .scale {
    display: flex;
    justify-content: space-between;
    padding: 0 40px 0 10px;
    color: var(--text-3);
    font-size: 10px;
  }
  .rows { display: grid; gap: 0; margin: 0; padding: 0; list-style: none; border-top: 1px solid var(--border); }
  .spot-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 2px;
    border-bottom: 1px solid var(--border);
  }
  .spot-row::before { position: absolute; top: 8px; bottom: 8px; left: 0; width: 3px; border-radius: 2px; background: var(--tint); content: ''; }
  .spot-row:hover, .spot-row.on { background: var(--bg-2); }
  .spot-row.on { box-shadow: inset 0 0 0 1px var(--accent); }
  .main { display: grid; flex: 1 1 auto; gap: 5px; min-width: 0; padding: 8px 4px 8px 10px; text-align: left; }
  .name { display: flex; align-items: baseline; gap: 7px; min-width: 0; font-size: var(--fs-xs); }
  .name strong { color: var(--text-1); font-size: var(--fs-sm); font-variant-numeric: tabular-nums; }
  .kind { color: var(--c); font-weight: 600; }
  .seen { margin-left: auto; color: var(--text-3); font-variant-numeric: tabular-nums; }
  /* the strip always fits its row: past forty passes the cells close up into a barcode */
  .strip { display: grid; grid-template-columns: repeat(var(--n), minmax(0, 1fr)); gap: 2px; height: 12px; }
  .strip.dense { gap: 0; }
  .strip.dense .cell { border-radius: 0; }
  .cell { border-radius: 2px; background: color-mix(in srgb, var(--text-3) 18%, transparent); }
  .cell.present { background: var(--tint); cursor: pointer; }
  .cell.present:hover { outline: 1px solid var(--text-1); outline-offset: 1px; }
  .cell.unread {
    background: repeating-linear-gradient(135deg, transparent 0 2px, color-mix(in srgb, var(--text-3) 30%, transparent) 2px 3px);
  }
  .where { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; color: var(--text-3); font-size: 10.5px; }
  .tag { padding: 0 5px; border-radius: 99px; font-size: 10px; font-weight: 600; line-height: 15px; }
  .tag.pinned { background: var(--ok-soft); color: var(--ok); }
  .tag.review { background: var(--accent-soft); color: var(--accent); }
  .acts { display: flex; flex: none; flex-direction: column; gap: 2px; padding-right: 2px; opacity: 0.35; transition: opacity 120ms var(--ease); }
  .spot-row:hover .acts, .spot-row.on .acts, .acts:focus-within { opacity: 1; }
  .more { justify-self: start; }
  .bulk { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 4px; }
</style>
