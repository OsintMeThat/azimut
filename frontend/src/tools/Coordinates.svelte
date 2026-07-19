<script>
  // Coordinates — paste one point in any notation, read it back in every
  // other, and jump to the nine external maps. Conversion runs on the local
  // backend; converting also triggers a Nominatim reverse-geocode for the
  // place name (the app's local-first rule names geocoding as one of the
  // actions that inherently needs the network), reported as "Not available"
  // if that call fails.
  import { api } from '../lib/api.js';
  import { toast, uiState } from '../lib/state.svelte.js';
  import { mapLinks } from '../lib/maplinks.js';
  import { bidiSafe } from '../lib/bidi.js';
  import Icon from '../components/Icon.svelte';

  // Mirrors the label order of engine/geo.py's all_formats(), so the empty
  // state can preview the field list before any coordinate is parsed.
  const EMPTY_FORMATS = [
    { id: 'dd', label: 'Decimal' },
    { id: 'ddm', label: 'Deg. decimal min.' },
    { id: 'dms', label: 'Deg. min. sec.' },
    { id: 'utm', label: 'UTM' },
    { id: 'mgrs', label: 'MGRS' },
    { id: 'plus_code', label: 'Plus code' },
    { id: 'geohash', label: 'Geohash' },
  ];

  let text = $state('');
  let point = $state(null); // { lat, lon, formats: [{id,label,value}] }
  let parsing = $state(false);
  let place = $state(null); // reverse-geocode result
  let placeLoading = $state(false);

  // Link labels don't depend on lat/lon, so this also drives the empty-state preview.
  const links = $derived(mapLinks(point?.lat ?? 0, point?.lon ?? 0));

  async function parse() {
    const value = text.trim();
    if (!value || parsing) return;
    parsing = true;
    place = null;
    try {
      point = await api.post('/api/geo/parse', { text: value });
      lookupPlace();
    } catch {
      point = null;
      toast('Could not read a coordinate from that', 'danger');
    } finally {
      parsing = false;
    }
  }

  async function copy(value) {
    await navigator.clipboard.writeText(bidiSafe(value));
    toast('Copied', 'ok', 1400);
  }

  async function lookupPlace() {
    if (!point) return;
    placeLoading = true;
    try {
      const res = await api.get(`/api/geo/reverse?lat=${point.lat}&lon=${point.lon}`);
      place = res.display_name || 'Not available';
    } catch {
      place = 'Not available';
    } finally {
      placeLoading = false;
    }
  }

  // Hand the point to the Satellite map and switch tabs; it consumes
  // uiState.gotoCoords on the next tick and flies there (lib/navigate.js).
  function openInSatellite() {
    if (!point) return;
    uiState.gotoCoords = { lat: point.lat, lon: point.lon };
    uiState.tool = 'satellite';
  }
</script>

<div class="tool">
  <div class="tool-header">
    <h2>Coordinates</h2>
  </div>

  <div class="tool-body">
    <form
      class="go-form"
      onsubmit={(e) => {
        e.preventDefault();
        parse();
      }}
    >
      <input
        class="input"
        placeholder={'Paste any coordinate: 48.8584, 2.2945  ·  DMS  ·  UTM  ·  MGRS  ·  plus code  ·  geohash'}
        bind:value={text}
        title="Decimal, degrees-minutes-seconds, degrees-decimal-minutes, UTM, MGRS, plus code or geohash"
      />
      <button type="submit" class="btn" disabled={!text.trim() || parsing}>
        <Icon name="search" size={15} /> {parsing ? '…' : 'Convert'}
      </button>
    </form>

    <div class="sheet">
      <div class="head-row">
        <span class="place" class:muted={!point || placeLoading}>
          {#if !point}
            Paste a coordinate to read it back in every notation.
          {:else if placeLoading}
            Resolving place…
          {:else}
            {place}
          {/if}
        </span>
        <button
          class="btn btn-sm"
          disabled={!point}
          onclick={openInSatellite}
          title="Open this point on the Satellite map"
        >
          <Icon name="crosshair" size={14} /> View in Satellite
        </button>
      </div>

      <div class="formats">
        {#if point}
          {#each point.formats as f (f.id)}
            <button class="row" onclick={() => copy(f.value)} title="Copy">
              <span class="k">{f.label}</span>
              <span class="v mono">{f.value}</span>
              <Icon name="copy" size={13} />
            </button>
          {/each}
        {:else}
          {#each EMPTY_FORMATS as f (f.id)}
            <div class="row row-empty">
              <span class="k">{f.label}</span>
              <span class="v mono">–</span>
            </div>
          {/each}
        {/if}
      </div>

      <div class="open-on">
        <span class="open-label">Open on</span>
        <div class="links">
          {#each links as l (l.id)}
            {#if point}
              <a class="ext-link" href={l.url} target="_blank" rel="noreferrer">
                {l.label}<Icon name="external" size={11} />
              </a>
            {:else}
              <span class="ext-link disabled">{l.label}</span>
            {/if}
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .go-form {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 16px 16px 0;
    max-width: 720px;
  }
  .go-form .input {
    flex: 1;
  }
  .sheet {
    display: flex;
    flex-direction: column;
    padding: 16px;
    max-width: 720px;
  }
  .head-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
  .head-row .place {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-md);
    color: var(--text-1);
    overflow-wrap: anywhere;
  }
  .head-row .place.muted {
    color: var(--text-3);
  }
  .head-row .btn {
    flex-shrink: 0;
    white-space: nowrap;
  }
  .formats {
    display: flex;
    flex-direction: column;
    padding: 4px 0;
    border-bottom: 1px solid var(--border);
  }
  .row {
    display: grid;
    grid-template-columns: 150px 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 7px 8px;
    text-align: left;
    background: none;
    border: 0;
    border-radius: 4px;
    color: inherit;
    cursor: pointer;
  }
  .row:hover {
    background: var(--bg-2);
  }
  .row .k {
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
  .row .v {
    overflow-wrap: anywhere;
  }
  .row :global(svg) {
    color: var(--text-3);
    opacity: 0;
  }
  .row:hover :global(svg) {
    opacity: 1;
  }
  .row-empty {
    cursor: default;
  }
  .row-empty .v {
    color: var(--text-3);
  }
  .open-on {
    display: flex;
    align-items: baseline;
    gap: 14px;
    padding-top: 14px;
  }
  .open-label {
    flex-shrink: 0;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
  }
  .ext-link {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: var(--fs-sm);
    color: var(--text-2);
    text-decoration: none;
  }
  .ext-link :global(svg) {
    color: var(--text-3);
  }
  .ext-link:hover {
    color: var(--accent);
  }
  .ext-link:hover :global(svg) {
    color: var(--accent);
  }
  .ext-link.disabled {
    color: var(--text-3);
    opacity: 0.6;
  }
</style>
