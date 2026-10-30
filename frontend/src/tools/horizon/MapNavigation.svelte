<script>
  import { api } from '../../lib/api.js';
  import { toast, uiState } from '../../lib/state.svelte.js';
  import { turnFromKey, turnFromPress } from '../../lib/map/gestures.js';
  import Compass from '../../components/Compass.svelte';
  import TurnGuide from '../../components/TurnGuide.svelte';
  import PlaceSearch from '../satellite/PlaceSearch.svelte';

  let {
    engine,
    view,
    bearing = 0,
    units = 'metric',
    active = true,
    value = $bindable(''),
    listId = 'horizon-suggestions',
    // Picking or moving a viewpoint still stands at typed coordinates.
    oncoordinates = null,
  } = $props();

  let searching = $state(false);
  let rotating = $state(null);

  $effect(() => {
    if (!active || uiState.tool !== 'horizon' || !engine) return;
    const map = engine;
    const container = map.container;
    const down = (event) => turnFromPress(map, event, {
      onPivot: (point) => (rotating = point),
      onEnd: () => (rotating = null),
    });
    const key = (event) => {
      if (container.contains(event.target) || container.matches(':hover')) turnFromKey(map, event);
    };
    container.addEventListener('mousedown', down, true);
    document.addEventListener('keydown', key);
    return () => {
      container.removeEventListener('mousedown', down, true);
      document.removeEventListener('keydown', key);
    };
  });

  function locate(point, coordinates = false) {
    if (coordinates && oncoordinates) oncoordinates(point);
    else engine?.setView(point, point.zoom ?? Math.max(engine.getZoom(), 13));
  }

  async function goTo() {
    const text = value.trim();
    if (!text || searching) return;
    searching = true;
    try {
      let parsed = null;
      try {
        parsed = await api.post('/api/geo/parse', { text });
      } catch {
        // Not coordinates: ask for a place name.
      }
      if (parsed) locate(parsed, true);
      else locate(await api.get(`/api/geo/geocode?q=${encodeURIComponent(text)}`));
    } catch {
      toast('No match. Try coordinates ("50.4501, 30.5234"), DMS, or a place name', 'danger');
    } finally {
      searching = false;
    }
  }

  function pick(item) {
    if (Number.isFinite(item.lat) && Number.isFinite(item.lon)) locate(item, item.group === 'coords');
  }
</script>

<div class="map-search">
  <PlaceSearch
    bind:value
    centre={view ? { lat: view.lat, lon: view.lon } : null}
    {units}
    {searching}
    {listId}
    onpick={pick}
    onsubmit={goTo}
  />
</div>
<div class="map-compass">
  <Compass {bearing} onbearing={(deg) => engine?.setBearing(deg)} />
</div>
{#if rotating}
  <TurnGuide x={rotating.x} y={rotating.y} />
{/if}

<style>
  /* one over the compass under it, so the suggestions open over it */
  .map-search {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 661;
    width: min(380px, calc(100% - 20px));
  }
  .map-search :global(.place-search) {
    width: 100%;
  }
  .map-compass {
    position: absolute;
    top: 134px;
    left: 10px;
    z-index: 660;
  }
</style>
