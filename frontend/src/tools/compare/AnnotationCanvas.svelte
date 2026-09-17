<script>
  import { onMount } from 'svelte';
  import { markLabel, movedMark, onSide, projectMark } from '../../lib/map/compareAnnotations.js';

  let { annotations = [], engine, letter = 'a', units = 'metric', active = true,
    tool = $bindable('select'), selectedId = $bindable(null), colour = '#f6a81a',
    strokeWidth = 4, fillOpacity = 0, annotationSide = 'both', editVertices = false, onchange = () => {} } = $props();
  let svg = $state();
  let revision = $state(0);
  let draft = $state(null);
  let editor = $state(null);
  let gesture = null;

  /** Below this, a pointer press is a click: a shape is picked, never nudged. */
  const DRAG_SLOP = 4;

  $effect(() => {
    if (!engine) return;
    const refresh = () => revision++;
    const release = engine.on('view-move', refresh);
    const observer = new ResizeObserver(refresh);
    if (svg) observer.observe(svg);
    return () => { release(); observer.disconnect(); };
  });

  // Every screen position in this component goes through here, and reading the
  // camera's revision *inside* it is what pins them all to the ground: a handle
  // or a popup computed outside the projected shapes would otherwise stay where
  // the last pan left it.
  const project = ([lon, lat]) => {
    revision;
    const at = engine?.latLngToContainerPoint({ lon, lat });
    return [at?.x ?? 0, at?.y ?? 0];
  };
  const marks = $derived.by(() =>
    [...annotations.filter((mark) => onSide(mark, letter)), ...(draft ? [draft] : [])]
      .map((mark) => ({ mark, shape: projectMark(mark, project), label: markLabel(mark, units),
        vertices: editVertices ? mark.points.map(project) : [] }))
  );
  const pathOf = (shape) => shape.path.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ') + (shape.closed ? ' Z' : '');
  function point(event) {
    const box = svg?.getBoundingClientRect();
    if (!box?.width || !engine) return null;
    const at = engine.containerPointToLatLng({ x: event.clientX - box.left, y: event.clientY - box.top });
    return [Math.max(-180, Math.min(180, at.lon)), Math.max(-90, Math.min(90, at.lat))];
  }
  function makeMark(points) {
    return { id: crypto.randomUUID(), kind: tool, side: annotationSide, colour, points,
      stroke_width: strokeWidth, fill_opacity: fillOpacity, font_size: 16, text: '' };
  }
  function begin(event) {
    if (!active || tool === 'select' || event.button > 0) return;
    const at = point(event);
    if (!at) return;
    event.preventDefault();
    if (tool === 'text') {
      editor = { mark: makeMark([at]), value: '' };
      return;
    }
    if (tool === 'polygon') {
      if (!draft) draft = makeMark([at, at, at]);
      else draft = { ...draft, points: [...draft.points.slice(0, -1), at, at].slice(0, 200) };
      return;
    }
    draft = makeMark([at, at]);
    gesture = { kind: 'draw', start: at };
    svg.setPointerCapture?.(event.pointerId);
  }
  /** True once a press has travelled far enough to mean "drag", not "click". */
  function dragging(event) {
    if (!gesture?.from) return true;
    if (gesture.live) return true;
    if (Math.hypot(event.clientX - gesture.from.x, event.clientY - gesture.from.y) < DRAG_SLOP) return false;
    gesture.live = true;
    return true;
  }

  function move(event) {
    const at = point(event);
    if (!at) return;
    if (gesture && !dragging(event)) return;
    if (gesture?.kind === 'vertex') {
      const points = gesture.mark.points.map((p, i) => i === gesture.index ? at : p);
      onchange(annotations.map((m) => m.id === gesture.mark.id ? { ...m, points } : m), false);
    } else if (gesture?.kind === 'move') {
      const moved = movedMark(gesture.mark, at[0] - gesture.start[0], at[1] - gesture.start[1]);
      onchange(annotations.map((mark) => mark.id === moved.id ? moved : mark), false);
    } else if (draft && tool === 'polygon') {
      draft = { ...draft, points: [...draft.points.slice(0, -1), at] };
    } else if (gesture?.kind === 'draw' && draft) {
      draft = { ...draft, points: draft.kind === 'freehand'
        ? [...draft.points, at].slice(0, 400) : [draft.points[0], at] };
    }
  }
  function finish(event) {
    if (!gesture) return;
    move(event);
    svg.releasePointerCapture?.(event.pointerId);
    if (gesture.kind === 'move' || gesture.kind === 'vertex') {
      // A press that never became a drag only selected something, so it leaves
      // no entry to undo and no geometry to save.
      if (gesture.live) onchange(annotations, true);
    } else if (draft) {
      const first = project(draft.points[0]);
      const last = project(draft.points.at(-1));
      if (Math.hypot(last[0] - first[0], last[1] - first[1]) >= 3) {
        onchange([...annotations, draft], true);
        selectedId = draft.id;
      }
      draft = null;
      tool = 'select';
    }
    gesture = null;
  }
  function finishPolygon(event) {
    event?.preventDefault();
    if (!draft || draft.kind !== 'polygon') return;
    const points = draft.points.filter((p, i, all) => i === 0 || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1]);
    if (points.length >= 3) {
      onchange([...annotations, { ...draft, points }], true);
      selectedId = draft.id;
    }
    draft = null;
    tool = 'select';
  }
  function select(event, mark) {
    if (!active || tool !== 'select' || event.button > 0) return;
    event.preventDefault();
    event.stopPropagation();
    selectedId = mark.id;
    gesture = { kind: 'move', start: point(event), mark: JSON.parse(JSON.stringify(mark)),
      from: { x: event.clientX, y: event.clientY }, live: false };
    svg.setPointerCapture?.(event.pointerId);
  }
  function vertex(event, mark, index) {
    if (!active || !editVertices || event.button > 0) return;
    event.preventDefault(); event.stopPropagation();
    selectedId = mark.id;
    gesture = { kind: 'vertex', mark: JSON.parse(JSON.stringify(mark)), index,
      from: { x: event.clientX, y: event.clientY }, live: false };
    svg.setPointerCapture?.(event.pointerId);
  }
  function edit(event, mark) {
    if (mark.kind !== 'text') return;
    event.stopPropagation();
    editor = { mark, value: mark.text };
  }
  function saveText() {
    if (!editor) return;
    const mark = { ...editor.mark, text: editor.value.trim() };
    if (mark.text) {
      onchange(annotations.some((item) => item.id === mark.id)
        ? annotations.map((item) => item.id === mark.id ? mark : item)
        : [...annotations, mark], true);
      selectedId = mark.id;
    }
    editor = null;
    tool = 'select';
  }
  onMount(() => {
    const key = (event) => {
      if (!active || event.target?.closest?.('input, textarea, select')) return;
      if (event.key === 'Escape') { draft = null; editor = null; gesture = null; tool = 'select'; }
      if (event.key === 'Enter') finishPolygon(event);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<svg class="annotation-canvas" class:drawing={active && tool !== 'select'}
  bind:this={svg} aria-label={`Annotations on imagery ${letter.toUpperCase()}`}
  onpointerdown={begin} onpointermove={move} onpointerup={finish}
  onpointercancel={finish} ondblclick={finishPolygon}>
  {#each marks as { mark, shape, label, vertices } (mark.id)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <g class="mark" class:area={editVertices} class:selected={selectedId === mark.id} style:color={mark.colour}
      onpointerdown={(event) => select(event, mark)} ondblclick={(event) => edit(event, mark)}>
      {#if mark.kind !== 'text'}
        <path d={pathOf(shape)} stroke={mark.colour} stroke-width={mark.stroke_width}
          fill={shape.closed ? mark.colour : 'none'} fill-opacity={mark.fill_opacity}
          stroke-dasharray={mark.kind === 'measure' ? '8 6' : undefined} />
        {#if editVertices}
          <!-- An area is grabbed by its edge. Its middle belongs to the map, so
               dragging inside one pans as it would anywhere else. -->
          <path class="edge" d={pathOf(shape)} fill="none" stroke="transparent"
            stroke-width={Math.max(16, mark.stroke_width * 4)} />
        {/if}
        {#if shape.head}<polygon points={shape.head.map((p) => p.join(',')).join(' ')} fill={mark.colour} />{/if}
      {/if}
      {#if label}
        <text x={shape.anchor[0] + 6} y={shape.anchor[1] - 8} font-size={mark.font_size}>{label}</text>
      {/if}
    </g>
    {#if editVertices && active && selectedId === mark.id && tool === 'select'}
      {#each vertices as at, i}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <g class="vertex" onpointerdown={(e) => vertex(e, mark, i)}>
          <rect class="grip" x={at[0] - 11} y={at[1] - 11} width="22" height="22" fill="transparent" />
          <rect x={at[0] - 5} y={at[1] - 5} width="10" height="10"
            fill="#fff" stroke={mark.colour} stroke-width="2" />
        </g>
      {/each}
    {/if}
  {/each}
</svg>
{#if editor}
  {@const anchor = project(editor.mark.points[0])}
  <form class="text-editor cmp-glass" style:left={`${anchor[0]}px`} style:top={`${anchor[1]}px`}
    onsubmit={(event) => { event.preventDefault(); saveText(); }}>
    <input class="compare-text-editor input" aria-label="Annotation text" value={editor.value}
      oninput={(event) => { if (editor) editor.value = event.currentTarget.value; }}
      maxlength="240" onkeydown={(event) => { if (event.key === 'Escape') editor = null; }} />
    <button class="btn btn-sm" type="submit">Apply</button>
    <button class="btn btn-sm" type="button" onclick={() => (editor = null)}>Cancel</button>
  </form>
{/if}

<style>
  .annotation-canvas { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 550; pointer-events: none; overflow: hidden; }
  .annotation-canvas.drawing { pointer-events: auto; cursor: crosshair; touch-action: none; }
  .mark { pointer-events: visiblePainted; cursor: move; }
  .mark.area { pointer-events: none; }
  .mark.area .edge { pointer-events: stroke; cursor: move; }
  .drawing .mark { pointer-events: none; }
  .vertex { pointer-events: auto; cursor: crosshair; }
  .vertex .grip { pointer-events: all; }
  .mark path { stroke-linecap: round; stroke-linejoin: round; }
  .mark.selected { filter: drop-shadow(0 0 3px white); }
  text { fill: white; stroke: #111; stroke-width: 3px; paint-order: stroke; font-family: system-ui, sans-serif; font-weight: 600; }
  .text-editor { position: absolute; z-index: 620; display: flex; gap: 5px; padding: 8px; max-width: 90%; transform: translateY(-100%); }
  .text-editor input { min-width: 100px; width: 220px; }
</style>
