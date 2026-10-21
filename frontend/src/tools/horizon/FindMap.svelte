<script>
  /**
   * The map column of Find: the area searched, the alignments' lines, where
   * they meet and, for tops that touch, where along a line the eye stands.
   *
   * The area is drawn corner by corner; a press on the first corner, Enter or
   * Done closes it, and a corner is moved by dragging it or taken away with a
   * right-click. An alignment's line runs from its near point out to the
   * camera's side, in a narrow wedge for its tolerance; both ends can be
   * dragged where the clicks missed.
   *
   * Once a search is done, every point it scored is a cell of the heatmap
   * under the rest, the score in its blue's lightness and opacity, and its best
   * places are numbered marks a click looks from.
   *
   * The Layers menu is Horizon's own: the same switches, so a layer turned on
   * here shows on the small map too. The case's layers and saved work are
   * drawn under the area to trace it by, and let a click through while the
   * area or an alignment is being drawn.
   */
  import { untrack } from 'svelte';
  import { createSurface } from '../../lib/map/surface.js';
  import { alignmentLine, alignmentWedge, areaMiddle, facingSectors, fanOf, GROUNDS, heatStyle, ringsOf, WATER_COLOUR } from '../../lib/horizon/find.js';
  import MapSurface from '../satellite/MapSurface.svelte';
  import MapNavigation from './MapNavigation.svelte';
  import MapLayersPanel from './MapLayersPanel.svelte';
  import AddedLayersOverlay from '../satellite/AddedLayersOverlay.svelte';
  import SavedOverlay from '../satellite/SavedOverlay.svelte';
  import Icon from '../../components/Icon.svelte';
  import { fmtCoords } from '../../lib/state.svelte.js';

  let {
    /** The shared imagery catalogue (state/imagery.svelte.js). */
    imagery,
    /** What is laid over the imagery, as Horizon's own map has it. */
    overlays = [],
    /**
     * Horizon's Layers menu and what it draws: `{ bases, rows, added, drawn,
     * toggle, caseId, drawing, saved, onmanage, onrefresh }`, `saved` the
     * case's saved work to draw or null. Null leaves the menu out.
     */
    layers = null,
    /** The finder (state/find.svelte.js). */
    find,
    /** Where the map opens: `{ lat, lon, zoom }`. */
    home,
    imperial = false,
    /** Asked to stand at a place, `{ lat, lon }`. */
    onstand = () => {},
    /** Asked to look from a place the search found. */
    onplace = () => {},
    /** The place of the results lit with the panel's list, or -1. */
    lit = $bindable(-1),
  } = $props();

  const AREA = '#f5a524';
  /** The headings the fan draws: the app's reading of the compass and the sun when the sun is said, else the compass's. */
  function fanSectors() {
    const read = find.sectors?.sectors;
    if (Array.isArray(read)) return read.map(([centre, half]) => ({ centre, half }));
    return facingSectors(find.facing);
  }

  /** A zone searched on a finer grid, and a zone left out. */
  const ZONE_IN = '#4dd6ff';
  const ZONE_OUT = '#ff6b6b';
  /** The fan of the directions the photo may face. */
  const FAN = '#e8eef7';

  let engine = $state(null);
  let ready = $state(false);
  let refused = $state(false);
  let view = $state(untrack(() => home));
  let bearing = $state(0);
  let providerId = $state('esri-world-imagery');
  let heat = $state.raw(null);
  let shapes = $state.raw(null);
  let marks = $state.raw(null);
  let layersOpen = $state(false);
  let layersFolded = $state({});
  /** The area or an alignment is being drawn: clicks go to it, not to a layer. */
  const holding = $derived(find.drawing === 'area' || find.drawing === 'zone' || find.drawing === 'try' || find.step?.on === 'map');

  /** A saved item picked on the map: the map goes to it. */
  function flyToSaved(row) {
    if (row.lat == null || row.lon == null || !engine) return;
    engine.setView({ lat: Number(row.lat), lon: Number(row.lon) }, Math.max(engine.getZoom(), Number(row.zoom) || 13));
  }

  $effect(() => {
    if (!engine || !ready) return;
    untrack(() => {
      // the heatmap first, so the area and the lines are drawn over it
      heat ??= createSurface(engine);
      shapes ??= createSurface(engine);
      marks ??= createSurface(engine);
    });
  });

  const result = $derived(find.search?.status === 'done' ? find.search.result : null);

  /** A ground's colour on the grid read before the search. */
  const GROUND_COLOUR = Object.fromEntries([...GROUNDS.map((g) => [g.id, g.colour]), ['water', WATER_COLOUR]]);
  const GROUND_WORDS = Object.fromEntries([...GROUNDS.map((g) => [g.id, g.label]), ['water', 'Water']]);

  // every point the search scored, as a cell as wide as the grid it was laid on; before any, the grid
  // the search would lay, each point in its ground's colour and grey where it is left out
  $effect(() => {
    if (!heat) return;
    const points = result?.points ?? [];
    if (!points.length) {
      const grid = find.drawing !== 'area' && !find.search ? (find.previewed?.points ?? []) : [];
      heat.set(
        grid.map(([lat, lon, kind, kept], index) => ({
          id: `grid-${index}`,
          kind: 'dot',
          at: { lat, lon },
          style: kept
            ? { stroke: '#0b0d10', strokeWidth: 0.5, strokeOpacity: 0.6, fill: GROUND_COLOUR[kind] ?? '#ffffff', fillOpacity: 0.85, radius: 3 }
            : { stroke: '#0b0d10', strokeWidth: 0, strokeOpacity: 0, fill: '#8a8f98', fillOpacity: 0.35, radius: 2 },
          tip: `${GROUND_WORDS[kind] ?? kind}${kept ? '' : ': left out'}`,
        }))
      );
      return;
    }
    const best = Math.max(result.places?.[0]?.explained ?? -1, ...points.map((p) => p.explained));
    const low = Math.max(0, Math.min(...points.map((p) => p.explained)));
    heat.set(
      points.map((point, index) => {
        const half = (point.spacing || 100) / 2;
        const dLat = half / 111_195;
        const dLon = half / (111_195 * Math.cos((point.lat * Math.PI) / 180));
        const { fill, opacity } = heatStyle(point.explained, best, low);
        return {
          id: `heat-${index}`,
          kind: 'rect',
          bounds: { north: point.lat + dLat, south: point.lat - dLat, east: point.lon + dLon, west: point.lon - dLon },
          style: { stroke: fill, strokeWidth: 0, strokeOpacity: 0, fill, fillOpacity: opacity },
          tip: `Explains ${Math.round(Math.max(0, point.explained) * 100)}% of the trace`,
        };
      })
    );
  });

  // the fan of the directions ticked, the area, the lines and their wedges
  $effect(() => {
    if (!shapes) return;
    const area = find.area;
    const tolerance = find.settings.tolerance;
    const out = [];
    const middle = area.length >= 3 && find.drawing !== 'area' ? areaMiddle(area) : null;
    if (middle) {
      for (const [index, ring] of fanOf(middle, fanSectors(), find.reach).entries()) {
        out.push({
          id: `fan-${index}`,
          kind: 'polygon',
          points: ring,
          style: { stroke: FAN, strokeWidth: 1, strokeOpacity: 0.7, dash: [4, 4], fill: FAN, fillOpacity: 0.07 },
          interactive: false,
        });
      }
      for (const ring of ringsOf(middle, fanSectors(), find.reach)) {
        out.push({ id: `ring-${ring.id}`, kind: 'line', points: ring.points, style: { stroke: FAN, strokeWidth: 1, strokeOpacity: 0.55 }, interactive: false });
      }
    }
    for (const zone of find.zones ?? []) {
      if (zone.points.length < 2) continue;
      const whole = zone.points.length >= 3 && !(find.drawing === 'zone' && find.zoneDrawn?.id === zone.id);
      const colour = zone.out ? ZONE_OUT : ZONE_IN;
      out.push({
        id: `zone-${zone.id}`,
        kind: whole ? 'polygon' : 'line',
        points: zone.points,
        style: { stroke: colour, strokeWidth: 2, dash: zone.out ? [6, 4] : undefined, ...(whole ? { fill: colour, fillOpacity: zone.out ? 0.18 : 0.08 } : {}) },
        interactive: false,
      });
    }
    if (area.length >= 2) {
      out.push({
        id: 'area',
        kind: area.length >= 3 && find.drawing !== 'area' ? 'polygon' : 'line',
        points: area,
        style: { stroke: AREA, strokeWidth: 2, ...(area.length >= 3 && find.drawing !== 'area' ? { fill: AREA, fillOpacity: 0.08 } : {}) },
        interactive: false,
      });
    }
    for (const one of find.alignments) {
      out.push({
        id: `wedge-${one.id}`,
        kind: 'polygon',
        points: alignmentWedge(one, tolerance),
        style: { stroke: one.colour, strokeWidth: 0.5, strokeOpacity: 0.5, fill: one.colour, fillOpacity: 0.12 },
        interactive: false,
      });
      out.push({ id: `line-${one.id}`, kind: 'line', points: alignmentLine(one), style: { stroke: one.colour, strokeWidth: 1.5 }, interactive: false });
      out.push({ id: `link-${one.id}`, kind: 'line', points: [one.map.near, one.map.far], style: { stroke: one.colour, strokeWidth: 1, dash: [3, 3] }, interactive: false });
      for (const [index, fit] of (one.touch?.fits ?? []).entries()) {
        if (fit.from && fit.to) {
          out.push({ id: `fit-${one.id}-${index}`, kind: 'line', points: [fit.from, fit.to], style: { stroke: '#ffffff', strokeWidth: 5, strokeOpacity: 0.9 }, interactive: false });
        }
      }
    }
    shapes.set(out);
  });

  // the corners, the ends and where the lines meet
  $effect(() => {
    if (!marks) return;
    const area = find.area;
    const drawingArea = find.drawing === 'area';
    const out = area.map((corner, index) => ({
      id: `corner-${index}`,
      kind: 'marker',
      at: corner,
      className: 'find-corner',
      html: `<span${index === 0 && drawingArea && area.length >= 3 ? ' class="closes"' : ''}></span>`,
      size: [12, 12],
      title: index === 0 && drawingArea && area.length >= 3 ? 'Close the area here' : 'Drag to move this corner, right-click to take it away',
      draggable: true,
      zIndex: 700,
      onClick: index === 0 && drawingArea && area.length >= 3 ? () => find.closeArea() : undefined,
      // the outline follows the hand; the corner is moved once it is let go
      onDrag: (at) => {
        dragged = { corner: index, at };
        shapes?.patch('area', { points: area.map((p, i) => (i === index ? at : p)) });
      },
      onDragEnd: letGo,
      onContextMenu: () => find.removeCorner(index),
    }));
    for (const [n, one] of find.alignments.entries()) {
      out.push({
        id: `near-${one.id}`,
        kind: 'marker',
        at: one.map.near,
        className: 'find-end',
        html: `<span style="background:${one.colour}">${n + 1}</span>`,
        size: [18, 18],
        title: 'The near point of this alignment: drag it where the click missed',
        draggable: true,
        zIndex: 720,
        onDrag: (at) => (dragged = { id: one.id, end: 'near', at }),
        onDragEnd: letGo,
      });
      out.push({
        id: `far-${one.id}`,
        kind: 'marker',
        at: one.map.far,
        className: 'find-end far',
        html: `<span style="border-color:${one.colour}"></span>`,
        size: [14, 14],
        title: 'The far point of this alignment: drag it where the click missed',
        draggable: true,
        zIndex: 710,
        onDrag: (at) => (dragged = { id: one.id, end: 'far', at }),
        onDragEnd: letGo,
      });
      for (const [index, fit] of (one.touch?.fits ?? []).entries()) {
        if (!fit.at) continue;
        out.push({
          id: `eye-${one.id}-${index}`,
          kind: 'marker',
          at: fit.at,
          className: 'find-eye',
          html: `<span style="border-color:${one.colour}"></span>`,
          size: [14, 14],
          tip: `Eye at ${fit.at.eye} m over the ground: a click stands here`,
          zIndex: 730,
          onClick: () => onstand(fit.at),
        });
      }
    }
    // the alignment being made: its near point as it will stay, in its own colour and number
    const pendingMap = find.pending?.map ?? {};
    if (pendingMap.near) {
      const colour = find.pending.colour ?? AREA;
      out.push({
        id: 'pending-near',
        kind: 'marker',
        at: pendingMap.near,
        className: 'find-end',
        html: `<span style="background:${colour}">${find.alignments.length + 1}</span>`,
        size: [18, 18],
        zIndex: 740,
      });
    }
    // how far each ring of the fan stands, on its middle
    if (find.area.length >= 3 && !drawingArea) {
      const middle = areaMiddle(find.area);
      for (const ring of ringsOf(middle, fanSectors(), find.reach)) {
        out.push({
          id: `ring-label-${ring.id}`,
          kind: 'marker',
          at: ring.label,
          className: 'find-ring',
          html: `<span>${Math.round(ring.metres / 1000)} km</span>`,
          size: [44, 16],
          zIndex: 600,
        });
      }
    }
    // what each zone is, at its middle: its grid, or left out
    for (const zone of find.zones ?? []) {
      if (zone.points.length < 3 || find.zoneDrawn?.id === zone.id) continue;
      out.push({
        id: `zone-label-${zone.id}`,
        kind: 'marker',
        at: areaMiddle(zone.points),
        className: `find-zone${zone.out ? ' out' : ''}`,
        html: `<span>${zone.out ? 'Left out' : zone.spacing === 'auto' ? 'Finer' : `${zone.spacing} m`}</span>`,
        size: [64, 18],
        zIndex: 610,
      });
    }
    const drawn = find.zoneDrawn;
    for (const [index, corner] of (drawn?.points ?? []).entries()) {
      out.push({
        id: `zone-corner-${index}`,
        kind: 'marker',
        at: corner,
        className: 'find-corner zone',
        html: `<span${index === 0 && drawn.points.length >= 3 ? ' class="closes"' : ''}></span>`,
        size: [12, 12],
        title: index === 0 && drawn.points.length >= 3 ? 'Close the zone here' : '',
        zIndex: 700,
        onClick: index === 0 && drawn.points.length >= 3 ? () => find.closeArea() : undefined,
      });
    }
    const tried = find.tried;
    if (tried?.at) {
      out.push({
        id: 'tried',
        kind: 'marker',
        at: tried.at,
        className: 'find-tried',
        html: '<span></span>',
        size: [16, 16],
        tip: tried.place ? `Tried here: explains ${Math.round(Math.max(0, tried.place.explained) * 100)}%` : 'Trying here…',
        zIndex: 770,
      });
    }
    for (const [index, place] of (result?.places ?? []).entries()) {
      out.push({
        id: `place-${index}`,
        kind: 'marker',
        at: place,
        className: 'find-place',
        html: `<span>${index + 1}</span>`,
        size: [22, 22],
        tip: `Explains ${Math.round(Math.max(0, place.explained) * 100)}%: a click looks from here`,
        zIndex: 760 - index,
        onClick: () => onplace(place),
        onOver: () => (lit = index),
        onOut: () => (lit = -1),
      });
    }
    const met = find.meeting;
    if (met) {
      out.push({
        id: 'meeting',
        kind: 'marker',
        at: met.at,
        className: 'find-meet',
        html: '<span></span>',
        size: [22, 22],
        tip: `The lines meet here, within ${Math.round(met.spread)} m: a click stands here`,
        zIndex: 750,
        onClick: () => onstand(met.at),
      });
    }
    marks.set(out);
  });

  // the place lit with the panel's list: its mark restyled where it stands, the others left alone
  $effect(() => {
    const on = lit;
    if (!marks) return;
    untrack(() => {
      for (const [index] of (result?.places ?? []).entries()) {
        marks.patch(`place-${index}`, {
          icon: { className: `find-place${on === index ? ' lit' : ''}`, html: `<span>${index + 1}</span>`, size: [22, 22] },
        });
      }
    });
  });

  // a corner or an end let go where it was dragged
  let dragged = null;
  function letGo() {
    const was = dragged;
    dragged = null;
    if (!was) return;
    if (Number.isInteger(was.corner)) find.moveCorner(was.corner, was.at);
    else find.moveEnd(was.id, was.end, was.at);
  }

  function onclick(point) {
    if (find.drawing === 'area' || find.drawing === 'zone') find.addCorner(point);
    else if (find.drawing === 'try') find.tryAt?.(point);
    else if (find.step?.on === 'map') find.mapClick(point);
  }

  /** Escape closes the Layers menu before Find takes it back from an enlarged column. */
  function onWindowKey(event) {
    if (event.key !== 'Escape' || !layersOpen || event.defaultPrevented) return;
    event.preventDefault();
    layersOpen = false;
  }

  function onKey(event) {
    if (event.defaultPrevented || event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    if (event.key === 'Enter' && (find.drawing === 'area' || find.drawing === 'zone')) find.closeArea();
    else if (event.key === 'Escape' && (find.drawing === 'area' || find.drawing === 'zone')) find.closeArea();
    else if (event.key === 'Escape' && find.drawing === 'try') find.stopTrying?.();
    else if (event.key === 'Backspace' && find.drawing === 'area' && find.area.length) find.removeCorner(find.area.length - 1);
  }

  // the area closed, however it was (Done, Enter, its first corner): the map comes over it
  let wasDrawing = false;
  $effect(() => {
    const drawingNow = find.drawing === 'area';
    if (wasDrawing && !drawingNow) untrack(showArea);
    wasDrawing = drawingNow;
  });

  /** The map over the area, once it is closed. */
  function showArea() {
    const area = find.area;
    if (!engine || area.length < 3) return;
    engine.fitBounds?.(
      {
        south: Math.min(...area.map((p) => p.lat)),
        north: Math.max(...area.map((p) => p.lat)),
        west: Math.min(...area.map((p) => p.lon)),
        east: Math.max(...area.map((p) => p.lon)),
      },
      { padding: 40 }
    );
  }
</script>

<svelte:window onkeydowncapture={onWindowKey} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fm" class:drawing={find.drawing === 'area' || find.drawing === 'zone' || find.drawing === 'try'} class:holding onkeydown={onKey}>
  {#if view}
    <MapSurface
      bind:engine
      bind:view
      bind:bearing
      bind:ready
      bind:refused
      bind:providerId
      {imagery}
      {overlays}
      {home}
      resetToHome={false}
      chrome={false}
      {imperial}
      armed={holding ? 'grid-drawing' : 'selecting'}
      controlsTop={60}
      {onclick}
    >
      <MapNavigation {engine} {view} {bearing} units={imperial ? 'imperial' : 'metric'} listId="horizon-find-suggestions" />
      {#if layers}
        <AddedLayersOverlay
          engine={ready ? engine : null}
          caseId={layers.caseId}
          layers={layers.drawn}
          drawing={layers.drawing}
          interactive={!holding}
        />
        {#if layers.saved}
          <SavedOverlay
            engine={ready ? engine : null}
            items={layers.saved}
            caseId={layers.caseId}
            coords={(item) => fmtCoords(item.lat, item.lon)}
            onopen={flyToSaved}
            onrefresh={layers.onrefresh}
          />
        {/if}
      {/if}
    </MapSurface>
    {#if layers}
      <button
        type="button"
        class="fm-layers"
        class:on={layersOpen}
        aria-expanded={layersOpen}
        aria-controls="hz-find-layers"
        onclick={() => (layersOpen = !layersOpen)}
        title="Base map and layers"
        aria-label="Map layers"
      >
        <Icon name="layers" size={14} />
      </button>
      {#if layersOpen}
        <MapLayersPanel
          id="hz-find-layers"
          bases={layers.bases}
          bind:providerId
          rows={layers.rows}
          added={layers.added}
          ontoggleadded={layers.toggle}
          onmanage={layers.onmanage}
          bind:folded={layersFolded}
        />
      {/if}
    {/if}
  {/if}
</div>

<style>
  /* the surface fills a flex box, as it does in every map tool */
  .fm {
    position: relative;
    display: flex;
    width: 100%;
    height: 100%;
  }
  .fm-layers {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 700;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: var(--r-md);
    background: color-mix(in srgb, var(--bg-1) 88%, transparent);
    box-shadow: 0 0 0 1px var(--border);
    color: var(--text-1);
    cursor: pointer;
  }
  .fm-layers:hover,
  .fm-layers.on {
    color: var(--accent);
  }
  .fm-layers:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  /* the saved marks let a corner or an alignment's click through to the map */
  .fm.holding :global(.saved-mark-wrap),
  .fm.holding :global(.saved-cone) {
    pointer-events: none;
  }
  .fm :global(.find-corner span) {
    display: block;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #f5a524;
    box-shadow: 0 0 0 2px #0b0d10;
    cursor: move;
  }
  .fm :global(.find-corner.zone span) {
    background: #4dd6ff;
  }
  .fm :global(.find-zone) {
    pointer-events: none;
  }
  .fm :global(.find-zone span) {
    display: grid;
    place-items: center;
    height: 18px;
    border-radius: 9px;
    background: rgba(11, 13, 16, 0.75);
    color: #4dd6ff;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }
  .fm :global(.find-zone.out span) {
    color: #ff6b6b;
  }
  .fm :global(.find-corner span.closes) {
    box-shadow:
      0 0 0 2px #0b0d10,
      0 0 0 5px #f5a524;
    cursor: pointer;
  }
  .fm :global(.find-end span) {
    display: grid;
    place-items: center;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    color: #0b0d10;
    font-size: 11px;
    font-weight: 700;
    box-shadow: 0 0 0 2px #0b0d10;
    cursor: move;
  }
  .fm :global(.find-end.far span) {
    width: 14px;
    height: 14px;
    border: 3px solid;
    background: #0b0d10;
    box-sizing: border-box;
  }
  .fm :global(.find-eye span) {
    display: block;
    width: 14px;
    height: 14px;
    border: 3px solid;
    border-radius: 50%;
    background: #fff;
    box-sizing: border-box;
    cursor: pointer;
  }
  .fm :global(.find-ring) {
    pointer-events: none;
  }
  .fm :global(.find-ring span) {
    display: grid;
    place-items: center;
    height: 16px;
    color: #e8eef7;
    font-size: 11px;
    text-shadow: 0 0 3px #0b0d10, 0 0 2px #0b0d10;
    white-space: nowrap;
  }
  .fm :global(.find-tried span) {
    display: block;
    width: 16px;
    height: 16px;
    border: 2px solid #fff;
    border-radius: 50%;
    background: #ff7ad9;
    box-shadow: 0 0 0 2px #0b0d10;
  }
  .fm :global(.find-place span) {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #fde725;
    color: #0b0d10;
    font-size: 12px;
    font-weight: 700;
    box-shadow: 0 0 0 2px #0b0d10;
    cursor: pointer;
  }
  .fm :global(.find-place.lit span) {
    box-shadow:
      0 0 0 2px #0b0d10,
      0 0 0 5px #fde725;
  }
  .fm :global(.find-meet span) {
    display: block;
    width: 22px;
    height: 22px;
    border: 2px solid #fff;
    border-radius: 50%;
    background: radial-gradient(circle, #fff 0 3px, transparent 4px);
    box-shadow: 0 0 0 2px #0b0d10;
    cursor: pointer;
  }
</style>
