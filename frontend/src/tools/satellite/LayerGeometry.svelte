<script>
  /**
   * Where a personal layer is edited on the map: its tool bar, the selection
   * drawn round what is picked, features dragged where they go, a loop drawn
   * round what to pick, the corners of a shape being drawn or reshaped, the
   * ring that turns a selected marker, and the menu a right-click opens.
   *
   * Mounted by every map that edits (Map, Detect, Compare, Horizon), so the bar
   * and the gestures are the same whichever one the analyst is on. A press on
   * one of the layer's features is taken before the map sees it, so it moves
   * the feature rather than the map; a press anywhere else is the map's.
   */
  import LayerEditBar from './LayerEditBar.svelte';
  import LayerFeatureMenu from './LayerFeatureMenu.svelte';
  import MarkerSymbol from './MarkerSymbol.svelte';
  import { featuresInLoop, hitFeature, linesOf, markerDisc } from '../../lib/map/layerHit.js';
  import { isBadge } from '../../lib/map/markerGlyphs.js';
  import { bearingToward, facingLabel, knobAt, screenNorth } from '../../lib/map/turnRing.js';

  /** `bar`: whether this map carries the tool bar, false on the second of two side-by-side maps. */
  let { engine, controller, active = true, ondone = null, bar = true } = $props();
  let frame = $state(0);
  /** The corner last pressed while a line is reshaped, which is where it can be cut. */
  let vertex = $state(null);
  /** The loop being drawn, in screen pixels, and whether it adds to the selection. */
  let loop = $state(null);
  /** A marker's direction while its ring is turned, until the layer has saved it. */
  let turning = $state(null);
  /** Where a right-click on a feature opened its menu, in window pixels. */
  let featureMenu = $state(null);
  let dragCleanup = null;
  /** Past this many pixels a press on a feature is a drag, short of it a click. */
  const DRAG_PIXELS = 4;
  /** A corner drawn this near one already in the layer lands on it; Alt held lets it go free. */
  const SNAP_PIXELS = 10;
  /** The corner a press would land on now, while a shape is drawn, in screen pixels. */
  let snapTarget = $state(null);
  let altHeld = false;
  /** Whether the last press was on this map: a Delete after a press on a button of the panel removes nothing. */
  let pressedOnMap = false;

  const editing = $derived(active && !!engine && !!controller.editor && !controller.loading);
  const groups = $derived(new Map((controller.groups ?? []).map((group) => [group.id, group])));
  const hiddenGroups = $derived(new Set(controller.editor?.hidden ?? []));
  /** The features as the map draws them: a uniform group's style, its size, its visible
   *  groups only, and in its order, the first group last so that it is on top. */
  const shown = $derived.by(() => {
    if (!editing) return [];
    const rank = new Map((controller.groups ?? []).map((group, index) => [group.id, index]));
    return controller.features.flatMap((feature) => {
      const group = groups.get(feature.properties.group);
      // a tracked feature that was not there on the layer's day is not there to pick
      if (hiddenGroups.has(group?.name) || feature.properties.$absent) return [];
      const style = group?.mode === 'uniform' ? { symbol: group.symbol, colour: group.colour } : {};
      return [{ ...feature, properties: { ...feature.properties, ...style, icon_scale: group?.size ?? 1 } }];
    }).sort((a, b) => (rank.get(b.properties.group) ?? 0) - (rank.get(a.properties.group) ?? 0));
  });
  const project = (lon, lat) => engine.latLngToContainerPoint({ lat, lon });

  const sketch = $derived(active ? controller.sketch : null);
  const rings = $derived.by(() => {
    frame;
    return sketch && engine ? sketch.rings.map((ring) => ring.map(([lon, lat]) => engine.latLngToContainerPoint({ lat, lon }))) : [];
  });
  const closed = $derived(['Polygon', 'MultiPolygon'].includes(sketch?.type));
  const path = $derived(rings.map((ring) => ring.length ? `M${ring.map((point) => `${point.x},${point.y}`).join(' L')}${closed ? ' Z' : ''}` : '').join(' '));
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
  const mids = $derived.by(() => {
    if (!sketch?.key || ['Point', 'Selection'].includes(sketch.type)) return [];
    const closed = ['Polygon', 'MultiPolygon'].includes(sketch.type);
    return rings.flatMap((ring, ri) => ring.flatMap((point, index) => {
      const next = ring[index + 1] ?? (closed ? ring[0] : null);
      return next ? [{ ring: ri, index: index + 1, x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 }] : [];
    }));
  });

  /** Outlines round what is selected, re-projected as the map moves. */
  const halos = $derived.by(() => {
    frame;
    if (!editing || sketch) return { discs: [], path: '' };
    const keys = new Set(controller.selection ?? []);
    const discs = [], paths = [];
    for (const feature of shown) {
      if (!keys.has(feature.properties.key)) continue;
      if (feature.geometry.type === 'Point') discs.push(markerDisc(feature, project));
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
    const keys = new Set(drag.keys), [dx, dy] = drag.offset;
    const marks = [], paths = [];
    for (const feature of shown) {
      if (!keys.has(feature.properties.key)) continue;
      const geometry = feature.geometry;
      if (geometry.type === 'Point') {
        const at = project(geometry.coordinates[0] + dx, geometry.coordinates[1] + dy);
        const scale = feature.properties.icon_scale ?? 1;
        const badge = isBadge(feature.properties.symbol);
        marks.push({ key: feature.properties.key, x: at.x, y: at.y, badge, size: (badge ? 25.6 : 38.4) * scale,
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
    const centre = project(lon, lat);
    const radius = (isBadge(feature.properties.symbol) ? 14 : 22) * (Number(feature.properties.icon_scale) || 1) + 16;
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
    let best = null;
    const walk = (node) => (typeof node?.[0] === 'number' ? [node] : (node ?? []).flatMap(walk));
    for (const feature of shown) {
      if (except && feature.properties.key === except) continue;
      for (const [lon, lat] of walk(feature.geometry.coordinates)) {
        const p = project(lon, lat);
        const gap = Math.hypot(p.x - at.x, p.y - at.y);
        if (gap <= SNAP_PIXELS && (!best || gap < best.gap)) best = { gap, lon, lat, x: p.x, y: p.y };
      }
    }
    return best ? { lon: best.lon, lat: best.lat, $snap: { x: best.x, y: best.y } } : point;
  }
  const drawing = () => !!controller.sketch && !['Point', 'Selection'].includes(controller.sketch.type);

  $effect(() => {
    if (!active || !engine) return;
    // A click on bare ground lets the selection go; a feature's own click never gets here.
    const off = [engine.on('view-move', () => frame += 1), engine.on('click', (point) => {
      const placed = drawing() ? snapped(point, controller.sketch?.key) : point;
      if (!controller.addPoint({ lat: placed.lat, lon: placed.lon }) && controller.editor && !controller.armed && controller.selection?.length) controller.select(null);
    })];
    const keys = (event) => { altHeld = event.altKey; };
    const pressed = (event) => { pressedOnMap = !!engine.container?.contains?.(event.target); };
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
      if (event.target?.closest?.('input, textarea, [contenteditable="true"]') || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
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
    // Only a press on the drawn map itself: a card, a control or a handle over it keeps its own.
    const ours = (event) => event.target?.tagName !== 'CANVAS';
    function down(event) {
      swallow = false;
      // a freehand stroke: every point the pointer passes, thinned, until it is let go
      const sketch = controller.sketch;
      if (event.button === 0 && !ours(event) && controller.freehand && sketch && !sketch.key && !sketch.shape
        && ['LineString', 'Polygon'].includes(sketch.type)) {
        swallow = true; event.preventDefault(); event.stopPropagation();
        stroke(local(event), local);
        return;
      }
      // A right press on a feature opens its menu; the map must not start turning under it.
      if (event.button === 2 && !ours(event) && !controller.armed && hitFeature(shown, project, local(event))) {
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
      const key = hitFeature(shown, project, at);
      if (!key) return;
      const feature = shown.find((one) => one.properties.key === key);
      const add = event.shiftKey || event.ctrlKey || event.metaKey;
      if (feature?.geometry?.type !== 'Point' && !add && !(controller.selection ?? []).includes(key)) {
        // A line or an area not picked yet: a press picks it, a drag across it pans the
        // map, which a big area would otherwise never let go of.
        const up = (next) => {
          window.removeEventListener('pointerup', up, true);
          const end = local(next);
          if (Math.hypot(end.x - at.x, end.y - at.y) >= DRAG_PIXELS) return;
          swallow = true;
          controller.chooseKeys([key]);
        };
        window.addEventListener('pointerup', up, true);
        return;
      }
      swallow = true; event.preventDefault(); event.stopPropagation();
      press(event, key, at, local);
    }
    const block = (event) => { if (swallow) { event.stopPropagation(); if (event.cancelable && event.type !== 'touchstart') event.preventDefault(); } };
    const click = (event) => { if (swallow) { event.stopPropagation(); event.preventDefault(); swallow = false; } };
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
      const key = hitFeature(shown, project, local(event));
      const feature = key && controller.features.find((one) => one.properties.key === key);
      if (!feature || feature.geometry.type === 'Point') return;
      event.stopPropagation(); event.preventDefault();
      controller.select(key);
      controller.editGeometry();
    }
    /** A right-click on a feature: its menu, over the map's own. */
    function menu(event) {
      if (ours(event) || controller.armed) return;
      const key = hitFeature(shown, project, local(event));
      if (!key) return;
      event.preventDefault(); event.stopPropagation();
      if (!(controller.selection ?? []).includes(key)) controller.chooseKeys([key]);
      featureMenu = { x: event.clientX, y: event.clientY };
    }
    /** While a circle or a box is drawn, it follows the pointer; while a shape is drawn, the corner it would snap to shows. */
    let hovering = 0;
    function hover(event) {
      // once a frame: a layer with long shapes has many corners to look at
      if (hovering) return;
      hovering = requestAnimationFrame(() => { hovering = 0; });
      const sketch = controller.sketch;
      if (!sketch || ['Point', 'Selection'].includes(sketch.type)) { snapTarget = null; return; }
      const point = engine.containerPointToLatLng(local(event));
      if (sketch.shape) controller.preview(point);
      const near = snapped(point, sketch.key);
      snapTarget = near.$snap ?? null;
    }
    box.addEventListener('pointermove', hover);
    box.addEventListener('pointerdown', down, true);
    box.addEventListener('mousedown', block, true);
    box.addEventListener('touchstart', block, true);
    box.addEventListener('click', click, true);
    box.addEventListener('dblclick', dblclick, true);
    box.addEventListener('contextmenu', menu, true);
    return () => {
      box.removeEventListener('pointermove', hover);
      snapTarget = null;
      box.removeEventListener('pointerdown', down, true);
      box.removeEventListener('mousedown', block, true);
      box.removeEventListener('touchstart', block, true);
      box.removeEventListener('click', click, true);
      box.removeEventListener('dblclick', dblclick, true);
      box.removeEventListener('contextmenu', menu, true);
      dragCleanup?.();
    };
  });

  /** A press on a feature: a click picks it, a drag moves what is picked with it. */
  function press(event, key, start, local) {
    const add = event.shiftKey || event.ctrlKey || event.metaKey;
    if (add) {
      const keys = controller.selection ?? [];
      controller.chooseKeys(keys.includes(key) ? keys.filter((one) => one !== key) : [...keys, key]);
      return;
    }
    const keys = (controller.selection ?? []).includes(key) ? [...controller.selection] : [key];
    const linked = new Set(controller.features.filter((one) => one.properties.entity_id).map((one) => one.properties.key));
    const movable = keys.filter((one) => !linked.has(one));
    const origin = engine.containerPointToLatLng(start);
    let offset = null;
    dragCleanup?.();
    const move = (event) => {
      const at = local(event);
      if (!offset && Math.hypot(at.x - start.x, at.y - start.y) < DRAG_PIXELS) return;
      if (!movable.length) return;
      const here = engine.containerPointToLatLng(at);
      offset = [here.lon - origin.lon, here.lat - origin.lat];
      if (!(controller.selection ?? []).includes(key)) controller.chooseKeys(keys);
      controller.drag(movable, offset);
    };
    const end = () => {
      cleanup();
      if (offset) controller.moveFeatures(movable, offset);
      else if (!(controller.selection ?? []).includes(key) || (controller.selection ?? []).length > 1) controller.chooseKeys([key]);
    };
    const cleanup = () => {
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
      if (points.length > 1) controller.addStroke(points.map((point) => engine.containerPointToLatLng(point)));
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

  $effect(() => { if (!sketch) { dragCleanup?.(); vertex = null; } });
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
      if (!moved || !chosen) { turning = null; return; }
      controller.update(chosen.key, { bearing: chosen.bearing }).finally(() => { if (turning === chosen) turning = null; });
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
    if (step) controller.update(at.key, { bearing: (((at.bearing ?? 0) + step * (event.shiftKey ? 15 : 5)) % 360 + 360) % 360 });
    else if (event.key === 'Delete' || event.key === 'Backspace') controller.update(at.key, { bearing: null });
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
    const move = (event) => {
      if (!controller.sketch) return;
      if (!stepped) { stepped = true; controller.beginVertexMove(); }
      const near = snapped(pointAt(event), controller.sketch.key);
      snapTarget = near.$snap ?? null;
      controller.moveVertex(ring, index, { lat: near.lat, lon: near.lon });
    };
    const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); dragCleanup = null; };
    dragCleanup = end;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
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
        <MarkerSymbol symbol={mark.symbol} colour={mark.colour} status={mark.status} external={mark.external} size={mark.size} />
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
      ondblclick={(event) => { event.stopPropagation(); controller.update(ring.key, { bearing: null }); }}
      onkeydown={(event) => turnKey(event, ring)}></button>
    {#if turning?.key === ring.key}
      <span class="turn-label" style:left={`${ring.knob.x}px`} style:top={`${ring.knob.y}px`}>{facingLabel(turning.bearing)}</span>
    {/if}
  </div>
{/if}

{#if featureMenu}<LayerFeatureMenu {controller} at={featureMenu} onclose={() => (featureMenu = null)} />{/if}

{#if sketch && engine}
  <div class="geometry" aria-label="Layer geometry handles">
    <svg aria-hidden="true"><path d={sketch.type === 'Selection' ? selectionPreview.path : path} fill={['Polygon', 'MultiPolygon'].includes(sketch.type) ? '#f5a62325' : 'none'} fill-rule="evenodd" stroke="#f5a623" stroke-width="2" />
      {#each selectionPreview.points as point}<circle cx={point.x} cy={point.y} r="5" fill="#f5a62355" stroke="#f5a623" />{/each}
    </svg>
    <!-- a circle or a box being drawn follows the pointer: a handle under it would take the press that closes it -->
    {#each sketch.shape ? [] : rings as ring, ri}
      {#each ring as point, index}
        <button type="button" class="vertex" class:chosen={ri === 0 && index === vertex} style:left={`${point.x}px`} style:top={`${point.y}px`}
          aria-label={`Move vertex ${ri + 1}.${index + 1}`} title={['Point', 'Selection'].includes(sketch.type) ? 'Drag to move' : 'Drag to move; Delete to remove'}
          onpointerdown={(event) => drag(event, ri, index)} onclick={(event) => event.stopPropagation()}
          onfocus={() => { if (ri === 0) vertex = index; }}
          onkeydown={(event) => vertexKey(event, ri, index, point)}></button>
      {/each}
    {/each}
    {#each mids as point}
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
  .ghost-mark { position: absolute; transform: translate(-50%, -100%); opacity: .9; }
  .ghost-mark.badge { transform: translate(-50%, -50%); }
  .vertex, .midpoint { position: absolute; transform: translate(-50%, -50%); pointer-events: auto; border: 1px solid #fff; border-radius: 50%; background: #f5a623; width: 11px; height: 11px; padding: 0; box-shadow: 0 0 0 1px #222; cursor: grab; touch-action: none; }
  .vertex.chosen { width: 14px; height: 14px; background: #fff; box-shadow: 0 0 0 2px #f5a623; }
  .vertex:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
  .midpoint { width: 13px; height: 13px; background: var(--bg-2); color: #f5a623; font-size: 11px; line-height: 11px; cursor: pointer; opacity: .85; }
</style>
