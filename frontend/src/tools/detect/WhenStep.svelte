<script>
  /**
   * Which imagery a detection reads, asked in the order it is decided.
   *
   * A one pass names A, the picture before, and B, the one to look in, which
   * is the newest pass under the cloud ceiling unless a day is chosen, and says
   * which day that is once the passes are looked up. A chosen day is read
   * whatever its cloud. A routine names no B: each run looks the newest pass up
   * itself, so this only asks what it compares with. The ceiling's slider sits
   * wherever "newest" picks, and says what a ceiling over 30% costs.
   * The passes over the areas are listed under the question, because picking
   * from what exists beats typing a day that may have no picture.
   *
   * One choice stands for every area; the per-area table is for areas far
   * enough apart to sit under different swaths. The pure part is
   * `lib/map/detectWhen.js`. The lookup waits to be pressed.
   */
  import { untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import {
    acquisitionQuery, areaKey, cloudWarning, coverageWarning, olderSpan, passKey, withOlder,
  } from '../../lib/map/acquisitions.js';
  import {
    areaLine, ceilingWarning, newestLabel, newestLine, newestPick, setSide, shadowWarning, sharedSide, uniform,
    withRule,
  } from '../../lib/map/detectWhen.js';
  import { isoDay } from '../../lib/sentinel.js';
  import AcquisitionPicker from './AcquisitionPicker.svelte';
  import AreaDates from './AreaDates.svelte';
  import DateField from '../../components/DateField.svelte';
  import Modal from '../../components/Modal.svelte';

  let {
    zones = [],
    pairs = $bindable([]),
    routine = false,
    /** A vessel or a fire is read on one image; a change needs two. */
    single = false,
    sensor = 'sentinel2',
    followupId = null,
    against = $bindable('previous'),
    /** A one pass reads B on a day of its own rather than the newest pass. */
    chooseB = $bindable(false),
    /** The cloud ceiling "newest" is chosen under. A chosen day ignores it. */
    maxcc = 100,
    /** Sets the ceiling; without it (radar) no slider is shown. */
    onmaxcc = null,
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
  let perArea = $state(false);
  let generation = 0;

  const key = $derived(areaKey(zones));
  // a list looked up another day has missed that day's passes
  const fresh = $derived(lookup?.key === key && lookup?.day === isoDay(new Date()) ? lookup : null);
  const a = $derived(sharedSide(pairs, 'a'));
  const b = $derived(sharedSide(pairs, 'b'));
  const same = $derived(uniform(pairs));
  const several = $derived(zones.length > 1);
  const ground = $derived(several ? 'these areas' : 'the area');
  const heading = $derived(routine ? (single ? 'Which image, each run' : 'Which images, each run')
    : single ? 'Which image' : 'Which two images');
  const waived = $derived(routine && !!followupId && against === 'previous');
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
  // the slider sits where the ceiling is in play: wherever "newest" picks B
  const ceiling = $derived(!radar && !!onmaxcc);
  const ceilingNote = $derived(ceilingWarning(maxcc));

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
    } catch (e) { if (mine === generation) error = e.message; }
    finally { if (mine === generation) busy = false; }
  }

  /** One pass on one side of every area, shown on the map as it is chosen,
   *  with its cloud when the lookup knows it. */
  function pick(letter, date, time = '') {
    pairs = setSide(pairs, letter, date, time, radar);
    if (letter === 'b' && date) chooseB = true;
    if (!date || !pairs.length) return;
    const cloud = radar ? null : fresh?.list.find((pass) => pass.date === date)?.cloud ?? null;
    onshow({ ...pairs[0][letter], date, cloud, ...(radar ? { provider: 'sentinel1', time } : {}) });
  }

  function takeNewest() {
    chooseB = false;
    pairs = setSide(pairs, 'b', '', '', radar);
  }

  function compareWith(value) {
    against = value;
    pairs = withRule(pairs, value);
  }

  const time = (side) => (radar && side?.time ? `${side.time.slice(0, 5)} UTC` : '');
</script>

{#snippet ceilingRow()}
  <label class="ceiling" title="The newest pass is taken under this">
    <span>Maximum cloud cover · {maxcc}%</span>
    <input type="range" min="0" max="100" value={maxcc} aria-label="Maximum cloud cover"
      oninput={(e) => onmaxcc(Number(e.currentTarget.value))} />
  </label>
  {#if ceilingNote}<p class="warn" role="note">{ceilingNote}</p>{/if}
{/snippet}

<section class="step" aria-label="Which imagery">
  <h3>{heading}</h3>

  {#if routine && single}
    <p class="lead">Each run reads the {newest} over {ground}.</p>
    <p class="hint">Nothing to choose now. When you run it, you can keep that pass or name another.</p>
    {#if ceiling}{@render ceilingRow()}{/if}
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
      {#if ceiling}{@render ceilingRow()}{/if}
    {/if}

    <div class="slots">
      {#if !single}
        <div class="slot" class:missing={!a?.date && !waived}>
          <span class="tag a" aria-hidden="true">A</span>
          <div class="body">
            <span class="k">{aTitle}</span>
            <div class="line">
              <DateField day reading={false} label="Day of A" value={a?.date ?? ''}
                placeholder={same || !several ? 'dd/mm/yyyy' : 'per area'} onchange={(value) => pick('a', value ?? '')} />
              {#if time(a)}<small class="mono">{time(a)}</small>{/if}
            </div>
            <small>{aHint}</small>
          </div>
        </div>
      {/if}
      {#if !routine}
        <div class="slot" class:missing={chooseB && !b?.date}>
          {#if !single}<span class="tag b" aria-hidden="true">B</span>{/if}
          <div class="body">
            {#if !single}<span class="k">After</span>{/if}
            <div class="cmp-seg" role="radiogroup" aria-label={single ? 'Which image' : 'Which picture B is'}>
              <button type="button" role="radio" class:on={!chooseB} aria-checked={!chooseB} onclick={takeNewest}>{Newest}</button>
              <button type="button" role="radio" class:on={chooseB} aria-checked={chooseB} onclick={() => (chooseB = true)}>A day I choose</button>
            </div>
            {#if chooseB}
              <div class="line">
                <DateField day reading={false} label={single ? 'Day of the image' : 'Day of B'} value={b?.date ?? ''}
                  placeholder={same || !several ? 'dd/mm/yyyy' : 'per area'} onchange={(value) => pick('b', value ?? '')} />
                {#if time(b)}<small class="mono">{time(b)}</small>{/if}
              </div>
              <small>Type it, or pick it in the passes below.</small>
            {:else}
              {#if ceiling}{@render ceilingRow()}{/if}
              <small>{newestNote}</small>
            {/if}
          </div>
        </div>
      {/if}
    </div>

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

  {#if several && !(routine && single)}
    <p class="hint">{same ? `The same days for all ${zones.length} areas.` : 'The areas have days of their own.'}
      <button class="link" onclick={() => (perArea = true)}>Set them per area…</button></p>
    {#if !same}
      <ul class="dates">
        {#each zones as zone (zone.id)}
          {@const pair = pairs.find((row) => row.area_id === zone.id)}
          <li><span class="who">{zone.name}</span><span class="what">{areaLine(pair, { single, routine, radar })}</span></li>
        {/each}
      </ul>
    {/if}
  {/if}
</section>

{#if perArea}
  <Modal title="Dates per area" width="760px" onclose={() => (perArea = false)}>
    <AreaDates {zones} bind:pairs {single} baselineOnly={routine} {sensor} {onshow} />
    <button class="btn btn-primary" onclick={() => (perArea = false)}>Done</button>
  </Modal>
{/if}

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
  small { color: var(--text-3); font-size: 10.5px; line-height: 1.35; }
  .mono { font-family: var(--font-mono); color: var(--text-2); }
  .cmp-seg { justify-self: start; }
  .passes-title { display: flex; flex-wrap: wrap; gap: 6px; align-items: baseline; margin: 2px 0 0; font-size: var(--fs-xs); }
  .passes-title span { color: var(--text-3); font-size: 10.5px; }
  .ceiling { display: grid; gap: 3px; color: var(--text-2); font-size: var(--fs-xs); }
  .ceiling input { width: 100%; }
  .link { color: var(--accent); font-size: var(--fs-xs); }
  .warn { margin: 0; color: var(--warn, #e2a03f); font-size: 10.5px; line-height: 1.35; }
  .dates { display: grid; gap: 3px; margin: 0; padding: 0; list-style: none; }
  .dates li { display: flex; gap: 8px; font-size: var(--fs-xs); }
  .dates .who { flex: 1; min-width: 0; overflow: hidden; color: var(--text-2); text-overflow: ellipsis; white-space: nowrap; }
  .dates .what { color: var(--text-3); font-family: var(--font-mono); font-size: 10.5px; }
</style>
