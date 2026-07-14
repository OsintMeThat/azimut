<script>
  import { onMount, tick } from 'svelte';
  import L from 'leaflet';
  import 'leaflet/dist/leaflet.css';
  import { api } from '../lib/api.js';
  import { caseState, uiState, ensureCase, reloadCase, toast } from '../lib/state.svelte.js';
  import { mapLinks } from '../lib/maplinks.js';
  import * as measure from '../lib/measure.js';
  import { dragBearing, pivotPanOffset } from '../lib/satRotate.js';
  import { SIZE_MIN, SIZE_MAX, clampSize, scaledCapture } from '../lib/captureSize.js';
  import { monthCount, tilesShort } from '../lib/usage.js';
  import { createViewer, nextZ, restack } from '../lib/refViewers.js';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import RefViewer from './RefViewer.svelte';

  let mapEl;
  let toolEl; // tool root — target of the real (browser) fullscreen (item 5)
  let map;
  let tileLayer;
  let providers = $state([]);
  let providerId = $state('esri-world-imagery');
  let coordsText = $state('');
  let center = $state({ lat: 48.8584, lon: 2.2945, zoom: 16 });
  let markerStyle = $state('none'); // 'crosshair' | 'pin' | 'none' — clean view by default (item 4)
  let moveMode = $state(false); // pin decoupled from center, draggable
  let marker = null; // Leaflet marker instance while in move mode
  let markerLatLng = $state(null); // {lat, lon} of the moved pin
  let bearing = $state(0);
  // Middle-drag rotation: a sober "target" marks the grabbed point and the map
  // turns around it (Google-Earth style, mirrors the Frame viewer).
  let rotating = $state(false);
  let rotatePivot = $state({ x: 0, y: 0 }); // grabbed point, map-wrap-local px
  let capturing = $state(false);
  let captureHover = $state(false); // previewing the crop frame (capture group hover)
  let captures = $state([]);
  let capturesFor = $state(null);
  let capturesCollapsed = $state(false);
  let mapReady = $state(false);

  // OSM labels overlay: a transparent labels-only layer laid over the imagery so
  // roads / place names are readable without hiding the satellite view (item 1).
  let osmOverlay = $state(false);
  let labelsLayer = null;
  const LABELS_URL =
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png';
  // The labels overlay only makes sense over satellite imagery — over a street
  // base map (OSM) it just doubles the road/place labels, so it's disabled then
  // and force-off if the provider changes to a non-imagery one (item 1).
  const currentProvider = $derived(providers.find((p) => p.id === providerId));
  const baseIsImagery = $derived(currentProvider?.imagery ?? true);
  // view-only basemaps (capturable=false) keep the map but not the capture
  // button (KEYED_PROVIDERS.md §4) — none built-in today, gate wired anyway
  const captureBlocked = $derived(currentProvider?.capturable === false);

  // --- keyed-provider usage (KEYED_PROVIDERS.md §6) ---
  // Metered tiles are proxied through the backend, which counts each one it
  // actually serves — this readout just mirrors settings.json.
  let usageTotals = $state({});
  let usageMonth = $state('');
  async function refreshUsage() {
    try {
      const s = await api.get('/api/settings');
      usageTotals = s.usage;
      usageMonth = s.month;
    } catch {
      /* readout only — never blocks the map */
    }
  }
  // small readout near the basemap selector, billed providers only
  const usagePill = $derived(
    currentProvider?.meter
      ? tilesShort(monthCount(usageTotals, currentProvider.meter, usageMonth))
      : null
  );

  // Acquisition date of the imagery under the crosshair — Esri only (item 2).
  let imageryDate = $state(null); // { supported, date, source } | null
  let dateReqId = 0;
  let dateTimer;

  // Fullscreen: the tool covers the whole viewport; SAVED stays collapsible (item 4).
  let fullscreen = $state(false);

  // Editable bearing readout (item 3): click the number to type an angle.
  let editingBearing = $state(false);
  let bearingInput = $state('');

  // Measure tools (item 5): distance / area / angle drawn on the map.
  let measureMode = $state(null); // null | 'distance' | 'area' | 'angle'
  let measurePoints = $state([]);
  let measureLayer = null;
  let toolsOpen = $state(false);

  // External-maps quick links, in the SAVED panel (item 6).
  let linksOpen = $state(false);

  // --- reference viewers: floating scratch windows over the map that hold a
  // media image (the shot to geolocate) so you can eyeball it against the
  // imagery while panning. Session-only (uiState.refViewers) — never captured,
  // never saved, dropped when the case changes (see openCase).
  let refPicker = $state(false); // the "pick an image" modal
  let refMedia = $state([]); // case images available to reference
  let refLoading = $state(false);
  let refSeq = 0; // id source for spawned windows

  async function openRefPicker() {
    refPicker = true;
    refLoading = true;
    try {
      const id = caseState.current?.id;
      const media = id ? await api.get(`/api/cases/${id}/media`) : [];
      refMedia = media.filter((m) => m.kind === 'image' || m.kind === 'video');
    } catch (e) {
      toast(`Could not load media: ${e.message}`, 'danger');
      refMedia = [];
    } finally {
      refLoading = false;
    }
  }

  function addRef(item) {
    const vs = uiState.refViewers;
    const n = vs.length;
    vs.push(
      createViewer(`ref-${++refSeq}`, item, {
        x: 60 + (n % 6) * 26,
        y: 60 + (n % 6) * 26,
        z: nextZ(vs),
      })
    );
    refPicker = false;
  }

  function focusRef(id) {
    const z = restack(uiState.refViewers, id);
    for (const v of uiState.refViewers) v.z = z.get(v.id);
  }

  function closeRef(id) {
    uiState.refViewers = uiState.refViewers.filter((v) => v.id !== id);
  }

  onMount(async () => {
    providers = await api.get('/api/satellite/providers');
    // leaflet-rotate patches the global L, so expose it before importing.
    window.L = L;
    await import('leaflet-rotate');
    map = L.map(mapEl, {
      center: [center.lat, center.lon],
      zoom: center.zoom,
      zoomControl: false,
      attributionControl: true,
      rotate: true,
      rotateControl: false,
      touchRotate: true,
      shiftKeyRotate: true,
    });
    setLayer();
    setOverlay();
    // stacked below the top-left tool cluster (fullscreen/labels/measure) via
    // CSS offset below, instead of Leaflet's default corner margin
    L.control.zoom({ position: 'topleft' }).addTo(map);
    // judging feature sizes (buildings, roads) needs a scale reference
    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);
    map.on('moveend zoomend', () => {
      const c = map.getCenter();
      center = { lat: c.lat, lon: c.lng, zoom: map.getZoom() };
    });
    map.on('rotate', () => {
      bearing = Math.round(map.getBearing());
    });
    map.on('click', onMapClick);
    // keep tiles seam-free (see deSeamTiles): re-flatten after any reposition,
    // and un-flatten right before a zoom so the reposition doesn't double-offset
    map.on('moveend zoomend viewreset rotateend', scheduleDeSeam);
    map.on('zoomstart', reSeamTiles);
    // middle-mouse drag rotates the view (item 3). Capture-phase so we can stop
    // the event before Leaflet's own container drag handler (which treats the
    // middle button as a pan) ever sees it — otherwise a turn also pans.
    mapEl.addEventListener('mousedown', onMiddleRotateStart, true);
    // left-drag draws the capture marquee when that mode is armed (capture-phase
    // so Leaflet's pan handler never sees the gesture)
    mapEl.addEventListener('mousedown', onSelectStart, true);
    window.addEventListener('keydown', onKeydown);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    mapReady = true;
    return () => {
      window.removeEventListener('keydown', onKeydown);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      map.remove();
    };
  });

  function onKeydown(e) {
    if (uiState.tool !== 'satellite' || e.key !== 'Escape') return;
    if (selectArmed) toggleSelect();
    else if (sizeMenuOpen) sizeMenuOpen = false;
    else if (measureMode) setMeasureMode(null);
    // native fullscreen already exits on Esc (handled by onFullscreenChange);
    // only the CSS fallback needs an explicit toggle here
    else if (fullscreen && !document.fullscreenElement) toggleFullscreen();
  }

  // --- OSM labels overlay (item 1) ---
  function setOverlay() {
    if (!map) return;
    if (osmOverlay && !labelsLayer) {
      labelsLayer = L.tileLayer(LABELS_URL, {
        subdomains: 'abcd',
        maxZoom: 20,
        pane: 'overlayPane', // above the imagery tiles, below markers/controls
        attribution: '© OpenStreetMap contributors © CARTO',
      }).addTo(map);
      labelsLayer.on('load tileload', scheduleDeSeam); // keep overlay seam-free too
    } else if (!osmOverlay && labelsLayer) {
      labelsLayer.remove();
      labelsLayer = null;
    }
  }

  // force the labels overlay off whenever the base isn't imagery (item 1)
  $effect(() => {
    if (!baseIsImagery && osmOverlay) osmOverlay = false;
  });

  $effect(() => {
    osmOverlay; // toggle the labels overlay
    setOverlay();
  });

  // --- imagery date under the crosshair (item 2) ---
  async function refreshImageryDate() {
    const id = ++dateReqId;
    try {
      const r = await api.get(
        `/api/satellite/imagery-date?lat=${center.lat}&lon=${center.lon}` +
          `&zoom=${center.zoom}&provider=${providerId}`
      );
      if (id === dateReqId) imageryDate = r;
    } catch {
      if (id === dateReqId) imageryDate = { supported: true, date: null, source: null };
    }
  }

  // debounce: the target moves a lot while panning — only query once it settles
  $effect(() => {
    center.lat;
    center.lon;
    center.zoom;
    providerId;
    if (!mapReady) return;
    clearTimeout(dateTimer);
    dateTimer = setTimeout(refreshImageryDate, 500);
  });

  // --- middle-drag rotate (item 3), Google-Earth style ---
  // Grab a point → the map turns around *that* point (not the centre) as the
  // cursor sweeps, with a sober target marking the pivot. Leaflet only rotates
  // about the centre, so after each bearing change we pan the grabbed geographic
  // point back under the cursor — keeping it pinned exactly where you grabbed.
  const ROTATE_DEADZONE = 8; // px to leave the pivot before the spoke is fixed
  function onMiddleRotateStart(e) {
    if (e.button !== 1 || !map) return;
    // own the gesture: no Leaflet pan, no browser middle-click autoscroll
    e.stopPropagation();
    e.preventDefault();
    const rect = mapEl.getBoundingClientRect();
    const grab = L.point(e.clientX - rect.left, e.clientY - rect.top);
    const pivotLatLng = map.containerPointToLatLng(grab); // the pinned location
    const startBearing = map.getBearing();
    const startScreen = { x: e.clientX, y: e.clientY };
    rotatePivot = { x: grab.x, y: grab.y };
    rotating = true;
    let startAngle = null; // reference spoke, fixed once out of the deadzone
    const move = (ev) => {
      if (startAngle === null) {
        if (Math.hypot(ev.clientX - startScreen.x, ev.clientY - startScreen.y) < ROTATE_DEADZONE) return;
        startAngle = { x: ev.clientX, y: ev.clientY };
        return;
      }
      setBearing(dragBearing(startBearing, startScreen, startAngle, { x: ev.clientX, y: ev.clientY }));
      // re-pin: pan the grabbed location back under the grab point
      const now = map.latLngToContainerPoint(pivotLatLng);
      const [dx, dy] = pivotPanOffset(grab, now);
      if (dx || dy) map.panBy([dx, dy], { animate: false });
    };
    const up = () => {
      rotating = false;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  function startEditBearing() {
    bearingInput = String(bearing);
    editingBearing = true;
  }

  function commitBearing() {
    const v = parseFloat(bearingInput);
    if (Number.isFinite(v)) setBearing(v);
    editingBearing = false;
  }

  // --- fullscreen (item 5) ---
  // Prefer the real Fullscreen API — it covers the OS/browser chrome too, unlike
  // the old fixed-overlay hack. Fall back to a CSS overlay where it's blocked
  // (e.g. an iframe without allow="fullscreen"). onFullscreenChange keeps the
  // `fullscreen` flag in sync when the browser enters/exits (Esc, F11, etc.).
  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      return;
    }
    if (toolEl?.requestFullscreen) {
      try {
        await toolEl.requestFullscreen();
        return; // state + resize handled by onFullscreenChange
      } catch {
        /* blocked — fall through to the CSS fallback */
      }
    }
    fullscreen = !fullscreen;
    await tick();
    map?.invalidateSize();
  }

  function onFullscreenChange() {
    if (document.fullscreenElement === toolEl) fullscreen = true;
    else if (!document.fullscreenElement) fullscreen = false;
    tick().then(() => map?.invalidateSize());
  }

  // --- measure tools (item 5) ---
  function onMapClick(e) {
    if (!measureMode) return;
    const pt = { lat: e.latlng.lat, lon: e.latlng.lng };
    // an angle is exactly three points; a fourth click starts a fresh angle
    if (measureMode === 'angle' && measurePoints.length >= 3) measurePoints = [];
    measurePoints = [...measurePoints, pt];
    redrawMeasure();
  }

  function setMeasureMode(m) {
    measureMode = measureMode === m ? null : m;
    if (measureMode) selectArmed = false; // measuring and marquee can't both be armed
    measurePoints = [];
    measureLayer?.clearLayers();
  }

  // toggling the panel shut also drops any active measure tool — otherwise the
  // ruler button stays lit (and the tool stays armed) with the panel gone
  function toggleTools() {
    toolsOpen = !toolsOpen;
    if (!toolsOpen && measureMode) setMeasureMode(null);
  }

  function clearMeasure() {
    measurePoints = [];
    measureLayer?.clearLayers();
  }

  function redrawMeasure() {
    if (!map) return;
    if (!measureLayer) measureLayer = L.layerGroup().addTo(map);
    measureLayer.clearLayers();
    const latlngs = measurePoints.map((p) => [p.lat, p.lon]);
    const stroke = { color: '#f5a623', weight: 2.5, opacity: 0.95 };
    if (measureMode === 'area' && latlngs.length >= 2) {
      L.polygon(latlngs, { ...stroke, fillColor: '#f5a623', fillOpacity: 0.15 }).addTo(
        measureLayer
      );
    } else if (latlngs.length >= 2) {
      L.polyline(latlngs, stroke).addTo(measureLayer);
    }
    for (const p of measurePoints) {
      L.circleMarker([p.lat, p.lon], {
        radius: 4,
        color: '#fff',
        weight: 2,
        fillColor: '#f5a623',
        fillOpacity: 1,
      }).addTo(measureLayer);
    }
  }

  const measureReadout = $derived.by(() => {
    if (!measureMode || measurePoints.length < 2) return null;
    if (measureMode === 'distance')
      return measure.formatDistance(measure.pathLength(measurePoints));
    if (measureMode === 'area')
      return measurePoints.length >= 3
        ? measure.formatArea(measure.polygonArea(measurePoints))
        : '…';
    // angle needs a middle vertex
    return measurePoints.length >= 3
      ? measure.formatAngle(measure.angleAt(measurePoints[0], measurePoints[1], measurePoints[2]))
      : '…';
  });

  const MEASURE_HINT = {
    distance: 'Click points along the path',
    area: 'Click the polygon corners',
    angle: 'Click three points — vertex second',
  };

  // --- external map links (item 6) ---
  const externalLinks = $derived(mapLinks(displayCoords.lat, displayCoords.lon, center.zoom));

  // fly the map to a capture's recorded point (item 7)
  function flyToCapture(item) {
    if (!map) return;
    map.setView([item.lat, item.lon], item.zoom || map.getZoom());
    setBearing(item.bearing || 0);
  }

  // --- tile seam fix ---
  // Leaflet positions each tile with a `translate3d(...)` transform, which
  // promotes it to its own GPU layer. At fractional OS display scaling (e.g.
  // 125/150%) an integer CSS position lands on a half physical pixel, so every
  // tile edge is antialiased independently and bleeds the map background as a
  // faint white grid — browser- and zoom-independent. Painting tiles with plain
  // left/top (no transform, no backface-visibility promotion — see CSS) keeps
  // them in the shared pane layer, where neighbouring edges meet on whole
  // pixels. Rotation/zoom still use their own pane transforms, so both keep
  // working. We convert after Leaflet positions the tiles, and revert to
  // transform positioning just before a zoom so the reposition is glitch-free.
  let deSeamRaf = 0;
  function deSeamTiles() {
    deSeamRaf = 0;
    if (!mapEl) return;
    for (const t of mapEl.querySelectorAll('.leaflet-tile')) {
      const m = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(t.style.transform);
      if (!m) continue; // already flat, or a rotated matrix we shouldn't touch
      t.style.left = m[1] + 'px';
      t.style.top = m[2] + 'px';
      t.style.transform = 'none';
    }
  }
  function scheduleDeSeam() {
    if (!deSeamRaf) deSeamRaf = requestAnimationFrame(deSeamTiles);
  }
  // put the translate transform back before Leaflet repositions tiles for a new
  // zoom, so a tile is never briefly offset by both left/top and translate3d
  function reSeamTiles() {
    if (!mapEl) return;
    for (const t of mapEl.querySelectorAll('.leaflet-tile')) {
      if (t.style.transform === 'none' && t.style.left) {
        t.style.transform = `translate3d(${t.style.left}, ${t.style.top}, 0)`;
        t.style.left = '';
        t.style.top = '';
      }
    }
  }

  function setLayer() {
    const p = providers.find((x) => x.id === providerId);
    if (!p || !map) return;
    // metered/keyed providers go through the backend tile proxy: the key and
    // any session token stay server-side, and every billed tile is counted
    // exactly once (browser cache hits never reach the proxy)
    const url = p.meter ? `/api/tiles/${p.id}/{z}/{x}/{y}` : p.url;
    const opts = { attribution: p.attribution, maxZoom: p.max_zoom };
    if (p.tile_size === 512) {
      // 512px tiles: same m/px at z-1, a quarter of the billed requests
      opts.tileSize = 512;
      opts.zoomOffset = -1;
    }
    if (tileLayer) tileLayer.remove();
    tileLayer = L.tileLayer(url, opts).addTo(map);
    tileLayer.on('load tileload', scheduleDeSeam);
    if (p.meter) {
      refreshUsage();
      // 'load' fires once all visible tiles are in — keep the pill current
      tileLayer.on('load', refreshUsage);
    }
  }

  $effect(() => {
    providerId; // track provider changes
    setLayer();
  });

  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev; // re-fetch when the case is reloaded elsewhere (e.g. sidebar delete)
    if (!id) {
      capturesFor = null;
      captures = [];
      return;
    }
    capturesFor = id;
    api.get(`/api/cases/${id}/satellite`).then((r) => (captures = r));
  });

  // the map container resizes when the sidebar toggles, and reappears from
  // display:none when the tool tab is re-selected (tools stay mounted) — both
  // need Leaflet to re-measure and redraw tiles for the exposed area
  $effect(() => {
    uiState.sidebarOpen; // track the global sidebar toggle
    if (!mapReady || uiState.tool !== 'satellite') return;
    tick().then(() => map?.invalidateSize());
  });

  // fly to coordinates handed off from the sidebar (place entity click) —
  // match the capture's own zoom/bearing, like clicking its card
  $effect(() => {
    const target = uiState.gotoCoords;
    if (mapReady && target && Number.isFinite(target.lat) && Number.isFinite(target.lon)) {
      uiState.gotoCoords = null;
      const zoom = Number.isFinite(target.zoom) ? target.zoom : Math.max(map.getZoom(), 16);
      map.setView([target.lat, target.lon], zoom);
      setBearing(Number.isFinite(target.bearing) ? target.bearing : 0);
    }
  });

  let searching = $state(false);
  async function goTo() {
    const text = coordsText.trim();
    if (!text || searching) return;
    searching = true;
    try {
      // coordinates first (decimal or DMS); anything else is a place name
      try {
        const parsed = await api.post('/api/geo/parse', { text });
        map.setView([parsed.lat, parsed.lon], Math.max(map.getZoom(), 16));
        return;
      } catch {
        /* not coordinates — fall through to geocoding */
      }
      const place = await api.get(`/api/geo/geocode?q=${encodeURIComponent(text)}`);
      map.setView([place.lat, place.lon], Math.max(map.getZoom(), 13));
      if (place.display_name) toast(place.display_name, 'info', 5000);
    } catch {
      toast('No match — try coordinates ("50.4501, 30.5234"), DMS, or a place name', 'danger');
    } finally {
      searching = false;
    }
  }

  function setBearing(deg) {
    if (!map) return;
    map.setBearing(((deg % 360) + 360) % 360);
  }

  function resetNorth() {
    setBearing(0);
  }

  // --- marker (crosshair / pin), optionally decoupled from center ---

  // the coordinates shown & recorded: the moved pin, else the crop center
  const displayCoords = $derived(
    moveMode && markerLatLng ? markerLatLng : { lat: center.lat, lon: center.lon }
  );

  // --- capture sizing (backend validates 256–4096 px per side; see lib/captureSize.js) ---

  // Standard output sizes for the centred Capture button, named by intent.
  const PRESETS = [
    { id: '1200x675', label: 'Tweet 16:9', w: 1200, h: 675 },
    { id: '1080x1080', label: 'Square', w: 1080, h: 1080 },
    { id: '1200x630', label: 'OG card', w: 1200, h: 630 },
    { id: '1280x800', label: 'Wide', w: 1280, h: 800 },
    { id: 'custom', label: 'Custom', w: 0, h: 0 },
  ];
  let preset = $state('1200x675');
  let customW = $state(1200);
  let customH = $state(675);
  // preset dimensions in px — the centred Capture frame + its hover preview
  const presetSize = $derived.by(() => {
    if (preset === 'custom') return [clampSize(customW), clampSize(customH)];
    const p = PRESETS.find((x) => x.id === preset);
    return [p.w, p.h];
  });

  // Marquee ratio lock (width/height); null = free-form drag.
  const RATIOS = [
    { id: 'free', label: 'Free', r: null },
    { id: '16:9', label: '16:9', r: 16 / 9 },
    { id: '4:3', label: '4:3', r: 4 / 3 },
    { id: '1:1', label: '1:1', r: 1 },
  ];
  let ratio = $state('free');
  const ratioValue = $derived(RATIOS.find((x) => x.id === ratio)?.r ?? null);

  // Output resolution: 1 = view zoom, 2 = one zoom deeper (2×), 'max' = provider max.
  let resolution = $state(1);
  const providerMaxZoom = $derived(providers.find((p) => p.id === providerId)?.max_zoom ?? 19);

  // Single capture button, split-style: the main part re-runs whichever mode
  // was used last (remembered here); the arrow opens mode + size/ratio/
  // resolution settings.
  let captureMode = $state('center'); // 'center' | 'select'
  let sizeMenuOpen = $state(false); // the mode/size/ratio/resolution popover
  let sizeMenuEl; // bound to the popover's wrapper — used to detect outside clicks
  let selectArmed = $state(false); // marquee mode: drag a box on the map to capture
  let selRect = $state(null); // live marquee { x0, y0, x1, y1 } in map-container px

  function markerIcon(style) {
    if (style === 'pin') {
      return L.divIcon({
        className: 'sat-marker',
        iconSize: [30, 42],
        iconAnchor: [15, 42], // tip points at the location
        html: `<svg width="30" height="42" viewBox="0 0 30 42">
          <path d="M15 41 C15 41 27 24 27 14 A12 12 0 1 0 3 14 C3 24 15 41 15 41 Z"
            fill="#e5484d" stroke="#3c0c0e" stroke-width="1.5"/>
          <circle cx="15" cy="14" r="4.5" fill="#fff" stroke="#3c0c0e" stroke-width="1"/>
        </svg>`,
      });
    }
    return L.divIcon({
      className: 'sat-marker',
      iconSize: [46, 46],
      iconAnchor: [23, 23],
      html: `<svg width="46" height="46" viewBox="0 0 46 46">
        <g stroke="#000" stroke-width="4" opacity="0.55">
          <line x1="1" y1="23" x2="16" y2="23"/><line x1="30" y1="23" x2="45" y2="23"/>
          <line x1="23" y1="1" x2="23" y2="16"/><line x1="23" y1="30" x2="23" y2="45"/>
        </g>
        <g stroke="#fff" stroke-width="2">
          <line x1="1" y1="23" x2="16" y2="23"/><line x1="30" y1="23" x2="45" y2="23"/>
          <line x1="23" y1="1" x2="23" y2="16"/><line x1="23" y1="30" x2="23" y2="45"/>
          <circle cx="23" cy="23" r="2.5" fill="none"/>
        </g>
      </svg>`,
    });
  }

  function removeMarker() {
    if (marker) marker.remove();
    marker = null;
    markerLatLng = null;
  }

  function toggleMoveMode() {
    if (markerStyle === 'none') return;
    moveMode = !moveMode;
    if (!moveMode) {
      removeMarker();
      return;
    }
    const c = map.getCenter();
    marker = L.marker(c, {
      draggable: true,
      icon: markerIcon(markerStyle),
      zIndexOffset: 1000,
    }).addTo(map);
    markerLatLng = { lat: c.lat, lon: c.lng };
    marker.on('drag move', () => {
      const p = marker.getLatLng();
      markerLatLng = { lat: p.lat, lon: p.lng };
    });
  }

  // keep the live marker's look in sync with the chosen style; leaving move
  // mode (or picking "none") drops the marker
  $effect(() => {
    if (markerStyle === 'none' && moveMode) {
      moveMode = false;
      removeMarker();
    } else if (marker) {
      marker.setIcon(markerIcon(markerStyle));
    }
  });

  // The single capture path. `centerLL` frames the crop (a Leaflet LatLng);
  // `baseW`/`baseH` are the crop size at the current view zoom, then scaled to
  // the chosen output resolution. The recorded point is the moved pin (if any),
  // else the crop centre.
  async function doCapture(centerLL, baseW, baseH) {
    if (capturing) return;
    capturing = true;
    const { zoom, width, height, mult } = scaledCapture(
      baseW, baseH, resolution, center.zoom, providerMaxZoom
    );
    let marker_x = 0, marker_y = 0, marker_lat = centerLL.lat, marker_lon = centerLL.lng;
    if (moveMode && marker) {
      const ll = marker.getLatLng();
      marker_lat = ll.lat;
      marker_lon = ll.lng;
      // pin offset from the crop centre in container px (already accounts for
      // rotation), scaled up to the output pixel size
      const c0 = map.latLngToContainerPoint(centerLL);
      const cp = map.latLngToContainerPoint(ll);
      marker_x = Math.round((cp.x - c0.x) * mult);
      marker_y = Math.round((cp.y - c0.y) * mult);
    }
    try {
      const c = await ensureCase();
      const result = await api.post(`/api/cases/${c.id}/satellite/capture`, {
        lat: centerLL.lat,
        lon: centerLL.lng,
        zoom,
        width,
        height,
        provider: providerId,
        bearing,
        marker_style: markerStyle,
        marker_x,
        marker_y,
        marker_lat,
        marker_lon,
        // second date on the capture: the imagery's acquisition date, if known
        imagery_date: imageryDate?.date ?? null,
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

  // Centred Capture button: the standard preset size, framed on the map centre.
  function captureCentered() {
    const [w, h] = presetSize;
    doCapture(map.getCenter(), w, h);
  }

  // The main capture button runs whichever mode is currently selected —
  // captureMode itself *is* the "last used mode" memory, so nothing else
  // needs to track it.
  function runCapture() {
    if (captureBlocked) return; // view-only basemap
    if (captureMode === 'select') toggleSelect();
    else captureCentered();
  }

  // clicking outside the open size/ratio/resolution popover closes it
  $effect(() => {
    if (!sizeMenuOpen) return;
    const onDocMousedown = (e) => {
      if (sizeMenuEl && !sizeMenuEl.contains(e.target)) sizeMenuOpen = false;
    };
    document.addEventListener('mousedown', onDocMousedown, true);
    return () => document.removeEventListener('mousedown', onDocMousedown, true);
  });

  // --- marquee: drag a rectangle on the map to capture exactly that area ---
  function toggleSelect() {
    selectArmed = !selectArmed;
    if (selectArmed) {
      sizeMenuOpen = false;
      if (measureMode) setMeasureMode(null);
    } else {
      selRect = null;
    }
  }

  function onSelectStart(e) {
    if (!selectArmed || e.button !== 0 || !map) return;
    // own the gesture so Leaflet doesn't pan while we draw the box
    e.stopPropagation();
    e.preventDefault();
    const rect = mapEl.getBoundingClientRect();
    const start = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    selRect = { x0: start.x, y0: start.y, x1: start.x, y1: start.y };
    const move = (ev) => {
      let x1 = ev.clientX - rect.left;
      let y1 = ev.clientY - rect.top;
      if (ratioValue) {
        // lock the box to the chosen aspect ratio, sized from the larger delta
        const dx = x1 - start.x;
        const dy = y1 - start.y;
        let w = Math.abs(dx);
        let h = Math.abs(dy);
        if (w / h > ratioValue) h = w / ratioValue;
        else w = h * ratioValue;
        x1 = start.x + (dx < 0 ? -w : w);
        y1 = start.y + (dy < 0 ? -h : h);
      }
      selRect = { x0: start.x, y0: start.y, x1, y1 };
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      finishSelect();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  function finishSelect() {
    const r = selRect;
    selRect = null;
    if (!r) return;
    const w = Math.abs(r.x1 - r.x0);
    const h = Math.abs(r.y1 - r.y0);
    if (w < 12 || h < 12) return; // an accidental click / tiny drag: ignore
    const centerLL = map.containerPointToLatLng(
      L.point((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2)
    );
    selectArmed = false; // one box per arm — re-arm to draw another
    doCapture(centerLL, Math.round(w), Math.round(h));
  }

  // save just the point (pin if moved, else center) as a navigable place — no image
  let savingPlace = $state(false);
  async function savePlace() {
    if (savingPlace) return;
    savingPlace = true;
    try {
      const c = await ensureCase();
      await api.post(`/api/cases/${c.id}/satellite/place`, {
        lat: displayCoords.lat,
        lon: displayCoords.lon,
        zoom: center.zoom,
        bearing,
      });
      await reloadCase();
      toast('Place saved — find it in the case sidebar', 'ok');
    } catch (e) {
      toast(`Could not save place: ${e.message}`, 'danger', 6000);
    } finally {
      savingPlace = false;
    }
  }

  // Deletions drop a file / an entity — always behind a confirm.
  // { kind: 'capture', item } | { kind: 'place', item }
  let deleteTarget = $state(null);
  let deleteBusy = $state(false);

  async function removeCapture(item) {
    await api.del(
      `/api/cases/${caseState.current.id}/satellite?path=${encodeURIComponent(item.path)}`
    );
    captures = captures.filter((c) => c.path !== item.path);
    // the capture's place entity may have gone with it — refresh the sidebar
    await reloadCase();
  }

  async function confirmDelete() {
    if (!deleteTarget || deleteBusy) return;
    deleteBusy = true;
    try {
      if (deleteTarget.kind === 'capture') await removeCapture(deleteTarget.item);
      else await removePlace(deleteTarget.item);
      deleteTarget = null;
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      deleteBusy = false;
    }
  }

  // --- details modal (title + notes) ---
  let notesItem = $state(null);
  let notesText = $state('');
  let notesTitle = $state('');
  let notesSaving = $state(false);

  function openNotes(item) {
    notesItem = item;
    notesText = item.notes ?? '';
    notesTitle = item.title ?? coordsLabel(item);
  }

  async function saveNotes() {
    if (!notesItem) return;
    notesSaving = true;
    try {
      const updated = await api.patch(
        `/api/cases/${caseState.current.id}/satellite`,
        { path: notesItem.path, notes: notesText, title: notesTitle }
      );
      const idx = captures.findIndex((c) => c.path === notesItem.path);
      if (idx !== -1) captures[idx] = updated;
      notesItem = null;
      // the mirrored place entity was retitled too — refresh the sidebar
      await reloadCase();
      toast('Saved', 'ok', 1600);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      notesSaving = false;
    }
  }

  function coordsLabel(item) {
    return `${item.lat.toFixed(6)}, ${item.lon.toFixed(6)}`;
  }

  function sendToComposer(item) {
    if (!uiState.composeQueue.includes(item.path)) uiState.composeQueue.push(item.path);
    uiState.tool = 'proof';
  }

  function fmt(value) {
    return value.toFixed(6);
  }

  async function copyCoords() {
    await navigator.clipboard.writeText(`${fmt(displayCoords.lat)}, ${fmt(displayCoords.lon)}`);
    toast('Coordinates copied', 'ok', 1600);
  }

  async function toggleCaptures() {
    capturesCollapsed = !capturesCollapsed;
    // the map container just resized — let Leaflet redraw tiles for the new size
    await tick();
    map?.invalidateSize();
  }

  // saved places (navigable points) live on the case as `place` entities
  const places = $derived(
    (caseState.current?.entities ?? []).filter((e) => e.type === 'place')
  );

  function flyToPlace(p) {
    const lat = Number(p.attrs?.lat);
    const lon = Number(p.attrs?.lon);
    if (!map || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    map.setView([lat, lon], Number(p.attrs?.zoom) || map.getZoom());
    setBearing(Number(p.attrs?.bearing) || 0);
  }

  async function removePlace(p) {
    await api.del(`/api/cases/${caseState.current.id}/entities/${p.id}`);
    await reloadCase();
  }

  // collapse state for the two saved-work sections
  let placesCollapsed = $state(false);
  let capturesSubCollapsed = $state(false);

  // --- place edit modal (title + notes), used for both save & later edits ---
  // { id: string|null, title, notes, lat, lon, zoom, bearing }; id null = new
  let placeModal = $state(null);
  let placeSaving = $state(false);

  function openNewPlace() {
    placeModal = {
      id: null,
      title: '',
      notes: '',
      lat: displayCoords.lat,
      lon: displayCoords.lon,
      zoom: center.zoom,
      bearing,
    };
  }

  function openEditPlace(p) {
    placeModal = {
      id: p.id,
      title: p.label ?? '',
      notes: p.attrs?.notes ?? '',
      lat: Number(p.attrs?.lat),
      lon: Number(p.attrs?.lon),
      zoom: p.attrs?.zoom,
      bearing: p.attrs?.bearing,
    };
  }

  function placeCoordsLabel(m) {
    return `${m.lat.toFixed(6)}, ${m.lon.toFixed(6)}`;
  }

  async function savePlaceModal() {
    if (!placeModal || placeSaving) return;
    placeSaving = true;
    try {
      const m = placeModal;
      if (m.id) {
        // edit existing place: retitle + set/clear the note
        const title = m.title.trim() || placeCoordsLabel(m);
        await api.patch(`/api/cases/${caseState.current.id}/entities/${m.id}`, {
          label: title,
          attrs: { notes: m.notes.trim() },
        });
      } else {
        const c = await ensureCase();
        await api.post(`/api/cases/${c.id}/satellite/place`, {
          lat: m.lat,
          lon: m.lon,
          zoom: m.zoom,
          bearing: m.bearing,
          title: m.title,
          notes: m.notes,
        });
      }
      placeModal = null;
      await reloadCase();
      toast('Place saved', 'ok', 1600);
    } catch (e) {
      toast(`Could not save place: ${e.message}`, 'danger', 6000);
    } finally {
      placeSaving = false;
    }
  }
</script>

<div class="tool" class:fullscreen bind:this={toolEl}>
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
        placeholder={'50.4501, 30.5234  ·  48°51\'29"N 2°17\'40"E  ·  a place name'}
        bind:value={coordsText}
        title="Coordinates (decimal or DMS) or a place name (geocoded via Nominatim)"
      />
      <button type="submit" class="btn" disabled={!coordsText.trim() || searching}>
        <Icon name="search" size={15} /> {searching ? '…' : 'Go'}
      </button>
    </form>
  </div>

  <div class="body">
    <div class="map-wrap" class:measuring={measureMode} class:selecting={selectArmed}>
      <div class="map" bind:this={mapEl}></div>

      <!-- top-left control cluster: fullscreen, OSM labels overlay, measure tools -->
      <div class="map-tools">
        <div class="tool-cluster card">
          <button
            class="mtbtn"
            class:on={fullscreen}
            onclick={toggleFullscreen}
            title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen map'}
            aria-label="Toggle fullscreen"
          >
            <Icon name={fullscreen ? 'minimize' : 'maximize'} size={16} />
          </button>
          <button
            class="mtbtn"
            class:on={osmOverlay}
            onclick={() => (osmOverlay = !osmOverlay)}
            disabled={!baseIsImagery}
            title={baseIsImagery
              ? 'Overlay OSM labels (roads, place names) on the imagery'
              : 'Labels overlay is only useful over satellite imagery'}
            aria-label="Toggle OSM labels overlay"
          >
            <Icon name="layers" size={16} />
          </button>
          <button
            class="mtbtn"
            class:on={toolsOpen || measureMode}
            onclick={toggleTools}
            title="Measure tools"
            aria-label="Measure tools"
          >
            <Icon name="ruler" size={16} />
          </button>
          <button
            class="mtbtn"
            class:on={uiState.refViewers.length}
            onclick={openRefPicker}
            title="Add a reference image or video over the map (scratch only — never captured or saved)"
            aria-label="Add reference"
          >
            <Icon name="image" size={16} />
          </button>
        </div>

        {#if toolsOpen}
          <div class="measure-panel card">
            <div class="measure-btns">
              <button
                class="btn btn-sm"
                class:on={measureMode === 'distance'}
                onclick={() => setMeasureMode('distance')}
              >
                <Icon name="ruler" size={14} /> Distance
              </button>
              <button
                class="btn btn-sm"
                class:on={measureMode === 'area'}
                onclick={() => setMeasureMode('area')}
              >
                <Icon name="polygon" size={14} /> Area
              </button>
              <button
                class="btn btn-sm"
                class:on={measureMode === 'angle'}
                onclick={() => setMeasureMode('angle')}
              >
                <Icon name="angle" size={14} /> Angle
              </button>
            </div>
            {#if measureMode}
              <div class="measure-readout">
                {#if measureReadout}
                  <span class="measure-value mono">{measureReadout}</span>
                {:else}
                  <span class="measure-hint">{MEASURE_HINT[measureMode]}</span>
                {/if}
                <button class="btn btn-ghost btn-sm" onclick={clearMeasure} title="Clear points">
                  <Icon name="reset" size={13} />
                </button>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- capture-frame outline: what the centred Capture will cover — only when
           a centred capture is the intent (hovering the capture button, or
           mid-capture) and not while drawing a marquee -->
      {#if captureMode === 'center' && (captureHover || capturing) && !selectArmed && !selRect}
        <div
          class="frame-overlay"
          style="width:{presetSize[0]}px;height:{presetSize[1]}px"
          aria-hidden="true"
        ></div>
      {/if}

      <!-- live marquee: the rectangle being dragged to define a custom crop -->
      {#if selRect}
        <div
          class="sel-rect"
          style="left:{Math.min(selRect.x0, selRect.x1)}px;top:{Math.min(selRect.y0, selRect.y1)}px;width:{Math.abs(selRect.x1 - selRect.x0)}px;height:{Math.abs(selRect.y1 - selRect.y0)}px"
          aria-hidden="true"
        >
          <span class="sel-dim mono">
            {Math.round(Math.abs(selRect.x1 - selRect.x0))} × {Math.round(Math.abs(selRect.y1 - selRect.y0))}
          </span>
        </div>
      {/if}

      <!-- fixed center marker; a draggable Leaflet marker takes over in move mode -->
      {#if markerStyle !== 'none' && !moveMode}
        <div class="marker-overlay marker-{markerStyle}" aria-hidden="true">
          {#if markerStyle === 'pin'}
            <svg width="30" height="42" viewBox="0 0 30 42">
              <path
                d="M15 41 C15 41 27 24 27 14 A12 12 0 1 0 3 14 C3 24 15 41 15 41 Z"
                fill="#e5484d" stroke="#3c0c0e" stroke-width="1.5"
              />
              <circle cx="15" cy="14" r="4.5" fill="#fff" stroke="#3c0c0e" stroke-width="1" />
            </svg>
          {:else}
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
          {/if}
        </div>
      {/if}

      <!-- middle-drag rotation pivot: sober target at the grabbed point, pinned
           on screen while the map turns around it -->
      {#if rotating}
        <div class="rotate-pivot" style:left={`${rotatePivot.x}px`} style:top={`${rotatePivot.y}px`} aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 40 40">
            <circle class="ring" cx="20" cy="20" r="15" />
            <circle class="dot" cx="20" cy="20" r="1.5" />
          </svg>
        </div>
      {/if}

      <div class="hud card">
        <button class="hud-coords mono" onclick={copyCoords} title="Copy coordinates">
          <Icon name="crosshair" size={13} />
          {fmt(displayCoords.lat)}, {fmt(displayCoords.lon)}
          <span class="z">z{center.zoom}</span>
          {#if moveMode && markerLatLng}<span class="pin-tag">pin</span>{/if}
          <Icon name="copy" size={12} />
        </button>
      </div>

      <!-- imagery acquisition date: a compact, unobtrusive pill in the corner so
           it doesn't crowd the coordinates readout (item 2) -->
      {#if imageryDate?.supported}
        <span
          class="date-pill mono"
          title={imageryDate.source
            ? `Imagery acquired around this date (source: ${imageryDate.source})`
            : 'Approximate acquisition date of the imagery here'}
        >
          <Icon name="clock" size={11} />
          {imageryDate.date ?? '—'}
        </span>
      {/if}

      <!-- lightweight compass: click the rose to reset north; middle-drag the map
           to rotate; click the number to type an exact bearing (item 3) -->
      <div class="rotate-ctl">
        <button
          class="compass"
          onclick={resetNorth}
          title={bearing ? 'Reset to north' : 'North up · middle-drag the map to rotate'}
          aria-label="Reset to north"
        >
          <svg width="30" height="30" viewBox="0 0 34 34" style="transform: rotate({-bearing}deg)">
            <polygon points="17,4 13,18 17,15 21,18" fill="#e5484d" />
            <polygon points="17,30 13,16 17,19 21,16" fill="#8a93a5" />
          </svg>
          <span class="n">N</span>
        </button>
        {#if editingBearing}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="input deg-input mono"
            type="number"
            min="0"
            max="359"
            bind:value={bearingInput}
            autofocus
            onblur={commitBearing}
            onkeydown={(e) => {
              if (e.key === 'Enter') commitBearing();
              else if (e.key === 'Escape') editingBearing = false;
            }}
            aria-label="Set bearing in degrees"
          />
        {:else}
          <button class="deg mono" onclick={startEditBearing} title="Click to type an exact angle">
            {bearing}°
          </button>
        {/if}
      </div>

      <div class="capture-bar card">
        <select class="select" bind:value={providerId} title="Imagery provider">
          {#each providers as p (p.id)}
            <option value={p.id} disabled={p.needs_key}>
              {p.label}{p.needs_key ? ' (needs API key)' : ''}
            </option>
          {/each}
        </select>
        {#if usagePill}
          <span
            class="usage-pill mono"
            title="Tiles requested from this billed provider this month — local counter, see Settings"
          >{usagePill}</span>
        {/if}
        <select class="select" bind:value={markerStyle} title="Marker style">
          <option value="crosshair">✛ crosshair</option>
          <option value="pin">📍 pin</option>
          <option value="none">no marker</option>
        </select>
        <button
          class="btn btn-toggle"
          class:on={moveMode}
          onclick={toggleMoveMode}
          disabled={markerStyle === 'none'}
          title="Move the marker off-center — recorded coordinates follow the pin"
        >
          <Icon name="crosshair" size={14} /> {moveMode ? 'Moving' : 'Move pin'}
        </button>
        <span class="bar-sep" aria-hidden="true"></span>
        <div class="place-save">
          <button
            class="btn place-save-main"
            onclick={savePlace}
            disabled={savingPlace}
            title="Save just this point (the pin, or the crop center) as a navigable place — no image"
          >
            <Icon name="pin" size={15} /> {savingPlace ? 'Saving…' : 'Save place'}
          </button>
          <button
            class="btn place-save-edit"
            onclick={openNewPlace}
            title="Save place with a title and note…"
            aria-label="Save place with a title and note"
          >
            <Icon name="note" size={14} />
          </button>
        </div>
        <!-- capture controls: one split button. The main part re-runs whichever
             mode was used last — a centred capture at the chosen size, or
             arming a marquee to drag a custom area — and the arrow opens the
             mode + size/ratio/resolution settings. Hovering/focusing the main
             button previews the centred crop frame, only while that's the
             active mode. -->
        <div class="capture-split" role="group">
          <button
            class="btn btn-primary capture-main"
            class:on={captureMode === 'select' && selectArmed}
            onmouseenter={() => (captureHover = captureMode === 'center')}
            onmouseleave={() => (captureHover = false)}
            onfocusin={() => (captureHover = captureMode === 'center')}
            onfocusout={() => (captureHover = false)}
            onclick={runCapture}
            disabled={capturing || captureBlocked}
            title={captureBlocked
              ? 'View-only basemap — this provider cannot be captured'
              : captureMode === 'select'
                ? 'Draw a rectangle on the map to capture exactly that area'
                : 'Capture the centred preset size'}
          >
            {#if capturing}
              <span class="spinner"></span> Capturing…
            {:else if captureMode === 'select'}
              <Icon name="crop" size={14} /> {selectArmed ? 'Draw box…' : 'Select area'}
            {:else}
              <Icon name="satellite" size={15} /> Capture
            {/if}
          </button>

          <div class="size-menu-wrap" bind:this={sizeMenuEl}>
            <button
              class="btn btn-icon capture-arrow"
              class:on={sizeMenuOpen}
              onclick={() => (sizeMenuOpen = !sizeMenuOpen)}
              title="Capture mode, size, ratio & resolution"
              aria-label="Capture options"
            >
              <Icon name="chevronDown" size={13} />
            </button>
            {#if sizeMenuOpen}
              <div class="size-menu card">
                <div class="menu-row">
                  <span class="menu-label">Mode</span>
                  <div class="chips">
                    <button class="chip" class:on={captureMode === 'center'} onclick={() => (captureMode = 'center')}>
                      Capture
                    </button>
                    <button class="chip" class:on={captureMode === 'select'} onclick={() => (captureMode = 'select')}>
                      Select area
                    </button>
                  </div>
                </div>
                <div class="menu-hint">
                  {captureMode === 'center'
                    ? 'Captures the centred size below.'
                    : 'Drag a box on the map to capture exactly it.'}
                </div>

                {#if captureMode === 'select'}
                  <div class="menu-row">
                    <span class="menu-label">Ratio</span>
                    <div class="chips">
                      {#each RATIOS as r (r.id)}
                        <button class="chip" class:on={ratio === r.id} onclick={() => (ratio = r.id)}>
                          {r.label}
                        </button>
                      {/each}
                    </div>
                  </div>
                  <div class="menu-hint">Locks the dragged box's shape.</div>
                {:else}
                  <div class="menu-row">
                    <span class="menu-label">Size</span>
                    <div class="chips">
                      {#each PRESETS as p (p.id)}
                        <button class="chip" class:on={preset === p.id} onclick={() => (preset = p.id)}>
                          {p.label}
                        </button>
                      {/each}
                    </div>
                  </div>
                  {#if preset === 'custom'}
                    <div class="custom-size" title="Custom crop size ({SIZE_MIN}–{SIZE_MAX} px)">
                      <input
                        class="input size-input"
                        type="number"
                        min={SIZE_MIN}
                        max={SIZE_MAX}
                        bind:value={customW}
                        onblur={() => (customW = clampSize(customW))}
                        aria-label="Crop width"
                      />
                      <span>×</span>
                      <input
                        class="input size-input"
                        type="number"
                        min={SIZE_MIN}
                        max={SIZE_MAX}
                        bind:value={customH}
                        onblur={() => (customH = clampSize(customH))}
                        aria-label="Crop height"
                      />
                    </div>
                  {/if}
                {/if}

                <div class="menu-row">
                  <span class="menu-label">Resolution</span>
                  <div class="chips">
                    <button class="chip" class:on={resolution === 1} onclick={() => (resolution = 1)}>1×</button>
                    <button class="chip" class:on={resolution === 2} onclick={() => (resolution = 2)}>2×</button>
                    <button class="chip" class:on={resolution === 'max'} onclick={() => (resolution = 'max')}>Max</button>
                  </div>
                </div>
                <div class="menu-hint">Captures a deeper zoom for a sharper file.</div>
              </div>
            {/if}
          </div>
        </div>
      </div>
      <!-- floating reference-image windows (scratch aids over the map) -->
      {#each uiState.refViewers as v (v.id)}
        <RefViewer
          viewer={v}
          caseId={caseState.current?.id}
          onfocus={focusRef}
          onclose={closeRef}
        />
      {/each}
    </div>

    <aside class="captures" class:collapsed={capturesCollapsed}>
      <button
        type="button"
        class="cap-head"
        onclick={toggleCaptures}
        title={capturesCollapsed ? 'Show captures' : 'Hide captures'}
      >
        <Icon name={capturesCollapsed ? 'chevronLeft' : 'chevronRight'} size={15} />
        <span class="label" style="margin:0">Saved</span>
        <span class="count">{places.length + captures.length}</span>
      </button>
      {#if capturesCollapsed}
        <!-- collapsed: header acts as the toggle back to the list -->
      {:else}
        <div class="panel-scroll">
          <!-- External maps: quick jumps to maps we can't embed in-tool, at the
               current target coordinates (item 6) -->
          <button type="button" class="sub-head" onclick={() => (linksOpen = !linksOpen)}>
            <Icon name={linksOpen ? 'chevronDown' : 'chevronRight'} size={12} />
            <Icon name="external" size={13} />
            <span>Open in…</span>
            <span class="count">{externalLinks.length}</span>
          </button>
          {#if linksOpen}
            <div class="links-grid">
              {#each externalLinks as l (l.id)}
                <a class="ext-link" href={l.url} target="_blank" rel="noreferrer" title={l.url}>
                  <Icon name="globe" size={13} />
                  <span>{l.label}</span>
                  <Icon name="external" size={12} />
                </a>
              {/each}
            </div>
            <div class="links-note mono">{fmt(displayCoords.lat)}, {fmt(displayCoords.lon)}</div>
          {/if}

          <!-- Places: navigable points (no image) -->
          <button
            type="button"
            class="sub-head"
            onclick={() => (placesCollapsed = !placesCollapsed)}
          >
            <Icon name={placesCollapsed ? 'chevronRight' : 'chevronDown'} size={12} />
            <Icon name="pin" size={13} />
            <span>Places</span>
            <span class="count">{places.length}</span>
          </button>
          {#if !placesCollapsed}
            {#if !places.length}
              <div class="none">Use “Save place” to drop a point you can fly back to.</div>
            {:else}
              <div class="place-list">
                {#each places as p (p.id)}
                  <div class="place-row card fade-up">
                    <div class="place-main">
                      <button
                        type="button"
                        class="place-goto"
                        title="Fly the map to this point"
                        onclick={() => flyToPlace(p)}
                      >
                        <Icon name="pin" size={15} />
                        <div class="place-meta">
                          <span class="title">{p.label}</span>
                          <span class="prov">
                            z{p.attrs?.zoom}{p.attrs?.bearing ? ` · ${Math.round(p.attrs.bearing)}°` : ''}
                          </span>
                        </div>
                      </button>
                      <button
                        class="btn btn-ghost btn-sm"
                        title="Edit title & note"
                        onclick={() => openEditPlace(p)}
                      >
                        <Icon name="note" size={14} />
                      </button>
                      <button
                        class="btn btn-ghost btn-sm"
                        title="Delete place"
                        onclick={() => (deleteTarget = { kind: 'place', item: p })}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                    {#if p.attrs?.notes}
                      <div class="place-notes">{p.attrs.notes}</div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          {/if}

          <!-- Captures: sourced imagery crops (images) -->
          <button
            type="button"
            class="sub-head"
            onclick={() => (capturesSubCollapsed = !capturesSubCollapsed)}
          >
            <Icon name={capturesSubCollapsed ? 'chevronRight' : 'chevronDown'} size={12} />
            <Icon name="satellite" size={13} />
            <span>Captures</span>
            <span class="count">{captures.length}</span>
          </button>
          {#if !capturesSubCollapsed}
            {#if !captures.length}
              <div class="none">
                Captured crops land in the case with full provenance: provider, zoom, date,
                attribution.
              </div>
            {:else}
              <div class="cap-list">
              {#each (caseState.current ? captures : []) as item (item.path)}
                <div class="cap card fade-up">
                  <a
                    class="cap-goto"
                    href={`/files/${caseState.current.id}/${item.path}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Open the full image"
                  >
                    <img
                      src={`/files/${caseState.current.id}/${item.path}`}
                      alt={item.filename}
                      loading="lazy"
                    />
                    <div class="cap-meta">
                      <span class="title">{item.title ?? coordsLabel(item)}</span>
                      <span class="mono coords">{coordsLabel(item)}</span>
                      <span class="prov">z{item.zoom}{item.bearing ? ` · ${Math.round(item.bearing)}°` : ''} · {item.provider_label}</span>
                      <span class="prov dates" title="Capture date · imagery acquisition date">
                        <Icon name="crosshair" size={10} /> {item.fetched_at?.slice(0, 10)}
                        {#if item.imagery_date}<span class="img-date"><Icon name="satellite" size={10} /> {item.imagery_date}</span>{/if}
                      </span>
                    </div>
                  </a>
                  <div class="cap-actions">
                    <button
                      class="btn btn-ghost btn-sm"
                      title="Go to these coordinates on the map"
                      onclick={() => flyToCapture(item)}
                    >
                      <Icon name="crosshair" size={14} />
                    </button>
                    <button
                      class="btn btn-ghost btn-sm"
                      title="Edit title & note"
                      onclick={() => openNotes(item)}
                    >
                      <Icon name="note" size={14} />
                    </button>
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
                      onclick={() => (deleteTarget = { kind: 'capture', item })}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                  {#if item.notes}
                    <div class="cap-notes">{item.notes}</div>
                  {/if}
                </div>
              {/each}
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    </aside>
  </div>
</div>

<!-- delete confirm: a capture drops its image file, a place its entity -->
{#if deleteTarget}
  <ConfirmDialog
    title={deleteTarget.kind === 'capture' ? 'Delete this capture?' : 'Delete this place?'}
    message={deleteTarget.kind === 'capture'
      ? `“${deleteTarget.item.title ?? coordsLabel(deleteTarget.item)}” will be removed from the case.`
      : `“${deleteTarget.item.label}” will be removed from the case.`}
    detail={deleteTarget.kind === 'capture'
      ? 'This permanently deletes the image file on disk — it cannot be undone.'
      : 'This permanently removes the saved point — it cannot be undone.'}
    confirmLabel="Delete"
    tone="danger"
    busy={deleteBusy}
    onconfirm={confirmDelete}
    oncancel={() => (deleteTarget = null)}
  />
{/if}

<!-- satellite notes modal -->
{#if notesItem}
  <Modal title="Capture details" onclose={() => (notesItem = null)} width="420px">
    <label style="display:block;font-size:var(--fs-xs);color:var(--text-3);margin-bottom:5px">Title</label>
    <input
      class="input"
      placeholder={coordsLabel(notesItem)}
      bind:value={notesTitle}
    />
    <hr style="border:none;border-top:1px solid var(--border);margin:12px 0" />
    <div class="sat-info-rows">
      <div class="sat-info-row">
        <span class="sat-info-label">Coordinates</span>
        <span class="mono">{notesItem.lat?.toFixed(6)}, {notesItem.lon?.toFixed(6)}</span>
      </div>
      <div class="sat-info-row">
        <span class="sat-info-label">Provider</span>
        <span>{notesItem.provider_label}</span>
      </div>
      <div class="sat-info-row">
        <span class="sat-info-label">Zoom</span>
        <span>{notesItem.zoom}</span>
      </div>
      <div class="sat-info-row">
        <span class="sat-info-label">Captured</span>
        <span class="mono">{notesItem.fetched_at?.slice(0, 10)}</span>
      </div>
      <div class="sat-info-row">
        <span class="sat-info-label">Imagery date</span>
        <span class="mono">{notesItem.imagery_date ?? '—'}</span>
      </div>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:12px 0" />
    <label style="display:block;font-size:var(--fs-xs);color:var(--text-3);margin-bottom:5px">Notes</label>
    <textarea
      class="textarea"
      rows="5"
      placeholder="Add observations, links, context…"
      bind:value={notesText}
    ></textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button class="btn" onclick={() => (notesItem = null)}>Cancel</button>
      <button class="btn btn-primary" onclick={saveNotes} disabled={notesSaving}>
        {notesSaving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </Modal>
{/if}

<!-- place edit / save-with-details modal -->
{#if placeModal}
  <Modal
    title={placeModal.id ? 'Edit place' : 'Save place'}
    onclose={() => (placeModal = null)}
    width="420px"
  >
    <label style="display:block;font-size:var(--fs-xs);color:var(--text-3);margin-bottom:5px">Title</label>
    <input
      class="input"
      placeholder={placeCoordsLabel(placeModal)}
      bind:value={placeModal.title}
    />
    <hr style="border:none;border-top:1px solid var(--border);margin:12px 0" />
    <div class="sat-info-rows">
      <div class="sat-info-row">
        <span class="sat-info-label">Coordinates</span>
        <span class="mono">{placeCoordsLabel(placeModal)}</span>
      </div>
      <div class="sat-info-row">
        <span class="sat-info-label">Zoom</span>
        <span>z{placeModal.zoom}{placeModal.bearing ? ` · ${Math.round(placeModal.bearing)}°` : ''}</span>
      </div>
    </div>
    <hr style="border:none;border-top:1px solid var(--border);margin:12px 0" />
    <label style="display:block;font-size:var(--fs-xs);color:var(--text-3);margin-bottom:5px">Notes</label>
    <textarea
      class="textarea"
      rows="5"
      placeholder="Add observations, links, context…"
      bind:value={placeModal.notes}
    ></textarea>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
      <button class="btn" onclick={() => (placeModal = null)}>Cancel</button>
      <button class="btn btn-primary" onclick={savePlaceModal} disabled={placeSaving}>
        {placeSaving ? 'Saving…' : 'Save'}
      </button>
    </div>
  </Modal>
{/if}

<!-- reference-image picker: choose a case image to float over the map. Pure
     scratch aid — the window is never captured or saved. -->
{#if refPicker}
  <Modal title="Add reference" onclose={() => (refPicker = false)} width="560px">
    <p class="ref-hint">
      Float one of the case's images or videos over the map to eyeball against the imagery.
      It's a scratch aid — never captured or saved.
    </p>
    {#if refLoading}
      <div class="ref-empty">Loading…</div>
    {:else if !refMedia.length}
      <div class="ref-empty">
        No images or videos in this case yet — import one in the Media Library first.
      </div>
    {:else}
      <div class="ref-grid">
        {#each (caseState.current ? refMedia : []) as m (m.path)}
          <button class="ref-pick" onclick={() => addRef(m)} title={m.title ?? m.filename}>
            <div class="ref-thumb">
              {#if m.thumbnail}
                <img src={`/files/${caseState.current.id}/${m.thumbnail}`} alt={m.filename} loading="lazy" />
              {:else}
                <Icon name={m.kind === 'video' ? 'video' : 'image'} size={26} />
              {/if}
              {#if m.kind === 'video'}
                <span class="ref-kind"><Icon name="video" size={11} /></span>
              {/if}
            </div>
            <span class="ref-name">{m.title ?? m.filename}</span>
          </button>
        {/each}
      </div>
    {/if}
  </Modal>
{/if}

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
    overflow: hidden;
  }
  .map {
    position: absolute;
    inset: 0;
    background: var(--bg-2);
  }
  .frame-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    border: 1px dashed rgba(255, 255, 255, 0.55);
    box-shadow: 0 0 0 100vmax rgba(8, 11, 18, 0.28);
    pointer-events: none;
    z-index: 450;
  }
  .marker-overlay {
    position: absolute;
    top: 50%;
    left: 50%;
    pointer-events: none;
    z-index: 500;
  }
  .marker-crosshair {
    transform: translate(-50%, -50%);
  }
  .marker-pin {
    /* tip of the pin sits on the point */
    transform: translate(-50%, -100%);
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
  }
  :global(.sat-marker) {
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
  }
  /* Sober rotation pivot (Google-Earth style): faint translucent ring + dot. */
  .rotate-pivot {
    position: absolute;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 650;
    color: #fff;
  }
  .rotate-pivot svg {
    display: block;
    overflow: visible;
    filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.55));
  }
  .rotate-pivot .ring {
    fill: none;
    stroke: currentColor;
    stroke-width: 1;
    opacity: 0.5;
  }
  .rotate-pivot .dot {
    fill: currentColor;
    opacity: 0.8;
  }
  .pin-tag {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--accent-text, #fff);
    background: var(--accent);
    border-radius: 3px;
    padding: 1px 4px;
  }
  .hud {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 600;
    display: flex;
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
  /* imagery date: small, low-contrast pill tucked into the bottom-left corner */
  .date-pill {
    position: absolute;
    bottom: 12px;
    left: 12px;
    z-index: 600;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border-radius: 999px;
    font-size: var(--fs-xs);
    color: var(--text-3);
    background: rgba(16, 22, 35, 0.7);
    backdrop-filter: blur(6px);
    pointer-events: none;
  }

  /* fullscreen: the whole tool covers the viewport, above the app chrome */
  .tool.fullscreen {
    position: fixed;
    inset: 0;
    z-index: 2000;
    background: var(--bg-0);
  }

  /* top-left control cluster (fullscreen · OSM labels · measure) */
  .map-tools {
    position: absolute;
    top: 12px;
    left: 12px;
    /* above Leaflet's own control corners (z-index 1000) so the measure panel
       is never hidden behind the zoom +/- buttons (item 7) */
    z-index: 1100;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-start;
  }
  .tool-cluster {
    display: flex;
    gap: 2px;
    padding: 4px;
    background: rgba(16, 22, 35, 0.88);
    backdrop-filter: blur(6px);
  }
  .mtbtn {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-1);
    color: var(--text-2);
    cursor: pointer;
  }
  .mtbtn:hover {
    color: var(--text-1);
    background: var(--bg-3);
  }
  .mtbtn.on {
    color: var(--accent-text);
    background: var(--accent);
  }
  .mtbtn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .mtbtn:disabled:hover {
    color: var(--text-2);
    background: none;
  }
  /* float to the right of the tool cluster instead of below it, where the
     Leaflet zoom control sits — otherwise the two overlap (item 7) */
  .measure-panel {
    position: absolute;
    top: 0;
    left: calc(100% + 8px);
    width: max-content;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    background: rgba(16, 22, 35, 0.92);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-2);
  }
  .measure-btns {
    display: flex;
    gap: 4px;
  }
  .measure-btns .btn.on {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .measure-readout {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
  .measure-value {
    font-size: var(--fs-md);
    font-weight: 700;
    color: var(--accent);
  }
  .measure-hint {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .map-wrap.measuring :global(.leaflet-container),
  .map-wrap.selecting :global(.leaflet-container) {
    cursor: crosshair;
  }

  /* live capture marquee: a dashed box with a dark scrim over the rest of the
     map, mirroring the centred frame-overlay look */
  .sel-rect {
    position: absolute;
    border: 1.5px dashed var(--accent);
    box-shadow: 0 0 0 100vmax rgba(8, 11, 18, 0.28);
    pointer-events: none;
    z-index: 460;
  }
  .sel-dim {
    position: absolute;
    top: -22px;
    left: 0;
    padding: 2px 6px;
    border-radius: var(--radius-1);
    font-size: var(--fs-xs);
    color: var(--text-1);
    background: var(--accent);
    color: var(--accent-text);
    white-space: nowrap;
  }

  /* lightweight compass — no heavy card, just the rose + an editable readout */
  .rotate-ctl {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 600;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .compass {
    position: relative;
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    color: var(--text-2);
    cursor: pointer;
    /* round translucent backing disc so the rose reads clearly over any
       imagery — same fill as the degree readout below (item 3) */
    border-radius: 50%;
    background: rgba(16, 22, 35, 0.88);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-1);
  }
  .compass:hover {
    color: var(--accent);
  }
  .compass svg {
    transition: transform 0.1s linear;
  }
  .compass .n {
    position: absolute;
    top: 1px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 9px;
    font-weight: 700;
    color: var(--text-1);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    pointer-events: none;
  }
  .deg {
    min-width: 40px;
    text-align: center;
    padding: 2px 6px;
    border-radius: var(--radius-1);
    font-size: var(--fs-xs);
    color: var(--text-1);
    background: rgba(16, 22, 35, 0.88);
    backdrop-filter: blur(6px);
    cursor: text;
  }
  .deg:hover {
    color: var(--accent);
  }
  .deg-input {
    width: 52px;
    padding: 2px 4px;
    text-align: center;
    font-size: var(--fs-xs);
  }
  .capture-bar {
    position: absolute;
    bottom: 34px;
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
  /* billed-provider tile counter (KEYED_PROVIDERS.md §6) — full readout in Settings */
  .usage-pill {
    font-size: var(--fs-xs);
    color: var(--text-3);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 3px 9px;
    white-space: nowrap;
  }
  .bar-sep {
    width: 1px;
    align-self: stretch;
    background: var(--border);
    margin: 0 2px;
  }
  /* the capture split-button: main action + arrow fused into one pill,
     mirroring .place-save's main/edit split */
  .capture-split {
    display: flex;
    align-items: stretch;
  }
  .capture-main {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .capture-arrow {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    background: var(--accent);
    border-color: transparent;
    border-left: 1px solid rgba(0, 0, 0, 0.2);
    color: var(--accent-text);
  }
  .capture-arrow:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .size-menu-wrap .capture-arrow.on {
    background: var(--accent-hover);
  }
  .capture-main.on {
    box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.5);
  }
  .custom-size {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .size-input {
    width: 64px;
    padding: 5px 6px;
    font-size: var(--fs-xs);
    text-align: center;
  }

  /* square icon button (the size/ratio/resolution popover trigger) */
  .btn-icon {
    padding: 6px 8px;
  }
  .btn-icon.on {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
  }
  .size-menu-wrap {
    position: relative;
    display: flex;
  }
  .size-menu {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    width: max-content;
    max-width: 280px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 12px;
    background: rgba(16, 22, 35, 0.96);
    backdrop-filter: blur(6px);
    box-shadow: var(--shadow-2);
    z-index: 700;
  }
  .menu-row {
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: space-between;
  }
  .menu-label {
    font-size: var(--fs-xs);
    color: var(--text-3);
    font-weight: 600;
  }
  .chips {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .chip {
    padding: 4px 9px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
    white-space: nowrap;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }
  .chip:hover {
    border-color: var(--border-strong);
    color: var(--text-1);
  }
  .chip.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .menu-hint {
    font-size: 10px;
    color: var(--text-3);
    margin: -1px 0 5px;
  }
  .menu-row + .custom-size {
    justify-content: flex-end;
    padding: 2px 0;
  }
  .prov.dates {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 1px;
  }
  .prov.dates :global(svg) {
    vertical-align: -1px;
    opacity: 0.8;
  }
  .img-date {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .place-save {
    display: flex;
    align-items: stretch;
  }
  .place-save-main {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .place-save-edit {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    border-left: none;
    padding-left: 8px;
    padding-right: 8px;
  }
  .btn-toggle {
    white-space: nowrap;
  }
  .btn-toggle.on {
    background: var(--accent);
    color: var(--accent-text);
    border-color: var(--accent);
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
  .captures.collapsed {
    width: 42px;
  }
  .cap-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 14px 14px 8px;
    width: 100%;
    background: none;
    border: none;
    color: var(--text-1);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .cap-head:hover {
    color: var(--accent);
  }
  .captures.collapsed .cap-head {
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    gap: 10px;
    padding: 14px 0;
    height: 100%;
  }
  .captures.collapsed .cap-head .label {
    writing-mode: vertical-rl;
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
  .panel-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 4px 12px 12px;
    display: flex;
    flex-direction: column;
  }
  .sub-head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 12px 2px 6px;
    background: none;
    border: none;
    font: inherit;
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-2);
    text-align: left;
    cursor: pointer;
  }
  .sub-head:hover {
    color: var(--accent);
  }
  .sub-head .count {
    margin-left: auto;
    text-transform: none;
  }
  .links-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    padding: 4px 2px 6px;
  }
  .ext-link {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-1);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
    text-decoration: none;
    overflow: hidden;
  }
  .ext-link span {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ext-link:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .ext-link :global(svg:last-child) {
    color: var(--text-3);
    flex-shrink: 0;
  }
  .links-note {
    padding: 0 4px 6px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .place-notes {
    padding: 0 10px 8px 30px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    font-style: italic;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
  }
  .place-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .place-row {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .place-main {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px 4px 4px;
  }
  .place-goto {
    display: flex;
    align-items: center;
    gap: 9px;
    flex: 1;
    min-width: 0;
    padding: 5px 6px;
    background: none;
    border: none;
    color: var(--text-2);
    text-align: left;
    cursor: pointer;
  }
  .place-goto:hover,
  .place-goto:hover .title {
    color: var(--accent);
  }
  .place-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .cap-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .cap {
    overflow: hidden;
    flex-shrink: 0;
  }
  .cap-goto {
    display: block;
    width: 100%;
    padding: 0;
    background: none;
    border: none;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .cap img {
    width: 100%;
    aspect-ratio: 10 / 7;
    object-fit: cover;
    background: var(--bg-2);
  }
  .cap-goto:hover img {
    opacity: 0.9;
  }
  .cap-goto:hover .coords {
    color: var(--accent);
  }
  .cap-meta {
    padding: 8px 10px 2px;
    display: flex;
    flex-direction: column;
  }
  .title {
    font-size: var(--fs-sm);
    color: var(--text-1);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .coords {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .cap-goto:hover .title {
    color: var(--accent);
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
  .cap-notes {
    padding: 0 10px 8px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    font-style: italic;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .sat-info-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sat-info-row {
    display: flex;
    gap: 10px;
    font-size: var(--fs-sm);
    align-items: baseline;
  }
  .sat-info-label {
    color: var(--text-3);
    font-size: var(--fs-xs);
    min-width: 80px;
    flex-shrink: 0;
  }

  /* Leaflet dark-theme adjustments */
  :global(.leaflet-container) {
    font-family: var(--font-sans);
    background: var(--bg-2);
    image-rendering: smooth;
  }
  /* NB: no backface-visibility / transform promotion on tiles — that forces
     each tile onto its own GPU layer and reintroduces the white seams the
     deSeamTiles() left/top positioning removes (see script). */
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
  /* zoom +/- (topleft) sits directly under the fullscreen/labels/measure
     cluster instead of Leaflet's default corner margin, which used to land
     it right on top of that cluster */
  :global(.leaflet-top.leaflet-left) {
    top: 58px !important;
    left: 12px !important;
  }
  :global(.leaflet-top.leaflet-left .leaflet-control) {
    margin: 0 0 8px !important;
  }
  :global(.leaflet-pane) {
    will-change: transform;
  }
  /* Slim ruler-style scale: no boxed panel, just a light bracket + label
     floating directly on the map so it stays readable over any imagery. */
  :global(.leaflet-control-scale) {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    padding: 0 !important;
    margin: 0 10px 10px 0 !important;
  }
  :global(.leaflet-control-scale-line) {
    background: transparent !important;
    border: none !important;
    border-left: 1.5px solid rgba(255, 255, 255, 0.92) !important;
    border-right: 1.5px solid rgba(255, 255, 255, 0.92) !important;
    border-bottom: 1.5px solid rgba(255, 255, 255, 0.92) !important;
    color: #fff !important;
    font-size: 10px !important;
    font-weight: 600 !important;
    line-height: 1.3 !important;
    padding: 0 4px 1px !important;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85), 0 0 4px rgba(0, 0, 0, 0.5) !important;
  }

  /* reference-image picker */
  .ref-hint {
    font-size: var(--fs-sm);
    color: var(--text-2);
    margin: 0 0 12px;
  }
  .ref-empty {
    padding: 24px 4px;
    text-align: center;
    font-size: var(--fs-sm);
    color: var(--text-3);
  }
  .ref-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
    max-height: 52vh;
    overflow-y: auto;
  }
  .ref-pick {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 0;
    background: none;
    border: none;
    color: var(--text-2);
    cursor: pointer;
    text-align: left;
  }
  .ref-thumb {
    position: relative;
    aspect-ratio: 4 / 3;
    border-radius: var(--radius-1);
    overflow: hidden;
    background: var(--bg-2);
    display: grid;
    place-items: center;
    color: var(--text-3);
    border: 1px solid var(--border);
  }
  .ref-kind {
    position: absolute;
    bottom: 4px;
    right: 4px;
    display: grid;
    place-items: center;
    padding: 2px;
    border-radius: var(--radius-1);
    color: #fff;
    background: rgba(11, 15, 23, 0.75);
    backdrop-filter: blur(4px);
  }
  .ref-pick:hover .ref-thumb {
    border-color: var(--accent);
  }
  .ref-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .ref-name {
    font-size: var(--fs-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ref-pick:hover .ref-name {
    color: var(--accent);
  }
</style>
