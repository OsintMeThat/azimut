<script>
  /**
   * Which imagery a detection reads, asked in the order it is decided.
   *
   * A one pass names A, the picture before, and B, the one to look in, which
   * is the newest pass under the cloud ceiling unless a day is chosen, and says
   * which day that is once the passes are looked up. A chosen day is read
   * whatever its cloud. A routine names no B: each run looks the newest pass up
   * itself, so this only asks what it compares with. Dates open a calendar of
   * actual passes; the longer pass list is fetched on request.
   */
  import { untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import {
    acquisitionQuery, areaKey, cloudWarning, coverageWarning, olderSpan, passKey, withOlder,
  } from '../../lib/map/acquisitions.js';
  import {
    canPickPass, newestLabel, newestLine, newestPick, passBefore, setSide, shadowWarning, sharedSide,
    withRule,
  } from '../../lib/map/detectWhen.js';
  import { isoDay } from '../../lib/sentinel.js';
  import AcquisitionPicker from './AcquisitionPicker.svelte';
  import AreaDates from './AreaDates.svelte';
  import PassCalendar from './PassCalendar.svelte';
  import DateField from '../../components/DateField.svelte';
  import Icon from '../../components/Icon.svelte';

  let {
    zones = [],
    pairs = $bindable([]),
    routine = false,
    /** A vessel or a fire is read on one image; a change needs two. */
    single = false,
    sensor = 'sentinel2',
    lastPasses = {},
    against = $bindable('previous'),
    /** A one pass reads B on a day of its own rather than the newest pass. */
    chooseB = $bindable(false),
    /** The cloud ceiling "newest" is chosen under. A chosen day ignores it. */
    maxcc = 100,
    /** The last lookup, held by the wizard so stepping back does not pay for it twice. */
    lookup = $bindable(null),
    onshow = () => {},
  } = $props();

  const AGAINST = [
    ['previous', 'The pass before', 'What changed since the last run'],
    ['reference', 'A fixed picture', 'Everything changed since that day'],
  ];

  const radar = $derived(sensor === 'sentinel1');
  let lookback = $state(untrack(() => lookup?.lookback ?? 90));
  let busy = $state(false);
  let error = $state('');
  let generation = 0;
  let calendarSide = $state('');
  let calendarPasses = $state([]);
  let calendarBusy = $state(false);
  let calendarError = $state('');
  let calendarGeneration = 0;
  const calendarCache = new Map();

  const key = $derived(areaKey(zones));
  // a list looked up another day has missed that day's passes
  const fresh = $derived(lookup?.key === key && lookup?.day === isoDay(new Date()) ? lookup : null);
  const a = $derived(sharedSide(pairs, 'a'));
  const b = $derived(sharedSide(pairs, 'b'));
  const several = $derived(zones.length > 1);
  const ground = $derived(several ? 'these areas' : 'the area');
  const heading = $derived(routine ? (single ? 'Which image, each run' : 'Which images, each run')
    : single ? 'Which image' : 'Which two images');
  const waived = $derived(routine && against === 'previous' && zones.every((zone) => !!lastPasses[zone.id]));
  const aTitle = $derived(!routine ? 'Before' : against === 'previous' ? 'First run compares with' : 'Every run compares with');
  const aHint = $derived(
    !routine ? 'The picture without the change.'
    : against === 'reference' ? 'The same picture, run after run.'
    : waived ? 'Used until a run has finished; then each run compares with the one before.'
    : 'Only the first run; after it, each run compares with the one before.'
  );
  const newest = $derived(newestLabel({ maxcc, radar }));
  const Newest = $derived(newest.charAt(0).toUpperCase() + newest.slice(1));
  // which day "newest" takes now, by the rule the run applies at launch
  const newestNow = $derived(fresh ? newestPick(fresh.list, { maxcc, radar, track: radar && !single ? a?.time ?? '' : '' }) : null);
  const newestNote = $derived(newestNow ? newestLine(newestNow, { maxcc, radar }) : `The ${newest}, looked up when the run starts.`);
  const warnings = $derived(!fresh ? [] : [single ? null : a, routine ? null : b]
    .filter((side) => side?.date)
    .map((side) => fresh.list.find((pass) => passKey(pass) === passKey(side) || (!side.time && pass.date === side.date)))
    .flatMap((entry) => [coverageWarning(entry), radar ? '' : cloudWarning(entry, maxcc)])
    .filter(Boolean));
  const shadows = $derived(shadowWarning(pairs, zones, { single, radar }));

  const look = () => search(lookback, false);
  const lookOlder = () => search(olderSpan(lookback, fresh?.list), true);

  async function search(span, more) {
    if (!span) return;
    busy = true; error = '';
    const mine = ++generation;
    try {
      const found = await api.post('/api/satellite/sentinel/acquisitions',
        acquisitionQuery(zones, span, new Date(), sensor));
      if (mine !== generation) return;
      const list = more ? withOlder(fresh?.list, found.dates) : found.dates ?? [];
      lookup = { key, day: isoDay(new Date()), lookback, list, truncated: !!found.truncated };
      const picked = newestPick(list, { maxcc, radar, track: radar && !single ? a?.time ?? '' : '' });
      if (picked.pass && zones[0]) onshow({ ...pairs[0]?.b, date: picked.pass.date,
        time: picked.pass.time ?? '', cloud: picked.pass.cloud, area: zones[0], side: 'B' });
    } catch (e) { if (mine === generation) error = e.message; }
    finally { if (mine === generation) busy = false; }
  }

  async function loadCalendarMonth(month) {
    const cacheKey = `${key}:${month}`;
    const cached = calendarCache.get(cacheKey);
    const mine = ++calendarGeneration;
    if (cached) { calendarPasses = cached; calendarBusy = false; calendarError = ''; return; }
    calendarPasses = []; calendarBusy = true; calendarError = '';
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
      .toISOString().slice(0, 10);
    const end = last < isoDay(new Date()) ? last : isoDay(new Date());
    try {
      const found = await api.post('/api/satellite/sentinel/acquisitions',
        acquisitionQuery(zones, { start: `${month}-01`, end }, new Date(), sensor));
      calendarCache.set(cacheKey, found.dates ?? []);
      if (mine === calendarGeneration) calendarPasses = found.dates ?? [];
    } catch (e) { if (mine === calendarGeneration) calendarError = e.message; }
    finally { if (mine === calendarGeneration) calendarBusy = false; }
  }

  /** One pass on one side of every area, shown on the map as it is chosen,
   *  with its cloud when the lookup knows it. */
  function pick(letter, date, time = '', closeCalendar = true) {
    pairs = setSide(pairs, letter, date, time, radar);
    if (letter === 'b' && date) chooseB = true;
    if (!date || !pairs.length) return;
    if (closeCalendar) calendarSide = '';
    const cloud = radar ? null : [...calendarPasses, ...(fresh?.list ?? [])]
      .find((pass) => pass.date === date)?.cloud ?? null;
    onshow({ ...pairs[0][letter], date, cloud, area: zones[0], side: letter,
      ...(radar ? { provider: 'sentinel1', time } : {}) });
  }

  function takeNewest() {
    chooseB = false;
    calendarSide = '';
    pairs = setSide(pairs, 'b', '', '', radar);
    if (newestNow?.pass && zones[0]) onshow({ ...pairs[0].b, date: newestNow.pass.date,
      time: newestNow.pass.time ?? '', cloud: newestNow.pass.cloud, area: zones[0], side: 'B' });
  }

  function compareWith(value) {
    against = value;
    pairs = withRule(pairs, value);
  }

  const time = (side) => (radar && side?.time ? `${side.time.slice(0, 5)} UTC` : '');
</script>

<section class="step" aria-label="Which imagery">
  <h3>{heading}</h3>

  {#if several}
    {#if routine && !single}
      <p class="lead">Each area takes its newest eligible pass as B and compares it with</p>
      <div class="options" role="radiogroup" aria-label="What each run compares with">
        {#each AGAINST as [value, title, detail] (value)}
          <button type="button" role="radio" class="option" class:on={against === value}
            aria-checked={against === value} onclick={() => compareWith(value)}>
            <strong>{title}</strong><span>{detail}</span>
          </button>
        {/each}
      </div>
    {/if}
    <AreaDates {zones} bind:pairs {single} {routine} baselineOnly={routine} previous={routine && against === 'previous'}
      {lastPasses} {sensor} {onshow} />
  {:else if routine && single}
    <p class="lead">Each run reads the {newest} over {ground}.</p>
    <p class="hint">Nothing to choose now. When you run it, you can keep that pass or name another.</p>
  {:else}
    {#if routine}
      <p class="lead">Each run takes the {newest} as B and compares it with</p>
      <div class="options" role="radiogroup" aria-label="What each run compares with">
        {#each AGAINST as [value, title, detail] (value)}
          <button type="button" role="radio" class="option" class:on={against === value}
            aria-checked={against === value} onclick={() => compareWith(value)}>
            <strong>{title}</strong><span>{detail}</span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="slots">
      {#if !single}
        <div class="slot" class:missing={!a?.date && !waived}>
          <span class="tag a" aria-hidden="true">A</span>
          <div class="body">
            <span class="k">Date A · {aTitle}</span>
            <div class="line">
              {#if routine && against === 'previous' && lastPasses[zones[0]?.id]}
                <button class="link" onclick={() => onshow({ ...lastPasses[zones[0].id], area: zones[0], side: 'A' })}>
                  {lastPasses[zones[0].id].date} · View A</button>
              {:else}
                <button class="date-pick" aria-label="Date A" aria-expanded={calendarSide === 'a'}
                  onclick={() => (calendarSide = 'a')}>
                  <Icon name="calendar" size={13} /><span>{a?.date || 'Choose a pass'}</span>
                  <Icon name="chevronDown" size={12} />
                </button>
              {/if}
              {#if time(a)}<small class="mono">{time(a)}</small>{/if}
            </div>
            {#if calendarSide === 'a'}
              <PassCalendar list={calendarPasses} value={a?.date ?? ''} label="A" {radar}
                busy={calendarBusy} error={calendarError} eligible={(pass) => canPickPass('a', pass, a, b, radar)}
                onmonth={loadCalendarMonth}
                onclose={() => (calendarSide = '')}
                onpick={(pass) => pick('a', pass.date, pass.time ?? '')} />
              <details class="manual-date"><summary>Enter a date</summary>
                <DateField day reading={false} label="Day of A" value={a?.date ?? ''}
                  onchange={(value) => pick('a', value ?? '', '', false)} />
              </details>
            {/if}
            <small>{aHint}</small>
          </div>
        </div>
      {/if}
      {#if !routine}
        <div class="slot" class:missing={chooseB && !b?.date}>
          {#if !single}<span class="tag b" aria-hidden="true">B</span>{/if}
          <div class="body">
            <span class="k">{single ? 'Image date' : 'Date B · After'}</span>
            <div class="line">
              <button class="date-pick" aria-label={single ? 'Image date' : 'Date B'}
                aria-expanded={calendarSide === 'b'} onclick={() => (calendarSide = 'b')}>
                <Icon name="calendar" size={13} /><span>{chooseB && b?.date ? b.date : Newest}</span>
                <Icon name="chevronDown" size={12} />
              </button>
              {#if time(b)}<small class="mono">{time(b)}</small>{/if}
            </div>
            {#if chooseB}<button class="link" onclick={takeNewest}>Use newest pass</button>
            {:else}<small>{newestNote}</small>{/if}
            {#if calendarSide === 'b'}
              <PassCalendar list={calendarPasses} value={b?.date ?? ''} label="B" {radar}
                busy={calendarBusy} error={calendarError} eligible={(pass) => canPickPass('b', pass, a, b, radar)}
                onmonth={loadCalendarMonth}
                onclose={() => (calendarSide = '')}
                onpick={(pass) => pick('b', pass.date, pass.time ?? '')} />
              <details class="manual-date"><summary>Enter a date</summary>
                <DateField day reading={false} label={single ? 'Day of the image' : 'Day of B'} value={b?.date ?? ''}
                  onchange={(value) => pick('b', value ?? '', '', false)} />
              </details>
            {/if}
          </div>
        </div>
      {/if}
    </div>

    {#if !single && b?.date && !passBefore(a, b, radar)}<p class="warn" role="alert">Date A must be before date B.</p>{/if}
    {#if shadows}<p class="warn" role="note">{shadows}</p>{/if}

    <p class="passes-title"><strong>Passes over {ground}</strong>
      <span>{radar ? 'with their time and track' : 'with their cloud cover'}</span></p>
    <AcquisitionPicker list={fresh?.list ?? []} {lookback} {busy} {error} searched={!!fresh} truncated={!!fresh?.truncated}
      areas={zones.length} {radar} {single} wantsReference={!single} wantsCompare={!routine}
      a={single ? null : a} b={routine ? null : b}
      onlookback={(value) => (lookback = value)} onlook={look} onolder={lookOlder}
      onpick={(letter, entry) => pick(letter, entry.date, entry.time ?? '')} />
    {#each warnings as warning (warning)}<p class="warn">{warning}</p>{/each}
  {/if}

</section>

<style>
  .step { display: grid; gap: 9px; }
  h3 { margin: 0; font-size: var(--fs-sm); font-weight: 700; }
  .lead { margin: 0; color: var(--text-1); font-size: var(--fs-xs); line-height: 1.45; }
  .options { display: grid; gap: 4px; }
  .option {
    display: grid;
    gap: 1px;
    padding: 6px 9px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    color: var(--text-1);
    font-size: var(--fs-xs);
    text-align: left;
  }
  .option:hover { background: var(--bg-2); }
  .option.on { border-color: var(--accent); background: var(--accent-soft); }
  .option span { color: var(--text-3); font-size: 10.5px; }
  .slots {
    display: grid;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
  }
  .slot { display: flex; gap: 9px; padding: 8px 9px; }
  .slot + .slot { border-top: 1px solid var(--border); }
  .slot.missing { background: color-mix(in srgb, var(--warn, #e2a03f) 7%, transparent); }
  .tag {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    color: #0b0d11;
    font: 700 10.5px/1 var(--font-sans);
  }
  .tag.a { background: var(--side-a, #38bdf8); }
  .tag.b { background: var(--side-b, #f59e0b); }
  .body { display: grid; gap: 5px; min-width: 0; flex: 1; }
  .k { color: var(--text-1); font-size: var(--fs-xs); font-weight: 600; }
  .line { display: flex; align-items: center; gap: 8px; }
  .line :global(.date-field) { width: 145px; }
  .date-pick { display: flex; align-items: center; gap: 7px; width: min(100%, 246px);
    padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-2); color: var(--text-1); font-size: var(--fs-xs); text-align: left; }
  .date-pick:hover, .date-pick[aria-expanded="true"] { border-color: var(--accent); }
  .date-pick span { flex: 1; }
  .manual-date { color: var(--text-3); font-size: 10px; }
  .manual-date summary { cursor: pointer; }
  small { color: var(--text-3); font-size: 10.5px; line-height: 1.35; }
  .mono { font-family: var(--font-mono); color: var(--text-2); }
  .passes-title { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; margin: 2px 0 0; font-size: var(--fs-xs); }
  .passes-title span { color: var(--text-3); font-size: 10.5px; }
  .link { color: var(--accent); font-size: var(--fs-xs); }
  .warn { margin: 0; color: var(--warn, #e2a03f); font-size: 10.5px; line-height: 1.35; }
</style>
