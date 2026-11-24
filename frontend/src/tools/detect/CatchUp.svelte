<script>
  /**
   * The passes a routine missed, ticked to be read one run each, oldest first.
   *
   * Nothing is asked of Copernicus until "Look for passes" is pressed: the lookup
   * is one catalogue request over the routine's areas. The passes the rule would
   * take are ticked; the cloudier ones, the ones covering part of the areas and
   * the gaps between two passes already read stay listed for the analyst to tick.
   * The button says how many runs it starts and about how many tiles each reads,
   * since that is what the quota pays for.
   */
  import { api } from '../../lib/api.js';
  import { acquisitionQuery, coverLabel, passKey } from '../../lib/map/acquisitions.js';
  import { MAX_CATCH_UP, catchUpSpan, chosenPasses, missedPasses, whyLabel } from '../../lib/map/detectCatchUp.js';
  import { shortDay } from '../../lib/map/detectSeries.js';
  import { passCount, plural } from '../../lib/map/detections.js';
  import { cloudClass } from '../../lib/sentinel.js';
  import { orbitMark } from '../../lib/radar.js';
  import Icon from '../../components/Icon.svelte';

  let {
    routine,
    /** The routine as saved, with its areas: `zones`, `b.maxcc`, `date_rule`, `a`. */
    detail,
    sensor = 'sentinel2',
    single = false,
    /** The days its runs read, and the radar track of the newest. */
    readDays = [],
    track = '',
    /** Tiles the newest run read, for the cost line. */
    tiles = 0,
    busy = false,
    onshow = () => {},
    onqueue = () => {},
  } = $props();

  const radar = $derived(sensor === 'sentinel1');
  const maxcc = $derived(radar ? 100 : Number(detail?.area_dates?.[0]?.b?.maxcc ?? detail?.b?.maxcc ?? 100));
  const span = $derived(catchUpSpan(readDays));
  let rows = $state(null);
  let ticked = $state(new Set());
  let looking = $state(false);
  let error = $state('');
  let truncated = $state(false);

  async function look() {
    looking = true; error = '';
    try {
      const found = await api.post('/api/satellite/sentinel/acquisitions', acquisitionQuery(detail.zones ?? [], span, new Date(), sensor));
      rows = missedPasses(found.dates ?? [], readDays, { maxcc, radar, track });
      truncated = !!found.truncated;
      ticked = new Set(rows.filter((row) => row.picked).map(passKey));
    } catch (e) {
      error = e.message;
    } finally {
      looking = false;
    }
  }

  function toggle(row) {
    const next = new Set(ticked);
    const key = passKey(row);
    if (next.has(key)) next.delete(key);
    else if (next.size < MAX_CATCH_UP) next.add(key);
    ticked = next;
  }

  const chosen = $derived(rows ? chosenPasses(rows, ticked) : []);
  const missed = $derived(rows ? rows.filter((row) => !row.read) : []);
  const reference = $derived(single ? '' : detail?.date_rule === 'latest_previous'
    ? 'Each compares with the pass before it.'
    : `Each compares with ${shortDay(detail?.area_dates?.[0]?.a?.date ?? detail?.a?.date, true) || 'its reference'}.`);
  const months = $derived.by(() => {
    const groups = [];
    for (const row of rows ?? []) {
      const month = row.date.slice(0, 7);
      if (groups.at(-1)?.month !== month) groups.push({ month, rows: [] });
      groups.at(-1).rows.push(row);
    }
    return groups;
  });
  const monthName = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
</script>

<div class="cmp-dock-body catch">
  <section class="lead">
    <h3>Catch up on missed passes</h3>
    <p>
      {readDays.length ? `Passes over its areas since ${shortDay(span.start, true)}, the first one it read.` : `Passes over its areas in the last month.`}
      Each pass you tick is read as one run, oldest first. {reference}
    </p>
    {#if !rows}
      <button class="btn btn-primary" disabled={looking || busy || !detail?.zones?.length} onclick={look}>
        <Icon name="search" size={13} /> {looking ? 'Looking…' : 'Look for passes'}
      </button>
      <p class="fine">One request to the Copernicus catalogue. No picture is read until you start the runs.</p>
    {/if}
    {#if error}<p class="warn" role="alert">{error}</p>{/if}
  </section>

  {#if rows}
    {#if !rows.length}
      <p class="hint">No pass flew over these areas in that time.</p>
    {:else}
      <div class="summary">
        <span><strong>{missed.length}</strong> {missed.length === 1 ? 'pass' : 'passes'} not read</span>
        <span><strong>{rows.length - missed.length}</strong> read</span>
        <button class="link" onclick={() => (ticked = new Set(missed.slice(0, MAX_CATCH_UP).map(passKey)))}>Tick all</button>
        <button class="link" onclick={() => (ticked = new Set())}>None</button>
      </div>
      <div class="months">
        {#each months as group (group.month)}
          <div class="month">
            <h4>{monthName(group.month)}</h4>
            {#each group.rows as row (passKey(row))}
              {@const on = ticked.has(passKey(row))}
              <div class="pass" class:read={row.read} class:on>
                <label class="tick">
                  <input type="checkbox" checked={on || row.read} disabled={row.read || busy} onchange={() => toggle(row)}
                    aria-label={`Read ${row.date}`} />
                  <span class="day">{shortDay(row.date)}</span>
                  {#if radar && row.time}<span class="time">{row.time.slice(0, 5)} UTC {orbitMark(row.orbit)}</span>{/if}
                </label>
                {#if row.read}
                  <span class="state done"><Icon name="check" size={11} /> read</span>
                {:else}
                  {#if !radar}<span class={`cloud ${cloudClass(row.cloud)}`}>{row.cloud == null ? '?' : `${Math.round(row.cloud)}%`}</span>{/if}
                  {#if row.why}<span class="state why">{whyLabel(row, maxcc)}</span>
                  {:else if row.gap}<span class="state gap">missed between two runs</span>
                  {:else}<span class="state">{coverLabel(row.coverage) || ''}</span>{/if}
                {/if}
                <button class="cmp-icon look" title="Show this pass on the map" aria-label={`Show ${row.date} on the map`}
                  onclick={() => onshow({ provider: sensor, date: row.date, time: row.time ?? '', cloud: row.cloud ?? null, side: 'B' })}>
                  <Icon name="eye" size={13} />
                </button>
              </div>
            {/each}
          </div>
        {/each}
      </div>
      {#if truncated}<p class="fine">The catalogue cut the list short: older passes are not shown.</p>{/if}
      <div class="go">
        <button class="btn btn-primary" disabled={busy || !chosen.length} onclick={() => onqueue(chosen)}>
          {chosen.length ? `Read ${passCount(chosen.length)}` : 'Tick the passes to read'}
        </button>
        {#if chosen.length}
          <p class="fine">
            {plural(chosen.length, 'run')}, one after the other{tiles ? `, about ${tiles} tile${tiles === 1 ? '' : 's'} each as on the last run` : ''}.
            The top bar follows them.
          </p>
        {/if}
        {#if ticked.size >= MAX_CATCH_UP}<p class="fine">At most {MAX_CATCH_UP} passes at once.</p>{/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .catch { display: grid; gap: 12px; align-content: start; }
  .lead { display: grid; gap: 8px; }
  h3 { margin: 0; font-size: var(--fs-sm); font-weight: 700; }
  .lead p { margin: 0; color: var(--text-2); font-size: var(--fs-xs); line-height: 1.5; }
  .lead .btn { justify-self: start; }
  .fine { margin: 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.45; }
  .warn { margin: 0; color: var(--warn); font-size: var(--fs-xs); }
  .summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; color: var(--text-2); font-size: var(--fs-xs); }
  .summary strong { color: var(--text-1); font-variant-numeric: tabular-nums; }
  .link { color: var(--accent); font-size: var(--fs-xs); }
  .link:first-of-type { margin-left: auto; }
  .months { display: grid; gap: 10px; }
  h4 { margin: 0 0 2px; color: var(--text-3); font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
  .pass {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    padding: 0 2px 0 6px;
    border-radius: var(--r-sm);
    font-size: var(--fs-xs);
  }
  .pass:hover { background: var(--bg-2); }
  .pass.on { background: var(--accent-soft); }
  .pass.read { color: var(--text-3); }
  .tick { display: flex; flex: 1 1 auto; align-items: center; gap: 8px; min-width: 0; cursor: pointer; }
  .pass.read .tick { cursor: default; }
  .day { min-width: 46px; color: var(--text-1); font-weight: 600; font-variant-numeric: tabular-nums; }
  .pass.read .day { color: var(--text-3); font-weight: 500; }
  .time { color: var(--text-2); font-variant-numeric: tabular-nums; }
  .cloud { min-width: 34px; padding: 1px 5px; border-radius: 99px; text-align: center; font-size: 10px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .cloud.clear { background: var(--ok-soft); color: var(--ok); }
  .cloud.part { background: var(--accent-soft); color: var(--warn); }
  .cloud.cloudy, .cloud.unknown { background: var(--bg-3); color: var(--text-2); }
  .state { min-width: 0; overflow: hidden; color: var(--text-3); text-overflow: ellipsis; white-space: nowrap; }
  .state.done { display: inline-flex; align-items: center; gap: 3px; }
  .state.why { color: var(--warn); }
  .state.gap { color: var(--info); }
  .look { margin-left: auto; opacity: 0.6; }
  .pass:hover .look { opacity: 1; }
  .go { position: sticky; bottom: 0; display: grid; gap: 6px; padding: 10px 0 2px; background: linear-gradient(transparent, var(--bg-1) 10px); }
</style>
