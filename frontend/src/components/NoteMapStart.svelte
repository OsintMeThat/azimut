<script>
  /**
   * `/` › Interactive map › Start an empty map: frame a place, then draw on it in the note.
   *
   * The map here is the app's own (`MapSurface`), opened by the press that asked for it, so
   * its tiles are the ones that press needs. A place name is found on the Find press only:
   * the case's own gazetteer and coordinates first, the geocoder after (`/geo/suggest`,
   * `/geo/places`), never on a keystroke. Start files the ground of the frame once and makes
   * the map a personal layer of its own (`POST /notes/maps/scratch`); the map lands in the
   * note with its Draw tab open, where its points, lines and areas are put.
   */
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import MapSurface from '../tools/satellite/MapSurface.svelte';
  import { createImageryState, FALLBACK_PROVIDER } from '../tools/satellite/state/imagery.svelte.js';

  let { home = { lat: 20, lon: 10, zoom: 3 }, providers = [], title = $bindable(''), onstart, onback } = $props();

  const BASES = [
    { value: 'satellite', label: 'Satellite', title: 'The imagery shown here, filed once' },
    { value: 'map', label: 'Map', title: 'A street map from OpenStreetMap, filed once' },
    { value: 'topographic', label: 'Topographic', title: 'A topographic map from OpenTopoMap, filed once' },
    { value: 'dark', label: 'Dark', title: 'The street map drawn dark, filed once' },
  ];

  const imagery = createImageryState({ api });
  let providerId = $state(FALLBACK_PROVIDER);
  let engine = $state(null);
  let ready = $state(false);
  let base = $state('satellite');
  let query = $state('');
  let found = $state([]);
  let finding = $state(false);
  let said = $state('');

  onMount(() => {
    imagery.loadProviders().catch(() => {});
  });

  /** A place name or coordinates, looked up on this press: the case's own list first, the geocoder after. */
  async function find() {
    const asked = query.trim();
    if (!asked || finding) return;
    finding = true;
    said = '';
    try {
      const local = await api.get(`/api/geo/suggest?q=${encodeURIComponent(asked)}`).catch(() => null);
      const rows = [];
      if (local?.coords) rows.push({ name: `${local.coords.lat.toFixed(5)}, ${local.coords.lon.toFixed(5)}`, lat: local.coords.lat, lon: local.coords.lon, zoom: 14 });
      for (const city of local?.cities ?? []) rows.push({ name: `${city.name}, ${city.country_name}`, lat: city.lat, lon: city.lon, zoom: 12 });
      if (!local?.coords) {
        const remote = await api.get(`/api/geo/places?q=${encodeURIComponent(asked)}&limit=5`).catch(() => null);
        for (const place of remote?.places ?? []) rows.push({ name: place.display_name, lat: place.lat, lon: place.lon, zoom: 13 });
        if (remote?.busy) said = 'The place search is busy: press Find again in a moment.';
      }
      found = rows.slice(0, 8);
      if (!rows.length && !said) said = 'No place of that name. Pan the map to it instead.';
      if (rows.length === 1) go(rows[0]);
    } finally {
      finding = false;
    }
  }

  function go(place) {
    engine?.setView({ lat: place.lat, lon: place.lon }, place.zoom);
    found = [];
  }

  function start() {
    if (!engine) return;
    const { west, south, east, north } = engine.viewBounds();
    const provider = base === 'satellite' && providers.some((one) => one.id === providerId) ? providerId : undefined;
    onstart?.({ title: title.replace(/\s+/g, ' ').trim(), west, south, east, north, base, ...(provider ? { provider } : {}) });
  }
</script>

<div class="map-start">
  <label class="field">
    <span>Title</span>
    <input class="input" bind:value={title} maxlength="200" placeholder="The bridgehead, 1 to 15 October" />
  </label>
  <form class="find" onsubmit={(event) => { event.preventDefault(); find(); }}>
    <input class="input" bind:value={query} aria-label="A place or coordinates" placeholder="A place or coordinates" />
    <button type="submit" class="btn btn-ghost" disabled={!query.trim() || finding}>{finding ? 'Finding…' : 'Find'}</button>
  </form>
  {#if found.length}
    <ul class="found" aria-label="Places found">
      {#each found as place, index (index)}
        <li><button type="button" onclick={() => go(place)}>{place.name}</button></li>
      {/each}
    </ul>
  {:else if said}
    <p class="said">{said}</p>
  {/if}
  <div class="stage">
    <MapSurface bind:engine bind:ready bind:providerId {imagery} {home} controlsTop={8} />
  </div>
  <div class="base" role="radiogroup" aria-label="Base">
    <span>Base</span>
    {#each BASES as one (one.value)}
      <button type="button" role="radio" aria-checked={base === one.value} class:on={base === one.value} title={one.title}
        onclick={() => (base = one.value)}>{one.label}</button>
    {/each}
  </div>
  <p class="said">Pan and zoom until the map shows the place. Its ground is filed once, on Start, and you then draw points, lines and areas on it in the note.</p>
  <div class="actions">
    <button type="button" class="btn btn-ghost" onclick={() => onback?.()}>Back</button>
    <button type="button" class="btn btn-primary" disabled={!ready} onclick={start}>Start the map</button>
  </div>
</div>

<style>
  .map-start { display: flex; flex-direction: column; gap: 10px; }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-2); }
  .find { display: flex; gap: 6px; }
  .find .input { flex: 1; }
  .found { margin: 0; padding: 0; list-style: none; border: 1px solid var(--border); border-radius: 8px; max-height: 150px; overflow-y: auto; }
  .found li + li { border-top: 1px solid var(--border); }
  .found button { width: 100%; padding: 6px 10px; border: 0; background: none; color: var(--text-1); font: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
  .found button:hover, .found button:focus-visible { background: var(--surface-2); outline: none; }
  .stage { position: relative; display: flex; height: min(52vh, 440px); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .base { display: flex; align-items: center; gap: 4px; padding: 3px; border-radius: 8px; background: var(--surface-2); font-size: 12px; color: var(--text-2); }
  .base > span { padding: 0 8px 0 6px; }
  .base button { flex: 1; padding: 5px 8px; border: 0; border-radius: 6px; background: none; color: var(--text-2); font: inherit; font-size: 12.5px; cursor: pointer; }
  .base button.on { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: 0 1px 2px rgba(0, 0, 0, .18); }
  .said { margin: 0; font-size: 12px; color: var(--text-3); }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
