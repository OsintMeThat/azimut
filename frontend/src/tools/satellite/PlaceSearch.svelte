<script>
  /**
   * The Satellite search bar: type, and the matches come to you.
   *
   * Three of the four sources answer on the keystroke — saved work already in
   * memory, and one localhost call that parses coordinates and reads the
   * bundled city gazetteer. The fourth is the geocoder, which forbids being
   * asked on every letter, so it is asked once typing stops and its matches
   * arrive underneath the rest.
   *
   * Pressing Enter without choosing a row still does exactly what the plain box
   * did before this list existed: hand the text over to be parsed or geocoded.
   */
  import Icon from '../../components/Icon.svelte';
  import { api } from '../../lib/api.js';
  import {
    REMOTE_MIN_CHARS,
    buildGroups,
    flatten,
    matchSaved,
    pushRecent,
    readRecents,
    step,
  } from '../../lib/satSuggest.js';

  let {
    value = $bindable(''),
    savedRows = [],
    centre = null,
    units = 'metric',
    searching = false,
    onpick,
    onsubmit,
  } = $props();

  // Long enough that a fast typist makes one call per word, short enough that a
  // pause between words already shows the list.
  const LOCAL_DELAY = 120;
  // The geocoder's floor is one request a second; this keeps a typist under it
  // without a fixed queue, and the server drops what it cannot pace anyway.
  const REMOTE_DELAY = 650;

  let open = $state(false);
  let at = $state(-1); // highlighted row, -1 for none
  let coords = $state(null);
  let cities = $state([]);
  let places = $state([]);
  let recents = $state(readRecents());
  let boxEl = $state(null);
  let localTimer;
  let remoteTimer;
  // Every request carries the query it was made for; a late answer to an older
  // query is dropped rather than shown under a newer one.
  let localFor = '';
  let remoteFor = '';

  const groups = $derived(
    buildGroups({
      query: value,
      coords,
      saved: matchSaved(savedRows, value),
      cities,
      places,
      recents,
      centre,
      units,
    })
  );
  const rows = $derived(flatten(groups));

  function schedule(text) {
    clearTimeout(localTimer);
    clearTimeout(remoteTimer);
    const query = text.trim();
    if (!query) {
      coords = null;
      cities = [];
      places = [];
      localFor = remoteFor = '';
      return;
    }
    // A query that grows keeps the previous places on screen until better ones
    // land — a list that empties itself on every letter is unreadable.
    localTimer = setTimeout(() => askLocal(query), LOCAL_DELAY);
    if (query.length >= REMOTE_MIN_CHARS) {
      remoteTimer = setTimeout(() => askRemote(query), REMOTE_DELAY);
    } else {
      places = [];
    }
  }

  async function askLocal(query) {
    localFor = query;
    try {
      const body = await api.get(`/api/geo/suggest?q=${encodeURIComponent(query)}`);
      if (localFor !== query) return;
      coords = body.coords;
      cities = body.cities ?? [];
    } catch {
      /* the bar still works without suggestions */
    }
  }

  async function askRemote(query) {
    remoteFor = query;
    try {
      const body = await api.get(`/api/geo/places?q=${encodeURIComponent(query)}&limit=5`);
      if (remoteFor !== query) return;
      // `busy` means the request was dropped rather than queued: keep whatever
      // is on screen instead of blanking the group.
      if (!body.busy) places = body.places ?? [];
    } catch {
      /* offline, or nothing there — the local groups stand on their own */
    }
  }

  function oninput(event) {
    value = event.currentTarget.value;
    at = -1;
    open = true;
    schedule(value);
  }

  function choose(item) {
    open = false;
    at = -1;
    recents = pushRecent(item);
    onpick(item);
  }

  function onkeydown(event) {
    if (event.key === 'Escape') {
      open = false;
      at = -1;
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!open) open = true;
      event.preventDefault();
      at = step(at, event.key === 'ArrowDown' ? 1 : -1, rows.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (at >= 0 && rows[at]) choose(rows[at]);
      else {
        open = false;
        onsubmit(value);
      }
    }
  }

  function onWindowPointerDown(event) {
    if (open && !boxEl?.contains(event.target)) open = false;
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="place-search" bind:this={boxEl}>
  <div class="field">
    <input
      class="input"
      role="combobox"
      aria-expanded={open && rows.length > 0}
      aria-controls="sat-suggestions"
      aria-autocomplete="list"
      aria-activedescendant={at >= 0 && rows[at] ? `sat-suggestion-${at}` : undefined}
      autocomplete="off"
      aria-label="Search a place or coordinates"
      placeholder={'A place, or 50.4501, 30.5234'}
      title="A place name, or coordinates (decimal, DMS, MGRS, plus code)"
      {value}
      {oninput}
      {onkeydown}
      onfocus={() => (open = true)}
      onclick={() => (open = true)}
    />
    <button
      type="button"
      class="btn"
      disabled={!value.trim() || searching}
      onclick={() => onsubmit(value)}
    >
      <Icon name="search" size={15} /> {searching ? '…' : 'Go'}
    </button>
  </div>

  {#if open && groups.length}
    <div class="menu card" id="sat-suggestions" role="listbox" aria-label="Matches">
      {#each groups as group (group.id)}
        <p class="head">{group.label}</p>
        {#each group.items as item (item.key)}
          {@const index = rows.indexOf(item)}
          <button
            type="button"
            class="row"
            class:on={index === at}
            id={`sat-suggestion-${index}`}
            role="option"
            aria-selected={index === at}
            onmouseenter={() => (at = index)}
            onclick={() => choose(item)}
          >
            <span class="name">{item.label}</span>
            {#if item.detail}<span class="detail">{item.detail}</span>{/if}
            {#if item.away}<span class="away">{item.away}</span>{/if}
          </button>
        {/each}
      {/each}
      {#if groups.some((group) => group.id === 'cities')}
        <p class="credit">Cities from GeoNames, CC BY 4.0</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .place-search {
    position: relative;
    width: min(420px, 36vw);
  }
  .field {
    display: flex;
    gap: 8px;
  }
  .menu {
    position: absolute;
    z-index: 1200;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    max-height: min(52vh, 420px);
    overflow-y: auto;
    padding: 4px;
  }
  .head {
    padding: 6px 8px 3px;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-3);
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 5px 8px;
    border-radius: var(--r-sm);
    text-align: left;
    cursor: pointer;
  }
  .row.on {
    background: var(--bg-3);
  }
  /* not `.label`: the global one is a form label, uppercase and block */
  .name {
    font-size: var(--fs-sm);
    color: var(--text-1);
    white-space: nowrap;
  }
  .detail {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-xs);
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .credit {
    padding: 6px 8px 3px;
    border-top: 1px solid var(--border);
    margin-top: 4px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .away {
    flex-shrink: 0;
    font-size: var(--fs-xs);
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
</style>
