<script>
  import { onMount } from 'svelte';
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { api } from '../lib/api.js';
  import { caseState, uiState, ensureCase, reloadCase, toast } from '../lib/state.svelte.js';
  import Icon from '../components/Icon.svelte';

  let mapEl;
  let map;
  let tileLayer;
  let providers = $state([]);
  let providerId = $state('esri-world-imagery');
  let coordsText = $state('');
  let center = $state({ lat: 48.8584, lon: 2.2945, zoom: 16 });
  let size = $state('1000x700');
  let crosshair = $state(true);
  let capturing = $state(false);
  let captures = $state([]);
  let capturesFor = $state(null);

  onMount(async () => {
    providers = await api.get('/api/satellite/providers');
    map = L.map(mapEl, {
      center: [center.lat, center.lon],
      zoom: center.zoom,
      zoomControl: true,
      attributionControl: true,
    });
    setLayer();
    map.on('moveend zoomend', () => {
      const c = map.getCenter();
      center = { lat: c.lat, lon: c.lng, zoom: map.getZoom() };
    });
    return () => map.remove();
  });

  function setLayer() {
    const p = providers.find((x) => x.id === providerId);
    if (!p || !map) return;
    if (tileLayer) tileLayer.remove();
    tileLayer = L.tileLayer(p.url, {
      attribution: p.attribution,
      maxZoom: p.max_zoom,
    }).addTo(map);
  }

  $effect(() => {
    providerId; // track provider changes
    setLayer();
  });

  $effect(() => {
    const id = caseState.current?.id;
    if (id !== capturesFor) {
      capturesFor = id;
      captures = [];
      if (id) api.get(`/api/cases/${id}/satellite`).then((r) => (captures = r));
    }
  });

  async function goTo() {
    const text = coordsText.trim();
    if (!text) return;
    try {
      const parsed = await api.post('/api/geo/parse', { text });
      map.setView([parsed.lat, parsed.lon], Math.max(map.getZoom(), 16));
    } catch {
      toast('Could not parse coordinates — try "50.4501, 30.5234" or DMS', 'danger');
    }
  }

  async function captureCrop() {
    if (capturing) return;
    capturing = true;
    const [width, height] = size.split('x').map(Number);
    try {
      const c = await ensureCase();
      const result = await api.post(`/api/cases/${c.id}/satellite/capture`, {
        lat: center.lat,
        lon: center.lon,
        zoom: center.zoom,
        width,
        height,
        provider: providerId,
        crosshair,
      });
      captures = [result, ...captures];
      await reloadCase();
      toast(
        result.tiles_missing
          ? `Captured with ${result.tiles_missing} missing tile(s) — no imagery there`
          : 'Satellite crop captured & filed',
        result.tiles_missing ? 'warn' : 'ok'
      );
    } catch (e) {
      toast(`Capture failed: ${e.message}`, 'danger', 6000);
    } finally {
      capturing = false;
    }
  }

  async function removeCapture(item) {
    await api.del(
      `/api/cases/${caseState.current.id}/satellite?path=${encodeURIComponent(item.path)}`
    );
    captures = captures.filter((c) => c.path !== item.path);
  }

  function sendToComposer(item) {
    if (!uiState.composeQueue.includes(item.path)) uiState.composeQueue.push(item.path);
    uiState.tool = 'proof';
  }

  function fmt(value) {
    return value.toFixed(5);
  }

  async function copyCoords() {
    await navigator.clipboard.writeText(`${fmt(center.lat)}, ${fmt(center.lon)}`);
    toast('Coordinates copied', 'ok', 1600);
  }
</script>

<div class="tool">
  <div class="tool-header">
    <h2>Satellite</h2>
    <span class="sub">pan to a point, capture a sourced imagery crop</span>
    <div class="spacer"></div>
    <form
      class="go-form"
      onsubmit={(e) => {
        e.preventDefault();
        goTo();
      }}
    >
      <input
        class="input"
        placeholder={'50.4501, 30.5234  ·  48°51\'29"N 2°17\'40"E'}
        bind:value={coordsText}
      />
      <button type="submit" class="btn" disabled={!coordsText.trim()}>
        <Icon name="search" size={15} /> Go
      </button>
    </form>
  </div>

  <div class="body">
    <div class="map-wrap">
      <div class="map" bind:this={mapEl}></div>
      <div class="crosshair-overlay" class:hidden={!crosshair} aria-hidden="true">
        <svg width="46" height="46" viewBox="0 0 46 46">
          <g stroke="#000" stroke-width="4" opacity="0.55">
            <line x1="1" y1="23" x2="16" y2="23" /><line x1="30" y1="23" x2="45" y2="23" />
            <line x1="23" y1="1" x2="23" y2="16" /><line x1="23" y1="30" x2="23" y2="45" />
          </g>
          <g stroke="#fff" stroke-width="2">
            <line x1="1" y1="23" x2="16" y2="23" /><line x1="30" y1="23" x2="45" y2="23" />
            <line x1="23" y1="1" x2="23" y2="16" /><line x1="23" y1="30" x2="23" y2="45" />
            <circle cx="23" cy="23" r="2.5" fill="none" />
          </g>
        </svg>
      </div>

      <div class="hud card">
        <button class="hud-coords mono" onclick={copyCoords} title="Copy coordinates">
          <Icon name="crosshair" size={13} />
          {fmt(center.lat)}, {fmt(center.lon)}
          <span class="z">z{center.zoom}</span>
          <Icon name="copy" size={12} />
        </button>
      </div>

      <div class="capture-bar card">
        <select class="select" bind:value={providerId} title="Imagery provider">
          {#each providers as p (p.id)}
            <option value={p.id} disabled={p.needs_key}>
              {p.label}{p.needs_key ? ' (needs API key)' : ''}
            </option>
          {/each}
        </select>
        <select class="select" bind:value={size} title="Crop size">
          <option value="800x600">800 × 600</option>
          <option value="1000x700">1000 × 700</option>
          <option value="1280x800">1280 × 800</option>
          <option value="1000x1000">1000 × 1000</option>
        </select>
        <label class="check">
          <input type="checkbox" bind:checked={crosshair} /> crosshair
        </label>
        <button class="btn btn-primary" onclick={captureCrop} disabled={capturing}>
          {#if capturing}
            <span class="spinner"></span> Capturing…
          {:else}
            <Icon name="satellite" size={15} /> Capture
          {/if}
        </button>
      </div>
    </div>

    <aside class="captures">
      <div class="cap-head">
        <span class="label" style="margin:0">Captures</span>
        <span class="count">{captures.length}</span>
      </div>
      {#if !captures.length}
        <div class="none">
          Captured crops land in the case with full provenance: provider, zoom, date,
          attribution.
        </div>
      {:else}
        <div class="cap-list">
          {#each captures as item (item.path)}
            <div class="cap card fade-up">
              <img
                src={`/files/${caseState.current.id}/${item.path}`}
                alt={item.filename}
                loading="lazy"
              />
              <div class="cap-meta">
                <span class="mono coords">{item.lat.toFixed(5)}, {item.lon.toFixed(5)}</span>
                <span class="prov">z{item.zoom} · {item.provider_label} · {item.fetched_at?.slice(0, 10)}</span>
              </div>
              <div class="cap-actions">
                <button
                  class="btn btn-ghost btn-sm"
                  title="Send to Proof Composer"
                  onclick={() => sendToComposer(item)}
                >
                  <Icon name="proof" size={14} />
                </button>
                <a
                  class="btn btn-ghost btn-sm"
                  href={`/files/${caseState.current.id}/${item.path}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Open"
                >
                  <Icon name="external" size={14} />
                </a>
                <button
                  class="btn btn-ghost btn-sm"
                  title="Delete"
                  onclick={() => removeCapture(item)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </aside>
  </div>
</div>

<style>
  .spacer {
    flex: 1;
  }
  .go-form {
    display: flex;
    gap: 8px;
    width: min(420px, 36vw);
  }
  .body {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .map-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  .map {
    position: absolute;
    inset: 0;
    background: var(--bg-2);
  }
  .crosshair-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 500;
  }
  .crosshair-overlay.hidden {
    display: none;
  }
  .hud {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 600;
    background: rgba(16, 22, 35, 0.88);
    backdrop-filter: blur(6px);
  }
  .hud-coords {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 13px;
    font-size: var(--fs-sm);
    color: var(--text-1);
  }
  .hud-coords:hover {
    color: var(--accent);
  }
  .z {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .capture-bar {
    position: absolute;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 600;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    background: rgba(16, 22, 35, 0.92);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-2);
  }
  .capture-bar .select {
    width: auto;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-sm);
    color: var(--text-2);
    user-select: none;
    white-space: nowrap;
  }
  .check input {
    accent-color: var(--accent);
  }
  .spinner {
    width: 13px;
    height: 13px;
    border: 2px solid var(--accent-text);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .captures {
    width: 300px;
    flex-shrink: 0;
    border-left: 1px solid var(--border);
    background: var(--bg-1);
    display: flex;
    flex-direction: column;
  }
  .cap-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 14px 8px;
  }
  .count {
    font-size: var(--fs-xs);
    color: var(--text-3);
    font-weight: 600;
  }
  .none {
    padding: 8px 14px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .cap-list {
    flex: 1;
    overflow-y: auto;
    padding: 6px 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .cap {
    overflow: hidden;
  }
  .cap img {
    width: 100%;
    aspect-ratio: 10 / 7;
    object-fit: cover;
    background: var(--bg-2);
  }
  .cap-meta {
    padding: 8px 10px 2px;
    display: flex;
    flex-direction: column;
  }
  .coords {
    font-size: var(--fs-xs);
    color: var(--text-1);
  }
  .prov {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .cap-actions {
    display: flex;
    gap: 2px;
    padding: 4px 6px 6px;
  }

  /* Leaflet dark-theme adjustments */
  :global(.leaflet-container) {
    font-family: var(--font-sans);
    background: var(--bg-2);
  }
  :global(.leaflet-control-attribution) {
    background: rgba(16, 22, 35, 0.85) !important;
    color: var(--text-3) !important;
    font-size: 10px;
  }
  :global(.leaflet-control-attribution a) {
    color: var(--text-2) !important;
  }
  :global(.leaflet-bar a) {
    background: var(--bg-2) !important;
    color: var(--text-1) !important;
    border-color: var(--border) !important;
  }
  :global(.leaflet-bar a:hover) {
    background: var(--bg-3) !important;
  }
</style>
