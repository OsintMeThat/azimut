<script>
  /**
   * The map column of Find: the area searched, the alignments' lines, where
   * they meet and, for tops that touch, where along a line the eye stands.
   *
   * The area is drawn corner by corner; a press on the first corner, Enter or
   * Done closes it, and a corner is moved by dragging it or taken away with a
   * right-click. More areas are drawn the same way and searched with it. The
   * brush passes over the grid while the map holds still: Off greys the points
   * it passes over, On turns them back on (Alt the other way for a stroke), at
   * once on the map, each stroke over the ones before; Ctrl+Z takes the last back. An alignment's line runs from its near point out to the
   * camera's side, in a narrow wedge for its tolerance; both ends can be
   * dragged where the clicks missed.
   *
   * While a search runs, the points it has scored fill the grid in as cells of
   * the heatmap, each laid once as it comes. Once it ends, every point it scored
   * is a cell, the score in its colour and opacity, and its best places are
   * numbered marks a click looks from. A click on a cell tries the trace there
   * in full, as the best places were; the place the analyst confirmed is a mark
   * of its own.
   *
   * The Layers menu is Horizon's own: the same switches, so a layer turned on
   * here shows on the small map too. The case's layers and saved work are
   * drawn under the area to trace it by, and let a click through while the
   * area or an alignment is being drawn.
   */
  import { untrack } from 'svelte';
  import { createSurface } from '../../lib/map/surface.js';
  import {
    alignmentLine,
    alignmentWedge,
    areaMiddle,
    facingSectors,
    fanOf,
    GROUNDS,
    heatOf,
    heatFloor,
    heatStyle,
    latticeNear,
    local,
    mapCells,
    resultOf,
    ringsOf,
    RULED,
    searchedPoints,
    WATER_COLOUR,
  } from '../../lib/horizon/find.js';
  import MapSurface from '../satellite/MapSurface.svelte';
  import MapNavigation from './MapNavigation.svelte';
  import MapLayersPanel from './MapLayersPanel.svelte';
  import AddedLayersOverlay from '../satellite/AddedLayersOverlay.svelte';
  import SavedOverlay from '../satellite/SavedOverlay.svelte';
  import Icon from '../../components/Icon.svelte';
  import { containsPoint } from '../../lib/measure.js';
  import { fmtCoords } from '../../lib/state.svelte.js';
  import { STROKE_POINTS_MAX } from './state/find.svelte.js';

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
    /** Asked to look again from the place the analyst confirmed (the search's `found`). */
    onfound = () => {},
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
  /** The points the brush paints in past the grid, shown until the app's grid lays them. */
  let painted = $state.raw(null);
  let shapes = $state.raw(null);
  let marks = $state.raw(null);
  let layersOpen = $state(false);
  let layersFolded = $state({});
  /** The area or an alignment is being drawn: clicks go to it, not to a layer. */
  const holding = $derived(['area', 'zone', 'more', 'try', 'brush'].includes(find.drawing) || find.step?.on === 'map');

  /** A saved item picked on the map: the map goes to it. */
  function flyToSaved(row) {
    if (row.lat == null || row.lon == null || !engine) return;
    engine.setView({ lat: Number(row.lat), lon: Number(row.lon) }, Math.max(engine.getZoom(), Number(row.zoom) || 13));
  }

  $effect(() => {
    if (!engine || !ready) return;
    untrack(() => {
      // the heatmap first, so the area and the lines are drawn over it; its points restyled at once under the brush
      heat ??= createSurface(engine, { tints: true });
      painted ??= createSurface(engine);
      shapes ??= createSurface(engine);
      marks ??= createSurface(engine);
    });
  });

  const result = $derived(resultOf(find.search));

  /** A ground's colour on the grid read before the search. */
  const GROUND_COLOUR = Object.fromEntries([...GROUNDS.map((g) => [g.id, g.colour]), ['water', WATER_COLOUR]]);
  const GROUND_WORDS = Object.fromEntries([...GROUNDS.map((g) => [g.id, g.label]), ['water', 'Water'], ['painted', 'Left out by the brush'], ...Object.entries(RULED)]);
  /** The best a running search has scored must grow this much before its cells are coloured again against it. */
  const LIVE_RECOLOUR = 0.05;

  const keyOf = (lat, lon) => `${lat},${lon}`;

  /** How a point of the grid looks, `[kind, kept]`: in its ground's colour, grey where it is left out, and what it says. */
  function dotLook([kind, kept]) {
    return {
      style: kept
        ? { stroke: '#0b0d10', strokeWidth: 0.5, strokeOpacity: 0.6, fill: GROUND_COLOUR[kind] ?? '#ffffff', fillOpacity: 0.85, radius: 3 }
        : { stroke: '#0b0d10', strokeWidth: 0, strokeOpacity: 0, fill: '#8a8f98', fillOpacity: 0.35, radius: 2 },
      tip: kind === 'painted' || RULED[kind] ? GROUND_WORDS[kind] : `${GROUND_WORDS[kind] ?? kind}${kept ? '' : ': left out'}`,
    };
  }

  /** A point of the grid read before the search, `[lat, lon, kind, kept]`. */
  function gridDot([lat, lon, kind, kept]) {
    return { id: `grid-${keyOf(lat, lon)}`, kind: 'dot', at: { lat, lon }, ...dotLook([kind, kept]) };
  }

  /** A point the brush paints in past the grid, its ground not read yet. */
  function paintedDot([lat, lon]) {
    return {
      id: `in-${keyOf(lat, lon)}`,
      kind: 'dot',
      at: { lat, lon },
      style: { stroke: '#0b0d10', strokeWidth: 0.5, strokeOpacity: 0.6, fill: '#ffffff', fillOpacity: 0.85, radius: 3 },
      tip: 'Painted in by the brush',
    };
  }

  /** A point scored, as a cell as wide as the grid it was laid on; a click tries the trace there in full while nothing is drawn. */
  function cell(point, id, { fill, opacity, tip }, answers) {
    const half = (point.spacing || 100) / 2;
    const dLat = half / 111_195;
    const dLon = half / (111_195 * Math.cos((point.lat * Math.PI) / 180));
    return {
      id,
      kind: 'rect',
      bounds: { north: point.lat + dLat, south: point.lat - dLat, east: point.lon + dLon, west: point.lon - dLon },
      style: { stroke: fill, strokeWidth: 0, strokeOpacity: 0, fill, fillOpacity: opacity },
      tip: answers ? `${tip}: a click tries it in full` : tip,
      ...(answers ? { onClick: () => find.tryAt({ lat: point.lat, lon: point.lon }) } : {}),
    };
  }

  /** A point a running search scored, coloured from the middle of those scored (`low`) to the best so far. */
  function liveCell(point, index, best, low, answers) {
    const tip = `Explains ${Math.round(Math.max(0, point.explained) * 100)}% so far, read roughly`;
    return cell(point, `live-${index}`, { ...heatStyle(point.explained, best, low), tip }, answers);
  }

  const bestOf = (points) => points.reduce((best, p) => Math.max(best, p.explained), 0.05);

  // every point the search scored, as a cell; while it runs, the grid with the points scored so far over it,
  // each laid once as it comes; before it runs, or once the setup is changed from the one it searched, the grid
  let laid = null;
  $effect(() => {
    if (!heat) return;
    const cells = mapCells({ search: find.search, edited: find.edited, drawing: find.drawing, previewed: find.previewed, live: find.live });
    // the cells answer a click while nothing is being drawn on the map
    const answers = !holding;
    if (cells.kind === 'grid') {
      // the strokes painted since the grid was read are laid over it
      const strokes = find.strokes;
      untrack(() => layGrid(cells.points, strokes));
      return;
    }
    untrack(dropPaintedIn);
    if (cells.kind === 'live') {
      untrack(() => layLive(cells, answers));
      return;
    }
    const points = cells.points;
    if (laid?.kind === cells.kind && laid.points === points && laid.answers === answers) return;
    laid = { kind: cells.kind, points, answers };
    const heats = heatOf(points, Math.max(result.places?.[0]?.explained ?? -1, ...points.map((p) => p.explained)));
    heat.set(points.map((point, index) => cell(point, `heat-${index}`, heats[index], answers)));
  });

  // -- the grid read before the search ------------------------------------------------

  /** A grid read again that keeps this share of its points is changed where it changed, not laid again. */
  const GRID_HELD = 0.5;
  /** How each point of the grid shows now, by key, `[kind, kept]`: as the app read it, with the strokes since over it. */
  let shown = new Map();
  /** How each point looked before the brush left it out, by key: what painting it back on brings back. */
  let before = new Map();
  /** The points shown over their own style, by key: the look of the tint. */
  let tinted = new Map();
  /** The points the brush painted in past the grid, by key: `[lat, lon]`. */
  let paintedIn = new Map();

  const sameLook = (a, b) => a?.[0] === b?.[0] && a?.[1] === b?.[1];

  /** Whether the eye may stand on this ground, as the app reads it (engine/finder.py `standing`). */
  function standsOn(ground) {
    const stands = find.stands ?? [];
    if (find.who?.mode === 'ground' && ground === 'water' && !stands.includes('water')) return false;
    return !stands.length || stands.includes(ground);
  }

  /** The strokes painted since the grid on the map was read, or none when one it read was taken back. */
  function unread(strokes) {
    const read = find.previewed?.strokesRead ?? [];
    const now = strokes ?? [];
    if (read.length > now.length || read.some((stroke, i) => stroke !== now[i])) return [];
    return now.slice(read.length);
  }

  /**
   * The grid the app read, laid once; read again, only the points that came or went are sent and the rest
   * restyled where it changed. The strokes painted since, and the one under way, are laid over it.
   */
  function layGrid(points, strokes) {
    const was = laid?.kind === 'grid' ? laid : null;
    if (!was || was.points !== points) {
      const keys = points.map(([lat, lon]) => keyOf(lat, lon));
      const held = was ? keys.reduce((count, key) => count + (was.base.has(key) ? 1 : 0), 0) : 0;
      if (!was || held < GRID_HELD * Math.max(keys.length, was.base.size)) {
        heat.set(points.map(gridDot));
        tinted = new Map();
        laid = { kind: 'grid', points, keys, base: new Map(points.map((p, i) => [keys[i], [p[2], p[3]]])) };
      } else {
        const fresh = new Set(keys);
        const gone = [...was.base.keys()].filter((key) => !fresh.has(key));
        for (const key of gone) {
          was.base.delete(key);
          tinted.delete(key);
        }
        heat.drop(gone.map((key) => `grid-${key}`));
        const added = points.filter((_, i) => !was.base.has(keys[i]));
        heat.add(added.map(gridDot));
        for (const p of added) was.base.set(keyOf(p[0], p[1]), [p[2], p[3]]);
        laid = { ...was, points, keys };
      }
    }
    shown = new Map(points.map((p, i) => [laid.keys[i], [p[2], p[3]]]));
    before = new Map(points.filter((p) => p[2] === 'painted' && p[4]).map((p) => [keyOf(p[0], p[1]), [p[4], standsOn(p[4])]]));
    const wasIn = paintedIn;
    paintedIn = new Map();
    const changed = new Set(laid.keys);
    for (const stroke of unread(strokes)) paintPath(stroke.path, stroke.radius, stroke.out, changed);
    if (painting) paintPath(painting.path, find.brush.radius, painting.out, changed);
    for (const key of changed) restyle(key);
    if (paintedIn.size || wasIn.size) painted?.set([...paintedIn.values()].map(paintedDot));
  }

  /** A point of the grid drawn as it shows now: over its own style while the two differ. */
  function restyle(key) {
    const look = shown.get(key);
    const base = laid.base.get(key);
    if (!look || !base) return;
    if (sameLook(look, base)) {
      if (tinted.delete(key)) heat.tint(`grid-${key}`, null, dotLook(base).tip);
      return;
    }
    if (sameLook(look, tinted.get(key))) return;
    const { style, tip } = dotLook(look);
    heat.tint(`grid-${key}`, style, tip);
    tinted.set(key, look);
  }

  /** The points painted in past the grid taken off, once the grid on the map is not the one read before a search. */
  function dropPaintedIn() {
    if (!paintedIn.size) return;
    paintedIn = new Map();
    painted?.clear();
  }

  /**
   * The grid with the points a running search has scored over it. Laid whole when it starts, when the grid or
   * the clicks change, or once the best so far has grown enough to colour the cells again; else only the points
   * scored since are added, and their dots taken off the grid.
   */
  function layLive({ points: grid, scored }, answers) {
    const best = bestOf(scored);
    const was = laid?.kind === 'live' ? laid : null;
    if (!was || was.grid !== grid || was.answers !== answers || scored.length < was.count || best > was.best + LIVE_RECOLOUR) {
      const done = new Set(scored.map((p) => keyOf(p.lat, p.lon)));
      const low = Math.min(heatFloor(scored), best);
      heat.set([...grid.filter(([lat, lon]) => !done.has(keyOf(lat, lon))).map(gridDot), ...scored.map((p, i) => liveCell(p, i, best, low, answers))]);
      laid = { kind: 'live', grid, answers, count: scored.length, best, low };
      return;
    }
    if (scored.length === was.count) return;
    const fresh = scored.slice(was.count);
    heat.drop(fresh.map((p) => `grid-${keyOf(p.lat, p.lon)}`));
    heat.add(fresh.map((p, i) => liveCell(p, was.count + i, was.best, was.low, answers)));
    laid = { ...was, count: scored.length };
  }

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
    for (const more of find.areas ?? []) {
      if (more.points.length < 2) continue;
      const whole = more.points.length >= 3 && find.moreDrawn?.id !== more.id;
      out.push({
        id: `more-${more.id}`,
        kind: whole ? 'polygon' : 'line',
        points: more.points,
        style: { stroke: AREA, strokeWidth: 2, ...(whole ? { fill: AREA, fillOpacity: 0.08 } : {}) },
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
      zIndex: 540,
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
        zIndex: 550,
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
        zIndex: 545,
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
          zIndex: 555,
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
        zIndex: 560,
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
          zIndex: 500,
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
        zIndex: 505,
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
        zIndex: 540,
        onClick: index === 0 && drawn.points.length >= 3 ? () => find.closeArea() : undefined,
      });
    }
    // each area beside the first, named at its middle; the one being drawn with its corners
    for (const [index, more] of (find.areas ?? []).entries()) {
      if (more.points.length < 3 || find.moreDrawn?.id === more.id) continue;
      out.push({
        id: `more-label-${more.id}`,
        kind: 'marker',
        at: areaMiddle(more.points),
        className: 'find-zone more',
        html: `<span>Area ${index + 2}</span>`,
        size: [64, 18],
        zIndex: 505,
      });
    }
    const growing = find.moreDrawn;
    for (const [index, corner] of (growing?.points ?? []).entries()) {
      out.push({
        id: `more-corner-${index}`,
        kind: 'marker',
        at: corner,
        className: 'find-corner',
        html: `<span${index === 0 && growing.points.length >= 3 ? ' class="closes"' : ''}></span>`,
        size: [12, 12],
        title: index === 0 && growing.points.length >= 3 ? 'Close the area here' : '',
        zIndex: 540,
        onClick: index === 0 && growing.points.length >= 3 ? () => find.closeArea() : undefined,
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
        zIndex: 575,
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
        zIndex: 570 - index,
        onClick: () => onplace(place),
        onOver: () => (lit = index),
        onOut: () => (lit = -1),
      });
    }
    const found = find.search?.found;
    if (found) {
      out.push({
        id: 'found',
        kind: 'marker',
        at: found,
        className: 'find-found',
        html: '<span>✓</span>',
        size: [24, 24],
        tip: 'The place you confirmed: a click looks from it again',
        zIndex: 578,
        onClick: () => onfound(found),
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
        zIndex: 565,
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

  // -- the brush ------------------------------------------------------------------

  /** The stroke being painted, `{ path, out, last }` (`last` where the hand was, in pixels), or null. */
  let painting = null;
  /** Whether a stroke is under way, and which way it paints: what the ring under the hand shows. */
  let paintingOut = $state(null);
  /** Where the pointer stands over the map while the brush is on, in pixels of the map, or null. */
  let pointer = $state(null);
  /** Read again when the camera settles: how many metres a pixel of the map spans then. */
  let metresPerPixel = $state(10);

  function readScale() {
    if (!engine?.container) return;
    const rect = engine.container.getBoundingClientRect();
    const x = rect.width / 2;
    const y = rect.height / 2;
    const span = local(engine.containerPointToLatLng({ x, y }), engine.containerPointToLatLng({ x: x + 100, y }));
    const metres = Math.hypot(span.x, span.y) / 100;
    if (metres > 0) metresPerPixel = metres;
  }
  $effect(() => {
    if (!engine || !ready) return;
    readScale();
    return engine.on('view-settled', readScale);
  });

  // a drag paints rather than pans while the brush is on; the map it was asked of is the one given back
  $effect(() => {
    const brushing = find.drawing === 'brush';
    const map = ready ? engine : null;
    if (!map) return;
    map.setPanning?.(!brushing);
    if (!brushing) {
      painting = null;
      paintingOut = null;
      pointer = null;
    }
    return () => map.setPanning?.(true);
  });

  /** How wide the brush paints, in pixels across: what the ring under the hand shows. */
  const brushAcross = $derived((2 * find.brush.radius) / metresPerPixel);

  /** How far `point` (`[lat, lon]`) stands from the path from `a` to `b`, metres, worked flat about `a`. */
  function fromPath(point, a, b) {
    const north = 111_195;
    const east = north * Math.cos((a.lat * Math.PI) / 180);
    const bx = (b.lon - a.lon) * east;
    const by = (b.lat - a.lat) * north;
    const length = bx * bx + by * by;
    const px = (point[1] - a.lon) * east;
    const py = (point[0] - a.lat) * north;
    const t = length > 0 ? Math.min(1, Math.max(0, (px * bx + py * by) / length)) : 0;
    return Math.hypot(px - t * bx, py - t * by);
  }

  /**
   * The brush over the grid from `a` to `b`, `radius` metres either side, as the app reads a stroke
   * (engine/finder.py `within`): Off greys the points it passes over, On brings back the ones it left out and
   * lays the ground past the grid on the app's lattice, but in a finer zone, which lays its own. The points
   * restyled are gathered in `changed`.
   */
  function paintSegment(a, b, radius, out, changed) {
    if (laid?.kind !== 'grid') return;
    for (const [index, point] of laid.points.entries()) {
      if (fromPath(point, a, b) > radius) continue;
      const key = laid.keys[index];
      const look = shown.get(key);
      if (out === (look[0] === 'painted')) continue;
      if (out) {
        before.set(key, look);
        shown.set(key, ['painted', false]);
      } else {
        if (!before.has(key)) continue;
        shown.set(key, before.get(key));
      }
      changed.add(key);
    }
    if (out) {
      for (const [key, point] of paintedIn) if (fromPath(point, a, b) <= radius) paintedIn.delete(key);
      return;
    }
    const finer = (find.zones ?? []).filter((zone) => !zone.out && zone.points.length >= 3);
    for (const [lat, lon] of latticeNear(find.area, find.previewed?.spacing, a, b, radius)) {
      const key = keyOf(lat, lon);
      if (shown.has(key) || paintedIn.has(key) || finer.some((zone) => containsPoint(zone.points, { lat, lon }))) continue;
      paintedIn.set(key, [lat, lon]);
    }
  }

  /** A whole stroke over the grid (`paintSegment`). */
  function paintPath(path, radius, out, changed) {
    if (!path?.length) return;
    if (path.length === 1) paintSegment(path[0], path[0], radius, out, changed);
    for (let i = 1; i < path.length; i += 1) paintSegment(path[i - 1], path[i], radius, out, changed);
  }

  /** The hand's path from `a` to `b` painted at once: the points it passes over restyled, those painted in laid. */
  function brushOver(a, b) {
    const changed = new Set();
    const had = paintedIn.size;
    paintSegment(a, b, find.brush.radius, painting.out, changed);
    for (const key of changed) restyle(key);
    if (paintedIn.size !== had) painted?.set([...paintedIn.values()].map(paintedDot));
  }

  /** Where an event stands on the map: its pixel in the map, and the place there. */
  function mapPoint(event) {
    const rect = engine.container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return { x, y, at: engine.containerPointToLatLng({ x, y }) };
  }

  function onPaintDown(event) {
    if (find.drawing !== 'brush' || event.button !== 0 || !engine) return;
    // the map's own buttons, a mark and the Layers menu keep their press
    if (event.target?.closest?.('button, input, .maplibregl-ctrl, .maplibregl-marker, .hz-layers')) return;
    event.preventDefault();
    const { x, y, at } = mapPoint(event);
    // Alt paints the other way for as long as the stroke lasts
    painting = { path: [at], out: event.altKey ? !find.brush.out : find.brush.out, last: { x, y } };
    paintingOut = painting.out;
    brushOver(at, at);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function onPaintMove(event) {
    if (find.drawing !== 'brush' || !engine) return;
    const { x, y, at } = mapPoint(event);
    pointer = { x, y };
    if (!painting) return;
    // a point every sixth of the brush's width, or every few pixels for a fine one
    if (Math.hypot(x - painting.last.x, y - painting.last.y) < Math.max(4, brushAcross / 6)) return;
    brushOver(painting.path.at(-1), at);
    painting.path.push(at);
    painting.last = { x, y };
    if (painting.path.length < STROKE_POINTS_MAX) return;
    // a stroke this long is kept, and the hand goes on with another
    find.addStroke({ path: painting.path, radius: find.brush.radius, out: painting.out });
    painting = { ...painting, path: [at] };
  }

  function onPaintUp() {
    if (!painting) return;
    find.addStroke({ path: painting.path, radius: find.brush.radius, out: painting.out });
    painting = null;
    paintingOut = null;
  }

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
    if (find.drawing === 'area' || find.drawing === 'zone' || find.drawing === 'more') find.addCorner(point);
    else if (find.drawing === 'try') find.tryAt?.(point);
    else if (find.step?.on === 'map') find.mapClick(point);
  }

  /** Escape closes the Layers menu before Find takes it back from an enlarged column; Ctrl+Z takes the brush's last stroke back while it paints. */
  function onWindowKey(event) {
    if (find.drawing === 'brush' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      event.stopPropagation();
      find.undoStroke();
      return;
    }
    if (event.key !== 'Escape' || !layersOpen || event.defaultPrevented) return;
    event.preventDefault();
    layersOpen = false;
  }

  function onKey(event) {
    if (event.defaultPrevented || event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const closing = ['area', 'zone', 'more'].includes(find.drawing);
    if (event.key === 'Enter' && closing) find.closeArea();
    else if (event.key === 'Escape' && closing) find.closeArea();
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

  // a search opened from the list: the map comes over everything it was drawn with, once it can move
  let framedAt = untrack(() => find.opened);
  $effect(() => {
    const opened = find.opened;
    if (!engine || !ready || opened === framedAt) return;
    framedAt = opened;
    untrack(() => engine.fitPoints?.(searchedPoints(find), { padding: 40, maxZoom: 17 }));
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
<div
  class="fm"
  class:drawing={['area', 'zone', 'more', 'try'].includes(find.drawing)}
  class:brushing={find.drawing === 'brush'}
  class:holding
  onkeydown={onKey}
  onpointerdowncapture={onPaintDown}
  onpointermove={onPaintMove}
  onpointerup={onPaintUp}
  onpointercancel={onPaintUp}
  onpointerleave={() => (pointer = null)}
>
  {#if find.drawing === 'brush' && pointer}
    <!-- how wide the brush paints, under the hand -->
    <div
      class="fm-brush"
      class:back={paintingOut === null ? !find.brush.out : !paintingOut}
      style:left="{pointer.x}px"
      style:top="{pointer.y}px"
      style:width="{brushAcross}px"
      style:height="{brushAcross}px"
      aria-hidden="true"
    ></div>
  {/if}
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
  /* the brush's ring under the hand, as wide as it reaches: grey turns points off, white turns them on */
  .fm-brush {
    position: absolute;
    z-index: 650;
    border: 1.5px solid #8a8f98;
    border-radius: 50%;
    box-shadow:
      0 0 0 1px rgba(11, 13, 16, 0.6),
      inset 0 0 0 1px rgba(11, 13, 16, 0.6);
    transform: translate(-50%, -50%);
    pointer-events: none;
  }
  .fm-brush.back {
    border-color: #ffffff;
  }
  .fm.brushing :global(.map-surface canvas) {
    cursor: none;
  }
  .fm :global(.find-zone.more span) {
    color: #f5a524;
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
  .fm :global(.find-found span) {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: #3fbc73;
    color: #0b0d10;
    font-size: 14px;
    font-weight: 800;
    box-shadow:
      0 0 0 2px #0b0d10,
      0 0 0 4px #3fbc73;
    cursor: pointer;
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
