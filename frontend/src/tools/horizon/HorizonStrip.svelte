<script>
  /**
   * The whole turn over the view, north at the left edge (lib/horizon/strip.js).
   *
   * However narrow the lens, this says where it points: the skyline of the full
   * turn fitted to the strip's height, the slope close by hatched, the lens's
   * field left clear and the rest veiled, the eight winds on a band of their
   * own under it, the marked point, and the sun and moon while their paths
   * are on. Drag the field to turn; a press elsewhere faces that way and can
   * be dragged on from there. While a laid photo is pinned to the terrain the
   * strip only reads (turning would part them), its field following the view
   * as it moves over the terrain.
   */
  import { rayFor } from '../../lib/horizon/camera.js';
  import { windOf } from '../../lib/horizon/geometry.js';
  import { wrap360 } from '../../lib/horizon/panorama.js';
  import {
    fieldSpans,
    outsideSpans,
    silhouette,
    STRIP_GROUND,
    STRIP_HEIGHT,
    stripAzimuth,
    stripLevel,
    stripRange,
    stripScale,
    stripX,
    stripY,
    WINDS,
  } from '../../lib/horizon/strip.js';

  let {
    /** The tab's view state (state/horizon.svelte.js). */
    view,
    /** The view's frame, which says how much of the turn the lens takes in. */
    frame = { width: 0, height: 0 },
    /** Where the sun and the moon stand at the chosen time, `{ sun, moon }`, or null. */
    bodies = null,
    /** A laid photo held to the terrain: the strip reads, it does not turn. */
    locked = false,
    /** The loupe the view is seen through, or null: the field is what it shows. */
    loupe = null,
  } = $props();

  /** Under this width the strip keeps the four cardinal winds only. */
  const ALL_WINDS_FROM = 560;

  let width = $state(0);
  let hover = $state(null);
  let press = null;

  const range = $derived(stripRange(view.panorama));
  const shape = $derived(width ? silhouette(view.panorama, width, range) : null);
  const level = $derived(view.panorama ? stripLevel(range) : null);

  /** The lens's field across the strip: the directions at the frame's two edges. */
  const field = $derived.by(() => {
    if (!width || !frame.width) return [];
    const camera = { ...view.camera, width: frame.width, height: frame.height, ...(loupe ? { loupe } : {}) };
    if (camera.projection === 'panorama' && camera.fov >= 360) return [];
    const left = rayFor(camera, 0, frame.height / 2).azimuth;
    const right = rayFor(camera, frame.width, frame.height / 2).azimuth;
    const span = camera.projection === 'panorama' ? camera.fov : wrap360(right - left);
    return fieldSpans(left, span, width);
  });
  const veils = $derived(outsideSpans(field, width));
  const winds = $derived(width >= ALL_WINDS_FROM ? WINDS : WINDS.filter((wind) => wind.cardinal));

  const marked = $derived.by(() => {
    const target = view.target;
    if (!width || !target || target.busy || target.error) return null;
    return { x: stripX(target.azimuth, width), seen: target.visible };
  });

  /** A body in the strip, pinned to the top edge when it stands higher than the strip shows. */
  function body(at) {
    if (!at || !width || at.altitude < -3) return null;
    return { x: stripX(at.azimuth, width), y: Math.min(STRIP_GROUND - 3, Math.max(4, stripY(at.altitude, range))) };
  }
  const sun = $derived(body(bodies?.sun));
  const moon = $derived(body(bodies?.moon));

  // -- turning from the strip ----------------------------------------------------

  const local = (event) => event.clientX - event.currentTarget.getBoundingClientRect().left;
  const onField = (x) => field.some((span) => x >= span.x - 4 && x <= span.x + span.width + 4);

  function onPointerDown(event) {
    if (event.button !== 0 || !view.panorama || !width || locked) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const x = local(event);
    // a press off the field faces that way first, then drags like the field
    if (!onField(x)) view.look({ heading: stripAzimuth(x, width) });
    press = { x, heading: view.camera.heading };
  }

  function onPointerMove(event) {
    const x = local(event);
    hover = { x, azimuth: stripAzimuth(x, width) };
    if (!press) return;
    view.look({ heading: press.heading + (x - press.x) / stripScale(width) });
  }

  function onPointerUp() {
    press = null;
  }

  function onKey(event) {
    if (locked) return;
    const step = event.shiftKey ? 10 : 1;
    const turn = { ArrowLeft: -step, ArrowRight: step, ArrowDown: -step, ArrowUp: step }[event.key];
    if (turn == null) return;
    event.preventDefault();
    view.look({ heading: view.camera.heading + turn });
  }

  const hoverNear = $derived(Boolean(hover && shape?.near.some((span) => hover.x >= span.x && hover.x <= span.x + span.width)));
  const tag = $derived(hover ? `${Math.round(hover.azimuth) % 360}° ${windOf(hover.azimuth)}${hoverNear ? ' · ground close by' : ''}` : '');
</script>

<div
  class="hz-strip"
  class:locked
  title={locked ? 'The photo is locked to the terrain: unlock it to turn' : undefined}
  bind:clientWidth={width}
  role="slider"
  tabindex="0"
  aria-label="Heading on the whole turn"
  aria-valuemin="0"
  aria-valuemax="360"
  aria-valuenow={Math.round(view.camera.heading)}
  aria-valuetext="{Math.round(view.camera.heading)}° {windOf(view.camera.heading)}"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onpointerleave={() => (hover = null)}
  onkeydown={onKey}
>
  {#if width}
    <svg {width} height={STRIP_HEIGHT} aria-hidden="true">
      <defs>
        <pattern id="hz-strip-near" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
          <line class="hatch" x1="0" y1="0" x2="0" y2="5" />
        </pattern>
      </defs>
      <rect class="winds-band" x="0" y={STRIP_GROUND} {width} height={STRIP_HEIGHT - STRIP_GROUND} />
      {#if level != null}
        <line class="level" x1="0" x2={width} y1={level} y2={level} />
      {/if}
      {#if shape}
        <path class="land" d={shape.fill} />
        <path class="skyline" d={shape.line} />
        {#each shape.near as span, index (index)}
          <rect class="near" x={span.x} y="0" width={span.width} height={STRIP_GROUND} />
        {/each}
      {/if}
      {#each veils as veil, index (index)}
        <rect class="veil" x={veil.x} y="0" width={veil.width} height={STRIP_GROUND} />
      {/each}
      {#each field as span, index (index)}
        <rect class="field" x={span.x + 0.75} y="0.75" width={Math.max(2, span.width - 1.5)} height={STRIP_GROUND - 1.5} rx="3" />
      {/each}
      {#each winds as wind (wind.label)}
        {@const x = stripX(wind.azimuth, width)}
        <line class="wind-tick" class:cardinal={wind.cardinal} x1={x} x2={x} y1={STRIP_GROUND} y2={STRIP_GROUND + (wind.cardinal ? 4 : 3)} />
        <text
          class="wind"
          class:cardinal={wind.cardinal}
          x={wind.azimuth === 0 ? 4 : x}
          y={STRIP_HEIGHT - 3}
          text-anchor={wind.azimuth === 0 ? 'start' : 'middle'}>{wind.label}</text
        >
      {/each}
      <text class="wind cardinal" x={width - 4} y={STRIP_HEIGHT - 3} text-anchor="end">N</text>
      {#if marked}
        <path class="marked" class:hidden={!marked.seen} d="M{marked.x} 7 l-3.5 -6 h7 Z" />
      {/if}
      {#if moon}<circle class="moon" cx={moon.x} cy={moon.y} r="2.5" />{/if}
      {#if sun}<circle class="sun" cx={sun.x} cy={sun.y} r="3" />{/if}
      {#if hover}
        <line class="hairline" x1={hover.x} x2={hover.x} y1="0" y2={STRIP_GROUND} />
      {/if}
    </svg>
    {#if hover}
      <span class="tag mono" style:left="{Math.min(width - 64, Math.max(4, hover.x + 6))}px">{tag}</span>
    {/if}
  {/if}
</div>

<style>
  .hz-strip {
    position: relative;
    flex: 0 0 44px;
    height: 44px;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
    cursor: ew-resize;
    outline: none;
    touch-action: none;
    user-select: none;
    overflow: hidden;
  }
  .hz-strip.locked {
    cursor: default;
  }
  .hz-strip:focus-visible {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  svg {
    display: block;
  }
  .winds-band {
    fill: color-mix(in srgb, var(--bg-0) 55%, var(--bg-1));
  }
  .level {
    stroke: color-mix(in srgb, var(--text-1) 25%, transparent);
    stroke-dasharray: 2 4;
  }
  .land {
    fill: color-mix(in srgb, var(--text-1) 16%, transparent);
  }
  .skyline {
    fill: none;
    stroke: color-mix(in srgb, var(--text-1) 70%, transparent);
    stroke-width: 1.25;
    stroke-linejoin: round;
  }
  /* the slope the eye stands on: hatched, so a full strip there reads as ground close by */
  .near {
    fill: url(#hz-strip-near);
  }
  .hatch {
    stroke: color-mix(in srgb, var(--text-1) 30%, transparent);
    stroke-width: 1.5;
  }
  /* what the lens does not take in sinks back; the field keeps the strip's own light */
  .veil {
    fill: color-mix(in srgb, var(--bg-0) 62%, transparent);
  }
  .field {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
  }
  .wind-tick {
    stroke: color-mix(in srgb, var(--text-1) 30%, transparent);
  }
  .wind-tick.cardinal {
    stroke: color-mix(in srgb, var(--text-1) 55%, transparent);
  }
  .wind {
    fill: var(--text-3);
    font-family: var(--font-mono);
    font-size: 9px;
  }
  .wind.cardinal {
    fill: var(--text-1);
    font-size: 10px;
    font-weight: 700;
  }
  .marked {
    fill: var(--hz-seen);
    stroke: var(--bg-0);
    stroke-width: 1;
  }
  .marked.hidden {
    fill: var(--hz-hidden);
  }
  .sun {
    fill: var(--hz-sun);
  }
  .moon {
    fill: var(--hz-moon);
  }
  .hairline {
    stroke: var(--text-2);
    stroke-width: 1;
  }
  .tag {
    position: absolute;
    top: 6px;
    padding: 0 5px;
    border-radius: var(--r-sm);
    background: var(--hz-glass);
    box-shadow: 0 0 0 1px var(--border);
    color: var(--text-1);
    font-size: 10px;
    line-height: 16px;
    pointer-events: none;
    white-space: nowrap;
  }
</style>
