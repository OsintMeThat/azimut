<script>
  /**
   * Which clock a chronology is read on.
   *
   * Five kinds of answer, in one searchable list because picking between them is one
   * decision:
   *
   * - **Where the case is**, the zone most of its places stand in (`lib/caseClock.js`),
   *   which is what a chronology opens on: an investigation argues in the local time of
   *   where things happened.
   * - **UTC**, what the case stores and the only reading that means the same thing on
   *   every machine.
   * - **This computer**, a legitimate reading of the analyst's own working day.
   * - **A saved point**, which is the reading the work usually wants *and* the only one
   *   that can carry daylight with it: a band of day and night needs coordinates.
   * - **Any zone in the world**, because an investigation is rarely in the analyst's
   *   own zone and often in no point the case has saved yet.
   *
   * Searchable rather than a four-hundred-row select, the way every other long picker
   * in this app works. A zone is named rather than offered as an offset: a name carries
   * the rules, so a stated hour survives the two days a year the offset moves.
   */
  import {
    UTC,
    machineZone,
    offsetLabel,
    worldZones,
    zoneMatches,
    zoneWords,
  } from '../lib/timeline.js';
  import { foldText } from '../lib/textFold.js';
  import { caseZoneWords } from '../lib/caseClock.js';
  import Icon from './Icon.svelte';
  import SearchInput from './SearchInput.svelte';

  let {
    /** `case` | `utc` | `machine` | `zone:<IANA>` | `place:<id>` */
    choice = $bindable('case'),
    /** The case's saved points, as `{ id, label }`. */
    places = [],
    /** The zone the case's places stand in, `{ zone, count, of }`, or null when it has
     *  none: then `case` reads as UTC and says so. */
    home = null,
    /** The instant the offsets are shown at: the window's own start, not today, or a
     *  winter window would be labelled with a summer offset. */
    at = 0,
    /** What the parent resolved the choice to, for the trigger's own label. */
    resolved = UTC,
    disabled = false,
    /** Told the analyst's pick, so the parent can keep it. */
    onpick,
  } = $props();

  /** How many zones the list shows before it asks for a narrower term. Long enough to
   *  browse a region, short enough not to be a wall. */
  const ROWS = 40;

  let open = $state(false);
  let query = $state('');
  let box = $state(null);

  const local = machineZone();
  const zones = worldZones();
  const matching = $derived(zones.filter((zone) => zoneMatches(zone, query, at)));
  const shown = $derived(matching.slice(0, ROWS));
  const matchingPlaces = $derived(
    places.filter((place) =>
      foldText(place.label).includes(foldText(query.trim()))
    )
  );

  /** What the button says. The point's or zone's own words, never the raw choice. */
  const label = $derived.by(() => {
    if (choice === 'case') return home ? zoneWords(home.zone).place : 'UTC';
    if (choice === 'utc') return 'UTC';
    if (choice === 'machine') return zoneWords(local).place;
    if (choice.startsWith('place:')) {
      return places.find((place) => place.id === choice.slice(6))?.label ?? 'Saved point';
    }
    return zoneWords(choice.slice(5)).place;
  });

  $effect(() => {
    if (!open || typeof document === 'undefined') return;
    const closeOutside = (event) => {
      if (!box?.contains(event.target)) open = false;
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  });

  function pick(value) {
    choice = value;
    open = false;
    query = '';
    onpick?.(value);
  }
</script>

<div class="zone-picker" bind:this={box}>
  <button
    class="trigger"
    {disabled}
    aria-expanded={open}
    title={choice === 'case' && home ? `The clock of ${caseZoneWords(home)}` : 'Which clock the axis is labelled with'}
    onclick={() => (open = !open)}
  >
    <Icon name="clock" size={12} />
    <span>{label}</span>
    <!-- The offset, unless the name already is it: `UTC UTC` said one thing twice. -->
    {#if label !== 'UTC'}<small>{offsetLabel(resolved, at)}</small>{/if}
  </button>

  {#if open}
    <div class="menu">
      <SearchInput bind:value={query} placeholder="Search a zone or a point…" width="100%" />
      <div class="rows">
        {#if home && zoneMatches(home.zone, query, at)}
          <button class:on={choice === 'case'} onclick={() => pick('case')}>
            <span>{zoneWords(home.zone).place}</span>
            <small>{caseZoneWords(home)} · {offsetLabel(home.zone, at)}</small>
          </button>
        {/if}
        {#if zoneMatches('UTC', query, at)}
          <button class:on={choice === 'utc' || (choice === 'case' && !home)} onclick={() => pick('utc')}>
            <span>UTC</span><small>what the case stores</small>
          </button>
        {/if}
        {#if local !== UTC && zoneMatches(local, query, at)}
          <button class:on={choice === 'machine'} onclick={() => pick('machine')}>
            <span>{zoneWords(local).place}</span>
            <small>this computer · {offsetLabel(local, at)}</small>
          </button>
        {/if}

        {#if matchingPlaces.length}
          <!-- Named apart because picking one does a second thing: a point has
               coordinates, so its daylight can be drawn under the ruler. -->
          <p class="heading">Saved points · with daylight</p>
          {#each matchingPlaces as place (place.id)}
            <button class:on={choice === `place:${place.id}`} onclick={() => pick(`place:${place.id}`)}>
              <span>{place.label}</span><small>local time and daylight</small>
            </button>
          {/each}
        {/if}

        {#if zones.length}
          <p class="heading">Anywhere in the world</p>
          {#each shown as zone (zone)}
            {@const words = zoneWords(zone)}
            <button class:on={choice === `zone:${zone}`} onclick={() => pick(`zone:${zone}`)}>
              <span>{words.place}</span>
              <small>{words.region} · {offsetLabel(zone, at)}</small>
            </button>
          {/each}
          {#if matching.length > shown.length}
            <p class="more">{matching.length - shown.length} more. Keep typing.</p>
          {:else if !matching.length && !matchingPlaces.length}
            <p class="more">No zone or point matches that.</p>
          {/if}
        {:else}
          <p class="more">This browser cannot list world zones. UTC and this computer still work.</p>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .zone-picker { position: relative; }
  .trigger {
    display: inline-flex; align-items: center; gap: 5px; height: 24px;
    padding: 0 7px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-2); color: var(--text-2); font-size: 10px; cursor: pointer;
  }
  .trigger:hover:not(:disabled) { border-color: var(--border-strong); color: var(--text-1); }
  .trigger:disabled { opacity: .5; cursor: default; }
  .trigger small { color: var(--text-3); font-variant-numeric: tabular-nums; }
  .menu {
    position: absolute; z-index: 45; top: calc(100% + 5px); left: 0;
    width: 268px; display: grid; gap: 5px; padding: 7px;
    border: 1px solid var(--border-strong); border-radius: var(--r-md);
    background: var(--bg-1); box-shadow: var(--shadow-2);
  }
  .rows { max-height: 236px; overflow: auto; }
  .rows > button {
    width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline; gap: 8px; padding: 5px 6px; border: 0; border-radius: var(--r-sm);
    background: none; color: var(--text-2); font-size: var(--fs-xs); text-align: left;
    cursor: pointer;
  }
  .rows > button:hover { background: var(--bg-2); color: var(--text-1); }
  .rows > button.on { background: var(--accent-soft); color: var(--text-1); }
  .rows > button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rows > button small { color: var(--text-3); font-size: 9px; white-space: nowrap; }
  .heading {
    margin: 7px 0 3px; padding: 0 6px; color: var(--text-3); font-size: 9px;
  }
  .more { margin: 5px 0 2px; padding: 0 6px; color: var(--text-3); font-size: 9px; }
</style>
