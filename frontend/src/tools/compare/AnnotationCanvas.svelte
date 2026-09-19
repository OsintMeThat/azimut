<script>
  import { onMount } from 'svelte';
  import {
    STAMPED, glyphBox, markGlyph, markLabel, markSize, movedMark, nextMarkNumber, onSide,
    projectMark, stampInk,
  } from '../../lib/map/compareAnnotations.js';
  import { isSolidIcon } from '../../lib/proofIcons.js';

  let { annotations = [], engine, letter = 'a', units = 'metric', active = true,
    tool = $bindable('select'), selectedId = $bindable(null), colour = '#f6a81a',
    strokeWidth = 4, fillOpacity = 0, annotationSide = 'both', glyph = 'point',
    stampSize = 16, editVertices = false, edgeOnly = false, onchange = () => {} } = $props();
  let svg = $state();
  let revision = $state(0);
  let draft = $state(null);
  let editor = $state(null);
  let gesture = null;

  /** Below this, a pointer press is a click: a shape is picked, never nudged. */
  const DRAG_SLOP = 4;
  // A note is a single anchor and a freehand stroke is hundreds of them, so
  // neither gains anything from grips: one is already dragged whole, the other
  // would be buried under its own handles.
  const GRIPPED = new Set(['arrow', 'line', 'measure', 'rect', 'ellipse', 'polygon']);

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
        vertices: editVertices && GRIPPED.has(mark.kind) ? mark.points.map(project) : [] }))
  );
  const pathOf = (shape) => shape.path.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ') + (shape.closed ? ' Z' : '');
  /**
   * The wheel belongs to the map, wherever the pointer happens to be.
   *
   * This overlay is a sibling of the map rather than a child, so a wheel over a
   * mark stopped here and the view would not zoom until the pointer was moved
   * off whatever had been drawn. A press is the mark's; the wheel is handed down
   * to the picture under it.
   */
  function relayWheel(event) {
    const container = engine?.container;
    if (!container) return;
    const below = document
      .elementsFromPoint(event.clientX, event.clientY)
      .find((element) => !svg?.contains(element) && container.contains(element));
    if (!below) return;
    event.preventDefault();
    below.dispatchEvent(new WheelEvent('wheel', {
      deltaX: event.deltaX, deltaY: event.deltaY, deltaZ: event.deltaZ,
      deltaMode: event.deltaMode,
      clientX: event.clientX, clientY: event.clientY,
      ctrlKey: event.ctrlKey, shiftKey: event.shiftKey,
      altKey: event.altKey, metaKey: event.metaKey,
      bubbles: true, cancelable: true,
    }));
  }

  function point(event) {
    const box = svg?.getBoundingClientRect();
    if (!box?.width || !engine) return null;
    const at = engine.containerPointToLatLng({ x: event.clientX - box.left, y: event.clientY - box.top });
    return [Math.max(-180, Math.min(180, at.lon)), Math.max(-90, Math.min(90, at.lat))];
  }
  function makeMark(points) {
    return { id: crypto.randomUUID(), kind: tool, side: annotationSide, colour, points,
      stroke_width: strokeWidth, fill_opacity: fillOpacity, font_size: stampSize, text: '',
      // Only the mark that carries one: a marker takes the first number free in
      // its own colour's series, so deleting #2 and stamping again fills that
      // hole, and a symbol carries the glyph in hand.
      ...(tool === 'number' ? { number: nextMarkNumber(annotations, colour) } : {}),
      ...(tool === 'icon' ? { glyph } : {}) };
  }

  /**
   * Put a stamp down: one press, no drag, and the tool stays in hand.
   *
   * Numbering four things or marking six vehicles is one act, not four or six,
   * which is the rule the Proof Maker's rail already follows.
   */
  function stamp(at) {
    const mark = makeMark([at]);
    onchange([...annotations, mark], true);
    selectedId = mark.id;
  }
  /**
   * Anchor the tool in hand at a ground point and let the pointer draw the rest.
   *
   * The right-click menu acts on the point under the cursor, so a measure
   * started there already has its first end; the second is taken by the next
   * click rather than by a drag that would have to start somewhere else.
   */
  export function startFrom(at) {
    if (!at || tool === 'select' || tool === 'text' || tool === 'polygon') return;
    // A stamp needs no second point: it lands on the one the menu was opened on.
    if (STAMPED.has(tool)) { stamp(at); return; }
    draft = makeMark([at, at]);
    gesture = { kind: 'trail', start: at };
  }

  /** The trailing end is set: keep the mark if it spans more than a click. */
  function settle() {
    const first = project(draft.points[0]);
    const last = project(draft.points.at(-1));
    if (Math.hypot(last[0] - first[0], last[1] - first[1]) >= 3) {
      onchange([...annotations, draft], true);
      selectedId = draft.id;
    }
    draft = null;
    gesture = null;
    tool = 'select';
  }

  function begin(event) {
    if (!active || tool === 'select' || event.button > 0) return;
    const at = point(event);
    if (!at) return;
    event.preventDefault();
    if (gesture?.kind === 'trail' && draft) {
      draft = { ...draft, points: [draft.points[0], at] };
      settle();
      return;
    }
    if (tool === 'text') {
      editor = { mark: makeMark([at]), value: '' };
      return;
    }
    if (STAMPED.has(tool)) {
      stamp(at);
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
    if (gesture?.kind === 'trail') {
      if (draft) draft = { ...draft, points: [draft.points[0], at] };
      return;
    }
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
    // A trail is armed, not held: it ends on the next click, not on the release
    // of whatever press happened to be in flight.
    if (!gesture || gesture.kind === 'trail') return;
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
  // Clicking the ground beside a mark lets it go. With Select in hand the map
  // owns the pointer, so that press never reaches this canvas and has to be read
  // off the document: only a press on a map surface counts, because the rail and
  // the panels are where a selected mark is worked on. A drag is a pan, not a
  // click, so the selection survives one. A Detect area is left out — its middle
  // belongs to the map, so a look inside one would drop the panel's own pick.
  $effect(() => {
    if (!active || !selectedId || tool !== 'select' || edgeOnly) return;
    let from = null;
    const down = (event) => {
      if (event.button > 0 || event.target?.closest?.('.annotation-canvas')) return;
      from = event.target?.closest?.('.map-wrap') ? { x: event.clientX, y: event.clientY } : null;
    };
    const up = (event) => {
      if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) < DRAG_SLOP) {
        selectedId = null;
      }
      from = null;
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
    };
  });

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
  onpointercancel={finish} ondblclick={finishPolygon} onwheel={relayWheel}>
  {#each marks as { mark, shape, label, vertices } (mark.id)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <g class="mark" class:area={edgeOnly} class:selected={selectedId === mark.id} style:color={mark.colour}
      onpointerdown={(event) => select(event, mark)} ondblclick={(event) => edit(event, mark)}>
      {#if STAMPED.has(mark.kind)}
        <!-- A stamp is one point on the ground: a numbered disc, or a symbol in
             its own box. Both are drawn from `compareAnnotations.js`, which the
             export draws from too, so a picture holds what the screen showed. -->
        {#if mark.kind === 'number'}
          <circle cx={shape.anchor[0]} cy={shape.anchor[1]} r={markSize(mark) / 2}
            fill={mark.colour} stroke={stampInk(mark)}
            stroke-width={Math.max(1, markSize(mark) * 0.05)} />
          <text class="numeral" x={shape.anchor[0]} y={shape.anchor[1]}
            font-size={markSize(mark) * 0.58} fill={stampInk(mark)}>{mark.number}</text>
        {:else}
          {@const box = glyphBox(mark, shape.anchor)}
          {@const entry = markGlyph(mark)}
          <path d={entry.path} transform={`translate(${box.x} ${box.y}) scale(${box.scale})`}
            fill={isSolidIcon(entry.name) ? mark.colour : 'none'} fill-rule="evenodd"
            stroke={isSolidIcon(entry.name) ? 'none' : mark.colour}
            stroke-width={Math.max(1.5, mark.stroke_width) / box.scale} />
          <!-- A stroked glyph is mostly holes, so the press lands on its box
               rather than on a 2px line. -->
          <rect class="hit" x={box.x} y={box.y} width={box.size} height={box.size} fill="transparent" />
        {/if}
      {:else if mark.kind !== 'text'}
        <path d={pathOf(shape)} stroke={mark.colour} stroke-width={mark.stroke_width}
          fill={shape.closed ? mark.colour : 'none'} fill-opacity={mark.fill_opacity}
          stroke-dasharray={mark.kind === 'measure' ? '8 6' : undefined} />
        <!-- A band along the outline, wide enough to hit: a 4px arrow is a
             target nobody can reliably click twice. For an area it is the only
             target, its middle belonging to the map so dragging inside one pans
             as it would anywhere else. -->
        <path class="edge" d={pathOf(shape)} fill="none" stroke="transparent"
          stroke-width={Math.max(16, mark.stroke_width * 4)} />
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
  .mark .edge { pointer-events: stroke; cursor: move; }
  .mark .hit { pointer-events: all; cursor: move; }
  .mark.area { pointer-events: none; }
  .drawing .mark, .drawing .mark .edge { pointer-events: none; }
  .vertex { pointer-events: auto; cursor: crosshair; }
  .vertex .grip { pointer-events: all; }
  .mark path { stroke-linecap: round; stroke-linejoin: round; }
  .mark.selected { filter: drop-shadow(0 0 3px white); }
  text { fill: white; stroke: #111; stroke-width: 3px; paint-order: stroke; font-family: system-ui, sans-serif; font-weight: 600; }
  /* The numeral is read off its own disc, so it takes the disc's ink and none of
     the dark casing a label needs over imagery. */
  .numeral {
    stroke: none;
    font-weight: 700;
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
  }
  .text-editor { position: absolute; z-index: 620; display: flex; gap: 5px; padding: 8px; max-width: 90%; transform: translateY(-100%); }
  .text-editor input { min-width: 100px; width: 220px; }
</style>
