<script>
  /**
   * A plate's page on the screen: the paper, its live maps, everything else drawn
   * over them on one canvas (`lib/plate/draw.js`), and the hand on top of it all.
   *
   * The page is laid out at its true size (`PX_PER_MM`) and scaled to the window,
   * so what the screen shows is what the export draws.
   *
   * - A press picks an element and drags it; its handles resize it. An edge or a
   *   middle that comes near another one, or the page's, catches on it.
   * - A map is framed by the hand once it is in framing mode (a double click, or
   *   the inspector's button): it then pans, zooms and turns, and Esc or a press
   *   outside lets it go.
   * - A label's point and an arrow's two ends stand on the ground, and are dragged
   *   there; placing either is a press on a map.
   */
  import PlateMap from './PlateMap.svelte';
  import PlateMapBar from './PlateMapBar.svelte';
  import { drawPage } from '../../lib/plate/draw.js';
  import { PX_PER_MM, pageSize } from '../../lib/plate/page.js';
  import { project, unproject } from '../../lib/plate/geo.js';

  let {
    spec,
    selected = $bindable(''),
    framing = $bindable(''),
    /** `{ kind: 'label' | 'arrow' }` while the next press on a map places one, else null. */
    placing = null,
    onplace = null,
    caseId = '',
    rows = [],
    providers = [],
    relief = null,
    /** The time the maps are drawn at: the plate's, or an export's day. */
    time,
    /** `{ id: { view, frame } }`, reported by each map. */
    views = $bindable({}),
    legend = {},
    credits = {},
    images = new Map(),
    markerImage = null,
    tokens = {},
    imperial = false,
    /** `(id, handle)` as each map comes up, for the export. */
    onmap = null,
    /** The window's share the page takes: 'fit', or a factor. */
    zoom = 'fit',
    /** `[id, label]` of the grounds a plate's maps can be drawn on. */
    grounds = [],
  } = $props();

  const size = $derived(pageSize(spec.page));
  const width = $derived(size.width * PX_PER_MM);
  const height = $derived(size.height * PX_PER_MM);
  let viewportWidth = $state(800);
  let viewportHeight = $state(600);
  const scale = $derived(zoom === 'fit'
    ? Math.max(0.1, Math.min((viewportWidth - 48) / width, (viewportHeight - 48) / height))
    : zoom);
  let pageEl = $state();
  let canvas = $state();
  let guides = $state([]);
  let fontsReady = $state(0);
  const dpr = typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1);

  const maps = $derived(spec.elements.filter((element) => element.kind === 'map' || element.kind === 'inset'));
  const main = $derived(spec.elements.find((element) => element.kind === 'map') ?? null);

  /** The view a map is drawn at: its own, or an inset's, over its map's centre. */
  function viewOf(element) {
    if (element.kind === 'map') return element.view;
    const of = spec.elements.find((item) => item.id === element.of);
    const live = of ? views[of.id]?.view ?? of.view : null;
    if (!live) return { lat: 0, lon: 0, zoom: 2, bearing: 0 };
    return { lat: live.lat, lon: live.lon, zoom: element.zoom ?? Math.max(0, live.zoom - 4.5), bearing: 0 };
  }

  function reported(element, view, frame) {
    views = { ...views, [element.id]: { view, frame } };
    if (element.kind === 'map') element.view = { lat: round(view.lat, 6), lon: round(view.lon, 6), zoom: round(view.zoom, 3), bearing: round(view.bearing, 1) };
  }
  const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

  // The theme's font, in the weights the page writes in, before the canvas uses it.
  $effect(() => {
    const family = { inter: 'Inter', barlow: 'Barlow Condensed', oxanium: 'Oxanium', plexmono: 'IBM Plex Mono' }[spec.theme.font] ?? 'Inter';
    if (!document.fonts?.load) return;
    Promise.all([400, 600, 700].map((weight) => document.fonts.load(`${weight} 16px "${family}"`))).then(() => { fontsReady += 1; }, () => {});
  });

  // Everything that is not a map, drawn again whenever anything it reads moves.
  $effect(() => {
    if (!canvas) return;
    void JSON.stringify(spec); void fontsReady;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawPage(ctx, spec, { scale: PX_PER_MM * dpr, views, legend, credits, images, markerImage, tokens, imperial });
  });

  // -- the hand ---------------------------------------------------------------------

  /** The page point under the pointer, in millimetres. */
  function toMm(event) {
    const rect = pageEl.getBoundingClientRect();
    return [(event.clientX - rect.left) / scale / PX_PER_MM, (event.clientY - rect.top) / scale / PX_PER_MM];
  }

  /** The ground under a page point, on the map whose frame holds it, or null. */
  function groundAt(element, [mx, my]) {
    const live = views[element.id];
    if (!live) return null;
    const [x, y] = element.box;
    return unproject(live.view, live.frame, [(mx - x) * PX_PER_MM, (my - y) * PX_PER_MM]);
  }

  /** Where a point of the ground stands on the page, in millimetres, through its map. */
  function onPage(element, point) {
    const map = spec.elements.find((item) => item.id === element.of);
    const live = map && views[map.id];
    if (!live || !point) return null;
    const [px, py] = project(live.view, live.frame, point);
    return [map.box[0] + px / PX_PER_MM, map.box[1] + py / PX_PER_MM];
  }

  const CATCH = 1.4;
  /** The lines a moving box can catch on: the page's edges and middle, and every other box's. */
  function lines(except) {
    const xs = [0, size.width / 2, size.width];
    const ys = [0, size.height / 2, size.height];
    for (const element of spec.elements) {
      if (element.id === except || element.kind === 'arrow') continue;
      const [x, y, w, h] = element.box;
      xs.push(x, x + w / 2, x + w); ys.push(y, y + h / 2, y + h);
    }
    return { xs, ys };
  }

  function caught(values, targets) {
    let best = null;
    for (const [index, value] of values.entries()) {
      for (const target of targets) {
        const gap = target - value;
        if (Math.abs(gap) <= CATCH && (!best || Math.abs(gap) < Math.abs(best.gap))) best = { gap, at: target, index };
      }
    }
    return best;
  }

  function grab(event, element, handle = 'move') {
    if (event.button !== 0 || framing === element.id) return;
    event.preventDefault();
    event.stopPropagation();
    selected = element.id;
    if (framing && framing !== element.id) framing = '';
    const start = toMm(event);
    const box = [...element.box];
    const { xs, ys } = lines(element.id);
    const move = (next) => {
      const [mx, my] = toMm(next);
      let [x, y, w, h] = box;
      const dx = mx - start[0];
      const dy = my - start[1];
      if (handle === 'move') { x += dx; y += dy; }
      if (handle.includes('w')) { x = Math.min(box[0] + box[2] - 3, box[0] + dx); w = box[2] - (x - box[0]); }
      if (handle.includes('e')) w = Math.max(3, box[2] + dx);
      if (handle.includes('n')) { y = Math.min(box[1] + box[3] - 3, box[1] + dy); h = box[3] - (y - box[1]); }
      if (handle.includes('s')) h = Math.max(3, box[3] + dy);
      const found = [];
      if (!next.altKey) {
        const cx = handle === 'move' ? caught([x, x + w / 2, x + w], xs) : caught(handle.includes('w') ? [x] : handle.includes('e') ? [x + w] : [], xs);
        if (cx) { if (handle === 'move') x += cx.gap; else if (handle.includes('w')) { x += cx.gap; w -= cx.gap; } else w += cx.gap; found.push({ axis: 'x', at: cx.at }); }
        const cy = handle === 'move' ? caught([y, y + h / 2, y + h], ys) : caught(handle.includes('n') ? [y] : handle.includes('s') ? [y + h] : [], ys);
        if (cy) { if (handle === 'move') y += cy.gap; else if (handle.includes('n')) { y += cy.gap; h -= cy.gap; } else h += cy.gap; found.push({ axis: 'y', at: cy.at }); }
      }
      guides = found;
      element.box = [x, y, w, h].map((value) => Math.round(value * 10) / 10);
    };
    const up = () => {
      guides = [];
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  /** Drag one of an element's ground points (`at` or `to`) over its map. */
  function grabGround(event, element, field) {
    event.preventDefault();
    event.stopPropagation();
    const map = spec.elements.find((item) => item.id === element.of);
    if (!map) return;
    const start = onPage(element, element[field]);
    const box = [...element.box];
    const move = (next) => {
      const point = groundAt(map, toMm(next));
      if (!point) return;
      element[field] = [round(point[0], 6), round(point[1], 6)];
      // a label's box keeps its place beside the point it names
      const now = onPage(element, element[field]);
      if (field === 'at' && element.kind === 'label' && start && now && next.shiftKey) {
        element.box = [box[0] + now[0] - start[0], box[1] + now[1] - start[1], box[2], box[3]];
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** A press on a map while placing: a label where it is pressed, an arrow from there to where it is let go. */
  function place(event, map) {
    if (!placing || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = toMm(event);
    const from = groundAt(map, start);
    if (!from) return;
    if (placing.kind === 'label') { onplace?.({ map, at: from, page: start }); return; }
    let to = from;
    const move = (next) => { to = groundAt(map, toMm(next)) ?? to; arrowDraft = { from: start, to: toMm(next) }; };
    const up = () => {
      arrowDraft = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (to[0] !== from[0] || to[1] !== from[1]) onplace?.({ map, at: from, to });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  let arrowDraft = $state(null);

  /** An arrow's box on the page, read off its two ends. */
  function arrowBox(element) {
    const a = onPage(element, element.at);
    const b = onPage(element, element.to);
    if (!a || !b) return element.box;
    const pad = 2;
    return [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.abs(a[0] - b[0]) + 2 * pad, Math.abs(a[1] - b[1]) + 2 * pad];
  }

  function keydown(event) {
    if (event.key === 'Escape' && framing) { framing = ''; event.stopPropagation(); }
  }

  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const px = (mm) => `${mm * PX_PER_MM}px`;
</script>

<svelte:window onkeydown={keydown} />

<div class="viewport" bind:clientWidth={viewportWidth} bind:clientHeight={viewportHeight}
  onpointerdown={(event) => { if (event.target.closest?.('.plate-map.live')) return; selected = ''; framing = ''; }} role="presentation">
  <div class="sizer" style:width="{width * scale}px" style:height="{height * scale}px">
    <div class="page" bind:this={pageEl} style:width="{width}px" style:height="{height}px" style:transform="scale({scale})"
      style:background={spec.theme.paper} role="presentation">
      {#each maps as element (`${element.id}:${element.basemap}:${(element.overlays ?? []).join(',')}`)}
        <PlateMap {element} view={viewOf(element)} {time} {caseId} {rows} {providers} {relief}
          interactive={framing === element.id}
          onview={(view, frame) => reported(element, view, frame)}
          onready={(handle) => onmap?.(element.id, handle)} />
      {/each}
      <canvas class="decor" bind:this={canvas} width={Math.round(width * dpr)} height={Math.round(height * dpr)}
        style:width="{width}px" style:height="{height}px"></canvas>

      <div class="hand">
        {#each spec.elements as element (element.id)}
          {@const box = element.kind === 'arrow' ? arrowBox(element) : element.box}
          {#if !(framing === element.id)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="hit" class:selected={selected === element.id} class:map={element.kind === 'map' || element.kind === 'inset'}
              class:placing={!!placing && element.kind === 'map'}
              style:left={px(box[0])} style:top={px(box[1])} style:width={px(box[2])} style:height={px(box[3])}
              data-element={element.id}
              onpointerdown={(event) => placing && element.kind === 'map' ? place(event, element) : grab(event, element)}
              ondblclick={() => { if (element.kind === 'map') framing = element.id; }}></div>
          {/if}
        {/each}

        {#each spec.elements.filter((item) => item.id === selected && framing !== item.id) as element (element.id)}
          {#if element.kind !== 'arrow'}
            {#each HANDLES as handle (handle)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="handle {handle}" style:left={px(element.box[0] + (handle.includes('w') ? 0 : handle.includes('e') ? element.box[2] : element.box[2] / 2))}
                style:top={px(element.box[1] + (handle.includes('n') ? 0 : handle.includes('s') ? element.box[3] : element.box[3] / 2))}
                style:transform="translate(-50%, -50%) scale({1 / scale})"
                onpointerdown={(event) => grab(event, element, handle)}></div>
            {/each}
          {/if}
          {#each element.kind === 'label' ? ['at'] : element.kind === 'arrow' ? ['at', 'to'] : [] as field (field)}
            {@const point = onPage(element, element[field])}
            {#if point}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div class="ground" title="Drag to move it on the ground" style:left={px(point[0])} style:top={px(point[1])}
                style:transform="translate(-50%, -50%) scale({1 / scale})"
                onpointerdown={(event) => grabGround(event, element, field)}></div>
            {/if}
          {/each}
        {/each}

        {#each spec.elements.filter((item) => (item.id === selected || item.id === framing) && (item.kind === 'map' || item.kind === 'inset')) as element (element.id)}
          <!-- the picked map's own bar, at the size of the window rather than of the page -->
          <div class="bar" style:left={px(element.box[0])} style:top={px(element.box[1])} style:transform="scale({1 / scale}) translate(6px, 6px)">
            <PlateMapBar {element} {grounds} framing={framing === element.id}
              onframe={() => { framing = framing === element.id ? '' : element.id; selected = element.id; }} />
          </div>
        {/each}

        {#each guides as guide, index (index)}
          <div class="guide {guide.axis}" style:left={guide.axis === 'x' ? px(guide.at) : 0} style:top={guide.axis === 'y' ? px(guide.at) : 0}></div>
        {/each}
        {#if arrowDraft}
          <svg class="draft" viewBox="0 0 {size.width} {size.height}" preserveAspectRatio="none">
            <line x1={arrowDraft.from[0]} y1={arrowDraft.from[1]} x2={arrowDraft.to[0]} y2={arrowDraft.to[1]} />
          </svg>
        {/if}
      </div>
    </div>
  </div>
  {#if framing}<p class="framing">Drag and scroll to frame the map, right-drag or Ctrl-drag to turn it. Esc when done.</p>{/if}
  {#if placing}<p class="framing">{placing.kind === 'label' ? 'Press the map where the label points.' : 'Drag on the map from where the arrow starts to where it points.'}</p>{/if}
</div>

<style>
  .viewport { position: relative; flex: 1; min-width: 0; min-height: 0; overflow: auto; display: grid; place-items: center;
    background: var(--bg-0, #0d0f12); }
  .sizer { position: relative; margin: 24px; flex: none; }
  .page { position: absolute; left: 0; top: 0; transform-origin: 0 0; box-shadow: 0 6px 30px rgba(0, 0, 0, .45); overflow: hidden; }
  .decor { position: absolute; left: 0; top: 0; pointer-events: none; z-index: 2; }
  .hand { position: absolute; inset: 0; z-index: 4; pointer-events: none; }
  .hit { position: absolute; pointer-events: auto; cursor: move; border-radius: 1px; }
  .hit:hover { outline: 1px dashed rgba(64, 132, 255, .7); }
  .hit.selected { outline: 1.5px solid #3b82f6; }
  .hit.map { cursor: move; }
  .hit.placing { cursor: crosshair; }
  .handle { position: absolute; width: 9px; height: 9px; border: 1.5px solid #3b82f6; background: #fff; border-radius: 2px;
    pointer-events: auto; z-index: 2; }
  .handle.nw, .handle.se { cursor: nwse-resize; }
  .handle.ne, .handle.sw { cursor: nesw-resize; }
  .handle.n, .handle.s { cursor: ns-resize; }
  .handle.e, .handle.w { cursor: ew-resize; }
  .ground { position: absolute; width: 12px; height: 12px; border: 2px solid #fff; background: #f59e0b; border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, .5); pointer-events: auto; cursor: grab; z-index: 3; }
  .bar { position: absolute; z-index: 5; transform-origin: 0 0; pointer-events: auto; }
  .guide { position: absolute; background: #ec4899; pointer-events: none; }
  .guide.x { top: 0; bottom: 0; width: 1px; }
  .guide.y { left: 0; right: 0; height: 1px; }
  .draft { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  .draft line { stroke: #f59e0b; stroke-width: .6; stroke-dasharray: 2 1.2; }
  .framing { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); margin: 0; padding: 4px 12px; border-radius: 999px;
    background: rgba(0, 0, 0, .72); color: #fff; font-size: 12px; pointer-events: none; }
</style>
