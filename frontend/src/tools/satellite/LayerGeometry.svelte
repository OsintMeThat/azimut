<script>
  /**
   * Where a personal layer is edited on the map: its tool bar, the selection
   * drawn round what is picked, features dragged where they go, a loop drawn
   * round what to pick, the corners of a shape being drawn or reshaped, the
   * ring that turns a selected marker, and the menu a right-click opens. A new
   * shape says its size beside the pointer as it is drawn.
   *
   * Mounted by every map that edits (Map, Detect, Compare, Horizon), so the bar
   * and the gestures are the same whichever one the analyst is on. A press on
   * a picked feature (an area by its edge) is taken before the map sees it, so
   * it moves the feature rather than the map; a drag anywhere else pans.
   */
  import LayerEditBar from './LayerEditBar.svelte';
  import LayerFeatureMenu from './LayerFeatureMenu.svelte';
  import MarkerSymbol from './MarkerSymbol.svelte';
  import { iconLibrary } from '../../lib/iconLibrary.svelte.js';
  import { featuresInLoop, hitFeature, hitPart, linesOf, markerDisc } from '../../lib/map/layerHit.js';
  import { isBadge } from '../../lib/map/markerGlyphs.js';
  import { SOURCE_ICON_SCALE } from '../../lib/map/addedLayer.js';
  import { middleClickPaste } from '../../lib/clipboardPaste.js';
  import { sketchReading } from '../../lib/map/sketchMeasure.js';
  import { prefs } from '../../lib/state.svelte.js';
  import { layerIconUrl, readyPicture } from '../../lib/map/ownIcons.js';
  import { bearingToward, facingLabel, knobAt, screenNorth } from '../../lib/map/turnRing.js';
  import { perFrame } from '../../lib/map/perFrame.js';

  /**
   * `bar`: whether this map carries the tool bar, false on the second of two side-by-side maps.
   * `onmenu`: the map's own point menu, opened from a feature's on its point (`{ lat, lon, x, y, feature, layer }`).
   */
  let { engine, controller, active = true, ondone = null, bar = true, onmenu = null } = $props();
  let frame = $state(0);
  /** The corner last pressed while a line is reshaped, which is where it can be cut. */
  let vertex = $state(null);
  /** The loop being drawn, in screen pixels, and whether it adds to the selection. */
  let loop = $state(null);
  /** A marker's direction while its ring is turned, until it is let go. */
  let turning = $state(null);
  /** Where a right-click on a feature opened its menu, in window pixels, and the point it was on (`point`). */
  let featureMenu = $state(null);
  /** Where the pointer is while a new shape is drawn, as `[lon, lat]`: the corner a click would lay. */
  let pointer = $state(null);
  let dragCleanup = null;
  /** Past this many pixels a press on a feature is a drag, short of it a click. */
  const DRAG_PIXELS = 4;
  /** A corner drawn this near one already in the layer lands on it; Alt held lets it go free. */
  const SNAP_PIXELS = 10;
  /** The corner a press would land on now, while a shape is drawn, in screen pixels. */
  let snapTarget = $state(null);
  /** The corner being dragged, `{ ring, index, lon, lat }`: drawn where the pointer has it, the shape taking it once let go. */
  let moving = $state(null);
  /** A "+" is put between two corners at least this far apart on the screen: closer, it would hide them. */
  const MID_ROOM = 28;
  /** How far past the map's edges handles are still drawn, so one dragged to the edge stays under the pointer. */
  const HANDLE_MARGIN = 40;
  let altHeld = false;
  /** Whether the last press was on this map: a Delete after a press on a button of the panel removes nothing. */
  let pressedOnMap = false;

  const editing = $derived(active && !!engine && !!controller.editor && !controller.loading);
  const groups = $derived(new Map((controller.groups ?? []).map((group) => [group.id, group])));
  const hiddenGroups = $derived(new Set(controller.editor?.hidden ?? []));
  /** The features as the map draws them: a uniform group's style or colour, its size, its visible
   *  groups only, and in its order, the first group last so that it is on top. */
  const shown = $derived.by(() => {
    if (!editing) return [];
    const rank = new Map((controller.groups ?? []).map((group, index) => [group.id, index]));
    return controller.features.flatMap((feature) => {
      const group = groups.get(feature.properties.group);
      // a tracked feature that was not there on the layer's day is not there to pick
      if (hiddenGroups.has(group?.name) || feature.properties.$absent) return [];
      const style = group?.mode === 'uniform' ? { symbol: group.symbol, colour: group.colour }
        : group?.mode === 'colour' ? { colour: group.colour } : {};
      return [{ ...feature, properties: { ...feature.properties, ...style, icon_scale: group?.size ?? 1 } }];
    }).sort((a, b) => (rank.get(b.properties.group) ?? 0) - (rank.get(a.properties.group) ?? 0));
  });
  const project = (lon, lat) => engine.latLngToContainerPoint({ lat, lon });

  const sketch = $derived(active ? controller.sketch : null);
  /**
   * The sketch's corners on the screen, each `{ x, y, ri, index }`, worked out again
   * only as the map moves or the shape changes: a dragged corner changes neither
   * until it is let go, so a shape of thousands of corners is not re-read at each step.
   */
  const projected = $derived.by(() => {
    frame;
    return sketch && engine ? sketch.rings.map((ring, ri) => ring.map(([lon, lat], index) => {
      const at = engine.latLngToContainerPoint({ lat, lon });
      return { x: at.x, y: at.y, ri, index };
    })) : [];
  });
  /** …with the corner being dragged where the pointer has it, every other corner the very same. */
  const rings = $derived.by(() => {
    const ring = moving && projected[moving.ring];
    if (!ring?.[moving.index]) return projected;
    const at = engine.latLngToContainerPoint({ lat: moving.lat, lon: moving.lon });
    const moved = ring.slice();
    moved[moving.index] = { x: at.x, y: at.y, ri: moving.ring, index: moving.index };
    return projected.map((one, ri) => (ri === moving.ring ? moved : one));
  });
  /** The map's box, read as it moves: handles beyond it are not drawn. */
  const box = $derived.by(() => {
    frame;
    const rect = engine?.container?.getBoundingClientRect?.();
    return rect?.width ? { width: rect.width, height: rect.height } : null;
  });
  const inView = (x, y) => !box || (x >= -HANDLE_MARGIN && y >= -HANDLE_MARGIN && x <= box.width + HANDLE_MARGIN && y <= box.height + HANDLE_MARGIN);
  /** The corners a handle is drawn on: those in view, and the one being dragged wherever it is. */
  const handles = $derived(rings.flatMap((ring) => ring.filter((point) => inView(point.x, point.y)
    || (moving && point.ri === moving.ring && point.index === moving.index))));
  const closed = $derived(['Polygon', 'MultiPolygon'].includes(sketch?.type));
  const path = $derived(rings.map((ring) => ring.length ? `M${ring.map((point) => `${point.x},${point.y}`).join(' L')}${closed ? ' Z' : ''}` : '').join(' '));
  /** The leg from the last corner to the pointer, closing back to the first on an area: the click not yet made. */
  const pending = $derived.by(() => {
    frame;
    const ring = sketch?.rings?.[0];
    if (!pointer || !engine || !ring?.length || sketch.key || sketch.shape || controller.freehand || !['LineString', 'Polygon'].includes(sketch.type)) return '';
    const at = ([lon, lat]) => { const p = engine.latLngToContainerPoint({ lat, lon }); return `${p.x},${p.y}`; };
    return `M${at(ring.at(-1))} L${at(pointer)}${sketch.type === 'Polygon' && ring.length > 1 ? ` L${at(ring[0])}` : ''}`;
  });
  /** What the new shape measures with that leg, said beside the pointer (or its last corner once the pointer has left). */
  const reading = $derived.by(() => {
    frame;
    const text = sketchReading(sketch, controller.freehand ? null : pointer, prefs.units);
    const spot = pointer ?? sketch?.rings?.[0]?.at(-1);
    if (!text || !spot || !engine) return null;
    const at = engine.latLngToContainerPoint({ lat: spot[1], lon: spot[0] });
    return { text, x: at.x, y: at.y };
  });
  const selectionPreview = $derived.by(() => {
    frame;
    if (!engine || sketch?.type !== 'Selection') return { path: '', points: [] };
    const delta = [sketch.rings[0][0][0] - sketch.origin[0], sketch.rings[0][0][1] - sketch.origin[1]];
    const at = ([lon, lat]) => engine.latLngToContainerPoint({ lon: lon + delta[0], lat: lat + delta[1] });
    const walk = (coords) => typeof coords?.[0]?.[0] === 'number' ? [coords] : (coords ?? []).flatMap(walk);
    const points = [], paths = [];
    for (const feature of sketch.before) {
      if (feature.geometry.type === 'Point') points.push(at(feature.geometry.coordinates));
      else for (const ring of walk(feature.geometry.coordinates)) paths.push(`M${ring.map((point) => { const p = at(point); return `${p.x},${p.y}`; }).join(' L')}`);
    }
    return { path: paths.join(' '), points };
  });
  /**
   * A "+" halfway along each side long enough on the screen to take one, in view,
   * made as the map moves or the shape changes. While a corner is dragged, the two
   * sides it pulls lose theirs and the others stay as they are.
   */
  const allMids = $derived.by(() => {
    if (!sketch?.key || ['Point', 'Selection'].includes(sketch.type)) return [];
    return projected.flatMap((ring, ri) => ring.flatMap((point, index) => {
      const next = ring[index + 1] ?? (closed ? ring[0] : null);
      if (!next || Math.hypot(next.x - point.x, next.y - point.y) < MID_ROOM) return [];
      const x = (point.x + next.x) / 2, y = (point.y + next.y) / 2;
      return inView(x, y) ? [{ key: `${ri}.${index + 1}`, ring: ri, index: index + 1, x, y }] : [];
    }));
  });
  const mids = $derived.by(() => {
    if (!moving) return allMids;
    const last = projected[moving.ring]?.length ?? 0;
    const pulled = (mid) => mid.ring === moving.ring && (mid.index === moving.index || mid.index === moving.index + 1
      || (moving.index === 0 && mid.index === last));
    return allMids.filter((mid) => !pulled(mid));
  });

  /**
   * Where the painted part of an icon drawn as it is sits from its point, and how far
   * it reaches, in screen pixels at size 1 (`markerDisc`): what a halo, the turn ring
   * and a click go round. Read off the picture the map drew it from, so a padded pin
   * is ringed where its ink is. Null for a disc, which is a badge's size.
   */
  function ownReach(properties) {
    const caseId = controller.editor?.caseId, layer = controller.editor?.name;
    if (!caseId || !layer || controller.icons?.[properties.icon]?.mode === 'disc') return null;
    const picture = readyPicture(layerIconUrl(caseId, layer, properties.icon));
    if (!picture) return null;
    const { image, box } = picture;
    return { dx: (box.x + box.w / 2 - image.width / 2) * SOURCE_ICON_SCALE,
      dy: (box.y + box.h / 2 - image.height / 2) * SOURCE_ICON_SCALE,
      reach: (Math.max(box.w, box.h) / 2) * SOURCE_ICON_SCALE + 3 };
  }

  /** Outlines round what is selected, re-projected as the map moves. */
  const halos = $derived.by(() => {
    frame;
    if (!editing || sketch) return { discs: [], path: '' };
    const keys = new Set(controller.selection ?? []);
    const discs = [], paths = [];
    for (const feature of shown) {
      if (!keys.has(feature.properties.key)) continue;
      if (feature.geometry.type === 'Point') discs.push(markerDisc(feature, project, ownReach));
      else for (const ring of linesOf(feature.geometry)) {
        paths.push(`M${ring.map(([lon, lat]) => { const p = project(lon, lat); return `${p.x},${p.y}`; }).join(' L')}`);
      }
    }
    return { discs, path: paths.join(' ') };
  });

  /** The dragged features where the pointer has them, drawn as the map would. */
  const ghosts = $derived.by(() => {
    frame;
    const drag = controller.dragging;
    if (!editing || !drag?.offset) return { marks: [], path: '' };
    // once let go, the features stand where they landed: the copies wait over them for the map to draw them
    const keys = new Set(drag.keys), [dx, dy] = drag.landing ? [0, 0] : drag.offset;
    const marks = [], paths = [];
    for (const feature of shown) {
      if (!keys.has(feature.properties.key)) continue;
      const geometry = feature.geometry;
      if (geometry.type === 'Point') {
        const at = project(geometry.coordinates[0] + dx, geometry.coordinates[1] + dy);
        const scale = feature.properties.icon_scale ?? 1;
        const badge = isBadge(feature.properties.symbol);
        const icon = feature.properties.icon ? iconLibrary.look(feature.properties.icon,
          { caseId: controller.editor?.caseId, layer: controller.editor?.name, meta: controller.icons }) : null;
        // the size the map draws them at (64 pixels at 0.4), a pin as much as a badge
        marks.push({ key: feature.properties.key, x: at.x, y: at.y, badge: badge || !!icon, size: 25.6 * scale, icon,
          symbol: feature.properties.symbol || 'pin', colour: feature.properties.colour || '#0072b2',
          status: feature.properties.status ?? '', external: feature.properties.provenance === 'external' });
      } else for (const ring of linesOf(geometry)) {
        paths.push(`M${ring.map(([lon, lat]) => { const p = project(lon + dx, lat + dy); return `${p.x},${p.y}`; }).join(' L')}`);
      }
    }
    return { marks, path: paths.join(' ') };
  });

  /**
   * The ring round the one selected marker: its knob points where the marker
   * faces, or waits at north, hollow, for a marker that faces nowhere yet.
   */
  const ring = $derived.by(() => {
    frame;
    const keys = controller.selection ?? [];
    if (!editing || sketch || controller.placing || controller.lassoing || controller.dragging?.offset || keys.length !== 1) return null;
    const feature = shown.find((one) => one.properties.key === keys[0]);
    if (feature?.geometry.type !== 'Point') return null;
    const [lon, lat] = feature.geometry.coordinates;
    // round what the marker draws, as its halo is: a badge's disc, a pin's head, an icon's ink
    const disc = markerDisc(feature, project, ownReach);
    const centre = { x: disc.x, y: disc.y };
    const radius = disc.r + 16;
    const north = screenNorth(project, lon, lat);
    const held = turning?.key === feature.properties.key ? turning.bearing : feature.properties.bearing;
    const bearing = held === undefined || held === null || held === '' ? null : Number(held);
    return { key: feature.properties.key, centre, radius, north, bearing, knob: knobAt(centre, radius, bearing ?? 0, north) };
  });

  /**
   * The corner of the layer nearest a point of the ground, within `SNAP_PIXELS` on the
   * screen, so a line drawn to meet another meets it exactly; the point itself when
   * none is near or Alt is held. A feature being reshaped is not its own target.
   */
  function snapped(point, except = null) {
    if (altHeld || !engine) return point;
    const at = engine.latLngToContainerPoint(point);
    const cells = cornersOnScreen(except);
    const [column, row] = [Math.floor(at.x / SNAP_PIXELS), Math.floor(at.y / SNAP_PIXELS)];
    let best = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const corner of cells.get(`${column + dx},${row + dy}`) ?? []) {
          const gap = Math.hypot(corner.x - at.x, corner.y - at.y);
          if (gap <= SNAP_PIXELS && (!best || gap < best.gap)) best = { gap, ...corner };
        }
      }
    }
    return best ? { lon: best.lon, lat: best.lat, $snap: { x: best.x, y: best.y } } : point;
  }
  /**
   * The layer's corners on the screen in cells `SNAP_PIXELS` wide, worked out once
   * for a view, its features and the one left out: a drag asks at every step, and
   * a layer can hold tens of thousands of corners.
   */
  let corners = null;
  function cornersOnScreen(except) {
    if (corners?.frame === frame && corners.shown === shown && corners.except === except) return corners.cells;
    const cells = new Map();
    const walk = (node) => (typeof node?.[0] === 'number' ? [node] : (node ?? []).flatMap(walk));
    for (const feature of shown) {
      if (except && feature.properties.key === except) continue;
      for (const [lon, lat] of walk(feature.geometry.coordinates)) {
        const p = project(lon, lat);
        const cell = `${Math.floor(p.x / SNAP_PIXELS)},${Math.floor(p.y / SNAP_PIXELS)}`;
        if (!cells.has(cell)) cells.set(cell, []);
        cells.get(cell).push({ lon, lat, x: p.x, y: p.y });
      }
    }
    corners = { frame, shown, except, cells };
    return cells;
  }
  const drawing = () => !!controller.sketch && !['Point', 'Selection'].includes(controller.sketch.type);
  /**
   * Whether a press landed on the drawn map: the flat map's canvas, or the globe's
   * while the 3D view is on, which stands beside the flat map rather than in it.
   * A card, a control or a handle over either keeps its own.
   */
  const onMap = (target) => target?.tagName === 'CANVAS' && (!!engine?.container?.contains?.(target) || !!engine?.onSurface?.(target));
  /** A press just picked a feature: the click the globe hands on after it is not a click on bare ground. */
  let justPicked = false;

  $effect(() => {
    if (!active || !engine) return;
    // A click on bare ground lets the selection go; a feature's own click never gets here.
    const off = [engine.on('view-move', () => frame += 1), engine.on('click', (point) => {
      if (justPicked) { justPicked = false; return; }
      const placed = drawing() ? snapped(point, controller.sketch?.key) : point;
      if (!controller.addPoint({ lat: placed.lat, lon: placed.lon }) && controller.editor && !controller.armed && controller.selection?.length) controller.select(null);
    })];
    const keys = (event) => { altHeld = event.altKey; };
    const pressed = (event) => { pressedOnMap = onMap(event.target) || !!engine.container?.contains?.(event.target); };
    window.addEventListener('keydown', keys); window.addEventListener('keyup', keys);
    window.addEventListener('pointerdown', pressed, true);
    return () => {
      off.forEach((release) => release()); dragCleanup?.();
      window.removeEventListener('keydown', keys); window.removeEventListener('keyup', keys);
      window.removeEventListener('pointerdown', pressed, true);
    };
  });

  /** Keys while a tool is armed, and Delete and Escape on a selection. */
  $effect(() => {
    if (!active || !controller.editor) return;
    const key = (event) => {
      // Enter saves a shape being drawn even from the layer's search field or with the style palette open:
      // neither has anything of its own to do with it, and a shape left unsaved is work lost
      const finishing = event.key === 'Enter' && !event.repeat && controller.sketch && controller.complete
        && !event.target?.closest?.('textarea, select, [contenteditable="true"], [role="alertdialog"], [role="dialog"]')
        && (!event.target?.closest?.('input') || event.target.closest('.find'))
        && !document.querySelector('[role="alertdialog"], [role="dialog"]');
      if (finishing) { event.preventDefault(); event.stopImmediatePropagation(); controller.saveGeometry(); return; }
      if (event.defaultPrevented || event.repeat || event.target?.closest?.('input, textarea, select, .float-menu, [role="alertdialog"], [role="dialog"], [contenteditable="true"]')
        || document.querySelector('[role="alertdialog"], [role="dialog"], .float-menu')) return;
      const ctrl = event.ctrlKey || event.metaKey;
      const undoKey = ctrl && !event.shiftKey && event.key.toLowerCase() === 'z';
      const redoKey = ctrl && ((event.shiftKey && event.key.toLowerCase() === 'z') || event.key.toLowerCase() === 'y');
      // while a shape is drawn or reshaped, Ctrl+Z walks the shape's own steps, never the layer's saved edits
      if (undoKey && controller.sketch) controller.undoSketch();
      else if (redoKey && controller.sketch) controller.redoSketch();
      else if (undoKey) { if (!controller.undo()) return; }
      else if (redoKey) { if (!controller.redo()) return; }
      else if (event.key === 'Escape' && controller.armed) controller.stop();
      else if (event.key === 'Escape' && controller.selection?.length) controller.select(null);
      else if (event.key === 'Enter' && controller.sketch && controller.complete) controller.saveGeometry();
      else if (event.key === 'Backspace' && controller.sketch && !controller.sketch.key && !event.target?.closest?.('.vertex')) controller.undoVertex();
      else if ((event.key === 'Delete' || event.key === 'Backspace') && !controller.armed && controller.selection?.length
        && !event.target?.closest?.('.vertex, .turn-knob') && (pressedOnMap || event.target === document.body)) controller.removeSelection();
      else return;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });

  /** A paste anywhere but a field is a position for the layer. */
  $effect(() => {
    if (!editing) return;
    const paste = (event) => {
      if (event.target?.closest?.('input, textarea, [contenteditable="true"]') || middleClickPaste() || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (!text.trim()) return;
      event.preventDefault();
      controller.openPaste(text);
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  });

  /**
   * The presses the map must not see: one on a feature of the layer, which picks
   * or drags it, and any while the loop is armed, which draws it. Mouse and touch
   * events follow a pointer press, and the engine pans on those, so each is
   * stopped until the click that ends the gesture.
   */
  $effect(() => {
    if (!editing) return;
    const box = engine.container;
    let swallow = false;
    const local = (event) => { const rect = box.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
    // Only a press on the drawn map itself, flat or the globe: a card, a control or a handle over it keeps its own.
    const ours = (event) => !onMap(event.target);
    function down(event) {
      swallow = false;
      if (onMap(event.target)) justPicked = false;
      // a freehand stroke: every point the pointer passes, thinned, until it is let go
      const sketch = controller.sketch;
      if (event.button === 0 && !ours(event) && controller.freehand && sketch && !sketch.key && !sketch.shape
        && ['LineString', 'Polygon'].includes(sketch.type)) {
        swallow = true; event.preventDefault(); event.stopPropagation();
        stroke(local(event), local);
        return;
      }
      // A right press on a feature opens its menu; the map must not start turning under it.
      if (event.button === 2 && !ours(event) && !controller.armed && hitFeature(shown, project, local(event), ownReach)) {
        swallow = true; event.preventDefault(); event.stopPropagation();
        return;
      }
      if (event.button !== 0 || ours(event) || controller.placing || controller.sketch) return;
      const at = local(event);
      if (controller.lassoing) {
        swallow = true; event.preventDefault(); event.stopPropagation();
        drawLoop(event, at, local);
        return;
      }
      const hit = hitPart(shown, project, at, ownReach);
      if (!hit) return;
      const { key } = hit;
      const add = event.shiftKey || event.ctrlKey || event.metaKey;
      if (!add && (!(controller.selection ?? []).includes(key) || hit.part === 'inside')) {
        // Only what is picked moves, and an area by its edge: a press picks, a drag pans
        // the map, so a pan that starts on a feature never carries it off.
        const up = (next) => {
          window.removeEventListener('pointerup', up, true);
          const end = local(next);
          if (Math.hypot(end.x - at.x, end.y - at.y) >= DRAG_PIXELS) return;
          swallow = true; justPicked = true;
          controller.chooseKeys([key]);
        };
        window.addEventListener('pointerup', up, true);
        return;
      }
      swallow = true; event.preventDefault(); event.stopPropagation();
      press(event, key, at, local);
    }
    const block = (event) => { if (swallow && onMap(event.target)) { event.stopPropagation(); if (event.cancelable && event.type !== 'touchstart') event.preventDefault(); } };
    const click = (event) => { if (swallow && onMap(event.target)) { event.stopPropagation(); event.preventDefault(); swallow = false; } };
    function dblclick(event) {
      // a double click ends a line or an area being drawn, its second click not a corner of its own
      const sketch = controller.sketch;
      if (!ours(event) && sketch && !sketch.key && !sketch.shape && ['LineString', 'Polygon'].includes(sketch.type)) {
        event.stopPropagation(); event.preventDefault();
        const ring = sketch.rings[0];
        const near = (a, b) => { const p = project(a[0], a[1]), q = project(b[0], b[1]); return Math.hypot(p.x - q.x, p.y - q.y) < 5; };
        while (ring.length > 1 && near(ring.at(-1), ring.at(-2))) ring.pop();
        if (controller.complete) controller.saveGeometry();
        return;
      }
      if (ours(event) || controller.armed) return;
      const key = hitFeature(shown, project, local(event), ownReach);
      const feature = key && controller.features.find((one) => one.properties.key === key);
      if (!feature || feature.geometry.type === 'Point') return;
      event.stopPropagation(); event.preventDefault();
      controller.select(key);
      controller.editGeometry();
    }
    /** A right-click on a feature: its menu, over the map's own. */
    function menu(event) {
      if (ours(event) || controller.armed) return;
      const key = hitFeature(shown, project, local(event), ownReach);
      if (!key) return;
      event.preventDefault(); event.stopPropagation();
      if (!(controller.selection ?? []).includes(key)) controller.chooseKeys([key]);
      // the point the menu speaks of: a marker's own, else the spot pressed on the line or the area
      const at = local(event), feature = controller.features.find((one) => one.properties.key === key);
      const ground = feature?.geometry.type === 'Point' ? { lon: feature.geometry.coordinates[0], lat: feature.geometry.coordinates[1] } : engine.containerPointToLatLng(at);
      featureMenu = { x: event.clientX, y: event.clientY,
        point: ground && { lat: ground.lat, lon: ground.lon, x: at.x, y: at.y, feature: feature?.properties.name || 'Unnamed feature', layer: controller.editor?.title ?? '' } };
    }
    /** While a circle or a box is drawn, it follows the pointer; while a shape is drawn, the corner it would snap to shows. */
    // once a frame at most: a layer with long shapes has many corners to look at
    const hover = perFrame(hovered);
    function hovered(event) {
      const sketch = controller.sketch;
      if (!onMap(event.target)) { if (!event.target?.closest?.('.vertex, .midpoint')) pointer = null; return; }
      if (!sketch || ['Point', 'Selection'].includes(sketch.type)) { snapTarget = null; pointer = null; return; }
      // an area being reshaped takes no click, so only a corner being dragged shows where it would land
      if (sketch.key && sketch.type !== 'LineString') { if (!dragCleanup) snapTarget = null; pointer = null; return; }
      const point = engine.containerPointToLatLng(local(event));
      // on the globe, the sky holds no ground to draw to
      if (!point) { pointer = null; return; }
      if (sketch.shape) controller.preview(point);
      const near = snapped(point, sketch.key);
      snapTarget = near.$snap ?? null;
      pointer = sketch.key ? null : [near.lon, near.lat];
    }
    // Heard on the window, ahead of both maps: the globe's canvas is not inside the flat map's
    // box, and a press stopped here never reaches either, so the globe neither turns nor clicks.
    const listening = [['pointermove', hover], ['pointerdown', down], ['mousedown', block], ['touchstart', block],
      ['click', click], ['dblclick', dblclick], ['contextmenu', menu]];
    for (const [type, run] of listening) window.addEventListener(type, run, true);
    return () => {
      hover.cancel();
      for (const [type, run] of listening) window.removeEventListener(type, run, true);
      snapTarget = null; pointer = null;
      dragCleanup?.();
    };
  });

  /** A press on a picked feature: a click picks it alone, a drag moves the whole selection with it. */
  function press(event, key, start, local) {
    const add = event.shiftKey || event.ctrlKey || event.metaKey;
    if (add) {
      const keys = controller.selection ?? [];
      controller.chooseKeys(keys.includes(key) ? keys.filter((one) => one !== key) : [...keys, key]);
      return;
    }
    const keys = [...controller.selection];
    const linked = new Set(controller.features.filter((one) => one.properties.entity_id).map((one) => one.properties.key));
    // a marker following a case item stays on it; so, while edits carry no date, does a feature moved on a day
    const movable = keys.filter((one) => !linked.has(one) && !controller.dateHolds?.(one));
    const origin = engine.containerPointToLatLng(start);
    let offset = null;
    let told = false;
    dragCleanup?.();
    // the copies follow once a frame at most, whatever the mouse reports
    const move = perFrame((event) => follow(event));
    const follow = (event) => {
      const at = local(event);
      if (!offset && Math.hypot(at.x - start.x, at.y - start.y) < DRAG_PIXELS) return;
      if (!movable.length) { if (!told) { told = true; controller.heldBack?.(keys); } return; }
      const here = engine.containerPointToLatLng(at);
      if (!here || !origin) return;
      offset = [here.lon - origin.lon, here.lat - origin.lat];
      controller.drag(movable, offset);
    };
    const end = () => {
      move.flush();
      cleanup();
      if (offset) controller.moveFeatures(movable, offset);
      else if (keys.length > 1) controller.chooseKeys([key]);
    };
    const cleanup = () => {
      move.cancel();
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel);
      dragCleanup = null;
    };
    const cancel = () => { cleanup(); controller.drag(null); };
    dragCleanup = cancel;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancel);
  }

  /** A freehand stroke, laid into the shape being drawn when the pointer lets go. */
  function stroke(start, local) {
    const points = [start];
    loop = { points, add: false, stroke: true };
    dragCleanup?.();
    const move = (event) => {
      const at = local(event);
      const last = points.at(-1);
      if (Math.hypot(at.x - last.x, at.y - last.y) < 6) return;
      points.push(at);
      loop = { points: [...points], add: false, stroke: true };
    };
    const end = () => {
      cleanup();
      loop = null;
      if (points.length > 1) controller.addStroke(points.map((point) => engine.containerPointToLatLng(point)).filter(Boolean));
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel);
      dragCleanup = null;
    };
    const cancel = () => { cleanup(); loop = null; };
    dragCleanup = cancel;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancel);
  }

  /** The free loop: every point the pointer passes, closed on release. */
  function drawLoop(event, start, local) {
    loop = { points: [start], add: event.shiftKey };
    dragCleanup?.();
    const move = (event) => { if (loop) loop = { ...loop, points: [...loop.points, local(event)] }; };
    const end = () => {
      cleanup();
      const drawn = loop;
      loop = null;
      if (!drawn || drawn.points.length < 3) { controller.stop(); return; }
      controller.chooseKeys(featuresInLoop(shown, project, drawn.points), drawn.add);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel);
      dragCleanup = null;
    };
    const cancel = () => { cleanup(); loop = null; };
    dragCleanup = cancel;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancel);
  }

  $effect(() => { if (!sketch) { dragCleanup?.(); vertex = null; pointer = null; } });
  // On the globe a double click is two clicks while a layer is edited: corners, and a shape opened, not a zoom.
  $effect(() => {
    if (!editing) return;
    engine.readClicks?.(true);
    return () => engine.readClicks?.(false);
  });
  $effect(() => { if (!editing) featureMenu = null; });

  /** The ring's knob, dragged: the marker turns toward the pointer, and is saved on release. */
  function turn(event, at) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    dragCleanup?.();
    const rect = engine.container.getBoundingClientRect();
    let moved = false;
    const move = (event) => {
      moved = true;
      turning = { key: at.key, bearing: bearingToward(at.centre, { x: event.clientX - rect.left, y: event.clientY - rect.top }, at.north, event.shiftKey) };
    };
    const end = () => {
      cleanup();
      const chosen = turning;
      turning = null;
      // the marker faces its new way at once, the save catching up behind
      if (moved && chosen) controller.aim(chosen.key, chosen.bearing);
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel);
      dragCleanup = null;
    };
    const cancel = () => { cleanup(); turning = null; };
    dragCleanup = cancel;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancel);
  }
  /** The knob from the keyboard: arrows turn by five degrees, fifteen with Shift; Delete clears. */
  function turnKey(event, at) {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
    if (step) controller.aim(at.key, (((at.bearing ?? 0) + step * (event.shiftKey ? 15 : 5)) % 360 + 360) % 360);
    else if (event.key === 'Delete' || event.key === 'Backspace') controller.aim(at.key, null);
    else return;
    event.preventDefault(); event.stopPropagation();
  }

  function pointAt(event) {
    const rect = engine.container.getBoundingClientRect();
    return engine.containerPointToLatLng({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  }
  function drag(event, ring, index) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    vertex = ring === 0 ? index : null;
    dragCleanup?.();
    let stepped = false;
    // once a frame at most, whatever the mouse reports; the corner is drawn where the pointer has it
    // and the shape only takes it once let go, so nothing else of the shape is worked out again meanwhile
    const follow = (event) => {
      const ground = pointAt(event);
      if (!controller.sketch || !ground) return;
      if (!stepped) { stepped = true; controller.beginVertexMove(); }
      const near = snapped(ground, controller.sketch.key);
      snapTarget = near.$snap ?? null;
      moving = { ring, index, lat: near.lat, lon: near.lon };
    };
    const move = perFrame(follow);
    const cleanup = () => {
      move.cancel();
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancel);
      dragCleanup = null;
    };
    const end = () => {
      move.flush();
      cleanup();
      if (moving) controller.moveVertex(moving.ring, moving.index, { lat: moving.lat, lon: moving.lon });
      moving = null;
    };
    const cancel = () => { cleanup(); moving = null; };
    dragCleanup = cancel;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancel);
  }
  function vertexKey(event, ring, index, point) {
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (!['Point', 'Selection'].includes(sketch?.type)) controller.removeVertex(ring, index);
    }
    else if (moves[event.key]) {
      const [dx, dy] = moves[event.key], step = event.shiftKey ? 10 : 1;
      controller.beginVertexMove();
      controller.moveVertex(ring, index, engine.containerPointToLatLng({ x: point.x + dx * step, y: point.y + dy * step }));
    } else return;
    event.preventDefault(); event.stopPropagation();
  }
</script>

{#if editing}
  {#if bar}<LayerEditBar {controller} {vertex} ondone={ondone ?? (() => controller.done())} />{/if}
  <div class="surface" aria-hidden="true" class:lasso={controller.lassoing}>
    <svg>
      {#if halos.path}<path class="halo" d={halos.path} />{/if}
      {#each halos.discs as disc}<circle class="halo" cx={disc.x} cy={disc.y} r={disc.r + 3} />{/each}
      {#if ghosts.path}<path class="ghost" d={ghosts.path} />{/if}
      {#if loop}<path class="loop" class:stroke={loop.stroke} d={`M${loop.points.map((point) => `${point.x},${point.y}`).join(' L')}${loop.stroke ? '' : ' Z'}`} />{/if}
      {#if snapTarget}<circle class="snap" cx={snapTarget.x} cy={snapTarget.y} r="8" />{/if}
    </svg>
    {#if ring}
      <svg class="ring" aria-hidden="true">
        <circle cx={ring.centre.x} cy={ring.centre.y} r={ring.radius} />
        {#if ring.bearing !== null}<line x1={ring.centre.x} y1={ring.centre.y} x2={ring.knob.x} y2={ring.knob.y} />{/if}
      </svg>
    {/if}
    {#each ghosts.marks as mark (mark.key)}
      <span class="ghost-mark" class:badge={mark.badge} style:left={`${mark.x}px`} style:top={`${mark.y}px`}>
        <MarkerSymbol symbol={mark.symbol} colour={mark.colour} status={mark.status} external={mark.external} icon={mark.icon} size={mark.size} />
      </span>
    {/each}
  </div>
{/if}

{#if ring}
  <div class="turning">
    <button type="button" class="turn-knob" class:unset={ring.bearing === null} style:left={`${ring.knob.x}px`} style:top={`${ring.knob.y}px`}
      aria-label={ring.bearing === null ? 'Set the direction' : `Direction ${facingLabel(ring.bearing)}`}
      title={ring.bearing === null ? 'Drag to set where it faces' : `Faces ${facingLabel(ring.bearing)}. Drag to turn it, double-click to clear.`}
      onpointerdown={(event) => turn(event, ring)} onclick={(event) => event.stopPropagation()}
      ondblclick={(event) => { event.stopPropagation(); controller.aim(ring.key, null); }}
      onkeydown={(event) => turnKey(event, ring)}></button>
    {#if turning?.key === ring.key}
      <span class="turn-label" style:left={`${ring.knob.x}px`} style:top={`${ring.knob.y}px`}>{facingLabel(turning.bearing)}</span>
    {/if}
  </div>
{/if}

{#if featureMenu}<LayerFeatureMenu {controller} at={featureMenu} point={featureMenu.point} onclose={() => (featureMenu = null)}
  onmore={onmenu ? () => { const point = featureMenu?.point; featureMenu = null; if (point) onmenu(point); } : null} />{/if}

{#if sketch && engine}
  <div class="geometry" aria-label="Layer geometry handles">
    <svg aria-hidden="true"><path d={sketch.type === 'Selection' ? selectionPreview.path : path} fill={['Polygon', 'MultiPolygon'].includes(sketch.type) ? '#f5a62325' : 'none'} fill-rule="evenodd" stroke="#f5a623" stroke-width="2" />
      {#each selectionPreview.points as point}<circle cx={point.x} cy={point.y} r="5" fill="#f5a62355" stroke="#f5a623" />{/each}
      {#if pending}<path class="pending" d={pending} />{/if}
    </svg>
    {#if reading}<span class="reading" style:left={`${reading.x}px`} style:top={`${reading.y}px`}>{reading.text}</span>{/if}
    <!-- a circle or a box being drawn follows the pointer: a handle under it would take the press that closes it -->
    {#each sketch.shape ? [] : handles as point (`${point.ri}.${point.index}`)}
      <button type="button" class="vertex" class:chosen={point.ri === 0 && point.index === vertex} style:left={`${point.x}px`} style:top={`${point.y}px`}
        aria-label={`Move vertex ${point.ri + 1}.${point.index + 1}`} title={['Point', 'Selection'].includes(sketch.type) ? 'Drag to move' : 'Drag to move; Delete to remove'}
        onpointerdown={(event) => drag(event, point.ri, point.index)} onclick={(event) => event.stopPropagation()}
        onfocus={() => { if (point.ri === 0) vertex = point.index; }}
        onkeydown={(event) => vertexKey(event, point.ri, point.index, point)}></button>
    {/each}
    {#each mids as point (point.key)}
      <button type="button" class="midpoint" style:left={`${point.x}px`} style:top={`${point.y}px`}
        aria-label={`Add vertex ${point.ring + 1}.${point.index}`} title="Add a vertex"
        onclick={(event) => { event.stopPropagation(); controller.insertVertex(point.ring, point.index, engine.containerPointToLatLng(point)); }}>+</button>
    {/each}
  </div>
{/if}

<style>
  .surface, .geometry, .turning { position: absolute; inset: 0; z-index: 12; pointer-events: none; overflow: hidden; }
  .ring circle { fill: none; stroke: #fff; stroke-width: 1.5; stroke-dasharray: 3 4; opacity: .85; filter: drop-shadow(0 0 1px #000a); }
  .ring line { stroke: #f5a623; stroke-width: 2; stroke-linecap: round; filter: drop-shadow(0 0 1px #000a); }
  .turn-knob { position: absolute; transform: translate(-50%, -50%); width: 16px; height: 16px; padding: 0; border: 2px solid #fff; border-radius: 50%;
    background: #f5a623; box-shadow: 0 0 0 1px #222, 0 1px 4px #0008; pointer-events: auto; cursor: grab; touch-action: none; }
  .turn-knob:active { cursor: grabbing; }
  .turn-knob.unset { background: #222a; border-style: dashed; }
  .turn-knob:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
  .turn-label { position: absolute; transform: translate(12px, -150%); padding: 2px 7px; border-radius: 999px; background: rgba(0, 0, 0, .72); color: #fff;
    font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .surface.lasso { cursor: crosshair; }
  svg { position: absolute; width: 100%; height: 100%; }
  .halo { fill: none; stroke: #f5a623; stroke-width: 2.5; stroke-dasharray: 5 3; }
  path.halo { stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
  .ghost { fill: none; stroke: #f5a623; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; opacity: .9; }
  .loop { fill: #f5a62318; stroke: #f5a623; stroke-width: 1.5; stroke-dasharray: 4 3; }
  .loop.stroke { fill: none; stroke-width: 2.5; stroke-dasharray: none; }
  .snap { fill: none; stroke: #fff; stroke-width: 2; filter: drop-shadow(0 0 1px #000c); }
  .pending { fill: none; stroke: #f5a623; stroke-width: 1.5; stroke-dasharray: 5 4; opacity: .8; }
  .reading { position: absolute; transform: translate(14px, -150%); padding: 2px 7px; border-radius: 999px; background: rgba(0, 0, 0, .72); color: #fff;
    font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; pointer-events: none; }
  /* a pin's tip, 7.7 of its 64 pixels above the bottom, on its point, as the map anchors it */
  .ghost-mark { position: absolute; transform: translate(-50%, -88%); opacity: .9; }
  .ghost-mark.badge { transform: translate(-50%, -50%); }
  .vertex, .midpoint { position: absolute; transform: translate(-50%, -50%); pointer-events: auto; border: 1px solid #fff; border-radius: 50%; background: #f5a623; width: 11px; height: 11px; padding: 0; box-shadow: 0 0 0 1px #222; cursor: grab; touch-action: none; }
  .vertex.chosen { width: 14px; height: 14px; background: #fff; box-shadow: 0 0 0 2px #f5a623; }
  .vertex:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
  .midpoint { width: 13px; height: 13px; background: var(--bg-2); color: #f5a623; font-size: 11px; line-height: 11px; cursor: pointer; opacity: .85; }
</style>
