<script>
  import { api } from '../../lib/api.js';
  import { acquisitionQuery, coverageWarning, passKey } from '../../lib/map/acquisitions.js';
  import AcquisitionPicker from './AcquisitionPicker.svelte';
  import DateField from '../../components/DateField.svelte';

  let {
    zones, pairs = $bindable([]), single = false, baselineOnly = false,
    /** Which collection the passes come from: radar passes carry a time. */
    sensor = 'sentinel2',
    onshow = () => {},
  } = $props();
  const radar = $derived(sensor === 'sentinel1');
  let looking = $state(null);
  let passes = $state([]);
  let days = $state(90);
  let busy = $state(false);
  let error = $state('');
  let searched = $state(false);
  let truncated = $state(false);
  let generation = 0;
  const pairFor = (id) => pairs.find((p) => p.area_id === id);

  async function lookup(zone) {
    looking = zone.id; busy = true; error = ''; searched = false; passes = [];
    const mine = ++generation;
    try {
      const found = await api.post('/api/satellite/sentinel/acquisitions',
        acquisitionQuery([zone], days, new Date(), sensor));
      if (mine !== generation) return;
      passes = found.dates ?? []; searched = true; truncated = !!found.truncated;
    } catch (e) { if (mine === generation) error = e.message; }
    finally { if (mine === generation) busy = false; }
  }
  /** A typed day has no time yet: the engine settles which pass of it at launch. */
  function pick(id, letter, date, time = '') {
    pairs = pairs.map((pair) => pair.area_id !== id ? pair : {
      ...pair, [letter]: { ...pair[letter], date, time: radar ? time : '' },
      date_rule: letter === 'b' && pair.date_rule !== 'latest_previous' ? (date ? 'manual' : 'latest_reference') : pair.date_rule,
    });
    if (date) onshow({ ...pairFor(id)[letter], date, ...(radar ? { provider: 'sentinel1', time } : {}) });
  }
  const at = (source) => (radar && source?.time ? `${source.time.slice(0, 5)} UTC` : '');
</script>

<div class="dates-table">
  <table aria-label="Dates per area">
    <thead><tr><th>Area</th>{#if !single}<th>A · before</th>{/if}{#if !baselineOnly}<th>{single ? 'Image' : 'B · after'}</th>{/if}<th></th></tr></thead>
    <tbody>
      {#each zones as zone (zone.id)}
        {@const pair = pairFor(zone.id)}
        {#if pair}
          <tr>
            <th>{zone.name}</th>
            {#if !single}
              <td><DateField day reading={false} label={`Reference for ${zone.name}`} value={pair.a.date}
                  onchange={(value) => pick(zone.id, 'a', value ?? '')} />
                {#if at(pair.a)}<small class="mono">{at(pair.a)}</small>{/if}
                {#if pair.date_rule === 'latest_previous'}<small>Then the pass before</small>{/if}</td>
            {/if}
            {#if !baselineOnly}
              <td><DateField day reading={false} label={`Pass for ${zone.name}`} value={pair.b.date}
                  onchange={(value) => pick(zone.id, 'b', value ?? '')} />
                {#if at(pair.b)}<small class="mono">{at(pair.b)}</small>{/if}
                {#if !pair.b.date}<small>Newest pass</small>{:else}<button class="link" onclick={() => pick(zone.id, 'b', '')}>Newest pass</button>{/if}</td>
            {/if}
            <td><button class="btn btn-sm" disabled={busy} onclick={() => lookup(zone)} aria-label={`Find passes for ${zone.name}`}>Find passes</button></td>
          </tr>
        {/if}
      {/each}
    </tbody>
  </table>
</div>
{#if looking}
  {@const pair = pairFor(looking)}
  <p class="hint">{zones.find((zone) => zone.id === looking)?.name}</p>
  <AcquisitionPicker list={passes} {days} {busy} {error} {searched} {truncated} areas={1} {radar}
    {single} wantsReference={!single} wantsCompare={!baselineOnly} a={pair?.a ?? null} b={pair?.b ?? null}
    ondays={(value) => (days = value)} onlook={() => lookup(zones.find((zone) => zone.id === looking))}
    onpick={(letter, entry) => pick(looking, letter, entry.date, entry.time ?? '')} />
  {#each [single ? null : pair?.a, pair?.b].filter((source) => source?.date) as source}
    {@const warning = coverageWarning(passes.find((pass) => passKey(pass) === passKey(source)
      || (!source.time && pass.date === source.date)))}
    {#if warning}<p class="warn">{warning}</p>{/if}
  {/each}
{/if}

<style>
  .dates-table { overflow: auto; }
  table { width: 100%; border-collapse: collapse; font-size: var(--fs-xs); }
  th, td { padding: 7px 5px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
  td :global(.date-field) { width: 145px; }
  small { display: block; color: var(--text-3); max-width: 150px; }
  .mono { font-family: var(--font-mono); }
  .link { color: var(--accent); font-size: var(--fs-xs); }
</style>
