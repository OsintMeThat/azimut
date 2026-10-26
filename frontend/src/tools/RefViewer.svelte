<script>
  // One reference window over the Satellite map, free, pinned to a corner of it
  // (clear of the map's own controls, wherever the map's edges go) or docked in
  // a column beside it. The pin in the header offers those six places; dragging
  // a window into a corner pins it there too, and dragging it away frees it.
  // Roll it up, resize it from the corner facing the map's middle, fade it so
  // the map shows and moves under it, unfold what the case knows about the
  // picture, and wheel/drag to zoom & pan it. Its controls lie over the bottom
  // of the picture and come up on a hover, so at rest it is a title and a
  // picture; a clip keeps a hairline of progress and plays in a slim player of
  // its own (satellite/RefVideoBar.svelte). Pure geometry lives in
  // lib/refViewers.js; this file is the pointer/DOM glue. Session-only: nothing
  // here is captured or saved.
  import { untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import RefVideoBar from './satellite/RefVideoBar.svelte';
  import { fileUrl } from '../lib/fileUrl.js';
  import { chromeBoxes } from '../lib/mapChrome.js';
  import {
    snapWindow,
    settledCorner,
    cornerSpot,
    placeOf,
    PLACES,
    clampSize,
    clampPan,
    clampOpacity,
    flipFade,
    hasFacts,
    zoomAt,
    MIN_OPACITY,
    MIN_SCALE,
  } from '../lib/refViewers.js';

  let { viewer, caseId, zBase = 630, onfocus, onclose, onplace, onkeep } = $props();

  let el = $state(); // the window root
  let headEl;
  let headH = $state(30);
  let bodyEl = $state();
  let video = $state();
  let bar = $state();
  let progress = $state('0%'); // a clip's hairline, at rest
  let placing = $state(false); // the header showing the six places
  // The map's size and its controls, read while the window is pinned: where the
  // corner is, and what the window keeps clear of in it.
  let wrap = $state({ w: 0, h: 0 });
  let controls = $state.raw([]);

  // the map-wrap we're positioned in — the box drags/resizes are clamped to
  const bounds = () => {
    const r = el.parentElement.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };

  function focus() {
    onfocus?.(viewer.id);
  }

  // run `move` on pointer drags until release; shared by the three gestures
  function drag(move, done) {
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      done?.();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startWindowDrag(e) {
    if (viewer.docked || e.button !== 0 || e.target.closest('button')) return;
    focus();
    e.preventDefault();
    el.focus({ preventScroll: true });
    const sx = e.clientX;
    const sy = e.clientY;
    const x0 = viewer.x;
    const y0 = viewer.y;
    const height = () => (viewer.collapsed ? headEl.offsetHeight : viewer.h);
    let moved = false;
    drag(
      (ev) => {
        // a press on the title that never moves leaves a pinned window pinned
        if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) <= 3) return;
        moved = true;
        viewer.corner = false;
        const c = snapWindow(x0 + (ev.clientX - sx), y0 + (ev.clientY - sy), viewer.w, height(), bounds());
        viewer.x = c.x;
        viewer.y = c.y;
      },
      () => {
        // let go against two edges at once, it stays in that corner
        const corner = moved && settledCorner(viewer.x, viewer.y, viewer.w, height(), bounds());
        if (corner) onplace?.(viewer.id, corner);
      }
    );
  }

  function startResize(e) {
    if (e.button !== 0) return;
    focus();
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const w0 = viewer.w;
    const h0 = viewer.h;
    // A pinned window grows away from its corner, toward the handle
    const across = viewer.corner?.endsWith('r') ? -1 : 1;
    const down = viewer.corner?.startsWith('b') ? -1 : 1;
    drag((ev) => {
      const w = w0 + across * (ev.clientX - sx);
      const h = h0 + down * (ev.clientY - sy);
      const s = viewer.corner ? clampSize(w, h, 0, 0, bounds()) : clampSize(w, h, viewer.x, viewer.y, bounds());
      viewer.w = s.w;
      viewer.h = s.h;
    });
  }

  function startPan(e) {
    // at fit scale an image has nothing to pan; a clip still takes the press,
    // since a click on it plays or pauses
    const zoomed = viewer.scale > MIN_SCALE;
    if (e.button !== 0 || (!zoomed && !isVideo)) return;
    focus();
    e.preventDefault();
    el.focus({ preventScroll: true });
    const sx = e.clientX;
    const sy = e.clientY;
    const ox0 = viewer.ox;
    const oy0 = viewer.oy;
    let moved = false;
    drag(
      (ev) => {
        if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 3) moved = true;
        if (!zoomed) return;
        const p = clampPan(
          ox0 + (ev.clientX - sx),
          oy0 + (ev.clientY - sy),
          viewer.scale,
          bodyEl.clientWidth,
          bodyEl.clientHeight
        );
        viewer.ox = p.ox;
        viewer.oy = p.oy;
      },
      () => {
        if (!moved && isVideo) bar?.togglePlay();
      }
    );
  }

  function onWheel(e) {
    e.preventDefault();
    const rect = bodyEl.getBoundingClientRect();
    const cursor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    apply(zoomAt(viewer, factor, cursor, { w: rect.width, h: rect.height }));
  }

  function zoomBy(factor) {
    const size = { w: bodyEl.clientWidth, h: bodyEl.clientHeight };
    apply(zoomAt(viewer, factor, { x: size.w / 2, y: size.h / 2 }, size));
  }

  function resetZoom() {
    viewer.scale = 1;
    viewer.ox = 0;
    viewer.oy = 0;
  }

  function apply({ scale, ox, oy }) {
    viewer.scale = scale;
    viewer.ox = ox;
    viewer.oy = oy;
  }

  // Keep the pan legal whenever the pane changes size: a corner drag, the dock
  // widened, another window docked under this one.
  $effect(() => {
    const body = bodyEl;
    if (!body || typeof ResizeObserver === 'undefined') return;
    const pane = untrack(() => viewer);
    const observer = new ResizeObserver(() => {
      const p = clampPan(pane.ox, pane.oy, pane.scale, body.clientWidth, body.clientHeight);
      if (p.ox !== pane.ox) pane.ox = p.ox;
      if (p.oy !== pane.oy) pane.oy = p.oy;
    });
    observer.observe(body);
    return () => observer.disconnect();
  });

  function setOpacity(e) {
    viewer.opacity = clampOpacity(e.currentTarget.value);
    if (viewer.opacity < 1) viewer.fadeTo = viewer.opacity;
  }

  function toggleFade() {
    Object.assign(viewer, flipFade(viewer));
  }

  // Pinned, the window's place is worked out from its corner, the map's size and
  // the map's controls, read again whenever the map changes size.
  $effect(() => {
    const parent = el?.parentElement;
    if (!viewer.corner || !parent) return;
    const read = () => {
      const r = parent.getBoundingClientRect();
      wrap = { w: r.width, h: r.height };
      controls = chromeBoxes(parent);
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(parent);
    return () => observer.disconnect();
  });

  const spot = $derived(
    viewer.corner && wrap.w
      ? cornerSpot(viewer.corner, viewer.w, viewer.collapsed ? headH : viewer.h, wrap, controls)
      : null
  );

  // The window's own position follows its spot, so freeing it, keeping a frame
  // beside it or dragging it away all start from where it is seen.
  $effect(() => {
    if (!spot) return;
    if (untrack(() => viewer.x) !== spot.x) viewer.x = spot.x;
    if (untrack(() => viewer.y) !== spot.y) viewer.y = spot.y;
  });

  function choose(id) {
    placing = false;
    onplace?.(viewer.id, id);
  }

  /** The picture's own shape, which a docked window takes its height from. */
  function measured(w, h) {
    if (!w || !h) return;
    const aspect = w / h;
    if (Math.abs((viewer.aspect ?? 0) - aspect) > 1e-3) viewer.aspect = aspect;
  }

  // A clip's keys, while the window has the focus: Space plays, the arrows step
  // one frame. A slider keeps its own arrows, and a button its own Space.
  // Escape puts the places away.
  function onKey(e) {
    if (placing && e.key === 'Escape') {
      placing = false;
      e.stopPropagation();
      return;
    }
    if (!isVideo || !bar) return;
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter'))) return;
    if (e.key === ' ') bar.togglePlay();
    else if (e.key === 'ArrowLeft') bar.stepFrames(-1);
    else if (e.key === 'ArrowRight') bar.stepFrames(1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  const isVideo = $derived(viewer.kind === 'video');
  const pct = $derived(Math.round(viewer.scale * 100));
  const facts = $derived(hasFacts(viewer.facts) ? viewer.facts : null);
  const when = $derived(
    facts
      ? [facts.captured && `Captured ${facts.captured}`, facts.published && `Published ${facts.published}`]
          .filter(Boolean)
          .join(' · ')
      : ''
  );
  // Faded over the map, the picture lets the pointer through: the map pans and
  // zooms under it, which is what lining the two up takes.
  const seeThrough = $derived(!viewer.docked && viewer.opacity < 1);
  const src = $derived(viewer.still ?? (caseId ? fileUrl(caseId, viewer.path) : null));
  const transform = $derived(`translate(${viewer.ox}px, ${viewer.oy}px) scale(${viewer.scale})`);
  const place = $derived(placeOf(viewer));
</script>

{#snippet fade()}
  {#if !viewer.docked}
    <div class="rv-fade" class:on={viewer.opacity < 1}>
      <button
        class="rv-btn"
        class:lit={viewer.opacity < 1}
        onclick={toggleFade}
        title={viewer.opacity < 1 ? 'Solid again' : 'See the map through it'}
        aria-label="Fade"
        aria-pressed={viewer.opacity < 1}
      >
        <Icon name="fade" size={13} />
      </button>
      <input
        class="rv-range"
        type="range"
        min={MIN_OPACITY}
        max="1"
        step="0.05"
        value={viewer.opacity}
        style:--fill={`${((viewer.opacity - MIN_OPACITY) / (1 - MIN_OPACITY)) * 100}%`}
        oninput={setOpacity}
        aria-label="Opacity"
        title={`Opacity ${Math.round(viewer.opacity * 100)}%`}
      />
    </div>
  {/if}
{/snippet}

{#snippet zoomReset()}
  <button class="rv-zoom" onclick={resetZoom} title="Fit the clip">{pct}%</button>
{/snippet}

<div
  bind:this={el}
  class="ref-viewer card"
  class:collapsed={viewer.collapsed}
  class:docked={viewer.docked}
  class:see-through={seeThrough}
  style:left={viewer.docked ? null : `${spot?.x ?? viewer.x}px`}
  style:top={viewer.docked ? null : `${spot?.y ?? viewer.y}px`}
  style:width={viewer.docked ? null : `${viewer.w}px`}
  style:height={viewer.docked || viewer.collapsed ? null : `${viewer.h}px`}
  style:z-index={viewer.docked ? null : zBase + viewer.z}
  onpointerdown={focus}
  onkeydown={onKey}
  role="dialog"
  aria-label={viewer.title || 'Reference'}
  tabindex="0"
>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={headEl}
    bind:clientHeight={headH}
    class="rv-head"
    onpointerdown={startWindowDrag}
    title={viewer.docked || placing ? undefined : 'Drag to move'}
  >
    {#if !viewer.docked}
      <Icon name="grip" size={14} />
    {/if}
    {#if placing}
      <!-- The six places, where the title was: picked, the window goes there;
           the one it is in already sets it free. -->
      <div class="rv-places" role="group" aria-label="Places">
        {#each PLACES as option (option.id)}
          <button
            class="rv-btn"
            class:lit={place?.id === option.id}
            onclick={() => choose(option.id)}
            title={place?.id === option.id ? 'Free it' : option.label}
            aria-label={option.label}
            aria-pressed={place?.id === option.id}
          >
            <Icon name={option.icon} size={13} />
          </button>
        {/each}
      </div>
    {:else}
      <span class="rv-title" title={viewer.title}>{viewer.title || 'Reference'}</span>
    {/if}
    {#if facts && !placing}
      <button
        class="rv-btn"
        class:lit={viewer.info}
        onclick={() => (viewer.info = !viewer.info)}
        title={viewer.info ? 'Hide details' : 'Dates, source and notes'}
        aria-label="Details"
        aria-pressed={viewer.info}
      >
        <Icon name="info" size={13} />
      </button>
    {/if}
    <button
      class="rv-btn"
      class:lit={Boolean(place) || placing}
      onclick={() => (placing = !placing)}
      title={placing ? 'Put the places away' : place ? `${place.label}: move or free it` : 'Pin it beside or over the map'}
      aria-label="Place"
      aria-expanded={placing}
    >
      <Icon name={place?.icon ?? 'pushpin'} size={13} />
    </button>
    {#if !placing}
      <button
        class="rv-btn"
        onclick={() => (viewer.collapsed = !viewer.collapsed)}
        title={viewer.collapsed ? 'Expand' : 'Collapse'}
        aria-label={viewer.collapsed ? 'Expand' : 'Collapse'}
      >
        <Icon name={viewer.collapsed ? 'chevronDown' : 'chevronUp'} size={13} />
      </button>
      <button class="rv-btn" onclick={() => onclose?.(viewer.id)} title="Close" aria-label="Close">
        <Icon name="x" size={13} />
      </button>
    {/if}
  </div>

  {#if !viewer.collapsed}
    {#if viewer.info && facts}
      <div class="rv-facts">
        {#if when}
          <p>{when}</p>
        {/if}
        {#if facts.source}
          <a href={facts.source.url} target="_blank" rel="noopener noreferrer" title={facts.source.url}>
            <span>{facts.source.label}</span>
            <Icon name="external" size={10} />
          </a>
        {/if}
        {#if facts.notes}
          <p class="rv-notes">{facts.notes}</p>
        {/if}
      </div>
    {/if}

    <div class="rv-stage" style:--aspect={viewer.aspect ?? 4 / 3}>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        bind:this={bodyEl}
        class="rv-body"
        class:pannable={viewer.scale > MIN_SCALE}
        class:clip={isVideo}
        style:opacity={viewer.docked ? null : viewer.opacity}
        onpointerdown={startPan}
        onwheel={onWheel}
      >
        {#if src}
          {#if isVideo}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video
              bind:this={video}
              {src}
              preload="metadata"
              playsinline
              style:transform={transform}
              onloadedmetadata={(e) => measured(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
            ></video>
          {:else}
            <img
              {src}
              alt={viewer.title}
              draggable="false"
              style:transform={transform}
              onload={(e) => measured(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
            />
          {/if}
        {/if}
      </div>

      {#if isVideo}
        <div class="rv-line" style:width={progress}></div>
        <div class="rv-bar clip">
          <RefVideoBar
            bind:this={bar}
            bind:progress
            {video}
            {viewer}
            {fade}
            zoom={viewer.scale > MIN_SCALE ? zoomReset : null}
            onkeep={(still, at) => onkeep?.(viewer.id, still, at)}
          />
        </div>
      {:else}
        <div class="rv-bar">
          {@render fade()}
          <span class="rv-gap"></span>
          <button class="rv-btn" onclick={() => zoomBy(1 / 1.25)} title="Zoom out" aria-label="Zoom out">
            <Icon name="minimize" size={12} />
          </button>
          <button class="rv-zoom" onclick={resetZoom} title="Reset zoom">{pct}%</button>
          <button class="rv-btn" onclick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in">
            <Icon name="plus" size={13} />
          </button>
        </div>
      {/if}
    </div>

    {#if !viewer.docked}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="rv-resize {viewer.corner ? `from-${viewer.corner}` : ''}"
        onpointerdown={startResize}
        title="Resize"
      ></div>
    {/if}
  {/if}
</div>

<style>
  /* The window's own background sits behind its bars rather than behind the
     picture, so fading the picture shows the map and not a grey sheet. */
  .ref-viewer {
    --rv-glass: rgba(24, 24, 24, 0.92);
    position: absolute;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: transparent;
    box-shadow: var(--shadow-2);
    user-select: none;
    outline: none;
  }
  .ref-viewer:focus-visible {
    border-color: var(--accent);
  }
  /* Faded, only the bars take the pointer: the picture is the map's to pan. */
  .ref-viewer.see-through,
  .ref-viewer.see-through .rv-stage,
  .ref-viewer.see-through .rv-body {
    pointer-events: none;
  }
  .ref-viewer.see-through > :not(.rv-stage),
  .ref-viewer.see-through .rv-bar {
    pointer-events: auto;
  }
  /* Docked: one window of the column, as tall as its picture. */
  .ref-viewer.docked {
    position: relative;
    flex: 0 1 auto;
    min-height: 0;
    border: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
    box-shadow: none;
    --rv-glass: var(--bg-1);
  }
  .rv-head,
  .rv-facts {
    background: var(--rv-glass);
    backdrop-filter: blur(6px);
  }
  .rv-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 5px 4px 8px;
    color: var(--text-2);
    cursor: grab;
    flex-shrink: 0;
  }
  .rv-head:active {
    cursor: grabbing;
  }
  .docked .rv-head,
  .docked .rv-head:active {
    cursor: default;
  }
  .rv-title {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-xs);
    color: var(--text-1);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rv-btn {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    cursor: pointer;
    flex-shrink: 0;
  }
  .rv-btn:hover {
    color: var(--text-1);
    background: rgba(255, 255, 255, 0.08);
  }
  .rv-btn.lit {
    color: var(--accent);
  }
  .rv-facts {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 96px;
    overflow: auto;
    padding: 2px 9px 7px;
    border-bottom: 1px solid var(--border);
    font-size: var(--fs-xs);
    color: var(--text-2);
    user-select: text;
    flex-shrink: 0;
  }
  .rv-facts p {
    margin: 0;
  }
  .rv-facts a {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    align-self: flex-start;
    max-width: 100%;
    color: var(--text-2);
    text-decoration: none;
  }
  .rv-facts a span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rv-facts a:hover {
    color: var(--accent);
  }
  .rv-notes {
    color: var(--text-1);
    white-space: pre-line;
  }
  /* The picture, and over its bottom edge the bar that comes up on a hover. */
  .rv-stage {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .docked .rv-stage {
    flex: 0 1 auto;
    aspect-ratio: var(--aspect);
    min-height: 60px;
  }
  .rv-body {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background:
      linear-gradient(45deg, rgba(255, 255, 255, 0.03) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.03) 75%),
      linear-gradient(45deg, rgba(255, 255, 255, 0.03) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.03) 75%),
      #171717;
    background-size: 16px 16px, 16px 16px, auto;
    background-position: 0 0, 8px 8px, 0 0;
    transition: opacity 0.12s;
  }
  .rv-body.clip {
    background: #000;
    cursor: pointer;
  }
  .rv-body.pannable {
    cursor: grab;
  }
  .rv-body.pannable:active {
    cursor: grabbing;
  }
  .rv-body img,
  .rv-body video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    transform-origin: 0 0;
    pointer-events: none;
  }
  .rv-bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 10px 8px 3px;
    color: var(--text-2);
    background: linear-gradient(to top, rgba(12, 12, 12, 0.88) 55%, rgba(12, 12, 12, 0));
    opacity: 0;
    transform: translateY(3px);
    pointer-events: none;
    transition:
      opacity 0.14s,
      transform 0.14s;
  }
  .rv-bar.clip {
    display: block;
    padding: 14px 6px 3px;
  }
  /* clear of the resize corner, which sits over the bar's last button */
  .ref-viewer:not(.docked) .rv-bar {
    padding-right: 16px;
  }
  .ref-viewer:hover .rv-bar,
  .ref-viewer:focus-visible .rv-bar,
  .ref-viewer:has(:focus-visible) .rv-bar,
  .ref-viewer.see-through .rv-bar {
    opacity: 1;
    transform: none;
    pointer-events: auto;
  }
  /* A clip at rest still says how far it has played. */
  .rv-line {
    position: absolute;
    left: 0;
    bottom: 0;
    height: 2px;
    background: var(--accent);
    opacity: 0.85;
    pointer-events: none;
    transition: opacity 0.14s;
  }
  .ref-viewer:hover .rv-line,
  .ref-viewer.see-through .rv-line {
    opacity: 0;
  }
  .rv-gap {
    flex: 1;
  }
  .rv-zoom {
    min-width: 42px;
    text-align: center;
    font-size: var(--fs-xs);
    color: var(--text-2);
    cursor: pointer;
    padding: 2px 4px;
    border-radius: var(--r-sm);
  }
  .rv-zoom:hover {
    color: var(--accent);
    background: rgba(255, 255, 255, 0.08);
  }
  /* The fade is a glyph at rest; its slider opens beside it on a hover, and
     stays out while the picture is faded so the value can be worked. */
  .rv-fade {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .rv-range {
    width: 0;
    opacity: 0;
    margin: 0;
    height: 14px;
    background: transparent;
    appearance: none;
    cursor: pointer;
    transition:
      width 0.15s,
      opacity 0.15s;
  }
  .rv-fade:hover .rv-range,
  .rv-fade:focus-within .rv-range,
  .rv-fade.on .rv-range {
    width: 52px;
    opacity: 1;
  }
  .rv-range::-webkit-slider-runnable-track {
    height: 3px;
    border-radius: 2px;
    background: linear-gradient(to right, var(--accent) var(--fill), rgba(255, 255, 255, 0.22) var(--fill));
  }
  .rv-range::-moz-range-track {
    height: 3px;
    border-radius: 2px;
    background: linear-gradient(to right, var(--accent) var(--fill), rgba(255, 255, 255, 0.22) var(--fill));
  }
  .rv-range::-webkit-slider-thumb {
    appearance: none;
    width: 10px;
    height: 10px;
    margin-top: -3.5px;
    border: none;
    border-radius: 50%;
    background: var(--text-1);
  }
  .rv-range::-moz-range-thumb {
    width: 10px;
    height: 10px;
    border: none;
    border-radius: 50%;
    background: var(--text-1);
  }
  .rv-resize {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 16px;
    height: 16px;
    cursor: nwse-resize;
    opacity: 0;
    transition: opacity 0.14s;
    background: linear-gradient(
      135deg,
      transparent 50%,
      var(--border-strong) 50%,
      var(--border-strong) 60%,
      transparent 60%,
      transparent 72%,
      var(--border-strong) 72%,
      var(--border-strong) 82%,
      transparent 82%
    );
  }
  .ref-viewer:hover .rv-resize {
    opacity: 1;
  }
  /* Pinned, the handle sits on the corner facing the map's middle. */
  .rv-resize.from-tr,
  .rv-resize.from-bl {
    cursor: nesw-resize;
  }
  .rv-resize.from-tr {
    left: 0;
    right: auto;
    transform: scaleX(-1);
  }
  .rv-resize.from-bl {
    top: 0;
    bottom: auto;
    transform: scaleY(-1);
  }
  .rv-resize.from-br {
    top: 0;
    left: 0;
    right: auto;
    bottom: auto;
    transform: scale(-1, -1);
  }
  .rv-places {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 1px;
  }
  .rv-places .rv-btn:nth-child(3) {
    margin-left: 6px; /* the columns, then the corners */
  }
</style>
