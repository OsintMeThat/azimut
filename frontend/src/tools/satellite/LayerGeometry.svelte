<script>
  let { engine, controller, active = true } = $props();
  let frame = $state(0);
  let dragCleanup = null;
  const sketch = $derived(active ? controller.sketch : null);
  const rings = $derived.by(() => {
    frame;
    return sketch && engine ? sketch.rings.map((ring) => ring.map(([lon, lat]) => engine.latLngToContainerPoint({ lat, lon }))) : [];
  });
  const path = $derived(rings.map((ring) => ring.length ? `M${ring.map((point) => `${point.x},${point.y}`).join(' L')}${sketch?.type === 'Polygon' ? ' Z' : ''}` : '').join(' '));
  const selectionPreview = $derived.by(() => {
    frame;
    if (!engine || sketch?.type !== 'Selection') return { path: '', points: [] };
    const delta = [sketch.rings[0][0][0] - sketch.origin[0], sketch.rings[0][0][1] - sketch.origin[1]];
    const project = ([lon, lat]) => engine.latLngToContainerPoint({ lon: lon + delta[0], lat: lat + delta[1] });
    const walk = (coords) => typeof coords?.[0]?.[0] === 'number' ? [coords] : (coords ?? []).flatMap(walk);
    const points = [], paths = [];
    for (const feature of sketch.before) {
      if (feature.geometry.type === 'Point') points.push(project(feature.geometry.coordinates));
      else for (const ring of walk(feature.geometry.coordinates)) paths.push(`M${ring.map((point) => { const at = project(point); return `${at.x},${at.y}`; }).join(' L')}`);
    }
    return { path: paths.join(' '), points };
  });
  const mids = $derived.by(() => {
    if (!sketch?.key || ['Point', 'Selection'].includes(sketch.type)) return [];
    return rings.flatMap((ring, ri) => ring.flatMap((point, index) => {
      const next = ring[index + 1] ?? (sketch.type === 'Polygon' ? ring[0] : null);
      return next ? [{ ring: ri, index: index + 1, x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 }] : [];
    }));
  });
  $effect(() => {
    if (!active || !engine) return;
    const off = [engine.on('view-move', () => frame += 1), engine.on('click', (point) => controller.addPoint(point))];
    return () => { off.forEach((release) => release()); dragCleanup?.(); };
  });
  $effect(() => {
    if (!active || !controller.armed) return;
    const key = (event) => {
      if (event.defaultPrevented || event.repeat || event.target?.closest?.('input, textarea, select, .icon-menu, [role="alertdialog"], [contenteditable="true"]')
        || document.querySelector('[role="alertdialog"]')) return;
      if (event.key === 'Escape') controller.stop();
      else if (event.key === 'Enter' && controller.sketch && controller.complete) controller.saveGeometry();
      else if (event.key === 'Backspace' && controller.sketch && !controller.sketch.key && !event.target?.closest?.('.vertex')) controller.undoVertex();
      else return;
      event.preventDefault(); event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });
  $effect(() => { if (!sketch) dragCleanup?.(); });

  function pointAt(event) {
    const rect = engine.container.getBoundingClientRect();
    return engine.containerPointToLatLng({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  }
  function drag(event, ring, index) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    dragCleanup?.();
    const move = (event) => { if (controller.sketch) controller.moveVertex(ring, index, pointAt(event)); };
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
      controller.moveVertex(ring, index, engine.containerPointToLatLng({ x: point.x + dx * step, y: point.y + dy * step }));
    } else return;
    event.preventDefault(); event.stopPropagation();
  }
</script>

{#if sketch && engine}
  <div class="geometry" aria-label="Layer geometry handles">
    <svg aria-hidden="true"><path d={sketch.type === 'Selection' ? selectionPreview.path : path} fill={sketch.type === 'Polygon' ? '#f5a62325' : 'none'} fill-rule="evenodd" stroke="#f5a623" stroke-width="2" />
      {#each selectionPreview.points as point}<circle cx={point.x} cy={point.y} r="5" fill="#f5a62355" stroke="#f5a623" />{/each}
    </svg>
    {#each rings as ring, ri}
      {#each ring as point, index}
        <button type="button" class="vertex" style:left={`${point.x}px`} style:top={`${point.y}px`}
          aria-label={`Move vertex ${ri + 1}.${index + 1}`} title={['Point', 'Selection'].includes(sketch.type) ? 'Drag to move' : 'Drag to move; Delete to remove'}
          onpointerdown={(event) => drag(event, ri, index)} onclick={(event) => event.stopPropagation()}
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
  .geometry { position: absolute; inset: 0; z-index: 12; pointer-events: none; overflow: hidden; }
  svg { position: absolute; width: 100%; height: 100%; }
  .vertex, .midpoint { position: absolute; transform: translate(-50%, -50%); pointer-events: auto; border: 1px solid #fff; border-radius: 50%; background: #f5a623; width: 11px; height: 11px; padding: 0; box-shadow: 0 0 0 1px #222; cursor: grab; touch-action: none; }
  .vertex:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
  .midpoint { width: 13px; height: 13px; background: var(--bg-2); color: #f5a623; font-size: 11px; line-height: 11px; cursor: pointer; opacity: .85; }
</style>
