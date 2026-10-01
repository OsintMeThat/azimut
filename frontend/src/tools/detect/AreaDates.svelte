<script>
  import { api } from '../../lib/api.js';
  import {
    acquisitionQuery, cloudWarning, coverageWarning, olderSpan, passKey, withOlder,
  } from '../../lib/map/acquisitions.js';
  import { canPickPass, newestLabel, newestLine, newestPick, passBefore } from '../../lib/map/detectWhen.js';
  import { isoDay } from '../../lib/sentinel.js';
  import Icon from '../../components/Icon.svelte';
  import AcquisitionPicker from './AcquisitionPicker.svelte';
  import PassCalendar from './PassCalendar.svelte';
  import DateField from '../../components/DateField.svelte';

  let {
    zones, pairs = $bindable([]), single = false, baselineOnly = false,
    routine = false, previous = false, lastPasses = {},
    /** Which collection the passes come from: radar passes carry a time. */
    sensor = 'sentinel2',
    onshow = () => {},
  } = $props();
  const radar = $derived(sensor === 'sentinel1');
  let looking = $state(null);
  let passes = $state([]);
  let lookback = $state(90);
  let busy = $state(false);
  let error = $state('');
  let searched = $state(false);
  let truncated = $state(false);
  let generation = 0;
  let calendarArea = $state('');
  let calendarSide = $state('');
  let calendarPasses = $state([]);
  let calendarBusy = $state(false);
  let calendarError = $state('');
  let calendarGeneration = 0;
  const calendarCache = new Map();
  const pairFor = (id) => pairs.find((p) => p.area_id === id);
  const zoneFor = (id) => zones.find((zone) => zone.id === id);
  const currentA = (id) => previous && lastPasses[id] ? lastPasses[id] : pairFor(id)?.a;
  const eligibleFor = (id, letter) => (pass) =>
    canPickPass(letter, pass, currentA(id), pairFor(id)?.b, radar);
  function show(id, letter, source, known = passes) {
    if (!source?.date) return;
    const cloud = radar ? null : known.find((pass) => pass.date === source.date)?.cloud ?? null;
    onshow({ ...source, cloud, area: zoneFor(id), side: letter });
  }

  /** The passes over one area, or with `more` those before the oldest listed. */
  async function lookup(zone, more = false) {
    const span = more ? olderSpan(lookback, passes) : lookback;
    if (!span) return;
    looking = zone.id; busy = true; error = ''; calendarSide = '';
    if (!more) { searched = false; passes = []; }
    const mine = ++generation;
    try {
      const found = await api.post('/api/satellite/sentinel/acquisitions',
        acquisitionQuery([zone], span, new Date(), sensor));
      if (mine !== generation) return;
      passes = more ? withOlder(passes, found.dates) : found.dates ?? [];
      searched = true; truncated = !!found.truncated;
      const pair = pairFor(zone.id);
      if (pair && (routine || !pair.b.date)) {
        const picked = newestPick(passes, { maxcc: radar ? 100 : pair.b.maxcc,
          radar, track: radar && !single ? currentA(zone.id)?.time ?? '' : '' });
        if (picked.pass) show(zone.id, 'B', { ...pair.b, date: picked.pass.date, time: picked.pass.time ?? '' }, passes);
      }
    } catch (e) { if (mine === generation) error = e.message; }
    finally { if (mine === generation) busy = false; }
  }
  async function lookupMonth(zone, month) {
    const key = `${zone.id}:${month}`;
    const cached = calendarCache.get(key);
    const mine = ++calendarGeneration;
    if (cached) { calendarPasses = cached; calendarBusy = false; calendarError = ''; return; }
    calendarPasses = []; calendarBusy = true; calendarError = '';
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
      .toISOString().slice(0, 10);
    const today = isoDay(new Date());
    const end = last < today ? last : today;
    try {
      const found = await api.post('/api/satellite/sentinel/acquisitions',
        acquisitionQuery([zone], { start: `${month}-01`, end }, new Date(), sensor));
      calendarCache.set(key, found.dates ?? []);
      if (mine === calendarGeneration) calendarPasses = found.dates ?? [];
    } catch (e) { if (mine === calendarGeneration) calendarError = e.message; }
    finally { if (mine === calendarGeneration) calendarBusy = false; }
  }
  function openCalendar(id, side) {
    if (calendarArea !== id) calendarPasses = [];
    calendarArea = id;
    calendarSide = side;
  }
  /** A typed day has no time yet: the engine settles which pass of it at launch. */
  function pick(id, letter, date, time = '', closeCalendar = true) {
    pairs = pairs.map((pair) => pair.area_id !== id ? pair : {
      ...pair, [letter]: { ...pair[letter], date, time: radar ? time : '' },
      date_rule: letter === 'b' && pair.date_rule !== 'latest_previous' ? (date ? 'manual' : 'latest_reference') : pair.date_rule,
    });
    if (closeCalendar) calendarSide = '';
    if (!date) return;
    show(id, letter, { ...pairFor(id)[letter], date, ...(radar ? { provider: 'sentinel1', time } : {}) },
      looking === id ? [...calendarPasses, ...passes] : calendarPasses);
  }
  const at = (source) => (radar && source?.time ? `${source.time.slice(0, 5)} UTC` : '');
  /** "Newest" as this area's ceiling makes it, capitalised for a cell. */
  const newestFor = (pair) => {
    const label = newestLabel({ maxcc: pair?.b?.maxcc, radar });
    return label.charAt(0).toUpperCase() + label.slice(1);
  };
  const track = (pair) => (radar && !single ? currentA(pair.area_id)?.time ?? '' : '');
  const pickedB = (pair) => looking === pair.area_id && searched && !pair.b.date
    ? newestPick(passes, { maxcc: radar ? 100 : pair.b.maxcc, radar, track: track(pair) }) : null;
  const cloudSkip = (picked, maxcc) => {
    const pass = picked?.skipped?.find((entry) => entry.why === 'cloud');
    return pass ? `${pass.date} was skipped (${Math.round(pass.cloud)}% cloud; limit ${maxcc}%).` : '';
  };
</script>

<div class="dates-table">
  {#each zones as zone (zone.id)}
    {@const pair = pairFor(zone.id)}
    {#if pair}
      <section class="area-date" aria-label={`Dates for ${zone.name}`}>
        <div class="area-head"><strong>{zone.name}</strong>
          {#if looking !== zone.id}
            <button class="btn btn-sm" disabled={busy} onclick={() => lookup(zone)}
              aria-label={`Find passes for ${zone.name}`}>Find passes</button>
          {/if}
        </div>
        {#if !single}
          <div class="side">
            <strong>Date A · {previous && lastPasses[zone.id] ? 'Last completed pass' : routine && previous ? 'First run only' : 'Before'}</strong>
            {#if previous && lastPasses[zone.id]}
              <button class="link" onclick={() => show(zone.id, 'A', currentA(zone.id))}>
                {currentA(zone.id).date}{#if at(currentA(zone.id))} · {at(currentA(zone.id))}{/if} · View A</button>
            {:else}
              <button class="date-pick" aria-label={`Date A for ${zone.name}`}
                aria-expanded={calendarArea === zone.id && calendarSide === 'a'}
                onclick={() => openCalendar(zone.id, 'a')}>
                <Icon name="calendar" size={13} /><span>{pair.a.date || 'Choose a pass'}</span>
                <Icon name="chevronDown" size={12} />
              </button>
              {#if pair.a.date}<button class="link" onclick={() => show(zone.id, 'A', pair.a)}>View A</button>{/if}
              {#if calendarArea === zone.id && calendarSide === 'a'}
                <PassCalendar list={calendarPasses} value={pair.a.date} label={`Reference for ${zone.name}`}
                  {radar} busy={calendarBusy} error={calendarError} eligible={eligibleFor(zone.id, 'a')}
                  onmonth={(month) => lookupMonth(zone, month)}
                  onclose={() => (calendarSide = '')}
                  onpick={(pass) => pick(zone.id, 'a', pass.date, pass.time ?? '')} />
                <details class="manual-date"><summary>Enter a date</summary>
                  <DateField day reading={false} label={`Reference for ${zone.name}`} value={pair.a.date}
                    onchange={(value) => pick(zone.id, 'a', value ?? '', '', false)} />
                </details>
              {/if}
            {/if}
          </div>
        {/if}
        <div class="side">
          <strong>{single ? 'Image date' : 'Date B · after'}</strong>
          {#if routine && baselineOnly}<small>{newestFor(pair)} at each run</small>
          {:else}
            <button class="date-pick" aria-label={`${single ? 'Image date' : 'Date B'} for ${zone.name}`}
              aria-expanded={calendarArea === zone.id && calendarSide === 'b'}
              onclick={() => openCalendar(zone.id, 'b')}>
              <Icon name="calendar" size={13} /><span>{pair.b.date || newestFor(pair)}</span>
              <Icon name="chevronDown" size={12} />
            </button>
            {#if pair.b.date}<button class="link" onclick={() => show(zone.id, 'B', pair.b)}>View B</button>
              <button class="link" onclick={() => pick(zone.id, 'b', '')}>Use newest</button>{/if}
            {#if calendarArea === zone.id && calendarSide === 'b'}
              <PassCalendar list={calendarPasses} value={pair.b.date} label={`Pass for ${zone.name}`}
                {radar} busy={calendarBusy} error={calendarError} eligible={eligibleFor(zone.id, 'b')}
                onmonth={(month) => lookupMonth(zone, month)}
                onclose={() => (calendarSide = '')}
                onpick={(pass) => pick(zone.id, 'b', pass.date, pass.time ?? '')} />
              <details class="manual-date"><summary>Enter a date</summary>
                <DateField day reading={false} label={`Pass for ${zone.name}`} value={pair.b.date}
                  onchange={(value) => pick(zone.id, 'b', value ?? '', '', false)} />
              </details>
            {/if}
          {/if}
          {#if pickedB(pair)?.pass}
            <button class="link" onclick={() => show(zone.id, 'B', { ...pair.b, date: pickedB(pair).pass.date,
              time: pickedB(pair).pass.time ?? '' })}>View B · {pickedB(pair).pass.date}</button>
          {/if}
        </div>
        {#if !single && pair.b.date && !passBefore(currentA(zone.id), pair.b, radar)}
          <p class="warn" role="alert">Date A must be before date B.</p>
        {/if}
        {#if looking === zone.id}
          <p class="hint">Passes over {zone.name}</p>
          <AcquisitionPicker list={passes} {lookback} {busy} {error} {searched} {truncated} areas={1} {radar}
            {single} wantsReference={!single && !(previous && lastPasses[zone.id])} wantsCompare={!baselineOnly}
            a={currentA(zone.id) ?? null} b={pair.b ?? null}
            onlookback={(value) => (lookback = value)} onlook={() => lookup(zone)}
            onolder={() => lookup(zone, true)}
            onpick={(letter, entry) => pick(zone.id, letter, entry.date, entry.time ?? '')} />
          {#if searched && !pair.b?.date}
            {@const maxcc = radar ? 100 : pair.b?.maxcc}
            {@const picked = newestPick(passes, { maxcc, radar, track: track(pair) })}
            {#if cloudSkip(picked, maxcc)}<p class="warn">{cloudSkip(picked, maxcc)}</p>{/if}
            <p class="hint">{newestLine(picked, { maxcc, radar })}</p>
          {/if}
          {#each [single ? null : pair.a, pair.b].filter((source) => source?.date) as source}
            {@const entry = passes.find((pass) => passKey(pass) === passKey(source) || (!source.time && pass.date === source.date))}
            {#each [coverageWarning(entry), radar ? '' : cloudWarning(entry, source.maxcc)].filter(Boolean) as warning (warning)}
              <p class="warn">{warning}</p>
            {/each}
          {/each}
        {/if}
      </section>
    {/if}
  {/each}
</div>

<style>
  .dates-table { display: grid; gap: 7px; }
  .area-date { display: grid; gap: 7px; padding: 8px; border: 1px solid var(--border); border-radius: var(--r-sm); }
  .area-head { display: flex; align-items: center; gap: 8px; }
  .area-head strong { flex: 1; font-size: var(--fs-xs); }
  .side { display: grid; justify-items: start; gap: 3px; font-size: var(--fs-xs); }
  .side strong { color: var(--text-2); }
  .date-pick { display: flex; align-items: center; gap: 7px; width: min(100%, 246px);
    padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-2); color: var(--text-1); font-size: var(--fs-xs); text-align: left; }
  .date-pick:hover, .date-pick[aria-expanded="true"] { border-color: var(--accent); }
  .date-pick span { flex: 1; }
  .manual-date { color: var(--text-3); font-size: 10px; }
  .manual-date summary { cursor: pointer; }
  .side :global(.date-field) { width: 145px; }
  .warn { margin: 0; color: var(--warn); font-size: 10.5px; }
  small { display: block; color: var(--text-3); max-width: 150px; }
  .link { color: var(--accent); font-size: var(--fs-xs); }
</style>
