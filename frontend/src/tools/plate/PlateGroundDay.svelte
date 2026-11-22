<script>
  /**
   * The day a plate map's ground was taken, where the ground has one, and the switch
   * that draws the map's dated layers on that day. One chooser for the inspector's
   * Ground section and for the menu of the map's bar, so the two never drift:
   *
   * - **World Imagery Wayback**: a release, newest first.
   * - **Sentinel-2 cloudless**: a year, each with the terms EOX gives it.
   * - **Sentinel-2, one dated pass**: Satellite's own calendar (`SentinelPicker`), on the
   *   one Sentinel-2 state the plate keeps for the map picked alone (`plateSentinel.svelte.js`).
   * - **Layers as they stood that day**, on a map whose picture has one day (`imageryDay`);
   *   a template keeps no layers, so not there.
   *
   * `menu` lays it out for the bar's floating menu: the releases and the years as rows to
   * press, the calendar open in place, asked for by the bar as it opens.
   */
  import Icon from '../../components/Icon.svelte';
  import SentinelPicker from '../satellite/SentinelPicker.svelte';
  import { momentLabel } from '../../lib/map/layerHistory.js';
  import { cloudClass, cloudLabel, maxccLabel, monthGrid, monthLabel } from '../../lib/sentinel.js';
  import { CLOUDLESS_ID, cloudlessYear } from '../../lib/plate/cloudless.js';
  import { SENTINEL_ID } from '../../lib/plate/sentinelPass.js';
  import { imageryDay } from '../../lib/plate/source.js';
  import { WAYBACK_ID } from '../../lib/wayback.js';

  let {
    element,
    /** The Wayback releases, `{ release, date }`, newest first, once read. */
    releases = [],
    /** The years of Sentinel-2 cloudless, `{ year, licence, free }`, newest first. */
    years = [],
    /** The plate's Sentinel-2 choices (`createPlateSentinel`), or null. */
    sentinel = null,
    /** The plate is a template, which keeps no layers. */
    template = false,
    /** Laid out for the bar's floating menu rather than the inspector. */
    menu = false,
  } = $props();

  const s2 = $derived(sentinel?.s2 ?? null);
  /** The plate's Sentinel-2 choices are this map's: it is the one picked alone. */
  const bound = $derived(!!sentinel && sentinel.map === element.id);
  const year = $derived(cloudlessYear(element, years));
  const layered = $derived(!template && !!imageryDay(element, { releases }));
  const dayOf = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) ? momentLabel(value) : String(value ?? ''));
  const passNote = $derived(bound && s2.latestBusy && !element.acquired ? 'Looking for the newest pass…'
    : !element.acquired ? 'No pass picked yet.'
      : !bound ? `The pass of ${element.acquired}.`
        : `${s2.layerLabel}, the pass of ${element.acquired}${s2.date ? '' : s2.maxcc < 100 ? `, the newest under ${s2.maxcc}% cloud` : ', the newest'}.`);
  const licence = $derived(year ? (year.free ? 'Free for any use, with its credit.' : 'Free for non-commercial use only, with its credit. 2016 is free for any use.') : '');
  const LAYERS_HINT = 'Draws the dated layers as they stood on the day this map\'s picture was taken, not on the plate\'s day';

  const setRelease = (value) => { element.release = value ? Number(value) : null; };
  const setYear = (value) => { element.year = value ? Number(value) : null; };

  // the inspector's calendar closes on a press anywhere else, as on Satellite's map
  let menuEl = $state();
  $effect(() => {
    if (menu || !bound || !s2.menuOpen) return;
    const away = (event) => { if (menuEl && !menuEl.contains(event.target)) s2.menuOpen = false; };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  });
  // the menu opens on the day the map shows, its list scrolled to it
  let list = $state();
  $effect(() => {
    const checked = menu ? list?.querySelector('[aria-checked="true"]') : null;
    if (checked) list.scrollTop = Math.max(0, checked.offsetTop - list.offsetTop - (list.clientHeight - checked.offsetHeight) / 2);
  });
</script>

{#if menu}
  {#if element.basemap === WAYBACK_ID}
    <div class="fm-head">Wayback release</div>
    <div class="days" role="group" aria-label="Wayback release" bind:this={list}>
      <button type="button" class="fm-item" role="menuitemradio" aria-checked={!element.release} onclick={() => setRelease(null)}>
        <span class="fm-grow">Newest</span>{#if releases[0]}<span class="when">{dayOf(releases[0].date)}</span>{/if}
        {#if !element.release}<Icon name="check" size={13} />{:else}<span class="room"></span>{/if}</button>
      {#each releases as entry (entry.release)}
        <button type="button" class="fm-item" role="menuitemradio" aria-checked={element.release === entry.release} onclick={() => setRelease(entry.release)}>
          <span class="fm-grow">{dayOf(entry.date)}</span>
          {#if element.release === entry.release}<Icon name="check" size={13} />{:else}<span class="room"></span>{/if}</button>
      {/each}
    </div>
  {:else if element.basemap === CLOUDLESS_ID}
    <div class="fm-head">Cloudless year</div>
    <div class="days" role="group" aria-label="Cloudless year" bind:this={list}>
      <button type="button" class="fm-item" role="menuitemradio" aria-checked={!element.year} onclick={() => setYear(null)}>
        <span class="fm-grow">Newest</span>{#if years[0]}<span class="when">{years[0].year}</span>{/if}
        {#if !element.year}<Icon name="check" size={13} />{:else}<span class="room"></span>{/if}</button>
      {#each years as entry (entry.year)}
        <button type="button" class="fm-item" role="menuitemradio" aria-checked={element.year === entry.year} onclick={() => setYear(entry.year)}>
          <span class="fm-grow">{entry.year}</span>{#if entry.free}<span class="when">free for any use</span>{/if}
          {#if element.year === entry.year}<Icon name="check" size={13} />{:else}<span class="room"></span>{/if}</button>
      {/each}
    </div>
    <p class="fm-note">One cloud-free picture of that year, made of many passes: it holds no single date.</p>
    {#if licence}<p class="fm-note">{licence}</p>{/if}
  {:else if element.basemap === SENTINEL_ID}
    <div class="fm-head">Sentinel-2 pass</div>
    {#if bound}<SentinelPicker {s2} inline {maxccLabel} {monthLabel} {monthGrid} {cloudClass} {cloudLabel} />{/if}
    <p class="fm-note">{passNote}</p>
  {/if}
  {#if layered}
    <div class="fm-sep"></div>
    <label class="fm-item layered" title={LAYERS_HINT}>
      <input type="checkbox" checked={element.layers_on === 'imagery'} onchange={(event) => (element.layers_on = event.currentTarget.checked ? 'imagery' : 'plate')} />
      <span class="fm-grow">Layers as they stood that day</span></label>
    <p class="fm-note">Its dated layers, legend and counts read that day, not the plate's.</p>
  {/if}
{:else}
  {#if element.basemap === WAYBACK_ID}
    <div class="rows">
      <span class="key">Release</span>
      <select aria-label="Wayback release" value={String(element.release ?? '')} onchange={(event) => setRelease(event.currentTarget.value)}>
        <option value="">Newest</option>
        {#each releases as entry (entry.release)}<option value={String(entry.release)}>{entry.date}</option>{/each}
      </select>
    </div>
  {:else if element.basemap === CLOUDLESS_ID}
    <div class="rows">
      <span class="key">Year</span>
      <select aria-label="Cloudless year" value={String(element.year ?? '')} onchange={(event) => setYear(event.currentTarget.value)}>
        <option value="">Newest</option>
        {#each years as entry (entry.year)}<option value={String(entry.year)}>{entry.year}{entry.free ? ', free for any use' : ''}</option>{/each}
      </select>
    </div>
    <p class="note">One cloud-free picture of that year, made of many passes: it holds no single date.</p>
    {#if licence}<p class="note">{licence}</p>{/if}
  {:else if element.basemap === SENTINEL_ID}
    {#if bound}
      <div class="rows">
        <span class="key">Pass</span>
        <span class="s2-pick"><SentinelPicker bind:menuEl {s2} {maxccLabel} {monthLabel} {monthGrid} {cloudClass} {cloudLabel} /></span>
      </div>
    {/if}
    <p class="note">{passNote}</p>
    <p class="note">One pass at 10 m a pixel, empty where it did not reach, its tiles spending your Copernicus quota.</p>
  {/if}
  {#if layered}
    <label class="check" title={LAYERS_HINT}>
      <input type="checkbox" checked={element.layers_on === 'imagery'} onchange={(event) => (element.layers_on = event.currentTarget.checked ? 'imagery' : 'plate')} />
      Layers as they stood that day</label>
    <p class="note">Its dated layers, legend and counts read that day, not the plate's.</p>
  {/if}
{/if}

<style>
  .rows { display: grid; grid-template-columns: 74px minmax(0, 1fr); align-items: center; gap: 7px 8px; margin: 8px 0; }
  .key { color: var(--text-3); font-size: 11px; }
  select { width: 100%; min-width: 0; height: 26px; padding: 3px 6px; font-size: var(--fs-xs); border-radius: var(--r-sm); }
  .note { margin: 6px 0; color: var(--text-3); font-size: 10.5px; line-height: 1.45; }
  .check { display: flex; align-items: center; gap: 6px; margin: 8px 0 0; cursor: pointer; }
  .s2-pick { display: flex; justify-content: flex-end; }
  /* the menu's list scrolls on its own, the switch under it staying in view */
  .days { flex: 0 1 auto; min-height: 0; max-height: 264px; overflow-y: auto; }
  .when { flex: none; color: var(--text-3); font-size: 11px; }
  .room { flex: none; width: 13px; }
  .layered input { flex: none; margin: 0; }
</style>
